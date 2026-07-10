import { describe, expect, it } from 'vitest';

import {
  groupGgufFiles,
  parseRepositoryId,
  quantizationName,
} from './huggingface.js';

describe('parseRepositoryId', () => {
  it('accepts owner/repository format', () => {
    expect(parseRepositoryId('org/model-GGUF')).toBe('org/model-GGUF');
  });

  it('extracts owner/repository from a huggingface.co URL', () => {
    expect(parseRepositoryId('https://huggingface.co/org/model-GGUF')).toBe(
      'org/model-GGUF',
    );

    expect(
      parseRepositoryId('https://huggingface.co/org/model-GGUF/tree/main'),
    ).toBe('org/model-GGUF');
  });

  it('rejects URLs from other hosts', () => {
    expect(() => parseRepositoryId('https://example.com/org/model')).toThrow();
  });

  it('rejects empty input', () => {
    expect(() => parseRepositoryId('  ')).toThrow();
  });
});

describe('quantizationName', () => {
  it('detects common quantization labels', () => {
    expect(quantizationName('model-Q4_K_M.gguf')).toBe('Q4_K_M');
    expect(quantizationName('model-IQ4_XS.gguf')).toBe('IQ4_XS');
    expect(quantizationName('model-BF16.gguf')).toBe('BF16');
  });

  it('falls back to GGUF when no quantization is detected', () => {
    expect(quantizationName('model.gguf')).toBe('GGUF');
  });
});

describe('groupGgufFiles', () => {
  it('groups single-file models individually', () => {
    const groups = groupGgufFiles([
      { path: 'model-q4_k_m.gguf', size: 100 },
      { path: 'README.md', size: 10 },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.sharded).toBe(false);
    expect(groups[0]?.files).toHaveLength(1);
  });

  it('groups shard files together', () => {
    const groups = groupGgufFiles([
      { path: 'model-00001-of-00002.gguf', size: 100 },
      { path: 'model-00002-of-00002.gguf', size: 100 },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.sharded).toBe(true);
    expect(groups[0]?.files).toHaveLength(2);
    expect(groups[0]?.size).toBe(200);
  });

  it('excludes mmproj files', () => {
    const groups = groupGgufFiles([{ path: 'mmproj-model.gguf', size: 100 }]);

    expect(groups).toHaveLength(0);
  });
});
