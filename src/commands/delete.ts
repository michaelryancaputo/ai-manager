import fs from 'node:fs';
import path from 'node:path';

import { confirm, search } from '@inquirer/prompts';
import chalk from 'chalk';

import { MODELS_DIR } from '../config.js';

import { findModels, getCurrentModel } from '../lib/models.js';

import { formatBytes, friendlyModelName, matchesSearchTerm } from '../lib/ui.js';

import type { ModelInfo } from '../types.js';

interface DeleteChoice {
  model: ModelInfo;
  deletePath: string;
  displayPath: string;
  size: number;
}

function directorySize(targetPath: string): number {
  if (!fs.existsSync(targetPath)) {
    return 0;
  }

  const stats = fs.statSync(targetPath);

  if (stats.isFile()) {
    return stats.size;
  }

  let total = 0;

  for (const entry of fs.readdirSync(targetPath, {
    withFileTypes: true,
  })) {
    total += directorySize(path.join(targetPath, entry.name));
  }

  return total;
}

export function isShard(filename: string): boolean {
  return /-\d{5}-of-\d{5}\.gguf$/i.test(filename);
}

export function getDeleteTarget(model: ModelInfo): DeleteChoice {
  const modelDirectory = path.dirname(model.fullPath);
  const filename = path.basename(model.fullPath);

  /*
   * For sharded models, remove the containing model directory
   * so all shards disappear together.
   */
  if (isShard(filename)) {
    return {
      model,
      deletePath: modelDirectory,
      displayPath: path.relative(MODELS_DIR, modelDirectory),
      size: directorySize(modelDirectory),
    };
  }

  return {
    model,
    deletePath: model.fullPath,
    displayPath: model.relativePath,
    size: model.size,
  };
}

function uniqueDeleteChoices(models: ModelInfo[]): DeleteChoice[] {
  const seen = new Map<string, DeleteChoice>();

  for (const model of models) {
    const choice = getDeleteTarget(model);

    if (!seen.has(choice.deletePath)) {
      seen.set(choice.deletePath, choice);
    }
  }

  return [...seen.values()].sort((a, b) =>
    a.displayPath.localeCompare(b.displayPath),
  );
}

export function removeTarget(targetPath: string): void {
  const resolvedModelsDir = fs.realpathSync(MODELS_DIR);
  const resolvedTarget = fs.realpathSync(targetPath);

  if (
    resolvedTarget === resolvedModelsDir ||
    !resolvedTarget.startsWith(`${resolvedModelsDir}${path.sep}`)
  ) {
    throw new Error(
      `Refusing to delete path outside the models directory: ${resolvedTarget}`,
    );
  }

  fs.rmSync(resolvedTarget, {
    recursive: true,
    force: false,
  });
}

export async function runDeleteCommand(): Promise<void> {
  const models = findModels();
  const current = getCurrentModel();

  console.log();
  console.log(chalk.bold.cyan('Delete Model'));
  console.log(chalk.dim('────────────────────────────────────────'));
  console.log();

  if (models.length === 0) {
    console.log(chalk.yellow('No installed models were found.'));
    return;
  }

  const choices = uniqueDeleteChoices(models);

  const selected = await search<DeleteChoice | null>({
    message: 'Select a model to delete (type to search)',
    pageSize: 15,
    source: (term) => {
      const filtered = term
        ? choices.filter((choice) =>
            matchesSearchTerm(
              term,
              friendlyModelName(choice.model.relativePath),
              choice.displayPath,
            ),
          )
        : choices;

      return [
        ...filtered.map((choice) => {
          const isActive = choice.model.relativePath === current;

          return {
            name: [
              isActive ? chalk.yellow('●') : chalk.dim('○'),

              isActive
                ? chalk.yellow(friendlyModelName(choice.model.relativePath))
                : friendlyModelName(choice.model.relativePath),

              chalk.dim(formatBytes(choice.size)),

              isActive ? chalk.red('active') : '',
            ]
              .filter(Boolean)
              .join('  '),

            value: choice,
            description: choice.displayPath,
          };
        }),
        {
          name: chalk.dim('← Back'),
          value: null,
        },
      ];
    },
  });

  if (!selected) {
    return;
  }

  const isActive = selected.model.relativePath === current;

  if (isActive) {
    console.log();
    console.log(chalk.red.bold('The selected model is currently active.'));
    console.log(chalk.yellow('Switch to another model before deleting it.'));
    return;
  }

  console.log();
  console.log(
    `${chalk.bold('Model:')} ${friendlyModelName(selected.model.relativePath)}`,
  );
  console.log(`${chalk.bold('Path:')} ${selected.displayPath}`);
  console.log(
    `${chalk.bold('Space reclaimed:')} ${formatBytes(selected.size)}`,
  );

  console.log();

  const approved = await confirm({
    message: 'Permanently delete this model?',
    default: false,
  });

  if (!approved) {
    console.log(chalk.dim('Deletion cancelled.'));
    return;
  }

  removeTarget(selected.deletePath);

  console.log();
  console.log(chalk.green.bold(`Deleted ${selected.displayPath}`));
  console.log(
    chalk.green(`Reclaimed approximately ${formatBytes(selected.size)}.`),
  );
}
