#!/usr/bin/env node

import fs from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

import { confirm, input, search, select } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';

import {
  API_URL,
  COMPOSE_DIR,
  CONTAINER,
  HEALTH_TIMEOUT_MS,
  MODELS_DIR,
  SERVICE,
} from './config.js';

import {
  findModels,
  getCurrentModel,
  getModelByRelativePath,
  setCurrentModel,
} from './lib/models.js';

import {
  formatBytes,
  friendlyModelName,
  matchesSearchTerm,
  printTitle,
} from './lib/ui.js';

import { runDownloadCommand } from './commands/download.js';

import {
  benchmarkModels,
  printComparisonTable,
  runBenchmarkCommand,
  runCompareModelsCommand,
} from './commands/benchmark.js';

import {
  getDeleteTarget,
  removeTarget,
  runDeleteCommand,
} from './commands/delete.js';

import type { ModelInfo, RunOptions } from './types.js';

const execFileAsync = promisify(execFile);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCancellation(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === 'ExitPromptError' ||
    error.message.includes('SIGINT') ||
    error.message.includes('force closed')
  );
}

async function runMenuAction(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error: unknown) {
    if (isCancellation(error)) {
      throw error;
    }

    console.log();
    console.error(chalk.red(errorMessage(error)));
  }
}

async function run(command: string, args: string[], options: RunOptions = {}) {
  return execFileAsync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function clearScreen(): void {
  if (process.stdout.isTTY) {
    console.clear();
  }
}

function getFreeSpace(): number {
  const stats = fs.statfsSync(MODELS_DIR);

  return stats.bavail * stats.bsize;
}

async function restartServer(): Promise<void> {
  await run('docker', ['compose', 'restart', SERVICE], {
    cwd: COMPOSE_DIR,
  });
}

async function isHealthy(): Promise<boolean> {
  try {
    await run('curl', ['-fsS', '--max-time', '3', `${API_URL}/v1/models`]);

    return true;
  } catch {
    return false;
  }
}

async function waitForHealth(): Promise<boolean> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < HEALTH_TIMEOUT_MS) {
    if (await isHealthy()) {
      return true;
    }

    await sleep(3000);
  }

  return false;
}

async function showLogs(lines = 100): Promise<void> {
  const child = spawn('docker', ['logs', `--tail=${lines}`, CONTAINER], {
    stdio: 'inherit',
  });

  await new Promise<void>((resolve, reject) => {
    child.on('error', reject);

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`docker logs exited with code ${String(code)}`));
    });
  });
}

async function switchModel(target: ModelInfo): Promise<boolean> {
  const previous = getCurrentModel();

  if (previous === target.relativePath) {
    console.log(
      chalk.yellow(`Already using ${friendlyModelName(target.relativePath)}.`),
    );

    return true;
  }

  const spinner = ora(
    `Switching to ${friendlyModelName(target.relativePath)}`,
  ).start();

  try {
    setCurrentModel(target.relativePath);

    spinner.text = 'Restarting llama.cpp';

    await restartServer();

    spinner.text = 'Waiting for llama.cpp to become healthy';

    if (!(await waitForHealth())) {
      throw new Error('llama.cpp did not become healthy before the timeout.');
    }

    spinner.succeed(
      chalk.green(`Now using ${friendlyModelName(target.relativePath)}`),
    );

    return true;
  } catch (error: unknown) {
    spinner.fail(
      chalk.red(`Failed to load ${friendlyModelName(target.relativePath)}`),
    );

    if (previous) {
      const rollback = ora(
        `Rolling back to ${friendlyModelName(previous)}`,
      ).start();

      try {
        setCurrentModel(previous);
        await restartServer();

        if (await waitForHealth()) {
          rollback.succeed(chalk.green('Rollback succeeded'));
        } else {
          rollback.fail(chalk.red('Rollback failed health check'));
        }
      } catch (rollbackError: unknown) {
        rollback.fail(
          chalk.red(`Rollback failed: ${errorMessage(rollbackError)}`),
        );
      }
    }

    console.error(chalk.red(errorMessage(error)));

    console.log(chalk.dim('\nRecent llama.cpp logs:\n'));

    await showLogs(40).catch(() => undefined);

    return false;
  }
}

