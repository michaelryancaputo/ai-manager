import chalk from 'chalk';
import { describe, expect, it, vi } from 'vitest';

import { printTable } from './benchmark.js';

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('printTable', () => {
  it('aligns a colored cell under its plain-text header', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    printTable(
      ['Metric', 'model-a', 'model-b'],
      [['Speed (tok/s)', '42.10', chalk.dim('failed')]],
    );

    const lines = logSpy.mock.calls.map((call) => stripAnsi(String(call[0])));
    const headerLine = lines[0] ?? '';
    const dataLine = lines[2] ?? '';

    expect(headerLine.indexOf('model-b')).toBe(dataLine.indexOf('failed'));

    logSpy.mockRestore();
  });
});
