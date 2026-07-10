#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

import select from '@inquirer/select';
import chalk from 'chalk';
import ora from 'ora';

import {
  API_URL,
  COMPOSE_DIR,
  CONTAINER,
  HEALTH_TIMEOUT_MS,
  SERVICE,
} from './config.js';

import {
  findModels,
  getCurrentModel,
  setCurrentModel,
} from './lib/models.js';

import {
  formatBytes,
  friendlyModelName,
  printTitle,
} from './lib/ui.js';

const execFileAsync = promisify(execFile);

async function run(command, args, options = {}) {
  return execFileAsync(command, args, {
    cwd: options.cwd,
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function restartServer() {
  await run(
    'docker',
    ['compose', 'restart', SERVICE],
    { cwd: COMPOSE_DIR },
  );
}

async function isHealthy() {
  try {
    await run('curl', [
      '-fsS',
      '--max-time',
      '3',
      `${API_URL}/v1/models`,
    ]);

    return true;
  } catch {
    return false;
  }
}

async function waitForHealth() {
  const startedAt = Date.now();

  while (Date.now() - startedAt < HEALTH_TIMEOUT_MS) {
    if (await isHealthy()) {
      return true;
    }

    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  return false;
}

async function showLogs(lines = 100) {
  const child = spawn(
    'docker',
    ['logs', `--tail=${lines}`, CONTAINER],
    {
      stdio: 'inherit',
    },
  );

  await new Promise((resolve, reject) => {
    child.on('error', reject);

    child.on('exit', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`docker logs exited with code ${code}`));
      }
    });
  });
}

async function switchModel(target) {
  const previous = getCurrentModel();

  if (previous === target.relativePath) {
    console.log(
      chalk.yellow(
        `Already using ${friendlyModelName(target.relativePath)}.`,
      ),
    );
    return;
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
      throw new Error(
        'llama.cpp did not become healthy before the timeout.',
      );
    }

    spinner.succeed(
      chalk.green(
        `Now using ${friendlyModelName(target.relativePath)}`,
      ),
    );
  } catch (error) {
    spinner.fail(
      chalk.red(
        `Failed to load ${friendlyModelName(target.relativePath)}`,
      ),
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
      } catch (rollbackError) {
        rollback.fail(
          chalk.red(`Rollback failed: ${rollbackError.message}`),
        );
      }
    }

    console.error(chalk.red(error.message));
    console.log(chalk.dim('\nRecent llama.cpp logs:\n'));

    await showLogs(40).catch(() => {});
    process.exitCode = 1;
  }
}

async function interactiveSelect() {
  const models = findModels();
  const current = getCurrentModel();

  if (models.length === 0) {
    console.error(
      chalk.red('No GGUF models were found in the models directory.'),
    );
    process.exitCode = 1;
    return;
  }

  printTitle();

  const healthy = await isHealthy();

  console.log(
    `${chalk.bold('API:')} ${
      healthy
        ? chalk.green('● healthy')
        : chalk.red('● unavailable')
    }`,
  );

  console.log(
    `${chalk.bold('Current:')} ${
      current
        ? chalk.cyan(friendlyModelName(current))
        : chalk.yellow('none')
    }`,
  );

  console.log();

  const chosen = await select({
    message: 'Select a model',
    pageSize: 12,
    choices: models.map(model => {
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
  });

  console.log();
  await switchModel(chosen);
}

function listModels() {
  const current = getCurrentModel();
  const models = findModels();

  if (models.length === 0) {
    console.log(chalk.yellow('No models found.'));
    return;
  }

  for (const model of models) {
    const isCurrent = model.relativePath === current;
    const marker = isCurrent
      ? chalk.green('●')
      : chalk.dim('○');

    const name = isCurrent
      ? chalk.bold.green(model.relativePath)
      : model.relativePath;

    console.log(
      `${marker} ${name} ${chalk.dim(formatBytes(model.size))}`,
    );
  }
}

async function showStatus() {
  const current = getCurrentModel();
  const models = findModels();
  const activeModel = models.find(
    model => model.relativePath === current,
  );

  printTitle();

  console.log(
    `${chalk.bold('Selected:')} ${
      current
        ? chalk.cyan(current)
        : chalk.yellow('none')
    }`,
  );

  if (activeModel) {
    console.log(
      `${chalk.bold('Name:')} ${friendlyModelName(
        activeModel.relativePath,
      )}`,
    );

    console.log(
      `${chalk.bold('Size:')} ${formatBytes(activeModel.size)}`,
    );
  } else if (current) {
    console.log(
      `${chalk.bold('File:')} ${chalk.red('missing or invalid')}`,
    );
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
      { cwd: COMPOSE_DIR },
    );

    const services = stdout
      .trim()
      .split('\n')
      .filter(Boolean);

    console.log(
      `${chalk.bold('Container:')} ${
        services.includes(SERVICE)
          ? chalk.green('running')
          : chalk.red('stopped')
      }`,
    );
  } catch {
    console.log(
      `${chalk.bold('Container:')} ${chalk.red('unknown')}`,
    );
  }

  console.log();
}

async function restartCommand() {
  const spinner = ora('Restarting llama.cpp').start();

  try {
    await restartServer();

    spinner.text = 'Waiting for llama.cpp to become healthy';

    if (await waitForHealth()) {
      spinner.succeed(
        chalk.green('llama.cpp restarted successfully'),
      );
    } else {
      spinner.fail(
        chalk.red('llama.cpp failed its health check'),
      );
      process.exitCode = 1;
    }
  } catch (error) {
    spinner.fail(chalk.red(error.message));
    process.exitCode = 1;
  }
}

function showHelp() {
  console.log(`
${chalk.bold.cyan('AI Model Manager')}

${chalk.bold('Usage')}
  ai-model             Open the interactive model selector
  ai-model select      Open the interactive model selector
  ai-model switch      Open the interactive model selector
  ai-model list        List installed models
  ai-model current     Show the selected model
  ai-model status      Show model, container, and API status
  ai-model restart     Restart llama.cpp
  ai-model logs [n]    Show recent container logs
  ai-model help        Show this help
`);
}

async function main() {
  const command = process.argv[2];

  switch (command) {
    case undefined:
    case 'select':
    case 'switch':
      await interactiveSelect();
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
      const requestedLines = Number.parseInt(
        process.argv[3] ?? '100',
        10,
      );

      const lines = Number.isFinite(requestedLines)
        ? requestedLines
        : 100;

      await showLogs(lines);
      break;
    }

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

main().catch(error => {
  if (
    error?.name === 'ExitPromptError'
    || error?.message?.includes('SIGINT')
    || error?.message?.includes('force closed')
  ) {
    console.log();
    console.log(chalk.dim('Cancelled.'));
    process.exit(0);
  }

  console.error(chalk.red(error.stack ?? error.message));
  process.exitCode = 1;
});