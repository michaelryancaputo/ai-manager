import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
const currentFile = fileURLToPath(import.meta.url);
const srcDirectory = path.dirname(currentFile);
const projectDirectory = path.resolve(srcDirectory, '..');
const envPath = path.join(projectDirectory, '.env');
dotenv.config({ path: envPath });
function required(name) {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}\n` +
            `Expected configuration file: ${envPath}\n` +
            `Copy .env.example to .env and configure it.`);
    }
    return value;
}
function positiveInteger(name, fallback) {
    const rawValue = process.env[name] ?? String(fallback);
    const value = Number.parseInt(rawValue, 10);
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer; received: ${rawValue}`);
    }
    return value;
}
export const PROJECT_DIR = projectDirectory;
export const MODELS_DIR = required('AI_MODELS_DIR');
export const COMPOSE_DIR = required('AI_COMPOSE_DIR');
export const MODEL_LINK = required('AI_MODEL_LINK');
export const SERVICE = required('AI_COMPOSE_SERVICE');
export const CONTAINER = required('AI_CONTAINER_NAME');
export const API_URL = required('AI_API_URL');
export const HEALTH_TIMEOUT_MS = positiveInteger('AI_HEALTH_TIMEOUT_MS', 120000);
//# sourceMappingURL=config.js.map