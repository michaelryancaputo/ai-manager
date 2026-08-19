import { checkbox } from '@inquirer/prompts';
import chalk from 'chalk';
import ora from 'ora';

import { API_URL } from '../config.js';

import {
  findModels,
  getCurrentModel,
  getModelByRelativePath,
} from '../lib/models.js';

import { formatBytes, friendlyModelName } from '../lib/ui.js';

import { TASK_LABELS } from '../services/catalog.js';

import type { ModelTask } from '../services/catalog.js';

import type { ModelInfo } from '../types.js';

type SwitchModel = (model: ModelInfo) => Promise<boolean>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface LlamaTimings {
  prompt_n?: number;
  prompt_ms?: number;
  prompt_per_second?: number;
  predicted_n?: number;
  predicted_ms?: number;
  predicted_per_second?: number;
}

interface ChatCompletionResponse {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  timings?: LlamaTimings;
}

interface BenchmarkResult {
  name: string;
  elapsedMs: number;
  promptTokens: number;
  completionTokens: number;
  promptTokensPerSecond: number | null;
  generationTokensPerSecond: number | null;
}

/**
 * A tiny (135 byte) three-color-stripe PNG used as the vision benchmark's
 * input image. Its content doesn't matter — the benchmark measures
 * multimodal request handling and generation speed, not description
 * accuracy.
 */
const TEST_IMAGE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAATklEQVR42u3PMQ0AMAgAMOQgZ/d0Tg5i5gEukiY10KjM1UJAQEBAQEBAQEBAoB3Id1YTEBAQEBAQEBAQEBgEbq0mICAgICAgICAgIND2AXRa2NP7KV6DAAAAAElFTkSuQmCC';

interface BenchmarkDefinition {
  name: string;
  task: ModelTask;
  prompt: string;
  maxTokens: number;
  image?: string;
}

const BENCHMARKS: BenchmarkDefinition[] = [
  {
    name: 'Chat',
    task: 'chat',
    prompt:
      'Summarize this in one sentence: Local language models provide privacy and control, but require users to manage hardware, model files, inference software, and performance tradeoffs.',
    maxTokens: 128,
  },
  {
    name: 'Coding',
    task: 'coding',
    prompt:
      'Write a concise TypeScript function that removes duplicate strings from an array while preserving order.',
    maxTokens: 256,
  },
  {
    name: 'Vision',
    task: 'vision',
    prompt: 'Describe what you see in this image in one sentence.',
    maxTokens: 128,
    image: TEST_IMAGE_DATA_URL,
  },
  {
    name: 'Reasoning',
    task: 'reasoning',
    prompt:
      'A farmer has 17 sheep. All but 9 run away. How many sheep remain? Explain briefly.',
    maxTokens: 128,
  },
];

function benchmarkTasks(): ModelTask[] {
  const seen = new Set<ModelTask>();
  const tasks: ModelTask[] = [];

  for (const benchmark of BENCHMARKS) {
    if (!seen.has(benchmark.task)) {
      seen.add(benchmark.task);
      tasks.push(benchmark.task);
    }
  }

  return tasks;
}

export async function selectBenchmarkTypes(): Promise<BenchmarkDefinition[]> {
  const selectedTasks = await checkbox<ModelTask>({
    message: 'Select benchmark types to run (space to toggle, enter to confirm)',
    pageSize: 15,
    choices: benchmarkTasks().map((task) => ({
      name: TASK_LABELS[task],
      value: task,
      checked: true,
    })),
  });

  return BENCHMARKS.filter((benchmark) => selectedTasks.includes(benchmark.task));
}

function formatNumber(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(2);
}

function average(values: Array<number | null>): number | null {
  const available = values.filter((value): value is number => value !== null);

  if (available.length === 0) {
    return null;
  }

  return (
    available.reduce((total, value) => total + value, 0) / available.length
  );
}

