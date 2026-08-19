import fs from 'node:fs';
import path from 'node:path';

import { confirm, input, search } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';

import { MODELS_DIR } from '../config.js';

import {
  downloadModel,
  downloadPatterns,
  groupGgufFiles,
  HuggingFaceAuthenticationError,
  listRepositoryFiles,
  parseRepositoryId,
  quantizationName,
  repositoryDirectoryName,
  runHuggingFaceLogin,
} from '../lib/huggingface.js';

import { formatBytes, matchesSearchTerm } from '../lib/ui.js';

import {
  getRecommendationSettings,
  rankModelRecommendations,
} from '../services/recommendations.js';

import type { HuggingFaceModelGroup, ModelInfo } from '../types.js';

type ActivateModel = (model: ModelInfo) => Promise<boolean>;

function availableSpace(directory: string): number {
  const stats = fs.statfsSync(directory);

  return stats.bavail * stats.bsize;
}

export function validateInstallDirectory(value: string): true | string {
  const trimmed = value.trim();

  if (!trimmed) {
    return 'An install directory is required.';
  }

  if (path.isAbsolute(trimmed)) {
    return 'Enter a directory relative to the models directory.';
  }

  if (
    trimmed === '..' ||
    trimmed.startsWith('../') ||
    trimmed.includes('/../')
  ) {
    return 'The install directory cannot leave the models directory.';
  }

  return true;
}

function getDownloadedTarget(
  destination: string,
  repositoryFile: string,
): ModelInfo {
  const fullPath = path.join(destination, repositoryFile);

  if (!fs.existsSync(fullPath)) {
    throw new Error(
      `Download completed, but the expected file was not found:\n${fullPath}`,
    );
  }

  const stats = fs.statSync(fullPath);

  return {
    relativePath: path.relative(MODELS_DIR, fullPath),
    fullPath,
    size: stats.size,
  };
}

async function inspectRepository(
  repositoryId: string,
): Promise<HuggingFaceModelGroup[] | null> {
  let attemptedLogin = false;

  while (true) {
    const spinner = ora(`Inspecting ${repositoryId}`).start();

    try {
      const files = await listRepositoryFiles(repositoryId);

      const groups = groupGgufFiles(files);

      if (groups.length === 0) {
        throw new Error('No GGUF model files were found in this repository.');
      }

      spinner.succeed(
        `Found ${groups.length} model option${groups.length === 1 ? '' : 's'}`,
      );

      return groups;
    } catch (error: unknown) {
      spinner.fail('Could not inspect the repository');

      if (error instanceof HuggingFaceAuthenticationError && !attemptedLogin) {
        console.log();
        console.log(chalk.yellow(error.message));

        const login = await confirm({
          message: 'Log in to Hugging Face now?',
          default: true,
        });

        if (!login) {
          return null;
        }

        console.log();

        await runHuggingFaceLogin();

        attemptedLogin = true;

        console.log();
        console.log(
          chalk.green('Authentication completed. Retrying repository access…'),
        );
        console.log();

        continue;
      }

      throw error;
    }
  }
}

export async function runDownloadCommand(
  activateModel: ActivateModel,
): Promise<void> {
  console.log();
  console.log(chalk.bold.cyan('Download Model'));
  console.log(chalk.dim('────────────────────────────────────────'));
  console.log();

  const repositoryInput = await input({
    message: 'Hugging Face repository or URL',

    validate(value: string): true | string {
      try {
        parseRepositoryId(value);
        return true;
      } catch (error: unknown) {
        return error instanceof Error ? error.message : String(error);
      }
    },
  });

  const repositoryId = parseRepositoryId(repositoryInput);

  const groups = await inspectRepository(repositoryId);

  if (!groups) {
    return;
  }

  console.log();

  const rankedGroups = rankModelRecommendations(groups);

  const hasRecommendation = rankedGroups.some(
    ({ recommendation }) => recommendation.recommended,
  );

  if (!hasRecommendation) {
    const settings = getRecommendationSettings();

    console.log(
      chalk.yellow(
        `None of these options are expected to fit comfortably in your ` +
          `configured GPU (${formatBytes(settings.gpuVramBytes)} VRAM, ` +
          `${settings.contextSize} context). Expect slower performance or ` +
          'CPU offload.',
      ),
    );
    console.log();
  }

  const selectedGroup = await search<HuggingFaceModelGroup | null>({
    message: 'Select a model (type to search)',
    pageSize: 15,
    source: (term) => {
      const filtered = term
        ? rankedGroups.filter(({ group }) =>
            matchesSearchTerm(term, group.label, quantizationName(group.label)),
          )
        : rankedGroups;

      return [
        ...filtered.map(({ group, recommendation }) => {
          const quantization = quantizationName(group.label);

          return {
            name: [
              group.label,
              chalk.cyan(quantization),

              group.size > 0
                ? chalk.dim(formatBytes(group.size))
                : chalk.dim('size unknown'),

              recommendation.recommended ? chalk.green('recommended') : '',

              group.sharded ? chalk.yellow(`${group.files.length} shards`) : '',
            ]
              .filter(Boolean)
              .join('  '),

            value: group,

            description: [
              ...group.files.map((file) => file.path),
              recommendation.summary,
            ].join('\n'),
          };
        }),

        {
          name: chalk.dim('← Back'),
          value: null,
        },
      ];
    },
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
    console.log(
      `${chalk.bold('Download size:')} ${formatBytes(requiredBytes)}`,
    );

    const safetyMargin = Math.max(
      5 * 1024 ** 3,
      Math.ceil(requiredBytes * 0.1),
    );

    if (freeBytes < requiredBytes + safetyMargin) {
      throw new Error(
        `Not enough storage. The download needs ${formatBytes(
          requiredBytes,
        )}, plus a ${formatBytes(safetyMargin)} safety margin.`,
      );
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

  const firstRepositoryFile = [...selectedGroup.files].sort((a, b) =>
    a.path.localeCompare(b.path),
  )[0];

  if (!firstRepositoryFile) {
    throw new Error('The selected model has no downloadable files.');
  }

  const downloadedModel = getDownloadedTarget(
    destination,
    firstRepositoryFile.path,
  );

  console.log();
  console.log(
    `${chalk.bold('Installed model:')} ${downloadedModel.relativePath}`,
  );

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
