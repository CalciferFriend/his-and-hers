/**
 * doctor.test.ts — unit tests for `hh doctor`
 *
 * Covers: local gateway check, Tailscale check, capabilities check,
 * per-peer checks (reachable / unreachable / WOL), SSH checks,
 * peer gateway, capabilities cache freshness, --peer filter,
 * --json output, no-config guard, unknown peer guard.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks (must be hoisted before imports)
// ---------------------------------------------------------------------------

const {
  mockLoadConfig,
  mockGetTailscaleStatus,
  mockPingPeer,
  mockTestSSH,
  mockCheckGatewayHealth,
  mockLoadCapabilities,
  mockLoadPeerCapabilities,
  mockIsPeerCapabilityStale,
  mockGetAllPeers,
  mockFindPeerByName,
} = vi.hoisted(() => ({
  mockLoadConfig: vi.fn(),
  mockGetTailscaleStatus: vi.fn(),
  mockPingPeer: vi.fn(),
  mockTestSSH: vi.fn(),
  mockCheckGatewayHealth: vi.fn(),
  mockLoadCapabilities: vi.fn(),
  mockLoadPeerCapabilities: vi.fn(),
  mockIsPeerCapabilityStale: vi.fn(),
  mockGetAllPeers: vi.fn(),
  mockFindPeerByName: vi.fn(),
}));

vi.mock("../config/store.ts", () => ({
  loadConfig: mockLoadConfig,
}));

vi.mock("@his-and-hers/core", () => ({
  getTailscaleStatus: mockGetTailscaleStatus,
  pingPeer: mockPingPeer,
  testSSH: mockTestSSH,
  checkGatewayHealth: mockCheckGatewayHealth,
  loadCapabilities: mockLoadCapabilities,
  loadPeerCapabilities: mockLoadPeerCapabilities,
  isPeerCapabilityStale: mockIsPeerCapabilityStale,
}));

vi.mock("../peers/select.ts", () => ({
  getAllPeers: mockGetAllPeers,
  findPeerByName: mockFindPeerByName,
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

import { doctor } from "./doctor.ts";

const PEER_NODE = {
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

const CONFIG = {
  node: { name: "calcifer", emoji: "🔥", role: "h1" },
  peer_node: PEER_NODE,
  gateway_port: 18789,
  provider: { kind: "anthropic", model: "claude-3-opus" },
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

  // Sane defaults: everything healthy
  mockLoadConfig.mockResolvedValue(CONFIG);
  mockGetTailscaleStatus.mockResolvedValue({ online: true, hostname: "calcifer" });
  mockPingPeer.mockResolvedValue(true);
  mockTestSSH.mockResolvedValue(true);
  mockCheckGatewayHealth.mockResolvedValue(true);
  mockLoadCapabilities.mockResolvedValue({ gpu: { available: false }, ollama: { available: false, models: [] } });
  mockLoadPeerCapabilities.mockResolvedValue(GPU_CAPS);
  mockIsPeerCapabilityStale.mockReturnValue(false);
  mockGetAllPeers.mockReturnValue([PEER_NODE]);
  mockFindPeerByName.mockReturnValue(PEER_NODE);
});

// ---------------------------------------------------------------------------
// No-config guard
// ---------------------------------------------------------------------------

describe("hh doctor — no config", () => {
  it("exits 1 and logs error when config missing", async () => {
    mockLoadConfig.mockResolvedValue(null);
    await doctor();
    expect(process.exitCode).toBe(1);
  });

  it("outputs JSON error when --json and no config", async () => {
    mockLoadConfig.mockResolvedValue(null);
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    // json path uses console.log
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await doctor({ json: true });
    expect(process.exitCode).toBe(1);
    spy.mockRestore();
    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Healthy path
// ---------------------------------------------------------------------------

describe("hh doctor — healthy node", () => {
  it("exits 0 when all checks pass", async () => {
    await doctor();
    expect(process.exitCode).toBeUndefined();
  });

  it("checks local gateway health on the configured port", async () => {
    await doctor();
    expect(mockCheckGatewayHealth).toHaveBeenCalledWith(
      expect.stringContaining("18789"),
    );
  });

  it("calls getTailscaleStatus for daemon check", async () => {
    await doctor();
    expect(mockGetTailscaleStatus).toHaveBeenCalled();
  });

  it("loads local capabilities", async () => {
    await doctor();
    expect(mockLoadCapabilities).toHaveBeenCalled();
  });

  it("pings every configured peer", async () => {
    await doctor();
    expect(mockPingPeer).toHaveBeenCalledWith("100.64.0.50", expect.any(Number));
  });

  it("tests SSH for peer when credentials are configured", async () => {
    await doctor();
    expect(mockTestSSH).toHaveBeenCalledWith(
      expect.objectContaining({ host: "100.64.0.50", user: "glados" }),
    );
  });

  it("checks peer gateway when peer is reachable", async () => {
    await doctor();
    expect(mockCheckGatewayHealth).toHaveBeenCalledWith(
      expect.stringContaining("100.64.0.50"),
    );
  });
});

// ---------------------------------------------------------------------------
// --json output
// ---------------------------------------------------------------------------

describe("hh doctor --json", () => {
  it("outputs valid JSON with checks array", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await doctor({ json: true });

    const raw = logs.find((l) => {
      try { JSON.parse(l); return true; } catch { return false; }
    });
    expect(raw).toBeTruthy();
    const report = JSON.parse(raw!);
    expect(report).toHaveProperty("checks");
    expect(report).toHaveProperty("healthy");
    expect(Array.isArray(report.checks)).toBe(true);
  });

  it("includes passed/warned/failed/skipped counts in JSON", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await doctor({ json: true });

    const raw = logs.find((l) => { try { JSON.parse(l); return true; } catch { return false; } });
    const report = JSON.parse(raw!);
    expect(typeof report.passed).toBe("number");
    expect(typeof report.warned).toBe("number");
    expect(typeof report.failed).toBe("number");
    expect(typeof report.skipped).toBe("number");
  });

  it("healthy: true when no failures", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await doctor({ json: true });

    const raw = logs.find((l) => { try { JSON.parse(l); return true; } catch { return false; } });
    const report = JSON.parse(raw!);
    expect(report.healthy).toBe(true);
  });

  it("healthy: false and exitCode 1 when check fails", async () => {
    mockCheckGatewayHealth.mockResolvedValue(false);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await doctor({ json: true });

    const raw = logs.find((l) => { try { JSON.parse(l); return true; } catch { return false; } });
    const report = JSON.parse(raw!);
    expect(report.healthy).toBe(false);
    expect(process.exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tailscale failures
// ---------------------------------------------------------------------------

describe("hh doctor — Tailscale issues", () => {
  it("marks daemon check as fail when Tailscale offline", async () => {
    mockGetTailscaleStatus.mockResolvedValue({ online: false });
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await doctor({ json: true });

    const raw = logs.find((l) => { try { JSON.parse(l); return true; } catch { return false; } });
    const report = JSON.parse(raw!);
    const tsCheck = report.checks.find((c: { name: string }) => c.name === "Tailscale daemon");
    expect(tsCheck?.status).toBe("fail");
    expect(process.exitCode).toBe(1);
  });

  it("skips peer checks when Tailscale is unavailable", async () => {
    mockGetTailscaleStatus.mockResolvedValue({ online: false });
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await doctor({ json: true });

    const raw = logs.find((l) => { try { JSON.parse(l); return true; } catch { return false; } });
    const report = JSON.parse(raw!);
    const peerChecks = report.checks.filter((c: { name: string; status: string }) =>
      c.name.includes("glados") && c.status === "skip",
    );
    expect(peerChecks.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Peer unreachable
// ---------------------------------------------------------------------------

describe("hh doctor — peer unreachable", () => {
  it("marks reachability as fail when peer ping fails (no WOL)", async () => {
    mockPingPeer.mockResolvedValue(false);
    const peer = { ...PEER_NODE, wol_enabled: false };
    mockGetAllPeers.mockReturnValue([peer]);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await doctor({ json: true });

    const raw = logs.find((l) => { try { JSON.parse(l); return true; } catch { return false; } });
    const report = JSON.parse(raw!);
    const reach = report.checks.find((c: { name: string }) =>
      c.name.includes("Tailscale reachability"),
    );
    expect(reach?.status).toBe("fail");
  });

  it("marks reachability as warn (not fail) when WOL enabled and peer offline", async () => {
    mockPingPeer.mockResolvedValue(false);
    // PEER_NODE has wol_enabled: true
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await doctor({ json: true });

    const raw = logs.find((l) => { try { JSON.parse(l); return true; } catch { return false; } });
    const report = JSON.parse(raw!);
    const reach = report.checks.find((c: { name: string }) =>
      c.name.includes("Tailscale reachability"),
    );
    expect(reach?.status).toBe("warn");
  });

  it("skips peer gateway check when peer is unreachable", async () => {
    mockPingPeer.mockResolvedValue(false);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await doctor({ json: true });

    const raw = logs.find((l) => { try { JSON.parse(l); return true; } catch { return false; } });
    const report = JSON.parse(raw!);
    const gwCheck = report.checks.find((c: { name: string; status: string }) =>
      c.name.includes("Gateway health") && c.status === "skip",
    );
    expect(gwCheck).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// SSH checks
// ---------------------------------------------------------------------------

describe("hh doctor — SSH checks", () => {
  it("marks SSH as fail when SSH test returns false", async () => {
    mockTestSSH.mockResolvedValue(false);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await doctor({ json: true });

    const raw = logs.find((l) => { try { JSON.parse(l); return true; } catch { return false; } });
    const report = JSON.parse(raw!);
    const sshCheck = report.checks.find((c: { name: string }) => c.name.includes(": SSH"));
    expect(sshCheck?.status).toBe("fail");
  });

  it("skips SSH check when no SSH credentials configured", async () => {
    const peer = { ...PEER_NODE, ssh_user: undefined, ssh_key_path: undefined };
    mockGetAllPeers.mockReturnValue([peer]);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await doctor({ json: true });

    const raw = logs.find((l) => { try { JSON.parse(l); return true; } catch { return false; } });
    const report = JSON.parse(raw!);
    const sshCheck = report.checks.find((c: { name: string }) => c.name.includes(": SSH"));
    expect(sshCheck?.status).toBe("skip");
    expect(mockTestSSH).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Capabilities checks
// ---------------------------------------------------------------------------

describe("hh doctor — capabilities", () => {
  it("warns when no local capabilities scan found", async () => {
    mockLoadCapabilities.mockResolvedValue(null);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await doctor({ json: true });

    const raw = logs.find((l) => { try { JSON.parse(l); return true; } catch { return false; } });
    const report = JSON.parse(raw!);
    const capCheck = report.checks.find((c: { name: string }) =>
      c.name === "Local capabilities",
    );
    expect(capCheck?.status).toBe("warn");
  });

  it("warns when peer capabilities cache is stale", async () => {
    mockIsPeerCapabilityStale.mockReturnValue(true);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await doctor({ json: true });

    const raw = logs.find((l) => { try { JSON.parse(l); return true; } catch { return false; } });
    const report = JSON.parse(raw!);
    const capCheck = report.checks.find((c: { name: string }) =>
      c.name.includes("Cached capabilities"),
    );
    expect(capCheck?.status).toBe("warn");
  });

  it("warns when no peer capabilities cache found", async () => {
    mockLoadPeerCapabilities.mockResolvedValue(null);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await doctor({ json: true });

    const raw = logs.find((l) => { try { JSON.parse(l); return true; } catch { return false; } });
    const report = JSON.parse(raw!);
    const capCheck = report.checks.find((c: { name: string }) =>
      c.name.includes("Cached capabilities"),
    );
    expect(capCheck?.status).toBe("warn");
  });

  it("passes when local capabilities have a GPU", async () => {
    mockLoadCapabilities.mockResolvedValue({
      gpu: { available: true, name: "RTX 4090" },
      ollama: { available: true, models: ["llama3.1:70b"] },
    });
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await doctor({ json: true });

    const raw = logs.find((l) => { try { JSON.parse(l); return true; } catch { return false; } });
    const report = JSON.parse(raw!);
    const capCheck = report.checks.find((c: { name: string }) =>
      c.name === "Local capabilities",
    );
    expect(capCheck?.status).toBe("pass");
  });
});

// ---------------------------------------------------------------------------
// --peer filter
// ---------------------------------------------------------------------------

describe("hh doctor --peer", () => {
  it("calls findPeerByName with supplied peer name", async () => {
    mockFindPeerByName.mockReturnValue(PEER_NODE);
    await doctor({ peer: "glados", json: true });
    expect(mockFindPeerByName).toHaveBeenCalledWith(expect.anything(), "glados");
  });

  it("exits 1 and logs error when --peer points to unknown peer", async () => {
    mockFindPeerByName.mockReturnValue(null);
    mockGetAllPeers.mockReturnValue([PEER_NODE]);
    await doctor({ peer: "nobody", json: true });
    expect(process.exitCode).toBe(1);
  });

  it("runs checks only against the specified peer", async () => {
    mockFindPeerByName.mockReturnValue(PEER_NODE);
    await doctor({ peer: "glados", json: true });
    // should only attempt one peer's gateway checks
    expect(mockPingPeer).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Multiple peers
// ---------------------------------------------------------------------------

describe("hh doctor — multiple peers", () => {
  const PEER2 = {
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

  it("checks all peers when no --peer filter", async () => {
    mockGetAllPeers.mockReturnValue([PEER_NODE, PEER2]);
    mockLoadPeerCapabilities.mockResolvedValue(null); // no cache for either
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s) => logs.push(s));

    await doctor({ json: true });

    const raw = logs.find((l) => { try { JSON.parse(l); return true; } catch { return false; } });
    const report = JSON.parse(raw!);
    const peerNames = [...new Set(
      report.checks
        .filter((c: { name: string }) => c.name.includes(":"))
        .map((c: { name: string }) => c.name.split(":")[0].replace(/^[^\w]+/, "").trim()),
    )];
    expect(peerNames).toContain("glados");
    expect(peerNames).toContain("pi5");
  });

  it("pings each peer individually", async () => {
    mockGetAllPeers.mockReturnValue([PEER_NODE, PEER2]);
    mockLoadPeerCapabilities.mockResolvedValue(null);

    await doctor({ json: true });

    expect(mockPingPeer).toHaveBeenCalledWith("100.64.0.50", expect.any(Number));
    expect(mockPingPeer).toHaveBeenCalledWith("100.64.0.51", expect.any(Number));
  });
});

// ---------------------------------------------------------------------------
// Gateway port override
// ---------------------------------------------------------------------------

describe("hh doctor — gateway port", () => {
  it("uses custom gateway_port from config", async () => {
    mockLoadConfig.mockResolvedValue({ ...CONFIG, gateway_port: 19999 });
    await doctor({ json: true });
    expect(mockCheckGatewayHealth).toHaveBeenCalledWith(
      expect.stringContaining("19999"),
    );
  });
});
