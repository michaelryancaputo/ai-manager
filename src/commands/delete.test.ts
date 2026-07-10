import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MODELS_DIR } from '../config.js';

import { getDeleteTarget, isShard, removeTarget } from './delete.js';

describe('isShard', () => {
  it('recognizes shard filenames', () => {
    expect(isShard('model-00001-of-00003.gguf')).toBe(true);
    expect(isShard('MODEL-00002-OF-00003.GGUF')).toBe(true);
  });

  it('rejects non-shard filenames', () => {
    expect(isShard('model.gguf')).toBe(false);
    expect(isShard('model-q4_k_m.gguf')).toBe(false);
  });
});

describe('getDeleteTarget', () => {
  it('resolves a single-file model to itself', () => {
    const model = {
      relativePath: 'model.gguf',
      fullPath: '/models/model.gguf',
      size: 100,
    };

    const target = getDeleteTarget(model);

    expect(target.deletePath).toBe('/models/model.gguf');
  });

  it('resolves a shard to its containing directory', () => {
    const model = {
      relativePath: 'my-model/my-model-00001-of-00003.gguf',
      fullPath: '/models/my-model/my-model-00001-of-00003.gguf',
      size: 100,
    };

    const target = getDeleteTarget(model);

    expect(target.deletePath).toBe('/models/my-model');
  });
});

describe('removeTarget', () => {
  beforeEach(() => {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(MODELS_DIR, { recursive: true, force: true });
  });

  it('deletes a path inside the models directory', () => {
    const target = path.join(MODELS_DIR, 'model-a');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'model.gguf'), 'x');

    removeTarget(target);

    expect(fs.existsSync(target)).toBe(false);
  });

  it('refuses to delete the models directory itself', () => {
    expect(() => removeTarget(MODELS_DIR)).toThrow();
  });

  it('refuses to delete a path outside the models directory', () => {
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ai-manager-outside-'),
    );

    try {
      expect(() => removeTarget(outside)).toThrow();
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