async function switchModelInteractive(target: ModelInfo): Promise<boolean> {
  const currentPath = getCurrentModel();
  const currentModel = currentPath ? getModelByRelativePath(currentPath) : null;

  if (!currentModel || currentModel.relativePath === target.relativePath) {
    return switchModel(target);
  }

  console.log();

  const shouldCompare = await confirm({
    message: `Compare ${friendlyModelName(currentModel.relativePath)} with ${friendlyModelName(target.relativePath)} before switching?`,
    default: false,
  });

  if (!shouldCompare) {
    return switchModel(target);
  }

  const entries = await benchmarkModels([currentModel, target], switchModel);

  printComparisonTable(entries);

  console.log();

  const decision = await select<'switch' | 'keep' | 'delete'>({
    message: `Use ${friendlyModelName(target.relativePath)}?`,
    choices: [
      {
        name: `Yes — switch to ${friendlyModelName(target.relativePath)}`,
        value: 'switch',
      },
      {
        name: `No — keep ${friendlyModelName(currentModel.relativePath)}, do not switch`,
        value: 'keep',
      },
      {
        name: chalk.red(`Delete ${friendlyModelName(target.relativePath)}`),
        value: 'delete',
      },
    ],
  });

  if (decision === 'switch') {
    return switchModel(target);
  }

  await switchModel(currentModel);

  if (decision === 'delete') {
    const deleteChoice = getDeleteTarget(target);

    removeTarget(deleteChoice.deletePath);

    console.log(chalk.dim(`Deleted ${deleteChoice.displayPath}.`));
  } else {
    console.log(
      chalk.dim(
        `Keeping ${friendlyModelName(target.relativePath)} installed without switching.`,
      ),
    );
  }

  return false;
}

async function interactiveModelSelect(): Promise<void> {
  const models = findModels();
  const current = getCurrentModel();

  if (models.length === 0) {
    console.error(chalk.red('No GGUF models were found.'));

    return;
  }

  clearScreen();
  printTitle();

  const healthy = await isHealthy();

  console.log(
    `${chalk.bold('API:')} ${
      healthy ? chalk.green('● healthy') : chalk.red('● unavailable')
    }`,
  );

  console.log(
    `${chalk.bold('Current:')} ${
      current ? chalk.cyan(friendlyModelName(current)) : chalk.yellow('none')
    }`,
  );

  console.log();

  const chosen = await search<ModelInfo | null>({
    message: 'Select a model (type to search)',
    pageSize: 15,
    source: (term) => {
      const filtered = term
        ? models.filter((model: ModelInfo) =>
            matchesSearchTerm(
              term,
              friendlyModelName(model.relativePath),
              model.relativePath,
            ),
          )
        : models;

      return [
        ...filtered.map((model: ModelInfo) => {
          const isCurrent = model.relativePath === current;

          return {
            name: [
              isCurrent ? chalk.green('●') : chalk.dim('○'),

              isCurrent
                ? chalk.bold.green(friendlyModelName(model.relativePath))
                : chalk.white(friendlyModelName(model.relativePath)),

              chalk.dim(formatBytes(model.size)),

              isCurrent ? chalk.yellow('current') : '',
            ]
              .filter(Boolean)
              .join('  '),

            value: model,
            description: model.relativePath,
          };
        }),
        {
          name: chalk.dim('← Back'),
          value: null,
        },
      ];
    },
  });

  if (!chosen) {
    return;
  }

  console.log();
  await switchModelInteractive(chosen);
}

function listModels(): void {
  const current = getCurrentModel();
  const models = findModels();

  if (models.length === 0) {
    console.log(chalk.yellow('No models found.'));

    return;
  }

  for (const model of models) {
    const isCurrent = model.relativePath === current;

    const marker = isCurrent ? chalk.green('●') : chalk.dim('○');

    const name = isCurrent
      ? chalk.bold.green(model.relativePath)
      : model.relativePath;

    console.log(`${marker} ${name} ${chalk.dim(formatBytes(model.size))}`);
  }
}

async function showStatus(): Promise<void> {
  const current = getCurrentModel();

  const activeModel = findModels().find(
    (model: ModelInfo) => model.relativePath === current,
  );

  printTitle();

  console.log(
    `${chalk.bold('Selected:')} ${
      current ? chalk.cyan(current) : chalk.yellow('none')
    }`,
  );

  if (activeModel) {
    console.log(
      `${chalk.bold('Name:')} ${friendlyModelName(activeModel.relativePath)}`,
    );

    console.log(`${chalk.bold('Size:')} ${formatBytes(activeModel.size)}`);
  } else if (current) {
    console.log(`${chalk.bold('File:')} ${chalk.red('missing or invalid')}`);
  }

  const healthy = await isHealthy();

  console.log(
    `${chalk.bold('API:')} ${
      healthy
        ? chalk.green(`${API_URL} — healthy`)
        : chalk.red(`${API_URL} — unavailable`)
    }`,
  );

  try {
    const { stdout } = await run(
      'docker',
      ['compose', 'ps', '--status', 'running', '--services'],
      {
        cwd: COMPOSE_DIR,
      },
    );

    const services = stdout.trim().split('\n').filter(Boolean);

    console.log(
      `${chalk.bold('Container:')} ${
        services.includes(SERVICE)
          ? chalk.green('running')
          : chalk.red('stopped')
      }`,
    );
  } catch {
    console.log(`${chalk.bold('Container:')} ${chalk.red('unknown')}`);
  }

  console.log(`${chalk.bold('Free space:')} ${formatBytes(getFreeSpace())}`);

  console.log();
}

