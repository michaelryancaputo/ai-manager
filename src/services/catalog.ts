export type ModelTask = 'chat' | 'coding' | 'vision' | 'reasoning';

export interface CatalogEntry {
  repositoryId: string;
  name: string;
  task: ModelTask;
  description: string;
}

export const TASK_LABELS: Record<ModelTask, string> = {
  chat: 'General chat / instruct',
  coding: 'Coding',
  vision: 'Vision / multimodal',
  reasoning: 'Reasoning / agentic',
};

const TASK_ORDER: ModelTask[] = ['chat', 'coding', 'vision', 'reasoning'];

export const MODEL_CATALOG: CatalogEntry[] = [
  {
    repositoryId: 'Qwen/Qwen3-4B-GGUF',
    name: 'Qwen3 4B',
    task: 'chat',
    description: 'Small, fast general-purpose assistant model.',
  },
  {
    repositoryId: 'Qwen/Qwen3-8B-GGUF',
    name: 'Qwen3 8B',
    task: 'chat',
    description: 'Balanced default for everyday chat and Q&A.',
  },
  {
    repositoryId: 'Qwen/Qwen3-30B-A3B-GGUF',
    name: 'Qwen3 30B-A3B',
    task: 'chat',
    description:
      'Large mixture-of-experts model with strong quality at efficient inference cost.',
  },
  {
    repositoryId: 'bartowski/Meta-Llama-3.1-8B-Instruct-GGUF',
    name: 'Llama 3.1 8B Instruct',
    task: 'chat',
    description:
      'Widely used alternative model family with well-supported quantizations.',
  },

  {
    repositoryId: 'Qwen/Qwen2.5-Coder-7B-Instruct-GGUF',
    name: 'Qwen2.5 Coder 7B',
    task: 'coding',
    description: 'Small, fast model tuned for code generation and completion.',
  },
  {
    repositoryId: 'Qwen/Qwen2.5-Coder-32B-Instruct-GGUF',
    name: 'Qwen2.5 Coder 32B',
    task: 'coding',
    description: 'Larger coder model for tougher programming tasks.',
  },
  {
    repositoryId: 'unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF',
    name: 'Qwen3 Coder 30B-A3B',
    task: 'coding',
    description:
      'Mixture-of-experts coder model; one of the most widely used GGUF coding models.',
  },
  {
    repositoryId: 'bartowski/DeepSeek-Coder-V2-Lite-Instruct-GGUF',
    name: 'DeepSeek Coder V2 Lite',
    task: 'coding',
    description: 'Alternative coder family with a mixture-of-experts architecture.',
  },

  {
    repositoryId: 'Qwen/Qwen3-VL-2B-Instruct-GGUF',
    name: 'Qwen3 VL 2B',
    task: 'vision',
    description: 'Small, fast vision-language model for image understanding.',
  },
  {
    repositoryId: 'Qwen/Qwen3-VL-8B-Instruct-GGUF',
    name: 'Qwen3 VL 8B',
    task: 'vision',
    description: 'Balanced default vision-language model.',
  },
  {
    repositoryId: 'Qwen/Qwen3-VL-30B-A3B-Instruct-GGUF',
    name: 'Qwen3 VL 30B-A3B',
    task: 'vision',
    description: 'Large mixture-of-experts vision-language model.',
  },
  {
    repositoryId: 'google/gemma-4-26B-A4B-it-qat-q4_0-gguf',
    name: 'Gemma 4 26B-A4B',
    task: 'vision',
    description:
      "Google's official quantization-aware-trained multimodal instruct model.",
  },

  {
    repositoryId: 'unsloth/DeepSeek-R1-Distill-Llama-8B-GGUF',
    name: 'DeepSeek R1 Distill Llama 8B',
    task: 'reasoning',
    description: 'Small reasoning model distilled from DeepSeek R1.',
  },
  {
    repositoryId: 'unsloth/DeepSeek-R1-Distill-Qwen-14B-GGUF',
    name: 'DeepSeek R1 Distill Qwen 14B',
    task: 'reasoning',
    description: 'Mid-size reasoning model distilled from DeepSeek R1.',
  },
  {
    repositoryId: 'unsloth/Qwen3-30B-A3B-Thinking-2507-GGUF',
    name: 'Qwen3 30B-A3B Thinking',
    task: 'reasoning',
    description:
      'Large mixture-of-experts model tuned for extended chain-of-thought reasoning.',
  },
  {
    repositoryId: 'Qwen/QwQ-32B-GGUF',
    name: 'QwQ 32B',
    task: 'reasoning',
    description: "Qwen's dedicated reasoning-specialized model.",
  },
];

export function catalogTasks(): ModelTask[] {
  const present = new Set(MODEL_CATALOG.map((entry) => entry.task));

  return TASK_ORDER.filter((task) => present.has(task));
}

export function catalogEntriesForTask(task: ModelTask): CatalogEntry[] {
  return MODEL_CATALOG.filter((entry) => entry.task === task);
}
