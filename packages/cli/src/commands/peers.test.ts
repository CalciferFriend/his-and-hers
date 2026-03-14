/**
 * peers.test.ts — unit tests for `hh peers`
 *
 * Covers: listing with cached caps, --ping reachability, --json output,
 * multi-peer configs, primary star marker, no-config guard,
 * GPU/Ollama/skills display, CPU-only peer, capability cache miss.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockLoadConfig,
  mockPingPeer,
  mockLoadPeerCapabilities,
  mockGetAllPeers,
} = vi.hoisted(() => ({
  mockLoadConfig: vi.fn(),
  mockPingPeer: vi.fn(),
  mockLoadPeerCapabilities: vi.fn(),
  mockGetAllPeers: vi.fn(),
}));

vi.mock("../config/store.ts", () => ({
  loadConfig: mockLoadConfig,
}));

vi.mock("@his-and-hers/core", () => ({
  pingPeer: mockPingPeer,
  loadPeerCapabilities: mockLoadPeerCapabilities,
}));

vi.mock("../peers/select.ts", () => ({
  getAllPeers: mockGetAllPeers,
}));

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), step: vi.fn(), message: vi.fn() },
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

import { peers } from "./peers.ts";

const PRIMARY_PEER = {
  name: "glados",
  emoji: "🤖",
  role: "h2",
  tailscale_ip: "100.64.0.50",
  gateway_port: 18789,
  ssh_user: "glados",
  ssh_key_path: "/home/calcifer/.ssh/glados_key",
  wol_enabled: true,
  os: "windows",
};

const SECONDARY_PEER = {
  name: "pi5",
  emoji: "🍓",
  role: "h2",
  tailscale_ip: "100.64.0.51",
  gateway_port: 18789,
  ssh_user: "pi",
  ssh_key_path: "/home/calcifer/.ssh/pi_key",
  wol_enabled: false,
  os: "linux",
};

const CONFIG = {
  node: { name: "calcifer", emoji: "🔥", role: "h1" },
  peer_node: PRIMARY_PEER,
  gateway_port: 18789,
};

const GPU_CAPS = {
  node: "glados",
  gpu: { available: true, name: "RTX 3070 Ti", vram_gb: 8 },
  ollama: { available: true, models: ["llama3.1:8b", "deepseek-coder:6.7b"] },
  skills: ["image-gen", "code"],
};

beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = undefined;

  mockLoadConfig.mockResolvedValue(CONFIG);
  mockGetAllPeers.mockReturnValue([PRIMARY_PEER]);
  mockPingPeer.mockResolvedValue(true);
  mockLoadPeerCapabilities.mockResolvedValue(GPU_CAPS);
});

// ---------------------------------------------------------------------------
// No-config guard
// ---------------------------------------------------------------------------

describe("hh peers — no config", () => {
  it("exits 1 when config is not found", async () => {
    mockLoadConfig.mockResolvedValue(null);
    await peers();
    expect(process.exitCode).toBe(1);
  });

  it("does not attempt to load peer capabilities when config missing", async () => {
    mockLoadConfig.mockResolvedValue(null);
    await peers();
    expect(mockLoadPeerCapabilities).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// --json output
// ---------------------------------------------------------------------------

describe("hh peers --json", () => {
  it("outputs a JSON array", async () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      lines.push(s as string);
      return true;
    });

    await peers({ json: true });

    const raw = lines.join("");
    const parsed = JSON.parse(raw);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("includes name, role, tailscale_ip, primary fields", async () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      lines.push(s as string);
      return true;
    });

    await peers({ json: true });

    const parsed = JSON.parse(lines.join(""));
    expect(parsed[0]).toMatchObject({
      name: "glados",
      role: "h2",
      tailscale_ip: "100.64.0.50",
      primary: true,
    });
  });

  it("includes gpu info when capabilities have GPU", async () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      lines.push(s as string);
      return true;
    });

    await peers({ json: true });

    const parsed = JSON.parse(lines.join(""));
    expect(parsed[0].gpu).toBe("RTX 3070 Ti");
    expect(parsed[0].ollama_models).toBe(2);
  });

  it("excludes gpu when peer is CPU-only", async () => {
    mockLoadPeerCapabilities.mockResolvedValue({
      node: "glados",
      gpu: { available: false },
      ollama: { available: false, models: [] },
      skills: [],
    });

    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      lines.push(s as string);
      return true;
    });

    await peers({ json: true });

    const parsed = JSON.parse(lines.join(""));
    expect(parsed[0].gpu).toBeUndefined();
  });

  it("includes skill_tags from cached capabilities", async () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      lines.push(s as string);
      return true;
    });

    await peers({ json: true });

    const parsed = JSON.parse(lines.join(""));
    expect(parsed[0].skill_tags).toEqual(["image-gen", "code"]);
  });

  it("does not include reachable field when --ping not set", async () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      lines.push(s as string);
      return true;
    });

    await peers({ json: true });

    const parsed = JSON.parse(lines.join(""));
    expect(parsed[0].reachable).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// --ping flag
// ---------------------------------------------------------------------------

describe("hh peers --ping", () => {
  it("calls pingPeer for each configured peer", async () => {
    await peers({ ping: true, json: true });
    expect(mockPingPeer).toHaveBeenCalledWith("100.64.0.50", expect.any(Number));
  });

  it("includes reachable: true in JSON output when peer responds", async () => {
    mockPingPeer.mockResolvedValue(true);
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      lines.push(s as string);
      return true;
    });

    await peers({ ping: true, json: true });

    const parsed = JSON.parse(lines.join(""));
    expect(parsed[0].reachable).toBe(true);
  });

  it("includes reachable: false in JSON output when peer is down", async () => {
    mockPingPeer.mockResolvedValue(false);
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      lines.push(s as string);
      return true;
    });

    await peers({ ping: true, json: true });

    const parsed = JSON.parse(lines.join(""));
    expect(parsed[0].reachable).toBe(false);
  });

  it("handles ping errors gracefully (falls back to false)", async () => {
    mockPingPeer.mockRejectedValue(new Error("network timeout"));
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      lines.push(s as string);
      return true;
    });

    await expect(peers({ ping: true, json: true })).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Multiple peers
// ---------------------------------------------------------------------------

describe("hh peers — multi-peer config", () => {
  beforeEach(() => {
    mockGetAllPeers.mockReturnValue([PRIMARY_PEER, SECONDARY_PEER]);
    // capabilities cache keyed to primary peer's name
    mockLoadPeerCapabilities.mockImplementation(async () => GPU_CAPS);
  });

  it("returns an entry for each peer", async () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      lines.push(s as string);
      return true;
    });

    await peers({ json: true });

    const parsed = JSON.parse(lines.join(""));
    expect(parsed).toHaveLength(2);
  });

  it("marks only the first peer as primary", async () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      lines.push(s as string);
      return true;
    });

    await peers({ json: true });

    const parsed = JSON.parse(lines.join(""));
    expect(parsed[0].primary).toBe(true);
    expect(parsed[1].primary).toBe(false);
  });

  it("pings all peers when --ping is set", async () => {
    await peers({ ping: true, json: true });
    expect(mockPingPeer).toHaveBeenCalledTimes(2);
  });

  it("assigns correct names to each peer", async () => {
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      lines.push(s as string);
      return true;
    });

    await peers({ json: true });

    const parsed = JSON.parse(lines.join(""));
    expect(parsed.map((p: { name: string }) => p.name)).toEqual(["glados", "pi5"]);
  });
});

// ---------------------------------------------------------------------------
// Capability cache miss
// ---------------------------------------------------------------------------

describe("hh peers — no capability cache", () => {
  it("still returns peer list when loadPeerCapabilities resolves null", async () => {
    mockLoadPeerCapabilities.mockResolvedValue(null);
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      lines.push(s as string);
      return true;
    });

    await peers({ json: true });

    const parsed = JSON.parse(lines.join(""));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].gpu).toBeUndefined();
    expect(parsed[0].ollama_models).toBeUndefined();
  });

  it("still returns peer list when loadPeerCapabilities throws", async () => {
    mockLoadPeerCapabilities.mockRejectedValue(new Error("ENOENT"));
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      lines.push(s as string);
      return true;
    });

    await expect(peers({ json: true })).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Default emoji fallback
// ---------------------------------------------------------------------------

describe("hh peers — emoji fallback", () => {
  it("uses 🤖 when peer has no emoji", async () => {
    const noEmojiPeer = { ...PRIMARY_PEER, emoji: undefined };
    mockGetAllPeers.mockReturnValue([noEmojiPeer]);
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      lines.push(s as string);
      return true;
    });

    await peers({ json: true });

    const parsed = JSON.parse(lines.join(""));
    expect(parsed[0].emoji).toBe("🤖");
  });
});
