import { execFileSync } from "node:child_process";
export function listRepoFiles(repo) {
    const output = execFileSync("hf", ["repo", "files", repo], {
        encoding: "utf8",
    });
    return output
        .split("\n")
        .map(f => f.trim())
        .filter(f => f.endsWith(".gguf"));
}
//# sourceMappingURL=huggingface.js.map