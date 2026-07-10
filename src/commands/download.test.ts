import { describe, expect, it } from 'vitest';

import { validateInstallDirectory } from './download.js';

describe('validateInstallDirectory', () => {
  it('rejects an empty value', () => {
    expect(validateInstallDirectory('')).not.toBe(true);
    expect(validateInstallDirectory('   ')).not.toBe(true);
  });

  it('rejects absolute paths', () => {
    expect(validateInstallDirectory('/etc/passwd')).not.toBe(true);
  });

  it('rejects paths that escape the models directory', () => {
    expect(validateInstallDirectory('..')).not.toBe(true);
    expect(validateInstallDirectory('../secrets')).not.toBe(true);
    expect(validateInstallDirectory('a/../../b')).not.toBe(true);
  });

  it('accepts a plain relative directory name', () => {
    expect(validateInstallDirectory('my-model')).toBe(true);
    expect(validateInstallDirectory('nested/model-dir')).toBe(true);
  });
});
