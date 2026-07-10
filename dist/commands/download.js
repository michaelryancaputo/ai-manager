import fs from 'node:fs';
import path from 'node:path';
import { confirm, input, select, } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';
import { MODELS_DIR } from '../config.js';
import { downloadModel, downloadPatterns, groupGgufFiles, listRepositoryFiles, parseRepositoryId, quantizationName, repositoryDirectoryName, } from '../lib/huggingface.js';
import { formatBytes } from '../lib/ui.js';
function availableSpace(directory) {
    const stats = fs.statfsSync(directory);
    return stats.bavail * stats.bsize;
}
function validateInstallDirectory(value) {
    const trimmed = value.trim();
    if (!trimmed) {
        return 'An install directory is required.';
    }
    if (path.isAbsolute(trimmed)) {
        return 'Enter a directory relative to the models directory.';
    }
    if (trimmed === '..'
        || trimmed.startsWith('../')
        || trimmed.includes('/../')) {
        return 'The install directory cannot leave the models directory.';
    }
    return true;
}
function getDownloadedTarget(destination, repositoryFile) {
    const fullPath = path.join(destination, repositoryFile);
    if (!fs.existsSync(fullPath)) {
        throw new Error(`Download completed, but the expected file was not found:\n${fullPath}`);
    }
    const stats = fs.statSync(fullPath);
    return {
        relativePath: path.relative(MODELS_DIR, fullPath),
        fullPath,
        size: stats.size,
    };
}
export async function runDownloadCommand(activateModel) {
    console.log();
    console.log(chalk.bold.cyan('Download Model'));
    console.log(chalk.dim('────────────────────────────────────────'));
    console.log();
    const startAction = await select({
        message: 'Choose an action',
        choices: [
            {
                name: 'Enter a Hugging Face repository or URL',
                value: 'repository',
            },
            {
                name: chalk.dim('← Back'),
                value: 'back',
            },
        ],
    });
    if (startAction === 'back') {
        return;
    }
    console.log();
    const repositoryInput = await input({
        message: 'Hugging Face repository or URL',
        validate(value) {
            try {
                parseRepositoryId(value);
                return true;
            }
            catch (error) {
                return error instanceof Error
                    ? error.message
                    : String(error);
            }
        },
    });
    const repositoryId = parseRepositoryId(repositoryInput);
    const spinner = ora(`Inspecting ${repositoryId}`).start();
    let groups;
    try {
        const files = await listRepositoryFiles(repositoryId);
        groups = groupGgufFiles(files);
        if (groups.length === 0) {
            throw new Error('No GGUF model files were found in this repository.');
        }
        spinner.succeed(`Found ${groups.length} model option${groups.length === 1 ? '' : 's'}`);
    }
    catch (error) {
        spinner.fail('Could not inspect the repository');
        throw error;
    }
    console.log();
    const selectedGroup = await select({
        message: 'Select a model',
        pageSize: 15,
        choices: [
            ...groups.map(group => {
                const quantization = quantizationName(group.label);
                const isRecommended = quantization === 'Q4_K_M';
                return {
                    name: [
                        group.label,
                        chalk.cyan(quantization),
                        group.size > 0
                            ? chalk.dim(formatBytes(group.size))
                            : chalk.dim('size unknown'),
                        isRecommended
                            ? chalk.green('recommended')
                            : '',
                        group.sharded
                            ? chalk.yellow(`${group.files.length} shards`)
                            : '',
                    ]
                        .filter(Boolean)
                        .join('  '),
                    value: group,
                    description: group.files
                        .map(file => file.path)
                        .join('\n'),
                };
            }),
            {
                name: chalk.dim('← Back'),
                value: null,
            },
        ],
    });
    if (!selectedGroup) {
        return;
    }
    const defaultDirectory = repositoryDirectoryName(repositoryId);
    console.log();
    const installDirectory = await input({
        message: 'Install directory',
        default: defaultDirectory,
        validate: validateInstallDirectory,
    });
    const destination = path.join(MODELS_DIR, installDirectory.trim());
    fs.mkdirSync(destination, {
        recursive: true,
    });
    const freeBytes = availableSpace(MODELS_DIR);
    const requiredBytes = selectedGroup.size;
    console.log();
    console.log(`${chalk.bold('Repository:')} ${repositoryId}`);
    console.log(`${chalk.bold('Selection:')} ${selectedGroup.label}`);
    console.log(`${chalk.bold('Destination:')} ${destination}`);
    console.log(`${chalk.bold('Free space:')} ${formatBytes(freeBytes)}`);
    if (requiredBytes > 0) {
        console.log(`${chalk.bold('Download size:')} ${formatBytes(requiredBytes)}`);
        const safetyMargin = Math.max(5 * 1024 ** 3, Math.ceil(requiredBytes * 0.1));
        if (freeBytes < requiredBytes + safetyMargin) {
            throw new Error(`Not enough storage. The download needs ${formatBytes(requiredBytes)}, plus a ${formatBytes(safetyMargin)} safety margin.`);
        }
    }
    console.log();
    const shouldDownload = await confirm({
        message: 'Download this model?',
        default: true,
    });
    if (!shouldDownload) {
        console.log(chalk.dim('Download cancelled.'));
        return;
    }
    console.log();
    await downloadModel({
        repositoryId,
        patterns: downloadPatterns(selectedGroup),
        destination,
    });
    console.log();
    console.log(chalk.green.bold('Download completed successfully.'));
    const firstRepositoryFile = [...selectedGroup.files]
        .sort((a, b) => a.path.localeCompare(b.path))[0];
    if (!firstRepositoryFile) {
        throw new Error('The selected model has no downloadable files.');
    }
    const downloadedModel = getDownloadedTarget(destination, firstRepositoryFile.path);
    console.log();
    console.log(`${chalk.bold('Installed model:')} ${downloadedModel.relativePath}`);
    const shouldActivate = await confirm({
        message: 'Switch to this model now?',
        default: true,
    });
    if (!shouldActivate) {
        console.log(chalk.dim('The model was installed but not activated.'));
        return;
    }
    console.log();
    await activateModel(downloadedModel);
}
//# sourceMappingURL=download.js.map