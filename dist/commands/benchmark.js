import chalk from 'chalk';
import ora from 'ora';
import { API_URL } from '../config.js';
const BENCHMARKS = [
    {
        name: 'Reasoning',
        prompt: 'A farmer has 17 sheep. All but 9 run away. How many sheep remain? Explain briefly.',
        maxTokens: 128,
    },
    {
        name: 'Coding',
        prompt: 'Write a concise TypeScript function that removes duplicate strings from an array while preserving order.',
        maxTokens: 256,
    },
    {
        name: 'Summarization',
        prompt: 'Summarize this in one sentence: Local language models provide privacy and control, but require users to manage hardware, model files, inference software, and performance tradeoffs.',
        maxTokens: 128,
    },
];
function formatNumber(value) {
    return value === null ? 'n/a' : value.toFixed(2);
}
function average(values) {
    const available = values.filter((value) => value !== null);
    if (available.length === 0) {
        return null;
    }
    return (available.reduce((total, value) => total + value, 0)
        / available.length);
}
async function runSingleBenchmark(name, prompt, maxTokens) {
    const startedAt = performance.now();
    const response = await fetch(`${API_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'local',
            messages: [
                {
                    role: 'user',
                    content: prompt,
                },
            ],
            temperature: 0,
            max_tokens: maxTokens,
            stream: false,
        }),
    });
    const elapsedMs = performance.now() - startedAt;
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Benchmark request failed with HTTP ${response.status}: ${body}`);
    }
    const result = (await response.json());
    const promptTokens = result.usage?.prompt_tokens
        ?? result.timings?.prompt_n
        ?? 0;
    const completionTokens = result.usage?.completion_tokens
        ?? result.timings?.predicted_n
        ?? 0;
    return {
        name,
        elapsedMs,
        promptTokens,
        completionTokens,
        promptTokensPerSecond: result.timings?.prompt_per_second ?? null,
        generationTokensPerSecond: result.timings?.predicted_per_second ?? null,
    };
}
export async function runBenchmarkCommand() {
    console.log();
    console.log(chalk.bold.cyan('Model Benchmark'));
    console.log(chalk.dim('────────────────────────────────────────'));
    console.log();
    const results = [];
    for (const benchmark of BENCHMARKS) {
        const spinner = ora(`Running ${benchmark.name} benchmark`).start();
        try {
            const result = await runSingleBenchmark(benchmark.name, benchmark.prompt, benchmark.maxTokens);
            results.push(result);
            spinner.succeed(`${benchmark.name}: ${formatNumber(result.generationTokensPerSecond)} tokens/sec`);
        }
        catch (error) {
            spinner.fail(`${benchmark.name} benchmark failed`);
            throw error;
        }
    }
    console.log();
    console.log(chalk.bold('Results'));
    console.log();
    for (const result of results) {
        console.log(chalk.bold(result.name));
        console.log(`  Total time:       ${(result.elapsedMs / 1000).toFixed(2)} sec`);
        console.log(`  Prompt tokens:    ${result.promptTokens}`);
        console.log(`  Completion tokens:${result.completionTokens}`);
        console.log(`  Prompt speed:     ${formatNumber(result.promptTokensPerSecond)} tokens/sec`);
        console.log(`  Generation speed: ${formatNumber(result.generationTokensPerSecond)} tokens/sec`);
        console.log();
    }
    const averageElapsedMs = results.reduce((total, result) => total + result.elapsedMs, 0)
        / results.length;
    const averagePromptSpeed = average(results.map(result => result.promptTokensPerSecond));
    const averageGenerationSpeed = average(results.map(result => result.generationTokensPerSecond));
    console.log(chalk.bold.green('Average'));
    console.log(`  Total time:       ${(averageElapsedMs / 1000).toFixed(2)} sec`);
    console.log(`  Prompt speed:     ${formatNumber(averagePromptSpeed)} tokens/sec`);
    console.log(`  Generation speed: ${formatNumber(averageGenerationSpeed)} tokens/sec`);
    console.log();
}
//# sourceMappingURL=benchmark.js.map