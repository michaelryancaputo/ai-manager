import { optionalPositiveInteger, optionalPositiveNumber } from '../lib/env.js';

import { quantizationName } from '../lib/huggingface.js';

import type { HuggingFaceModelGroup } from '../types.js';

export type FitLevel =
  'excellent' | 'good' | 'borderline' | 'partial-offload' | 'unknown';

export interface ModelRecommendation {
  score: number;
  fit: FitLevel;
  recommended: boolean;
  estimatedMemoryBytes: number | null;
  summary: string;
}

export interface RecommendationSettings {
  gpuVramBytes: number;
  gpuHeadroomBytes: number;
  contextSize: number;
}

const GIB = 1024 ** 3;

export function getRecommendationSettings(): RecommendationSettings {
  const gpuVramGb = optionalPositiveNumber(process.env.AI_GPU_VRAM_GB, 16);

  const gpuHeadroomGb = optionalPositiveNumber(
    process.env.AI_GPU_HEADROOM_GB,
    2,
  );

  const contextSize = optionalPositiveInteger(
    process.env.AI_CONTEXT_SIZE,
    8192,
  );

  return {
    gpuVramBytes: gpuVramGb * GIB,
    gpuHeadroomBytes: gpuHeadroomGb * GIB,
    contextSize,
  };
}

function quantizationScore(quantization: string): number {
  const scores: Record<string, number> = {
    Q4_K_M: 100,
    Q4_K_L: 96,
    IQ4_XS: 91,
    Q5_K_M: 88,
    Q5_K_L: 84,
    Q6_K: 76,
    Q4_0: 70,
    Q8_0: 60,
    BF16: 35,
    FP16: 35,
    F16: 35,
  };

  return scores[quantization] ?? 50;
}

/**
 * Model files require extra memory beyond their on-disk size.
 *
 * This estimate includes:
 * - roughly 10% runtime overhead
 * - a context/KV-cache allowance based on configured context size
 *
 * It remains an estimate because architectures differ significantly.
 */
function estimateRuntimeMemory(
  modelSizeBytes: number,
  contextSize: number,
): number {
  const modelOverhead = modelSizeBytes * 0.1;

  const contextMultiplier = Math.max(1, contextSize / 8192);

  const contextReserve = 1.25 * GIB * contextMultiplier;

  return Math.ceil(modelSizeBytes + modelOverhead + contextReserve);
}

export function determineFit(
  estimatedMemoryBytes: number,
  settings: RecommendationSettings,
): FitLevel {
  const usableVram = settings.gpuVramBytes - settings.gpuHeadroomBytes;

  const utilization = estimatedMemoryBytes / usableVram;

  if (utilization <= 0.7) {
    return 'excellent';
  }

  if (utilization <= 0.9) {
    return 'good';
  }

  if (utilization <= 1) {
    return 'borderline';
  }

  return 'partial-offload';
}

function fitScore(fit: FitLevel): number {
  switch (fit) {
    case 'excellent':
      return 100;

    case 'good':
      return 90;

    case 'borderline':
      return 65;

    case 'partial-offload':
      return 20;

    case 'unknown':
      return 40;
  }
}

function fitSummary(fit: FitLevel): string {
  switch (fit) {
    case 'excellent':
      return 'Comfortable GPU fit';

    case 'good':
      return 'Should fit in GPU memory';

    case 'borderline':
      return 'Likely tight at the configured context';

    case 'partial-offload':
      return 'Likely needs CPU offload or a smaller context';

    case 'unknown':
      return 'Model size is unavailable';
  }
}

export function recommendModel(
  group: HuggingFaceModelGroup,
  settings = getRecommendationSettings(),
): ModelRecommendation {
  const quantization = quantizationName(group.label);

  if (group.size <= 0) {
    return {
      score: quantizationScore(quantization),
      fit: 'unknown',
      recommended: false,
      estimatedMemoryBytes: null,
      summary: fitSummary('unknown'),
    };
  }

  const estimatedMemoryBytes = estimateRuntimeMemory(
    group.size,
    settings.contextSize,
  );

  const fit = determineFit(estimatedMemoryBytes, settings);

  const score = fitScore(fit) * 0.7 + quantizationScore(quantization) * 0.3;

  return {
    score,
    fit,
    recommended: false,
    estimatedMemoryBytes,
    summary: fitSummary(fit),
  };
}

export function rankModelRecommendations(
  groups: HuggingFaceModelGroup[],
  settings = getRecommendationSettings(),
): Array<{
  group: HuggingFaceModelGroup;
  recommendation: ModelRecommendation;
}> {
  const ranked = groups
    .map((group) => ({
      group,
      recommendation: recommendModel(group, settings),
    }))
    .sort((a, b) => b.recommendation.score - a.recommendation.score);

  const bestViable = ranked.find(
    (item) =>
      item.recommendation.fit === 'excellent' ||
      item.recommendation.fit === 'good',
  );

  if (bestViable) {
    bestViable.recommendation.recommended = true;
  }

  return ranked;
}
