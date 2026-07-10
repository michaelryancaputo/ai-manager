import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const currentFile = fileURLToPath(import.meta.url);
const srcDirectory = path.dirname(currentFile);
const projectDirectory = path.resolve(srcDirectory, '..');
const envPath = path.join(projectDirectory, '.env');

dotenv.config({ path: envPath, quiet: true });

function required(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}\n` +
      `Expected configuration file: ${envPath}\n` +
      'Copy .env.example to .env and configure it.',
    );
  }

  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const rawValue = process.env[name] ?? String(fallback);
  const value = Number.parseInt(rawValue, 10);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `${name} must be a positive integer; received: ${rawValue}`,
    );
  }

  return value;
}

export const PROJECT_DIR: string = projectDirectory;
export const MODELS_DIR: string = required('AI_MODELS_DIR');
export const COMPOSE_DIR: string = required('AI_COMPOSE_DIR');
export const MODEL_LINK: string = required('AI_MODEL_LINK');

export const SERVICE: string = required('AI_COMPOSE_SERVICE');
export const CONTAINER: string = required('AI_CONTAINER_NAME');
export const API_URL: string = required('AI_API_URL');

export const HEALTH_TIMEOUT_MS: number = positiveInteger(
  'AI_HEALTH_TIMEOUT_MS',
  120_000,
);
