/**
 * providers/index.ts
 *
 * Model provider abstraction for his-and-hers.
 * Supports any OpenClaw-compatible provider so the setup works with
 * whatever models the user already has.
 */

export type ProviderKind =
  | "anthropic"
  | "openai"
  | "ollama"
  | "lmstudio"
  | "custom";

export interface ProviderConfig {
  kind: ProviderKind;
  /** API key (stored in OS keychain, never plaintext in config) */
  apiKey?: string;
  /** Base URL — required for ollama/lmstudio/custom */
  baseUrl?: string;
  /** Primary model id, e.g. "claude-sonnet-4-6" or "llama3.2" */
  model: string;
  /** Human-readable alias shown in status output */
  alias?: string;
}

/** Well-known defaults per provider */
export const PROVIDER_DEFAULTS: Record<ProviderKind, Partial<ProviderConfig>> = {
  anthropic: {
    model: "claude-sonnet-4-6",
    alias: "Claude Sonnet",
  },
  openai: {
    model: "gpt-4o-mini",
    alias: "GPT-4o Mini",
  },
  ollama: {
    baseUrl: "http://localhost:11434",
    model: "llama3.2",
    alias: "Llama 3.2 (local)",
  },
  lmstudio: {
    baseUrl: "http://localhost:1234/v1",
    model: "local-model",
    alias: "LM Studio (local)",
  },
  custom: {
    baseUrl: "http://localhost:8080/v1",
    model: "custom",
    alias: "Custom",
  },
};

/**
 * Build the OpenClaw agent config block for this provider.
 * Written to the node's openclaw.json during `tj onboard`.
 */
export function buildOpenClawProviderConfig(provider: ProviderConfig): object {
  const base = {
    agents: {
      defaults: {
        model: {
          primary: `${provider.kind}/${provider.model}`,
        },
      },
    },
  };

  if (provider.kind === "ollama" || provider.kind === "lmstudio" || provider.kind === "custom") {
    return {
      ...base,
      models: {
        providers: {
          [provider.kind]: {
            baseUrl: provider.baseUrl,
            apiKey: "ollama", // placeholder; ollama doesn't require real key
            api: "openai-completions",
            models: [
              {
                id: provider.model,
                name: provider.alias ?? provider.model,
                api: "openai-completions",
                input: ["text"],
                contextWindow: 128000,
              },
            ],
          },
        },
      },
    };
  }

  return base;
}

/**
 * Check if Ollama is running locally and list available models.
 * Useful during onboarding to let Jerry auto-detect what's available.
 */
export async function detectOllamaModels(
  baseUrl = "http://localhost:11434",
): Promise<string[]> {
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return data.models?.map((m) => m.name) ?? [];
  } catch {
    return [];
  }
}

/**
 * Cost routing hint: for a given task description, suggest which node
 * (tom/jerry) and which provider makes sense.
 *
 * This is a simple heuristic — Phase 3 will make this smarter.
 */
export type RoutingHint = "tom-cloud" | "jerry-local" | "jerry-cloud";

export function suggestRouting(task: string): RoutingHint {
  const lower = task.toLowerCase();
  const heavyKeywords = [
    "image", "video", "audio", "transcribe", "generate", "render",
    "fine-tune", "train", "embed", "inference", "diffusion", "whisper",
  ];
  const isHeavy = heavyKeywords.some((kw) => lower.includes(kw));
  return isHeavy ? "jerry-local" : "tom-cloud";
}
