/**
 * hh discover — browse and search the community node registry.
 *
 * Searches GitHub Gists tagged "his-and-hers-node" (i.e. those published
 * with `hh publish`). Filters by role, GPU, provider, skills, and OS.
 *
 * Examples:
 *   hh discover                        # list recent nodes
 *   hh discover --role h2           # H2 nodes only
 *   hh discover --gpu cuda             # CUDA GPU nodes
 *   hh discover --skill image-gen      # nodes with image generation
 *   hh discover --provider ollama      # Ollama-powered nodes
 *   hh discover --os windows           # Windows nodes
 *   hh discover --json                 # machine-readable output
 */

import type { HHNodeCard } from "./publish.ts";

const GIST_SEARCH_URL =
  "https://api.github.com/gists/public?per_page=100&description=his-and-hers";

interface GistSummary {
  id: string;
  description: string;
  html_url: string;
  updated_at: string;
  forks_url: string;
  files: Record<string, { filename: string; raw_url: string }>;
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchGistList(token?: string): Promise<GistSummary[]> {
  const headers: Record<string, string> = {
    "User-Agent": "his-and-hers-cli",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(GIST_SEARCH_URL, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as GistSummary[];
}

async function fetchCardFromGist(gist: GistSummary, token?: string): Promise<HHNodeCard | null> {
  const cardFile = gist.files["hh-node-card.json"];
  if (!cardFile) return null;
  try {
    const headers: Record<string, string> = { "User-Agent": "his-and-hers-cli" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(cardFile.raw_url, { headers });
    if (!res.ok) return null;
    return (await res.json()) as HHNodeCard;
  } catch {
    return null;
  }
}

// ─── Display helpers ──────────────────────────────────────────────────────────

function cardSummary(card: HHNodeCard, gist: GistSummary): string {
  const emoji = card.emoji ?? (card.role === "h1" ? "🐱" : "🐭");
  const gpu = card.capabilities?.gpu?.name
    ? ` · GPU: ${card.capabilities.gpu.name}${card.capabilities.gpu.vram_gb ? ` (${card.capabilities.gpu.vram_gb}GB)` : ""}`
    : "";
  const modelLine = card.provider.alias ?? `${card.provider.kind}/${card.provider.model}`;
  const skills = card.capabilities?.skills?.length
    ? `\n   Skills: ${card.capabilities.skills.join(", ")}`
    : "";
  const wol = card.wol_supported ? " · WOL ✓" : "";
  const updatedAt = gist.updated_at.slice(0, 10);

  return [
    `${emoji}  ${card.name}  [${card.role}] — ${modelLine}${gpu}${wol}`,
    `   OS: ${card.os ?? "unknown"} · Updated: ${updatedAt}`,
    skills,
    card.description ? `   "${card.description}"` : "",
    `   ${gist.html_url}`,
  ].filter(Boolean).join("\n");
}

// ─── Filter helpers ───────────────────────────────────────────────────────────

function matchesFilter(
  card: HHNodeCard,
  filters: {
    role?: string;
    gpu?: string;
    skill?: string;
    provider?: string;
    os?: string;
  },
): boolean {
  if (filters.role && card.role !== filters.role) return false;
  if (filters.os && card.os !== filters.os) return false;
  if (filters.provider && card.provider.kind !== filters.provider) return false;
  if (filters.gpu) {
    const backend = card.capabilities?.gpu?.backend;
    if (!backend || backend !== filters.gpu) return false;
  }
  if (filters.skill) {
    const skills = card.capabilities?.skills ?? [];
    if (!skills.includes(filters.skill)) return false;
  }
  return true;
}

// ─── CLI command ──────────────────────────────────────────────────────────────

export async function discover(opts: {
  role?: string;
  gpu?: string;
  skill?: string;
  provider?: string;
  os?: string;
  limit?: number;
  json?: boolean;
  token?: string;
}): Promise<void> {
  const token = opts.token ?? process.env["GITHUB_TOKEN"];
  const limit = opts.limit ?? 20;

  if (!opts.json) {
    console.log("🔍 Searching community node registry...\n");
  }

  let gists: GistSummary[];
  try {
    gists = await fetchGistList(token);
  } catch (err) {
    console.error(`✗ Failed to reach GitHub API: ${(err as Error).message}`);
    process.exit(1);
  }

  // Filter to his-and-hers gists (description contains our tag)
  const tjGists = gists.filter(
    (g) =>
      g.description?.includes("[his-and-hers]") &&
      g.files["hh-node-card.json"],
  );

  if (tjGists.length === 0) {
    if (!opts.json) {
      console.log("No nodes published yet. Be the first! Run `hh publish`.");
    } else {
      console.log("[]");
    }
    return;
  }

  // Fetch cards in parallel (cap at 10 concurrent)
  const results: Array<{ card: HHNodeCard; gist: GistSummary }> = [];
  const chunks = [];
  for (let i = 0; i < tjGists.length; i += 10) {
    chunks.push(tjGists.slice(i, i + 10));
  }
  for (const chunk of chunks) {
    const fetched = await Promise.all(
      chunk.map(async (g) => {
        const card = await fetchCardFromGist(g, token);
        return card ? { card, gist: g } : null;
      }),
    );
    results.push(...fetched.filter(Boolean) as Array<{ card: HHNodeCard; gist: GistSummary }>);
  }

  // Apply filters
  const filters = {
    role: opts.role,
    gpu: opts.gpu,
    skill: opts.skill,
    provider: opts.provider,
    os: opts.os,
  };
  const filtered = results.filter(({ card }) => matchesFilter(card, filters));

  if (filtered.length === 0) {
    const filterDesc = Object.entries(filters)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    if (!opts.json) {
      console.log(`No nodes match filter: ${filterDesc || "none"}`);
    } else {
      console.log("[]");
    }
    return;
  }

  // Sort: h2 first (more interesting hardware), then by updated_at desc
  filtered.sort((a, b) => {
    if (a.card.role !== b.card.role) return a.card.role === "h2" ? -1 : 1;
    return b.gist.updated_at.localeCompare(a.gist.updated_at);
  });

  const display = filtered.slice(0, limit);

  if (opts.json) {
    console.log(
      JSON.stringify(
        display.map(({ card, gist }) => ({ ...card, gist_id: gist.id, gist_url: gist.html_url })),
        null,
        2,
      ),
    );
    return;
  }

  const filterSummary = Object.entries(filters)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

  console.log(
    `Found ${filtered.length} node${filtered.length === 1 ? "" : "s"}${filterSummary ? ` (${filterSummary})` : ""}. Showing ${display.length}:\n`,
  );

  for (const { card, gist } of display) {
    console.log(cardSummary(card, gist));
    console.log();
  }

  console.log(`─────────────────────────────────────────────────`);
  console.log(`Want to be in this list? Run \`hh publish\`.`);
}
