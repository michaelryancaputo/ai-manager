import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

import type { HuggingFaceFile, HuggingFaceModelGroup } from '../types.js';

const execFileAsync = promisify(execFile);

interface HuggingFaceTreeItem {
  type?: string;
  path?: string;
  size?: number;
  lfs?: {
    size?: number;
  };
}

export class HuggingFaceAuthenticationError extends Error {
  constructor(message = 'Hugging Face authentication is required.') {
    super(message);
    this.name = 'HuggingFaceAuthenticationError';
  }
}

export function parseRepositoryId(input: string): string {
  const value = input.trim();

  if (!value) {
    throw new Error('A Hugging Face repository is required.');
  }

  if (/^[^/\s]+\/[^/\s]+$/.test(value)) {
    return value;
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(
      'Enter a Hugging Face URL or repository in owner/repository format.',
    );
  }

  if (
    url.hostname !== 'huggingface.co' &&
    url.hostname !== 'www.huggingface.co'
  ) {
    throw new Error('The URL must point to huggingface.co.');
  }

  const parts = url.pathname.split('/').filter(Boolean);

  if (parts.length < 2) {
    throw new Error('The Hugging Face URL does not contain a repository name.');
  }

  return `${parts[0]}/${parts[1]}`;
}

export function repositoryDirectoryName(repositoryId: string): string {
  const repositoryName = repositoryId.split('/').at(-1);

  if (!repositoryName) {
    throw new Error(`Invalid repository ID: ${repositoryId}`);
  }

  return repositoryName
    .replace(/-GGUF$/i, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .toLowerCase();
}

export async function getHuggingFaceToken(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('hf', ['auth', 'token'], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });

    const token = stdout.trim();

    return token || null;
  } catch {
    return null;
  }
}

