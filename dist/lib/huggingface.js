import path from 'node:path';
import { spawn } from 'node:child_process';
export function parseRepositoryId(input) {
    const value = input.trim();
    if (!value) {
        throw new Error('A Hugging Face repository is required.');
    }
    if (/^[^/\s]+\/[^/\s]+$/.test(value)) {
        return value;
    }
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new Error('Enter a Hugging Face URL or repository in owner/repository format.');
    }
    if (url.hostname !== 'huggingface.co'
        && url.hostname !== 'www.huggingface.co') {
        throw new Error('The URL must point to huggingface.co.');
    }
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) {
        throw new Error('The Hugging Face URL does not contain a repository name.');
    }
    return `${parts[0]}/${parts[1]}`;
}
export function repositoryDirectoryName(repositoryId) {
    return repositoryId
        .split('/')
        .at(-1)
        .replace(/-GGUF$/i, '')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .toLowerCase();
}
export async function listRepositoryFiles(repositoryId) {
    const encodedRepository = repositoryId
        .split('/')
        .map(encodeURIComponent)
        .join('/');
    const url = `https://huggingface.co/api/models/${encodedRepository}` +
        '/tree/main?recursive=true&expand=true';
    const response = await fetch(url, {
        headers: {
            Accept: 'application/json',
        },
    });
    if (response.status === 401) {
        throw new Error('This repository requires authentication. Run `hf auth login` first.');
    }
    if (response.status === 404) {
        throw new Error(`Hugging Face repository not found: ${repositoryId}`);
    }
    if (!response.ok) {
        throw new Error(`Hugging Face returned HTTP ${response.status}.`);
    }
    const data = (await response.json());
    if (!Array.isArray(data)) {
        throw new Error('Hugging Face returned an unexpected repository response.');
    }
    return data
        .filter((item) => item.type === 'file'
        && typeof item.path === 'string')
        .map(item => ({
        path: item.path,
        size: item.size ?? item.lfs?.size ?? 0,
    }));
}
function isGguf(filename) {
    return filename.toLowerCase().endsWith('.gguf');
}
function isMmproj(filename) {
    return path
        .basename(filename)
        .toLowerCase()
        .startsWith('mmproj-');
}
function parseShard(filename) {
    const match = filename.match(/^(.*)-(\d{5})-of-(\d{5})\.gguf$/i);
    if (!match) {
        return null;
    }
    return {
        prefix: match[1],
        shardNumber: Number.parseInt(match[2], 10),
        shardCount: Number.parseInt(match[3], 10),
    };
}
export function quantizationName(filename) {
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
        if (match) {
            return match[0];
        }
    }
    return 'GGUF';
}
function quantizationRank(filename) {
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
    const index = preferred.findIndex(value => upper.includes(value));
    return index === -1 ? preferred.length : index;
}
export function groupGgufFiles(files) {
    const groups = new Map();
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
        const groupId = path.posix.join(normalizedDirectory, `${shard.prefix}-sharded`);
        const group = groups.get(groupId) ?? {
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
        .map(group => ({
        ...group,
        files: [...group.files].sort((a, b) => a.path.localeCompare(b.path)),
    }))
        .sort((a, b) => {
        const rankDifference = quantizationRank(a.label)
            - quantizationRank(b.label);
        if (rankDifference !== 0) {
            return rankDifference;
        }
        return a.label.localeCompare(b.label);
    });
}
export function downloadPatterns(group) {
    if (!group.sharded) {
        return group.files.map(file => file.path);
    }
    const directoryPrefix = group.directory
        ? `${group.directory}/`
        : '';
    return [
        `${directoryPrefix}${group.shardPrefix}-*-of-*.gguf`,
    ];
}
export async function downloadModel(options) {
    const args = [
        'download',
        options.repositoryId,
    ];
    for (const pattern of options.patterns) {
        args.push('--include', pattern);
    }
    args.push('--local-dir', options.destination, '--format', 'human');
    const child = spawn('hf', args, {
        stdio: 'inherit',
        env: process.env,
    });
    await new Promise((resolve, reject) => {
        child.on('error', error => {
            if (error instanceof Error
                && 'code' in error
                && error.code === 'ENOENT') {
                reject(new Error('The `hf` command is not installed or is not available in PATH.'));
                return;
            }
            reject(error);
        });
        child.on('exit', code => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`hf download exited with code ${String(code)}.`));
        });
    });
}
//# sourceMappingURL=huggingface.js.map