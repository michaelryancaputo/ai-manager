import { execFileSync } from 'node:child_process';

export function listRepoFiles(repo: string): string[] {
  const output = execFileSync(
    'hf',
    ['repo', 'files', repo],
    {
      encoding: 'utf8',
    },
  );

  return output
    .split('\n')
    .map((filename: string) => filename.trim())
    .filter(
      (filename: string) =>
        filename.toLowerCase().endsWith('.gguf'),
    );
}