async function restartCommand(): Promise<void> {
  const spinner = ora('Restarting llama.cpp').start();

  try {
    await restartServer();

    spinner.text = 'Waiting for llama.cpp to become healthy';

    if (await waitForHealth()) {
      spinner.succeed(chalk.green('llama.cpp restarted successfully'));
    } else {
      spinner.fail(chalk.red('llama.cpp failed its health check'));

      process.exitCode = 1;
    }
  } catch (error: unknown) {
    spinner.fail(chalk.red(errorMessage(error)));

    process.exitCode = 1;
  }
}

async function pause(): Promise<void> {
  await input({
    message: 'Press Enter to return',
  });
}

async function mainMenu(): Promise<void> {
  let running = true;

  while (running) {
    clearScreen();
    printTitle();

    const current = getCurrentModel();
    const healthy = await isHealthy();

    console.log(
      `${chalk.bold('Server:')} ${
        healthy ? chalk.green('● healthy') : chalk.red('● unavailable')
      }`,
    );

    console.log(
      `${chalk.bold('Model:')} ${
        current ? chalk.cyan(friendlyModelName(current)) : chalk.yellow('none')
      }`,
    );

    console.log(`${chalk.bold('Free space:')} ${formatBytes(getFreeSpace())}`);

    console.log();

    const action = await select<string>({
      message: 'Choose an action',
      choices: [
        {
          name: 'Switch model',
          value: 'switch',
        },
        {
          name: 'Download model from Hugging Face',
          value: 'download',
        },
        {
          name: 'Delete model',
          value: 'delete',
        },
        {
          name: 'Benchmark current model',
          value: 'benchmark',
        },
        {
          name: 'Compare models (benchmark)',
          value: 'compare',
        },
        {
          name: 'Status',
          value: 'status',
        },
        {
          name: 'Restart llama.cpp',
          value: 'restart',
        },
        {
          name: 'View logs',
          value: 'logs',
        },
        {
          name: chalk.dim('Exit'),
          value: 'exit',
        },
      ],
    });

    switch (action) {
      case 'switch':
        await runMenuAction(interactiveModelSelect);
        break;

      case 'download':
        clearScreen();

        await runMenuAction(() => runDownloadCommand(switchModelInteractive));

        await pause();
        break;

      case 'delete':
        clearScreen();

        await runMenuAction(runDeleteCommand);

        await pause();
        break;

      case 'benchmark':
        clearScreen();

        await runMenuAction(runBenchmarkCommand);

        await pause();
        break;

      case 'compare':
        clearScreen();

        await runMenuAction(() => runCompareModelsCommand(switchModel));

        await pause();
        break;

      case 'status':
        clearScreen();

        await runMenuAction(showStatus);

        await pause();
        break;

      case 'restart':
        clearScreen();

        await runMenuAction(restartCommand);

        await pause();
        break;

      case 'logs':
        clearScreen();

        await runMenuAction(() => showLogs(100));

        await pause();
        break;

      case 'exit':
        running = false;
        break;

      default:
        break;
    }
  }
}

function showHelp(): void {
  console.log(`
${chalk.bold.cyan('AI Model Manager')}

${chalk.bold('Usage')}
  manager                Open the main menu
  manager switch         Open the model selector
  manager download       Download a Hugging Face model
  manager delete         Delete an installed model
  manager remove         Alias for delete
  manager rm             Alias for delete
  manager benchmark      Benchmark the active model
  manager compare        Benchmark and compare multiple models
  manager list           List installed models
  manager current        Show the active model
  manager status         Show server and storage status
  manager restart        Restart llama.cpp
  manager logs [n]       Show recent logs
  manager exit           Exit immediately
  manager quit           Exit immediately
  manager q              Exit immediately
  manager help           Show this help
`);
}

async function main(): Promise<void> {
  const command = process.argv[2];

  switch (command) {
    case undefined:
      await mainMenu();
      break;

    case 'select':
    case 'switch':
      await interactiveModelSelect();
      break;

    case 'download':
      await runDownloadCommand(switchModelInteractive);
      break;

    case 'delete':
    case 'remove':
    case 'rm':
      await runDeleteCommand();
      break;

    case 'benchmark':
      await runBenchmarkCommand();
      break;

    case 'compare':
      await runCompareModelsCommand(switchModel);
      break;

    case 'list':
      listModels();
      break;

    case 'current':
      console.log(getCurrentModel() ?? 'none');
      break;

    case 'status':
      await showStatus();
      break;

    case 'restart':
      await restartCommand();
      break;

    case 'logs': {
      const requested = Number.parseInt(process.argv[3] ?? '100', 10);

      await showLogs(Number.isFinite(requested) ? requested : 100);

      break;
    }

    case 'exit':
    case 'quit':
    case 'q':
      return;

    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;

    default:
      console.error(chalk.red(`Unknown command: ${command}`));

      showHelp();
      process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  if (isCancellation(error)) {
    console.log();
    console.log(chalk.dim('Cancelled.'));

    process.exit(0);
  }

  console.error();
  console.error(chalk.red(errorMessage(error)));

  process.exitCode = 1;
});
