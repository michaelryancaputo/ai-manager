#!/usr/bin/env node
import fs from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { input, select, } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { API_URL, COMPOSE_DIR, CONTAINER, HEALTH_TIMEOUT_MS, MODELS_DIR, SERVICE, } from './config.js';
import { findModels, getCurrentModel, setCurrentModel, } from './lib/models.js';
import { formatBytes, friendlyModelName, printTitle, } from './lib/ui.js';
import { runDownloadCommand, } from './commands/download.js';
import { runBenchmarkCommand, } from './commands/benchmark.js';
import { runDeleteCommand, } from './commands/delete.js';
const execFileAsync = promisify(execFile);
function errorMessage(error) {
    return error instanceof Error
        ? error.message
        : String(error);
}
async function run(command, args, options = {}) {
    return execFileAsync(command, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        maxBuffer: 20 * 1024 * 1024,
    });
}
function sleep(milliseconds) {
    return new Promise(resolve => {
        setTimeout(resolve, milliseconds);
    });
}
function clearScreen() {
    if (process.stdout.isTTY) {
        console.clear();
    }
}
function getFreeSpace() {
    const stats = fs.statfsSync(MODELS_DIR);
    return stats.bavail * stats.bsize;
}
async function restartServer() {
    await run('docker', [
        'compose',
        'restart',
        SERVICE,
    ], {
        cwd: COMPOSE_DIR,
    });
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
    }
    catch {
        return false;
    }
}
async function waitForHealth() {
    const startedAt = Date.now();
    while (Date.now() - startedAt
        < HEALTH_TIMEOUT_MS) {
        if (await isHealthy()) {
            return true;
        }
        await sleep(3000);
    }
    return false;
}
async function showLogs(lines = 100) {
    const child = spawn('docker', [
        'logs',
        `--tail=${lines}`,
        CONTAINER,
    ], {
        stdio: 'inherit',
    });
    await new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('exit', code => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`docker logs exited with code ${String(code)}`));
        });
    });
}
async function switchModel(target) {
    const previous = getCurrentModel();
    if (previous
        === target.relativePath) {
        console.log(chalk.yellow(`Already using ${friendlyModelName(target.relativePath)}.`));
        return true;
    }
    const spinner = ora(`Switching to ${friendlyModelName(target.relativePath)}`).start();
    try {
        setCurrentModel(target.relativePath);
        spinner.text =
            'Restarting llama.cpp';
        await restartServer();
        spinner.text =
            'Waiting for llama.cpp to become healthy';
        if (!(await waitForHealth())) {
            throw new Error('llama.cpp did not become healthy before the timeout.');
        }
        spinner.succeed(chalk.green(`Now using ${friendlyModelName(target.relativePath)}`));
        return true;
    }
    catch (error) {
        spinner.fail(chalk.red(`Failed to load ${friendlyModelName(target.relativePath)}`));
        if (previous) {
            const rollback = ora(`Rolling back to ${friendlyModelName(previous)}`).start();
            try {
                setCurrentModel(previous);
                await restartServer();
                if (await waitForHealth()) {
                    rollback.succeed(chalk.green('Rollback succeeded'));
                }
                else {
                    rollback.fail(chalk.red('Rollback failed health check'));
                }
            }
            catch (rollbackError) {
                rollback.fail(chalk.red(`Rollback failed: ${errorMessage(rollbackError)}`));
            }
        }
        console.error(chalk.red(errorMessage(error)));
        console.log(chalk.dim('\nRecent llama.cpp logs:\n'));
        await showLogs(40).catch(() => undefined);
        return false;
    }
}
async function interactiveModelSelect() {
    const models = findModels();
    const current = getCurrentModel();
    if (models.length === 0) {
        console.error(chalk.red('No GGUF models were found.'));
        return;
    }
    clearScreen();
    printTitle();
    const healthy = await isHealthy();
    console.log(`${chalk.bold('API:')} ${healthy
        ? chalk.green('● healthy')
        : chalk.red('● unavailable')}`);
    console.log(`${chalk.bold('Current:')} ${current
        ? chalk.cyan(friendlyModelName(current))
        : chalk.yellow('none')}`);
    console.log();
    const chosen = await select({
        message: 'Select a model',
        pageSize: 15,
        choices: [
            ...models.map((model) => {
                const isCurrent = model.relativePath === current;
                return {
                    name: [
                        isCurrent
                            ? chalk.green('●')
                            : chalk.dim('○'),
                        isCurrent
                            ? chalk.bold.green(friendlyModelName(model.relativePath))
                            : chalk.white(friendlyModelName(model.relativePath)),
                        chalk.dim(formatBytes(model.size)),
                        isCurrent
                            ? chalk.yellow('current')
                            : '',
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
        ],
    });
    if (!chosen) {
        return;
    }
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
        console.log(`${marker} ${name} ${chalk.dim(formatBytes(model.size))}`);
    }
}
async function showStatus() {
    const current = getCurrentModel();
    const activeModel = findModels().find((model) => model.relativePath === current);
    printTitle();
    console.log(`${chalk.bold('Selected:')} ${current
        ? chalk.cyan(current)
        : chalk.yellow('none')}`);
    if (activeModel) {
        console.log(`${chalk.bold('Name:')} ${friendlyModelName(activeModel.relativePath)}`);
        console.log(`${chalk.bold('Size:')} ${formatBytes(activeModel.size)}`);
    }
    else if (current) {
        console.log(`${chalk.bold('File:')} ${chalk.red('missing or invalid')}`);
    }
    const healthy = await isHealthy();
    console.log(`${chalk.bold('API:')} ${healthy
        ? chalk.green(`${API_URL} — healthy`)
        : chalk.red(`${API_URL} — unavailable`)}`);
    try {
        const { stdout } = await run('docker', [
            'compose',
            'ps',
            '--status',
            'running',
            '--services',
        ], {
            cwd: COMPOSE_DIR,
        });
        const services = stdout
            .trim()
            .split('\n')
            .filter(Boolean);
        console.log(`${chalk.bold('Container:')} ${services.includes(SERVICE)
            ? chalk.green('running')
            : chalk.red('stopped')}`);
    }
    catch {
        console.log(`${chalk.bold('Container:')} ${chalk.red('unknown')}`);
    }
    console.log(`${chalk.bold('Free space:')} ${formatBytes(getFreeSpace())}`);
    console.log();
}
async function restartCommand() {
    const spinner = ora('Restarting llama.cpp').start();
    try {
        await restartServer();
        spinner.text =
            'Waiting for llama.cpp to become healthy';
        if (await waitForHealth()) {
            spinner.succeed(chalk.green('llama.cpp restarted successfully'));
        }
        else {
            spinner.fail(chalk.red('llama.cpp failed its health check'));
            process.exitCode = 1;
        }
    }
    catch (error) {
        spinner.fail(chalk.red(errorMessage(error)));
        process.exitCode = 1;
    }
}
async function pause() {
    await input({
        message: 'Press Enter to return',
    });
}
async function mainMenu() {
    let running = true;
    while (running) {
        clearScreen();
        printTitle();
        const current = getCurrentModel();
        const healthy = await isHealthy();
        console.log(`${chalk.bold('Server:')} ${healthy
            ? chalk.green('● healthy')
            : chalk.red('● unavailable')}`);
        console.log(`${chalk.bold('Model:')} ${current
            ? chalk.cyan(friendlyModelName(current))
            : chalk.yellow('none')}`);
        console.log(`${chalk.bold('Free space:')} ${formatBytes(getFreeSpace())}`);
        console.log();
        const action = await select({
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
                await interactiveModelSelect();
                break;
            case 'download':
                clearScreen();
                await runDownloadCommand(switchModel);
                await pause();
                break;
            case 'delete':
                clearScreen();
                await runDeleteCommand();
                await pause();
                break;
            case 'benchmark':
                clearScreen();
                await runBenchmarkCommand();
                await pause();
                break;
            case 'status':
                clearScreen();
                await showStatus();
                await pause();
                break;
            case 'restart':
                clearScreen();
                await restartCommand();
                await pause();
                break;
            case 'logs':
                clearScreen();
                await showLogs(100);
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
function showHelp() {
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
async function main() {
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
            await runDownloadCommand(switchModel);
            break;
        case 'delete':
        case 'remove':
        case 'rm':
            await runDeleteCommand();
            break;
        case 'benchmark':
            await runBenchmarkCommand();
            break;
        case 'list':
            listModels();
            break;
        case 'current':
            console.log(getCurrentModel()
                ?? 'none');
            break;
        case 'status':
            await showStatus();
            break;
        case 'restart':
            await restartCommand();
            break;
        case 'logs': {
            const requested = Number.parseInt(process.argv[3]
                ?? '100', 10);
            await showLogs(Number.isFinite(requested)
                ? requested
                : 100);
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
main().catch((error) => {
    const message = errorMessage(error);
    if ((error instanceof Error
        && error.name
            === 'ExitPromptError')
        || message.includes('SIGINT')
        || message.includes('force closed')) {
        console.log();
        console.log(chalk.dim('Cancelled.'));
        process.exit(0);
    }
    console.error();
    console.error(chalk.red(error instanceof Error
        ? error.stack
            ?? error.message
        : message));
    process.exitCode = 1;
});
//# sourceMappingURL=ai-manager.js.map