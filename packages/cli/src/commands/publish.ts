/**
 * hh publish — publish an anonymised node card to the community registry.
 *
 * Uses GitHub Gist as a zero-infrastructure registry. Each published node
 * is a public Gist with:
 *   - description: "[his-and-hers] <role> — <name>, <provider>, <GPU>"
 *   - file: hh-node-card.json  (the anonymised HHNodeCard)
 *
 * Anyone can browse the registry with: hh discover
 *
 * Auth: set GITHUB_TOKEN env var, or pass --token. Without a token, publish
 * works anonymously (no editing/deleting later). Most users should set the
 * token so they can update or retract their card.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { loadConfig } from "../config/store.ts";

const REGISTRY_TAG = "his-and-hers-node";
const CARD_DIR = join(homedir(), ".his-and-hers");
const CARD_FILE = join(CARD_DIR, "published-card.json");

// ─── Schema ──────────────────────────────────────────────────────────────────

export interface HHNodeCard {
  /** Schema version for forward compat */
  schema_version: "1.0";
  /** ISO datetime when this card was published */
  published_at: string;
  /** h1 (orchestrator, always-on) or h2 (executor, powerful PC) */
  role: "h1" | "jerry";
  /** Display name (user-provided — can be anything) */
  name: string;
  emoji?: string;
  /** Provider info — no API keys, just the kind + model */
  provider: {
    kind: string;
    model: string;
    alias?: string;
  };
  /** Hardware platform */
  os?: "linux" | "windows" | "macos";
  /** Capability highlights (from capabilities.json if present) */
  capabilities?: {
    gpu?: { name?: string; vram_gb?: number; backend?: string } | null;
    ollama?: { running: boolean; model_count?: number };
    skills?: string[];
    notes?: string;
  };
  /** WOL support — can be woken remotely */
  wol_supported: boolean;
  /** User-provided tags, e.g. ["rtx3070ti", "comfyui", "rag"] */
  tags: string[];
  /** Free-form description shown in hh discover */
  description?: string;
  /** Gist ID of this card (filled in after first publish) */
  gist_id?: string;
}

// ─── Anonymiser ──────────────────────────────────────────────────────────────

async function buildNodeCard(
  opts: { tags?: string[]; description?: string; force?: boolean },
): Promise<HHNodeCard> {
  const config = await loadConfig();
  if (!config) throw new Error("No config found — run `hh onboard` first.");

  const node = config.this_node;
  const peer = config.peer_node;

  // Load capabilities if present
  let capabilities: HHNodeCard["capabilities"] | undefined;
  const capPath = join(CARD_DIR, "capabilities.json");
  if (existsSync(capPath)) {
    try {
      const raw = JSON.parse(await readFile(capPath, "utf-8"));
      capabilities = {
        gpu: raw.gpu?.available
          ? { name: raw.gpu.name, vram_gb: raw.gpu.vram_gb, backend: raw.gpu.backend }
          : null,
        ollama: raw.ollama
          ? { running: raw.ollama.running, model_count: raw.ollama.models?.length ?? 0 }
          : undefined,
        skills: raw.skills ?? [],
        notes: raw.notes,
      };
    } catch {
      // capabilities scan not available — skip
    }
  }

  const card: HHNodeCard = {
    schema_version: "1.0",
    published_at: new Date().toISOString(),
    role: node.role,
    name: node.name,
    emoji: node.emoji,
    provider: {
      kind: node.provider?.kind ?? "anthropic",
      model: node.provider?.model ?? "claude-sonnet-4-6",
      alias: node.provider?.alias,
    },
    os: node.role === "h1" ? "linux" : (peer?.os ?? "linux"),
    capabilities,
    wol_supported: !!(peer?.wol?.enabled || peer?.wol_enabled),
    tags: opts.tags ?? [],
    description: opts.description,
  };

  return card;
}

function gistDescription(card: HHNodeCard): string {
  const gpu = card.capabilities?.gpu?.name
    ? ` — ${card.capabilities.gpu.name}`
    : "";
  const modelAlias = card.provider.alias ?? `${card.provider.kind}/${card.provider.model}`;
  return `[his-and-hers] ${card.role} node: ${card.name} ${card.emoji ?? ""} · ${modelAlias}${gpu}`;
}

// ─── GitHub Gist API ─────────────────────────────────────────────────────────

async function postGist(card: HHNodeCard, token?: string): Promise<{ id: string; url: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "his-and-hers-cli",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const body = JSON.stringify({
    description: gistDescription(card),
    public: true,
    files: {
      "hh-node-card.json": {
        content: JSON.stringify({ ...card, tags: [...card.tags, REGISTRY_TAG] }, null, 2),
      },
    },
  });

  const res = await fetch("https://api.github.com/gists", {
    method: "POST",
    headers,
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${text}`);
  }

  const data = await res.json() as { id: string; html_url: string };
  return { id: data.id, url: data.html_url };
}

async function patchGist(
  gistId: string,
  card: HHNodeCard,
  token: string,
): Promise<{ id: string; url: string }> {
  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "his-and-hers-cli",
      "Authorization": `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      description: gistDescription(card),
      files: {
        "hh-node-card.json": {
          content: JSON.stringify({ ...card, tags: [...card.tags, REGISTRY_TAG] }, null, 2),
        },
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${text}`);
  }

  const data = await res.json() as { id: string; html_url: string };
  return { id: data.id, url: data.html_url };
}

// ─── CLI command ─────────────────────────────────────────────────────────────

export async function publish(opts: {
  tags?: string;
  description?: string;
  token?: string;
  update?: boolean;
  dry?: boolean;
  json?: boolean;
}): Promise<void> {
  const token = opts.token ?? process.env["GITHUB_TOKEN"];
  const tags = opts.tags ? opts.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];

  let card: HHNodeCard;
  try {
    card = await buildNodeCard({ tags, description: opts.description });
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    process.exit(1);
  }

  if (opts.dry) {
    console.log("── Dry run — node card that would be published ──");
    console.log(JSON.stringify(card, null, 2));
    return;
  }

  // Check if we already have a published card with a gist_id
  let existingGistId: string | undefined;
  if (existsSync(CARD_FILE)) {
    try {
      const saved = JSON.parse(await readFile(CARD_FILE, "utf-8")) as HHNodeCard;
      existingGistId = saved.gist_id;
    } catch {
      // corrupted — ignore
    }
  }

  let result: { id: string; url: string };

  if (existingGistId && token) {
    if (!opts.json) console.log(`↺  Updating existing card (gist ${existingGistId})...`);
    card.gist_id = existingGistId;
    result = await patchGist(existingGistId, card, token);
  } else {
    if (!opts.json) {
      if (!token) {
        console.log("ℹ  No GITHUB_TOKEN — publishing anonymously (you won't be able to update/delete later).");
        console.log("   Set GITHUB_TOKEN to publish with your account.\n");
      }
      console.log("📤 Publishing node card to community registry...");
    }
    result = await postGist(card, token);
    card.gist_id = result.id;
  }

  // Save locally for future updates
  await mkdir(CARD_DIR, { recursive: true });
  await writeFile(CARD_FILE, JSON.stringify(card, null, 2));

  if (opts.json) {
    console.log(JSON.stringify({ ...card, gist_id: result.id, url: result.url }, null, 2));
  } else {
    console.log(`✓  Published!`);
    console.log(`   ${result.url}`);
    console.log(``);
    console.log(`   Share this URL so others can see your node config.`);
    console.log(`   Run \`hh discover\` to browse the community registry.`);
    console.log(`   Run \`hh publish\` again to update your card.`);
  }
}