export async function runHuggingFaceLogin(): Promise<void> {
  const child = spawn('hf', ['auth', 'login'], {
    stdio: 'inherit',
    env: process.env,
  });

  await new Promise<void>((resolve, reject) => {
    child.on('error', (error) => {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        reject(
          new Error(
            'The `hf` command is not installed or is not available in PATH.',
          ),
        );
        return;
      }

      reject(error);
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Hugging Face login exited with code ${String(code)}.`));
    });
  });
}

export async function listRepositoryFiles(
  repositoryId: string,
): Promise<HuggingFaceFile[]> {
  const encodedRepository = repositoryId
    .split('/')
    .map(encodeURIComponent)
    .join('/');

  const url =
    `https://huggingface.co/api/models/${encodedRepository}` +
    '/tree/main?recursive=true&expand=true';

  const token = await getHuggingFaceToken();

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    headers,
  });

  if (response.status === 401) {
    throw new HuggingFaceAuthenticationError(
      'This repository requires authentication, or your token does not have access.',
    );
  }

  if (response.status === 403) {
    throw new HuggingFaceAuthenticationError(
      'Your Hugging Face account does not have access to this gated repository.',
    );
  }

  if (response.status === 404) {
    throw new Error(`Hugging Face repository not found: ${repositoryId}`);
  }

  if (!response.ok) {
    throw new Error(`Hugging Face returned HTTP ${response.status}.`);
  }

  const data = (await response.json()) as HuggingFaceTreeItem[];

  if (!Array.isArray(data)) {
    throw new Error('Hugging Face returned an unexpected repository response.');
  }

  return data
    .filter(
      (
        item,
      ): item is HuggingFaceTreeItem & {
        path: string;
      } => item.type === 'file' && typeof item.path === 'string',
    )
    .map((item) => ({
      path: item.path,
      size: item.size ?? item.lfs?.size ?? 0,
    }));
}

function isGguf(filename: string): boolean {
  return filename.toLowerCase().endsWith('.gguf');
}

function isMmproj(filename: string): boolean {
  return path.basename(filename).toLowerCase().startsWith('mmproj-');
}

function parseShard(filename: string): {
  prefix: string;
  shardNumber: number;
  shardCount: number;
} | null {
  const match = filename.match(/^(.*)-(\d{5})-of-(\d{5})\.gguf$/i);

  if (!match) {
    return null;
  }

  const prefix = match[1];
  const shardNumber = match[2];
  const shardCount = match[3];

  if (!prefix || !shardNumber || !shardCount) {
    return null;
  }

  return {
    prefix,
    shardNumber: Number.parseInt(shardNumber, 10),
    shardCount: Number.parseInt(shardCount, 10),
  };
}

export function quantizationName(filename: string): string {
  const upper = filename.toUpperCase();

  const patterns = [
    /UD-Q\d+_[A-Z0-9_]+/,
    /IQ\d+_[A-Z0-9_]+/,
    /Q\d+_[A-Z0-9_]+/,
    /BF16/,
    /FP16/,
    /F16/,
  ];

  for (const pattern of patterns) {
    const match = upper.match(pattern);

    if (match?.[0]) {
      return match[0];
    }
  }

  return 'GGUF';
}

function quantizationRank(filename: string): number {
  const upper = filename.toUpperCase();

  const preferred = [
    'Q4_K_M',
    'Q4_K_L',
    'IQ4_XS',
    'Q4_0',
    'Q5_K_M',
    'Q5_K_L',
    'Q6_K',
    'Q8_0',
    'BF16',
    'FP16',
    'F16',
  ];

  const index = preferred.findIndex((value) => upper.includes(value));

  return index === -1 ? preferred.length : index;
}

export function groupGgufFiles(
  files: HuggingFaceFile[],
): HuggingFaceModelGroup[] {
  const groups = new Map<string, HuggingFaceModelGroup>();

  for (const file of files) {
    if (!isGguf(file.path) || isMmproj(file.path)) {
      continue;
    }

    const shard = parseShard(file.path);

    if (!shard) {
      groups.set(file.path, {
        id: file.path,
        label: path.basename(file.path),
        files: [file],
        size: file.size,
        sharded: false,
      });

      continue;
    }

    const directory = path.dirname(file.path);

    const normalizedDirectory = directory === '.' ? '' : directory;

    const groupId = path.posix.join(
      normalizedDirectory,
      `${shard.prefix}-sharded`,
    );

    const existing = groups.get(groupId);

    const group: HuggingFaceModelGroup = existing ?? {
      id: groupId,
      label: `${shard.prefix} (${shard.shardCount} shards)`,
      files: [],
      size: 0,
      sharded: true,
      shardPrefix: shard.prefix,
      shardCount: shard.shardCount,
      directory: normalizedDirectory,
    };

    group.files.push(file);
    group.size += file.size;

    groups.set(groupId, group);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      files: [...group.files].sort((a, b) => a.path.localeCompare(b.path)),
    }))
    .sort((a, b) => {
      const rankDifference =
        quantizationRank(a.label) - quantizationRank(b.label);

      if (rankDifference !== 0) {
        return rankDifference;
      }

      return a.label.localeCompare(b.label);
    });
}

export function downloadPatterns(group: HuggingFaceModelGroup): string[] {
  if (!group.sharded) {
    return group.files.map((file) => file.path);
  }

  const directoryPrefix = group.directory ? `${group.directory}/` : '';

  return [`${directoryPrefix}${group.shardPrefix}-*-of-*.gguf`];
}

export async function downloadModel(options: {
  repositoryId: string;
  patterns: string[];
  destination: string;
}): Promise<void> {
  const args = ['download', options.repositoryId];

  for (const pattern of options.patterns) {
    args.push('--include', pattern);
  }

  args.push('--local-dir', options.destination, '--format', 'human');

  const child = spawn('hf', args, {
    stdio: 'inherit',
    env: process.env,
  });

  await new Promise<void>((resolve, reject) => {
    child.on('error', (error) => {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        reject(
          new Error(
            'The `hf` command is not installed or is not available in PATH.',
          ),
        );
        return;
      }

      reject(error);
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`hf download exited with code ${String(code)}.`));
    });
  });
}
