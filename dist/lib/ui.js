import path from 'node:path';
import chalk from 'chalk';
export function printTitle() {
    console.log();
    console.log(chalk.bold.cyan('AI Model Manager'));
    console.log(chalk.dim('────────────────────────────────────────'));
}
export function formatBytes(bytes) {
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
export function friendlyModelName(relativePath) {
    return path
        .basename(relativePath, '.gguf')
        .replaceAll('_', ' ')
        .replaceAll('-', ' ');
}
//# sourceMappingURL=ui.js.map