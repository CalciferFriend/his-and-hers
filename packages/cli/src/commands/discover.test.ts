/**
 * discover.test.ts — unit tests for `hh discover`
 *
 * Covers: empty registry, filter by role/gpu/skill/provider/os, limit,
 * --json output, sorting (h2 first then by date), partial fetch failures,
 * GitHub API errors, custom token passthrough.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — we need to intercept global fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

import { discover } from "./discover.ts";
import type { HHNodeCard } from "./publish.ts";

function makeGist(
  id: string,
  card: HHNodeCard | null,
  updatedAt = "2026-03-14T00:00:00Z",
) {
  const files: Record<string, { filename: string; raw_url: string }> = {};
  if (card !== null) {
    files["hh-node-card.json"] = {
      filename: "hh-node-card.json",
      raw_url: `https://gist.githubusercontent.com/raw/${id}`,
    };
  }
  return {
    id,
    description: "[his-and-hers] test node",
    html_url: `https://gist.github.com/${id}`,
    updated_at: updatedAt,
    forks_url: `https://api.github.com/gists/${id}/forks`,
    files,
  };
}

const CARD_H2_GPU: HHNodeCard = {
  name: "GLaDOS",
  emoji: "🤖",
  role: "h2",
  os: "windows",
  provider: { kind: "ollama", model: "llama3.1:8b", alias: "Ollama/LLaMA" },
  wol_supported: true,
  capabilities: {
    gpu: { available: true, name: "RTX 3070 Ti", vram_gb: 8, backend: "cuda" },
    ollama: { available: true, models: ["llama3.1:8b"] },
    skills: ["image-gen", "code"],
  },
  description: "Home GPU rig",
};

const CARD_H1_CPU: HHNodeCard = {
  name: "Calcifer",
  emoji: "🔥",
  role: "h1",
  os: "linux",
  provider: { kind: "anthropic", model: "claude-3-opus", alias: "Claude" },
  wol_supported: false,
  capabilities: {
    gpu: { available: false },
    ollama: { available: false, models: [] },
    skills: [],
  },
  description: "AWS orchestrator",
};

const CARD_H2_LINUX: HHNodeCard = {
  name: "Pi5",
  emoji: "🍓",
  role: "h2",
  os: "linux",
  provider: { kind: "ollama", model: "phi3:mini", alias: "Ollama/Phi" },
  wol_supported: false,
  capabilities: {
    gpu: { available: false },
    ollama: { available: true, models: ["phi3:mini"] },
    skills: ["lightweight"],
  },
  description: "Raspberry Pi 5",
};

function mockGistList(gists: ReturnType<typeof makeGist>[]) {
  return {
    ok: true,
    status: 200,
    json: async () => gists,
    text: async () => "",
  };
}

function mockCardFetch(card: HHNodeCard) {
  return {
    ok: true,
    status: 200,
    json: async () => card,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = undefined;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// Empty registry
// ---------------------------------------------------------------------------

describe("hh discover — empty registry", () => {
  it("prints a helpful message when no nodes published", async () => {
    mockFetch.mockResolvedValueOnce(mockGistList([]));
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await discover({});

    expect(logs.some((l) => l.includes("No nodes") || l.includes("hh publish"))).toBe(true);
  });

  it("outputs empty JSON array when no nodes and --json", async () => {
    mockFetch.mockResolvedValueOnce(mockGistList([]));
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await discover({ json: true });

    expect(logs).toContain("[]");
  });
});

// ---------------------------------------------------------------------------
// Basic listing
// ---------------------------------------------------------------------------

describe("hh discover — basic listing", () => {
  beforeEach(() => {
    const gist1 = makeGist("gist-001", CARD_H2_GPU, "2026-03-14T00:00:00Z");
    const gist2 = makeGist("gist-002", CARD_H1_CPU, "2026-03-13T00:00:00Z");

    mockFetch
      .mockResolvedValueOnce(mockGistList([gist1, gist2]))
      .mockResolvedValueOnce(mockCardFetch(CARD_H2_GPU))
      .mockResolvedValueOnce(mockCardFetch(CARD_H1_CPU));
  });

  it("returns all nodes in JSON", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await discover({ json: true });

    const raw = logs.find((l) => { try { JSON.parse(l); return true; } catch { return false; } });
    expect(raw).toBeTruthy();
    const result = JSON.parse(raw!);
    expect(result).toHaveLength(2);
  });

  it("includes gist_url in JSON output", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await discover({ json: true });

    const raw = logs.find((l) => { try { JSON.parse(l); return true; } catch { return false; } });
    const result = JSON.parse(raw!);
    expect(result[0]).toHaveProperty("gist_url");
    expect(result[0]).toHaveProperty("gist_id");
  });
});

// ---------------------------------------------------------------------------
// Sorting: h2 first, then by updated_at desc
// ---------------------------------------------------------------------------

describe("hh discover — sorting", () => {
  it("puts h2 nodes before h1 nodes", async () => {
    const gist1 = makeGist("gist-h1", CARD_H1_CPU, "2026-03-14T10:00:00Z");
    const gist2 = makeGist("gist-h2", CARD_H2_GPU, "2026-03-13T10:00:00Z");

    mockFetch
      .mockResolvedValueOnce(mockGistList([gist1, gist2]))
      .mockResolvedValueOnce(mockCardFetch(CARD_H1_CPU))
      .mockResolvedValueOnce(mockCardFetch(CARD_H2_GPU));

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await discover({ json: true });

    const raw = logs.find((l) => { try { JSON.parse(l); return true; } catch { return false; } });
    const result = JSON.parse(raw!);
    expect(result[0].role).toBe("h2");
    expect(result[1].role).toBe("h1");
  });

  it("sorts h2 nodes by updated_at descending", async () => {
    const gist1 = makeGist("gist-pi", CARD_H2_LINUX, "2026-03-12T00:00:00Z");
    const gist2 = makeGist("gist-gpu", CARD_H2_GPU, "2026-03-14T00:00:00Z");

    mockFetch
      .mockResolvedValueOnce(mockGistList([gist1, gist2]))
      .mockResolvedValueOnce(mockCardFetch(CARD_H2_LINUX))
      .mockResolvedValueOnce(mockCardFetch(CARD_H2_GPU));

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await discover({ json: true });

    const raw = logs.find((l) => { try { JSON.parse(l); return true; } catch { return false; } });
    const result = JSON.parse(raw!);
    expect(result[0].name).toBe("GLaDOS"); // more recent
    expect(result[1].name).toBe("Pi5");
  });
});

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

describe("hh discover — filter by role", () => {
  beforeEach(() => {
    const gist1 = makeGist("gist-h2", CARD_H2_GPU);
    const gist2 = makeGist("gist-h1", CARD_H1_CPU);
    mockFetch
      .mockResolvedValueOnce(mockGistList([gist1, gist2]))
      .mockResolvedValueOnce(mockCardFetch(CARD_H2_GPU))
      .mockResolvedValueOnce(mockCardFetch(CARD_H1_CPU));
  });

  it("filters to h2 only", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await discover({ role: "h2", json: true });

    const raw = logs.find((l) => { try { JSON.parse(l); return true; } catch { return false; } });
    const result = JSON.parse(raw!);
    expect(result.every((c: HHNodeCard) => c.role === "h2")).toBe(true);
    expect(result).toHaveLength(1);
  });

  it("filters to h1 only", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await discover({ role: "h1", json: true });

    const raw = logs.find((l) => { try { JSON.parse(l); return true; } catch { return false; } });
    const result = JSON.parse(raw!);
    expect(result.every((c: HHNodeCard) => c.role === "h1")).toBe(true);
  });
});

describe("hh discover — filter by gpu backend", () => {
  beforeEach(() => {
    const gist1 = makeGist("gist-gpu", CARD_H2_GPU);
    const gist2 = makeGist("gist-pi", CARD_H2_LINUX);
    mockFetch
      .mockResolvedValueOnce(mockGistList([gist1, gist2]))
      .mockResolvedValueOnce(mockCardFetch(CARD_H2_GPU))
      .mockResolvedValueOnce(mockCardFetch(CARD_H2_LINUX));
  });

  it("filters to cuda nodes only", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await discover({ gpu: "cuda", json: true });

    const raw = logs.find((l) => { try { JSON.parse(l); return true; } catch { return false; } });
    const result = JSON.parse(raw!);
    expect(result).toHaveLength(1);
    expect(result[0].capabilities.gpu.backend).toBe("cuda");
  });

  it("returns empty JSON when gpu filter matches no nodes", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await discover({ gpu: "metal", json: true });

    expect(logs).toContain("[]");
  });
});

describe("hh discover — filter by skill", () => {
  beforeEach(() => {
    const gist1 = makeGist("gist-gpu", CARD_H2_GPU);
    const gist2 = makeGist("gist-pi", CARD_H2_LINUX);
    mockFetch
      .mockResolvedValueOnce(mockGistList([gist1, gist2]))
      .mockResolvedValueOnce(mockCardFetch(CARD_H2_GPU))
      .mockResolvedValueOnce(mockCardFetch(CARD_H2_LINUX));
  });

  it("filters to nodes with image-gen skill", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await discover({ skill: "image-gen", json: true });

    const raw = logs.find((l) => { try { JSON.parse(l); return true; } catch { return false; } });
    const result = JSON.parse(raw!);
    expect(result).toHaveLength(1);
    expect(result[0].capabilities.skills).toContain("image-gen");
  });

  it("returns no results when skill not present in registry", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await discover({ skill: "video-render", json: true });

    expect(logs).toContain("[]");
  });
});

describe("hh discover — filter by provider", () => {
  beforeEach(() => {
    const gist1 = makeGist("gist-ollama", CARD_H2_GPU);
    const gist2 = makeGist("gist-anthropic", CARD_H1_CPU);
    mockFetch
      .mockResolvedValueOnce(mockGistList([gist1, gist2]))
      .mockResolvedValueOnce(mockCardFetch(CARD_H2_GPU))
      .mockResolvedValueOnce(mockCardFetch(CARD_H1_CPU));
  });

  it("filters to ollama providers only", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await discover({ provider: "ollama", json: true });

    const raw = logs.find((l) => { try { JSON.parse(l); return true; } catch { return false; } });
    const result = JSON.parse(raw!);
    expect(result.every((c: HHNodeCard) => c.provider.kind === "ollama")).toBe(true);
  });

  it("filters to anthropic providers only", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await discover({ provider: "anthropic", json: true });

    const raw = logs.find((l) => { try { JSON.parse(l); return true; } catch { return false; } });
    const result = JSON.parse(raw!);
    expect(result.every((c: HHNodeCard) => c.provider.kind === "anthropic")).toBe(true);
  });
});

describe("hh discover — filter by OS", () => {
  beforeEach(() => {
    const gist1 = makeGist("gist-win", CARD_H2_GPU);
    const gist2 = makeGist("gist-linux", CARD_H2_LINUX);
    mockFetch
      .mockResolvedValueOnce(mockGistList([gist1, gist2]))
      .mockResolvedValueOnce(mockCardFetch(CARD_H2_GPU))
      .mockResolvedValueOnce(mockCardFetch(CARD_H2_LINUX));
  });

  it("filters to windows nodes only", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await discover({ os: "windows", json: true });

    const raw = logs.find((l) => { try { JSON.parse(l); return true; } catch { return false; } });
    const result = JSON.parse(raw!);
    expect(result).toHaveLength(1);
    expect(result[0].os).toBe("windows");
  });

  it("filters to linux nodes only", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await discover({ os: "linux", json: true });

    const raw = logs.find((l) => { try { JSON.parse(l); return true; } catch { return false; } });
    const result = JSON.parse(raw!);
    expect(result.every((c: HHNodeCard) => c.os === "linux")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Limit
// ---------------------------------------------------------------------------

describe("hh discover — limit", () => {
  it("caps results to --limit value", async () => {
    const gist1 = makeGist("gist-1", CARD_H2_GPU, "2026-03-14T00:00:00Z");
    const gist2 = makeGist("gist-2", CARD_H2_LINUX, "2026-03-13T00:00:00Z");
    const gist3 = makeGist("gist-3", CARD_H1_CPU, "2026-03-12T00:00:00Z");

    mockFetch
      .mockResolvedValueOnce(mockGistList([gist1, gist2, gist3]))
      .mockResolvedValueOnce(mockCardFetch(CARD_H2_GPU))
      .mockResolvedValueOnce(mockCardFetch(CARD_H2_LINUX))
      .mockResolvedValueOnce(mockCardFetch(CARD_H1_CPU));

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await discover({ limit: 2, json: true });

    const raw = logs.find((l) => { try { JSON.parse(l); return true; } catch { return false; } });
    const result = JSON.parse(raw!);
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// GitHub API error
// ---------------------------------------------------------------------------

describe("hh discover — API errors", () => {
  it("logs error and exits when GitHub API returns non-200", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => "rate limit exceeded",
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    // discover calls process.exit(1) on API error
    const spy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });

    await expect(discover({ json: true })).rejects.toThrow("exit");
    spy.mockRestore();
  });

  it("skips gist when card fetch returns non-200", async () => {
    const gist1 = makeGist("gist-1", CARD_H2_GPU);
    const gist2 = makeGist("gist-2", CARD_H1_CPU);

    mockFetch
      .mockResolvedValueOnce(mockGistList([gist1, gist2]))
      .mockResolvedValueOnce({ ok: false, status: 404 }) // first card fails
      .mockResolvedValueOnce(mockCardFetch(CARD_H1_CPU));

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await discover({ json: true });

    const raw = logs.find((l) => { try { JSON.parse(l); return true; } catch { return false; } });
    const result = JSON.parse(raw!);
    // Only the second card should be present
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Calcifer");
  });

  it("skips gist when card fetch throws", async () => {
    const gist1 = makeGist("gist-1", CARD_H2_GPU);

    mockFetch
      .mockResolvedValueOnce(mockGistList([gist1]))
      .mockRejectedValueOnce(new Error("network error"));

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await discover({ json: true });

    expect(logs).toContain("[]");
  });
});

// ---------------------------------------------------------------------------
// Auth token passthrough
// ---------------------------------------------------------------------------

describe("hh discover — auth token", () => {
  it("passes provided token as Authorization header", async () => {
    mockFetch.mockResolvedValueOnce(mockGistList([]));

    await discover({ token: "ghp_secret123", json: true });

    const firstCall = mockFetch.mock.calls[0];
    expect(firstCall[1].headers["Authorization"]).toBe("Bearer ghp_secret123");
  });

  it("falls back to GITHUB_TOKEN env var", async () => {
    vi.stubEnv("GITHUB_TOKEN", "ghp_fromenv");
    mockFetch.mockResolvedValueOnce(mockGistList([]));

    await discover({ json: true });

    const firstCall = mockFetch.mock.calls[0];
    expect(firstCall[1].headers["Authorization"]).toBe("Bearer ghp_fromenv");
    vi.unstubAllEnvs();
  });

  it("sends request without Authorization when no token provided", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("GITHUB_TOKEN", "");
    mockFetch.mockResolvedValueOnce(mockGistList([]));

    await discover({ json: true });

    const firstCall = mockFetch.mock.calls[0];
    expect(firstCall[1].headers["Authorization"]).toBeUndefined();
    vi.unstubAllEnvs();
  });
});

// ---------------------------------------------------------------------------
// Gist description filter — only [his-and-hers] gists
// ---------------------------------------------------------------------------

describe("hh discover — gist description filter", () => {
  it("ignores gists without [his-and-hers] description", async () => {
    const unrelated = {
      id: "unrelated",
      description: "some random gist",
      html_url: "https://gist.github.com/unrelated",
      updated_at: "2026-03-14T00:00:00Z",
      forks_url: "",
      files: { "hh-node-card.json": { filename: "hh-node-card.json", raw_url: "https://x.com/raw" } },
    };
    const real = makeGist("gist-real", CARD_H2_GPU);

    mockFetch
      .mockResolvedValueOnce(mockGistList([unrelated, real]))
      .mockResolvedValueOnce(mockCardFetch(CARD_H2_GPU));

    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await discover({ json: true });

    const raw = logs.find((l) => { try { JSON.parse(l); return true; } catch { return false; } });
    const result = JSON.parse(raw!);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("GLaDOS");
  });
});
