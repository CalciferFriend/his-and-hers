import * as p from "@clack/prompts";
import { isCancelled, type WizardContext } from "../context.ts";
import { buildProviderConfig, type ProviderConfig } from "../../config/schema.ts";

const PROVIDERS = [
  { value: "anthropic-max", label: "Claude Max Plan", hint: "recommended — uses your Max subscription" },
  { value: "anthropic", label: "Anthropic API", hint: "pay-per-token API key" },
  { value: "openai",    label: "OpenAI" },
  { value: "ollama",    label: "Ollama (local)",    hint: "recommended for H2 / GPU" },
  { value: "lmstudio",  label: "LM Studio (local)" },
  { value: "custom",    label: "Custom OpenAI-compatible endpoint" },
] as const satisfies { value: ProviderConfig["kind"]; label: string; hint?: string }[];

const MODELS: Record<ProviderConfig["kind"], { label: string; value: string }[]> = {
  "anthropic-max": [
    { value: "claude-sonnet-4-6",    label: "claude-sonnet-4-6 (recommended)" },
    { value: "claude-opus-4-6",      label: "claude-opus-4-6 (most capable)" },
    { value: "claude-haiku-4-5",     label: "claude-haiku-4-5 (fast)" },
  ],
  anthropic: [
    { value: "claude-sonnet-4-6",    label: "claude-sonnet-4-6 (recommended)" },
    { value: "claude-opus-4-6",      label: "claude-opus-4-6 (most capable)" },
    { value: "claude-haiku-4-5",     label: "claude-haiku-4-5 (fast)" },
  ],
  openai: [
    { value: "gpt-4o-mini",   label: "gpt-4o-mini (recommended)" },
    { value: "gpt-4o",        label: "gpt-4o" },
    { value: "gpt-5.1-codex", label: "gpt-5.1-codex" },
  ],
  ollama:   [{ value: "llama3.2", label: "llama3.2 (default)" }],
  lmstudio: [{ value: "local-model", label: "local-model (from LM Studio)" }],
  custom:   [{ value: "custom", label: "custom" }],
};

async function tryStoreInKeychain(
  service: string,
  account: string,
  password: string,
): Promise<boolean> {
  try {
    const keytar = await import("keytar");
    await keytar.default.setPassword(service, account, password);
    return true;
  } catch {
    return false;
  }
}

export async function stepProvider(
  ctx: Partial<WizardContext>,
): Promise<Partial<WizardContext>> {
  const kind = await p.select({
    message: "LLM provider for this node",
    options: [...PROVIDERS],
  });

  if (isCancelled(kind)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  const providerKind = kind as ProviderConfig["kind"];
  const isLocal = providerKind === "ollama" || providerKind === "lmstudio";
  const isMaxPlan = providerKind === "anthropic-max";

  // ── Model selection ────────────────────────────────────────────────────────
  let model: string;
  if (isLocal || providerKind === "custom") {
    // For local providers, allow free-text entry or pick default
    const modelOptions = MODELS[providerKind];
    const defaultModel = modelOptions[0]?.value ?? "local-model";

    const modelInput = await p.text({
      message: `Model name/id (default: ${defaultModel})`,
      placeholder: defaultModel,
    });

    if (isCancelled(modelInput)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }
    model = (modelInput as string).trim() || defaultModel;
  } else {
    // Cloud providers: offer a select
    const selectedModel = await p.select({
      message: "Model",
      options: MODELS[providerKind],
    });

    if (isCancelled(selectedModel)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }
    model = selectedModel as string;
  }

  // ── Base URL (local/custom providers) ─────────────────────────────────────
  let baseUrl: string | undefined;
  if (isLocal || providerKind === "custom") {
    const defaults: Record<string, string> = {
      ollama:   "http://localhost:11434",
      lmstudio: "http://localhost:1234/v1",
      custom:   "http://localhost:8080/v1",
    };
    const defaultUrl = defaults[providerKind] ?? "http://localhost:8080/v1";

    const urlInput = await p.text({
      message: `Base URL for ${providerKind}`,
      placeholder: defaultUrl,
      initialValue: defaultUrl,
    });

    if (isCancelled(urlInput)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }
    baseUrl = (urlInput as string).trim() || defaultUrl;

    if (providerKind === "ollama") {
      // Try to auto-detect running Ollama instance
      const spinner = p.spinner();
      spinner.start(`Checking Ollama at ${baseUrl}…`);
      try {
        const res = await fetch(`${baseUrl}/api/tags`);
        if (res.ok) {
          const data = await res.json() as { models?: { name: string }[] };
          const names = (data.models ?? []).map((m) => m.name).slice(0, 5).join(", ");
          spinner.stop(`Ollama is running. Available models: ${names || "(none yet)"}`);
        } else {
          spinner.stop("Ollama responded but returned an error — continuing anyway.");
        }
      } catch {
        spinner.stop("Ollama not reachable at that URL — make sure it's running before using cofounder.");
      }
    }
  }

  // ── API key (cloud providers) ──────────────────────────────────────────────
  let apiKeyKeychainKey: string | undefined;

  if (isMaxPlan) {
    p.log.info(
      "Max plan detected — Cofounder will use your Claude Code / Max subscription.\n" +
      "No API key needed. Make sure Claude Code is authenticated on this machine.",
    );
  } else if (!isLocal) {
    const apiKey = await p.password({
      message: `API key for ${providerKind}`,
      validate: (v) => {
        if (!v.trim()) return "API key is required (or choose a local provider)";
      },
    });

    if (isCancelled(apiKey)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }

    const keychainKey = `cofounder-${providerKind}-api-key`;
    const spinner = p.spinner();
    spinner.start("Storing API key in OS keychain…");

    const stored = await tryStoreInKeychain("cofounder", keychainKey, apiKey as string);

    if (stored) {
      spinner.stop("API key stored in OS keychain ✓");
      apiKeyKeychainKey = keychainKey;
    } else {
      spinner.stop("Could not access OS keychain — keytar may need native build.");
      p.log.warn(
        "Set your API key in your shell profile as an environment variable.\n" +
        "Install keytar native dependencies for secure storage: pnpm approve-builds",
      );
    }
  }

  // ── Build ProviderConfig ───────────────────────────────────────────────────
  const providerConfig = buildProviderConfig(providerKind, model, {
    baseUrl,
    apiKeyKeychainKey,
  });

  p.log.success(
    `Provider configured: ${providerConfig.alias ?? providerKind} / ${model}`,
  );

  return {
    ...ctx,
    provider: providerKind,
    providerConfig,
    apiKeyStored: !isLocal ? !!apiKeyKeychainKey : true,
  };
}
