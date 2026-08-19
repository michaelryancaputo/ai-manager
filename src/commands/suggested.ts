import { search, select } from '@inquirer/prompts';
import chalk from 'chalk';

import { matchesSearchTerm } from '../lib/ui.js';

import {
  catalogEntriesForTask,
  catalogTasks,
  TASK_LABELS,
} from '../services/catalog.js';

import type { CatalogEntry, ModelTask } from '../services/catalog.js';

import { downloadRepository } from './download.js';

import type { ActivateModel } from './download.js';

async function selectTask(): Promise<ModelTask | null> {
  const tasks = catalogTasks();

  return select<ModelTask | null>({
    message: 'Browse suggested models by task',
    choices: [
      ...tasks.map((task) => ({
        name: `${TASK_LABELS[task]} ${chalk.dim(
          `(${catalogEntriesForTask(task).length})`,
        )}`,
        value: task,
      })),
      {
        name: chalk.dim('← Back'),
        value: null,
      },
    ],
  });
}

async function selectCatalogEntry(
  task: ModelTask,
): Promise<CatalogEntry | null> {
  const entries = catalogEntriesForTask(task);

  return search<CatalogEntry | null>({
    message: `${TASK_LABELS[task]} (type to search)`,
    pageSize: 15,
    source: (term) => {
      const filtered = term
        ? entries.filter((entry) =>
            matchesSearchTerm(
              term,
              entry.name,
              entry.repositoryId,
              entry.description,
            ),
          )
        : entries;

      return [
        ...filtered.map((entry) => ({
          name: `${entry.name}  ${chalk.dim(entry.repositoryId)}`,
          value: entry,
          description: entry.description,
        })),
        {
          name: chalk.dim('← Back'),
          value: null,
        },
      ];
    },
  });
}

export async function runSuggestedModelsCommand(
  activateModel: ActivateModel,
): Promise<void> {
  console.log();
  console.log(chalk.bold.cyan('Suggested Models'));
  console.log(chalk.dim('────────────────────────────────────────'));

  while (true) {
    console.log();

    const task = await selectTask();

    if (!task) {
      return;
    }

    console.log();

    const entry = await selectCatalogEntry(task);

    if (!entry) {
      continue;
    }

    console.log();
    console.log(`${chalk.bold('Model:')} ${entry.name}`);
    console.log(`${chalk.bold('Repository:')} ${entry.repositoryId}`);

    await downloadRepository(entry.repositoryId, activateModel);

    return;
  }
}
