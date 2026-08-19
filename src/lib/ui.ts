import path from 'node:path';
import chalk from 'chalk';

export function printTitle(): void {
  console.log();
  console.log(chalk.bold.cyan('AI Model Manager'));
  console.log(chalk.dim('────────────────────────────────────────'));
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];

  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const decimalPlaces = unitIndex >= 3 ? 1 : 0;
  const unit = units[unitIndex] ?? 'B';

  return `${value.toFixed(decimalPlaces)} ${unit}`;
}

export function friendlyModelName(relativePath: string): string {
  return path
    .basename(relativePath, '.gguf')
    .replaceAll('_', ' ')
    .replaceAll('-', ' ');
}

export function matchesSearchTerm(term: string, ...fields: string[]): boolean {
  const needle = term.trim().toLowerCase();

  if (!needle) {
    return true;
  }

  return fields.some((field) => field.toLowerCase().includes(needle));
}
