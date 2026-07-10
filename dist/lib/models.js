import fs from 'node:fs';
import path from 'node:path';
import { MODEL_LINK, MODELS_DIR } from '../config.js';
export function getCurrentModel() {
    try {
        const stats = fs.lstatSync(MODEL_LINK);
        if (!stats.isSymbolicLink()) {
            return null;
        }
        return fs.readlinkSync(MODEL_LINK);
    }
    catch {
        return null;
    }
}
export function findModels(directory = MODELS_DIR) {
    if (!fs.existsSync(directory)) {
        return [];
    }
    const results = [];
    for (const entry of fs.readdirSync(directory, {
        withFileTypes: true,
    })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== '.cache') {
                results.push(...findModels(fullPath));
            }
            continue;
        }
        if (entry.isFile()
            && entry.name.toLowerCase().endsWith('.gguf')
            && !entry.name.toLowerCase().startsWith('mmproj-')
            && fullPath !== MODEL_LINK) {
            const stats = fs.statSync(fullPath);
            results.push({
                relativePath: path.relative(MODELS_DIR, fullPath),
                fullPath,
                size: stats.size,
            });
        }
    }
    return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
export function setCurrentModel(relativePath) {
    const fullPath = path.join(MODELS_DIR, relativePath);
    if (!fs.existsSync(fullPath)) {
        throw new Error(`Model does not exist: ${fullPath}`);
    }
    const temporaryLink = `${MODEL_LINK}.next`;
    try {
        fs.unlinkSync(temporaryLink);
    }
    catch {
        // The temporary link does not exist.
    }
    // A relative link resolves both on the host and inside /models in Docker.
    fs.symlinkSync(relativePath, temporaryLink);
    fs.renameSync(temporaryLink, MODEL_LINK);
}
export function getModelByRelativePath(relativePath) {
    return (findModels().find((model) => model.relativePath === relativePath) ?? null);
}
//# sourceMappingURL=models.js.map