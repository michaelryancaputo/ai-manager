# AI Manager

An interactive CLI for managing a local [llama.cpp](https://github.com/ggml-org/llama.cpp) server running in Docker: switch between installed GGUF models, download new ones from Hugging Face (with quantization picks sized to your GPU), browse a curated catalog of suggested models by task, delete models you no longer need, and benchmark/compare models.

## What this is (and isn't)

This tool does not run inference itself. It manages:

- A `llama.cpp` server running as a Docker Compose service (start/stop/restart, health checks, logs).
- A models directory on disk, and a symlink pointing at whichever GGUF file is "active" — swapping the symlink and restarting the container is how model switching works.

You bring your own `docker-compose.yml` targeting whatever GPU backend you have (Intel Arc, NVIDIA CUDA, AMD ROCm, or CPU-only), using the matching `llama.cpp` server image. See [`docker-compose.example.yml`](./docker-compose.example.yml) for a working starting point (Intel Arc/oneAPI).

## Features

- **Switch models** — searchable list of installed models, with health/status shown before you pick.
- **Download from Hugging Face** — paste a repo URL or `owner/repo`, pick a quantization; recommendations are scored against your configured GPU VRAM and context size.
- **Suggested models** — browse a curated, task-organized catalog (general chat, coding, vision/multimodal, reasoning) without knowing a specific repo ahead of time.
- **Delete** — remove installed models and reclaim disk space, with shard-aware cleanup.
- **Benchmark / Compare** — run timed chat-completion requests against the active model, or benchmark multiple installed models back-to-back and compare tokens/sec. Choose which task types to include (chat, coding, vision, reasoning).

## Prerequisites

- Node.js >= 20
- Docker with Docker Compose v2 (`docker compose ...`)
- The [Hugging Face CLI](https://huggingface.co/docs/huggingface_hub/guides/cli) (`hf`) — `pip install -U "huggingface_hub[cli]"` — used for authenticated downloads of gated/private repos
- A GPU-capable `llama.cpp` server image appropriate to your hardware (or CPU-only)

## Install

```sh
git clone git@github.com:michaelryancaputo/ai-manager.git
cd ai-manager
npm run install-global
```

`install-global` runs `npm install && npm run build && npm install -g .`, which links a global `manager` command directly to this repo's `dist/` output. After pulling changes, run `npm run build` again to update the installed command in place.

## Configure

Copy `.env.example` to `.env` in the project root and fill in the values for your setup:

| Variable               | Required | Default  | Description                                                                                                                                                       |
| ---------------------- | -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AI_MODELS_DIR`        | Yes      | —        | Directory holding downloaded GGUF models. Mounted into the container as `/models`.                                                                                |
| `AI_COMPOSE_DIR`       | Yes      | —        | Directory containing your `docker-compose.yml`.                                                                                                                   |
| `AI_MODEL_LINK`        | Yes      | —        | Path to the symlink (inside `AI_MODELS_DIR`) that `manager` repoints when you switch models. Must match the `--model` path your compose file passes to llama.cpp. |
| `AI_COMPOSE_SERVICE`   | Yes      | —        | The service name in `docker-compose.yml` to restart.                                                                                                              |
| `AI_CONTAINER_NAME`    | Yes      | —        | The container name, used for status checks and `manager logs`.                                                                                                    |
| `AI_API_URL`           | Yes      | —        | Base URL of the llama.cpp OpenAI-compatible API (e.g. `http://127.0.0.1:8080`).                                                                                   |
| `AI_HEALTH_TIMEOUT_MS` | No       | `120000` | How long to wait for the server to become healthy after a restart.                                                                                                |
| `AI_GPU_VRAM_GB`       | No       | `16`     | GPU VRAM available for model loading; used to score quantization recommendations.                                                                                 |
| `AI_GPU_HEADROOM_GB`   | No       | `2`      | VRAM reserved for runtime overhead when scoring recommendations.                                                                                                  |
| `AI_CONTEXT_SIZE`      | No       | `8192`   | Context size used when estimating a model's runtime memory footprint.                                                                                             |

## Docker Compose setup

Copy [`docker-compose.example.yml`](./docker-compose.example.yml) to `docker-compose.yml` in the directory pointed to by `AI_COMPOSE_DIR`, then adjust it for your hardware:

- Swap the image tag for your GPU backend (see the [llama.cpp Docker docs](https://github.com/ggml-org/llama.cpp/blob/master/docs/docker.md) — Intel/oneAPI, CUDA, ROCm, Vulkan, and CPU-only variants are all published).
- Update the `devices`/`group_add`/environment blocks to match your backend (or remove them entirely for CPU-only).
- Make sure the volume mount's host path is `AI_MODELS_DIR`, mounted at `/models`, and that `--model` matches `AI_MODEL_LINK`'s filename relative to `AI_MODELS_DIR`.

## Usage

Run `manager` with no arguments to open the interactive menu, or use a subcommand directly:

```
manager                Open the main menu
manager switch         Open the model selector
manager download       Download a Hugging Face model
manager suggested      Browse suggested models for your hardware
manager delete         Delete an installed model
manager benchmark      Benchmark the active model
manager compare        Benchmark and compare multiple models
manager list           List installed models
manager current        Show the active model
manager status         Show server and storage status
manager restart        Restart llama.cpp
manager logs [n]       Show recent logs
manager help           Show this help
```

## Development

```sh
npm run dev         # run from source with tsx
npm run typecheck
npm run lint
npm test
npm run format
npm run build        # compile to dist/
```

## Security

- **`npm audit`** should report zero vulnerabilities. Re-run it after touching dependencies.
- **`.npmrc` sets `min-release-age=7`**, an npm supply-chain protection (npm >= 11.10.0, see `engines.npm` below): npm refuses to install any package version published fewer than 7 days ago. Most malicious/compromised npm packages are caught and unpublished within days, so this buys time before we'd ever pull one in. It applies to fresh/updated installs, not already-locked `package-lock.json` versions.
- **`allowScripts` in `package.json`** records which dependencies are permitted to run install scripts (a common supply-chain attack vector). Currently only `esbuild` (pulled in by `tsx`/`vitest`, used to fetch its own prebuilt native binary — reviewed and approved). If `npm install` warns about a new package with unreviewed scripts, inspect it (`node_modules/<pkg>/package.json`'s `scripts`, and the script file itself) before approving with `npm approve-scripts <pkg>`.
- No secrets live in this repo — runtime config is entirely `.env`-driven (see [Configure](#configure)), and `.gitignore` excludes `.env` and model files.

## License

MIT — see [LICENSE](./LICENSE).