async function runSingleBenchmark(
  benchmark: BenchmarkDefinition,
): Promise<BenchmarkResult> {
  const startedAt = performance.now();

  const content = benchmark.image
    ? [
        { type: 'text', text: benchmark.prompt },
        { type: 'image_url', image_url: { url: benchmark.image } },
      ]
    : benchmark.prompt;

  const response = await fetch(`${API_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'local',
      messages: [
        {
          role: 'user',
          content,
        },
      ],
      temperature: 0,
      max_tokens: benchmark.maxTokens,
      stream: false,
    }),
  });

  const elapsedMs = performance.now() - startedAt;

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `Benchmark request failed with HTTP ${response.status}: ${body}`,
    );
  }

  const result = (await response.json()) as ChatCompletionResponse;

  const promptTokens =
    result.usage?.prompt_tokens ?? result.timings?.prompt_n ?? 0;

  const completionTokens =
    result.usage?.completion_tokens ?? result.timings?.predicted_n ?? 0;

  return {
    name: benchmark.name,
    elapsedMs,
    promptTokens,
    completionTokens,
    promptTokensPerSecond: result.timings?.prompt_per_second ?? null,
    generationTokensPerSecond: result.timings?.predicted_per_second ?? null,
  };
}

async function runBenchmarkSuite(
  benchmarks: BenchmarkDefinition[],
): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  for (const benchmark of benchmarks) {
    const spinner = ora(`Running ${benchmark.name} benchmark`).start();

    try {
      const result = await runSingleBenchmark(benchmark);

      results.push(result);

      spinner.succeed(
        `${benchmark.name}: ${formatNumber(
          result.generationTokensPerSecond,
        )} tokens/sec`,
      );
    } catch (error: unknown) {
      spinner.fail(`${benchmark.name} benchmark failed: ${errorMessage(error)}`);
    }
  }

  return results;
}

export async function runBenchmarkCommand(): Promise<void> {
  console.log();
  console.log(chalk.bold.cyan('Model Benchmark'));
  console.log(chalk.dim('────────────────────────────────────────'));
  console.log();

  const benchmarks = await selectBenchmarkTypes();

  if (benchmarks.length === 0) {
    console.log(chalk.yellow('No benchmark types selected.'));

    return;
  }

  console.log();

  const results = await runBenchmarkSuite(benchmarks);

  if (results.length === 0) {
    console.log();
    console.log(chalk.red('No benchmarks completed successfully.'));

    return;
  }

  console.log();
  console.log(chalk.bold('Results'));
  console.log();

  for (const result of results) {
    console.log(chalk.bold(result.name));
    console.log(
      `  Total time:       ${(result.elapsedMs / 1000).toFixed(2)} sec`,
    );
    console.log(`  Prompt tokens:    ${result.promptTokens}`);
    console.log(`  Completion tokens:${result.completionTokens}`);
    console.log(
      `  Prompt speed:     ${formatNumber(
        result.promptTokensPerSecond,
      )} tokens/sec`,
    );
    console.log(
      `  Generation speed: ${formatNumber(
        result.generationTokensPerSecond,
      )} tokens/sec`,
    );
    console.log();
  }

  const averageElapsedMs =
    results.reduce((total, result) => total + result.elapsedMs, 0) /
    results.length;

  const averagePromptSpeed = average(
    results.map((result) => result.promptTokensPerSecond),
  );

  const averageGenerationSpeed = average(
    results.map((result) => result.generationTokensPerSecond),
  );

  console.log(chalk.bold.green('Average'));
  console.log(
    `  Total time:       ${(averageElapsedMs / 1000).toFixed(2)} sec`,
  );
  console.log(
    `  Prompt speed:     ${formatNumber(averagePromptSpeed)} tokens/sec`,
  );
  console.log(
    `  Generation speed: ${formatNumber(averageGenerationSpeed)} tokens/sec`,
  );
  console.log();
}

export interface ModelBenchmark {
  model: ModelInfo;
  results: BenchmarkResult[] | null;
}

const ANSI_PATTERN = /\[[0-9;]*m/g;

function stripAnsi(text: string): string {
  return text.replaceAll(ANSI_PATTERN, '');
}

function padCell(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - stripAnsi(text).length));
}

export function printTable(headers: string[], rows: string[][]): void {
  const columnWidths = headers.map((header, columnIndex) =>
    Math.max(
      header.length,
      ...rows.map((row) => stripAnsi(row[columnIndex] ?? '').length),
    ),
  );

  const printRow = (cells: string[]): void => {
    console.log(
      cells
        .map((cell, columnIndex) =>
          padCell(cell, columnWidths[columnIndex] ?? 0),
        )
        .join('   '),
    );
  };

  printRow(headers);
  printRow(columnWidths.map((width) => '─'.repeat(width)));

  for (const row of rows) {
    printRow(row);
  }
}

export function printComparisonTable(
  entries: ModelBenchmark[],
  benchmarks: BenchmarkDefinition[] = BENCHMARKS,
): void {
  const compared = entries.filter(
    (entry): entry is ModelBenchmark & { results: BenchmarkResult[] } =>
      entry.results !== null,
  );

  if (compared.length === 0) {
    console.log(chalk.red('No models benchmarked successfully.'));

    return;
  }

  const headers = [
    'Metric',
    ...entries.map((entry) => friendlyModelName(entry.model.relativePath)),
  ];

  const sizeRow = [
    'Size',
    ...entries.map((entry) => formatBytes(entry.model.size)),
  ];

  const metricRows = benchmarks.map((benchmark) => [
    `${benchmark.name} (tok/s)`,
    ...entries.map((entry) => {
      const result = entry.results?.find(
        (item) => item.name === benchmark.name,
      );

      return result
        ? formatNumber(result.generationTokensPerSecond)
        : chalk.dim('failed');
    }),
  ]);

  const averageRow = [
    'Average (tok/s)',
    ...entries.map((entry) =>
      entry.results
        ? formatNumber(
            average(
              entry.results.map((result) => result.generationTokensPerSecond),
            ),
          )
        : chalk.dim('failed'),
    ),
  ];

  console.log();
  console.log(chalk.bold('Comparison'));
  console.log();

  printTable(headers, [sizeRow, ...metricRows, averageRow]);
  console.log();
}

export async function benchmarkModels(
  models: ModelInfo[],
  switchModel: SwitchModel,
  benchmarks: BenchmarkDefinition[] = BENCHMARKS,
): Promise<ModelBenchmark[]> {
  const entries: ModelBenchmark[] = [];

  for (const model of models) {
    console.log();
    console.log(chalk.bold.cyan(friendlyModelName(model.relativePath)));

    const switched = await switchModel(model);

    if (!switched) {
      console.log(
        chalk.red(
          `Skipping ${friendlyModelName(model.relativePath)} — the model failed to load.`,
        ),
      );

      entries.push({ model, results: null });
      continue;
    }

    try {
      const results = await runBenchmarkSuite(benchmarks);

      entries.push({ model, results });
    } catch (error: unknown) {
      console.log(
        chalk.red(
          `Benchmark failed for ${friendlyModelName(model.relativePath)}: ${errorMessage(error)}`,
        ),
      );

      entries.push({ model, results: null });
    }
  }

  return entries;
}

export async function runCompareModelsCommand(
  switchModel: SwitchModel,
): Promise<void> {
  console.log();
  console.log(chalk.bold.cyan('Compare Models'));
  console.log(chalk.dim('────────────────────────────────────────'));
  console.log();

  const models = findModels();

  if (models.length === 0) {
    console.log(chalk.yellow('No installed models were found.'));

    return;
  }

  const currentPath = getCurrentModel();

  const selected = await checkbox<ModelInfo>({
    message: 'Select models to benchmark (space to toggle, enter to confirm)',
    pageSize: 15,
    choices: models.map((model) => ({
      name: [
        friendlyModelName(model.relativePath),
        chalk.dim(formatBytes(model.size)),
        model.relativePath === currentPath ? chalk.yellow('current') : '',
      ]
        .filter(Boolean)
        .join('  '),
      value: model,
    })),
  });

  if (selected.length === 0) {
    console.log(chalk.yellow('No models selected.'));

    return;
  }

  console.log();

  const benchmarks = await selectBenchmarkTypes();

  if (benchmarks.length === 0) {
    console.log(chalk.yellow('No benchmark types selected.'));

    return;
  }

  const originalModel = currentPath
    ? getModelByRelativePath(currentPath)
    : null;

  const entries = await benchmarkModels(selected, switchModel, benchmarks);

  if (originalModel && getCurrentModel() !== originalModel.relativePath) {
    console.log();
    console.log(
      chalk.dim(`Restoring ${friendlyModelName(originalModel.relativePath)}…`),
    );

    await switchModel(originalModel);
  }

  printComparisonTable(entries, benchmarks);
}
