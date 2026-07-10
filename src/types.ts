export interface ModelInfo {
  relativePath: string;
  fullPath: string;
  size: number;
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface HuggingFaceFile {
  path: string;
  size: number;
}

export interface HuggingFaceModelGroup {
  id: string;
  label: string;
  files: HuggingFaceFile[];
  size: number;
  sharded: boolean;
  shardPrefix?: string;
  shardCount?: number;
  directory?: string;
}
