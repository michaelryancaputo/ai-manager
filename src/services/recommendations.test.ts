import { describe, expect, it } from 'vitest';

import { determineFit, rankModelRecommendations } from './recommendations.js';

import type { HuggingFaceModelGroup } from '../types.js';

const settings = {
  gpuVramBytes: 16 * 1024 ** 3,
  gpuHeadroomBytes: 0,
  contextSize: 8192,
};

function group(label: string, size: number): HuggingFaceModelGroup {
  return {
    id: label,
    label,
    files: [{ path: label, size }],
    size,
    sharded: false,
  };
}

describe('determineFit', () => {
  it('returns excellent at or below 70% utilization', () => {
    expect(determineFit(0.7 * settings.gpuVramBytes, settings)).toBe(
      'excellent',
    );
  });

  it('returns good between 70% and 90% utilization', () => {
    expect(determineFit(0.71 * settings.gpuVramBytes, settings)).toBe('good');
    expect(determineFit(0.9 * settings.gpuVramBytes, settings)).toBe('good');
  });

  it('returns borderline between 90% and 100% utilization', () => {
    expect(determineFit(0.91 * settings.gpuVramBytes, settings)).toBe(
      'borderline',
    );
    expect(determineFit(1 * settings.gpuVramBytes, settings)).toBe(
      'borderline',
    );
  });

  it('returns partial-offload above 100% utilization', () => {
    expect(determineFit(1.01 * settings.gpuVramBytes, settings)).toBe(
      'partial-offload',
    );
  });
});

describe('rankModelRecommendations', () => {
  it('marks exactly one viable option as recommended', () => {
    const groups = [
      group('model-Q8_0.gguf', 8 * 1024 ** 3),
      group('model-Q4_K_M.gguf', 4 * 1024 ** 3),
      group('model-BF16.gguf', 30 * 1024 ** 3),
    ];

    const ranked = rankModelRecommendations(groups, settings);

    const recommendedCount = ranked.filter(
      (item) => item.recommendation.recommended,
    ).length;

    expect(recommendedCount).toBe(1);
    expect(
      ranked.find((item) => item.recommendation.recommended)?.recommendation
        .fit,
    ).not.toBe('partial-offload');
  });

  it('does not mark anything recommended when nothing fits', () => {
    const groups = [group('model-BF16.gguf', 100 * 1024 ** 3)];

    const ranked = rankModelRecommendations(groups, settings);

    expect(ranked.every((item) => !item.recommendation.recommended)).toBe(true);
  });
});
