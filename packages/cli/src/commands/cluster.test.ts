/**
 * cluster.test.ts — unit tests for cofounder cluster / cofounder clusters
 *
 * Tests cover:
 *   - clusterList: empty, populated, stale peer annotation, JSON output
 *   - clusterAdd: happy path, name validation, peer validation, update/overwrite
 *   - clusterShow: found, not found, stale peers, JSON output
 *   - clusterRemove: happy path (force), not found, JSON output
 *   - clusterPeersAdd: add new peer, already-in-cluster guard, unknown peer
 *   - clusterPeersRemove: remove peer, not-in-cluster guard, empty-after note
 *   - resolveClusterPeers: found, not found, no config
 *
 * Phase 7c — Calcifer ✅ (2026-03-15)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as p from "@clack/prompts";
import {
  clusterList,
  clusterAdd,
  clusterShow,
  clusterRemove,
  clusterPeersAdd,
  clusterPeersRemove,
  resolveClusterPeers,
} from "./cluster.ts";
import * as configStore from "../config/store.ts";
import type { HHConfig, PeerNodeConfig } from "../config/schema.ts";

// ── Silence clack ──────────────────────────────────────────────────────────────
vi.mock("@clack/prompts", async () => {
  const actual = await vi.importActual<typeof p>("@clack/prompts");
  return {
    ...actual,
    intro: vi.fn(),
    outro: vi.fn(),
    confirm: vi.fn(),
    isCancel: vi.fn(() => false),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn(), step: vi.fn() },
    spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() })),
  };
});

vi.mock("../config/store.ts");

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePeer(name: string, ip = "100.0.0.1"): PeerNodeConfig {
  return {
    name,
    role: "h2",
    tailscale_ip: ip,
    tailscale_hostname: `${name}.local`,
    ssh_user: "ubuntu",
    ssh_key_path: "~/.ssh/id_ed25519",
    os: "linux",
    gateway_port: 18789,
  } as PeerNodeConfig;
}

function makeConfig(overrides: Partial<HHConfig> = {}): HHConfig {
  return {
    version: "0.3.0",
    this_node: {
      role: "h1",
      name: "calcifer",
      tailscale_hostname: "calcifer.local",
      tailscale_ip: "100.0.0.10",
    },
    peer_node: makePeer("glados", "100.0.0.1"),
    peer_nodes: [makePeer("piper", "100.0.0.2"), makePeer("forge", "100.0.0.3")],
    gateway_port: 18789,
    ...overrides,
  } as HHConfig;
}

const mockLoad = vi.mocked(configStore.loadConfig);
const mockPatch = vi.mocked(configStore.patchConfig);

beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = undefined;
});

// ── clusterList ───────────────────────────────────────────────────────────────

describe("clusterList", () => {
  it("shows empty state when no clusters defined", async () => {
    mockLoad.mockResolvedValue(makeConfig());
    await clusterList();
    expect(p.log.info).toHaveBeenCalledWith(expect.stringContaining("No clusters defined"));
  });

  it("lists defined clusters", async () => {
    mockLoad.mockResolvedValue(makeConfig({ clusters: { gpu: ["glados", "piper"], fast: ["forge"] } }));
    await clusterList();
    expect(p.log.info).toHaveBeenCalledWith(expect.stringContaining("gpu"));
    expect(p.log.info).toHaveBeenCalledWith(expect.stringContaining("fast"));
  });

  it("annotates stale peers in human output", async () => {
    mockLoad.mockResolvedValue(makeConfig({ clusters: { gpu: ["glados", "phantom"] } }));
    await clusterList();
    // phantom is not in config — should be flagged
    expect(p.log.info).toHaveBeenCalledWith(expect.stringContaining("phantom"));
  });

  it("emits valid JSON with stale annotation", async () => {
    mockLoad.mockResolvedValue(makeConfig({ clusters: { gpu: ["glados", "ghost"] } }));
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await clusterList({ json: true });
    expect(spy).toHaveBeenCalledTimes(1);
    const out = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(out.clusters).toHaveLength(1);
    expect(out.clusters[0].name).toBe("gpu");
    expect(out.clusters[0].stale).toContain("ghost");
    spy.mockRestore();
  });

  it("exits with code 1 when no config", async () => {
    mockLoad.mockResolvedValue(null);
    await clusterList();
    expect(process.exitCode).toBe(1);
  });
});

// ── clusterAdd ────────────────────────────────────────────────────────────────

describe("clusterAdd", () => {
  it("creates a new cluster and persists", async () => {
    mockLoad.mockResolvedValue(makeConfig());
    mockPatch.mockResolvedValue(makeConfig());
    await clusterAdd("gpu", { peers: "glados,piper" });
    expect(mockPatch).toHaveBeenCalledWith(
      expect.objectContaining({ clusters: expect.objectContaining({ gpu: ["glados", "piper"] }) }),
    );
    expect(p.log.success).toHaveBeenCalledWith(expect.stringContaining("Created"));
  });

  it("updates an existing cluster and says 'Updated'", async () => {
    mockLoad.mockResolvedValue(makeConfig({ clusters: { gpu: ["glados"] } }));
    mockPatch.mockResolvedValue(makeConfig());
    await clusterAdd("gpu", { peers: "glados,piper" });
    expect(p.log.success).toHaveBeenCalledWith(expect.stringContaining("Updated"));
  });

  it("rejects invalid cluster names", async () => {
    mockLoad.mockResolvedValue(makeConfig());
    await clusterAdd("has space", { peers: "glados" });
    expect(process.exitCode).toBe(1);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("rejects unknown peer names without --no-validate", async () => {
    mockLoad.mockResolvedValue(makeConfig());
    await clusterAdd("gpu", { peers: "glados,nobody" });
    expect(process.exitCode).toBe(1);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("allows unknown peer names with --no-validate", async () => {
    mockLoad.mockResolvedValue(makeConfig());
    mockPatch.mockResolvedValue(makeConfig());
    await clusterAdd("gpu", { peers: "glados,nobody", noValidate: true });
    expect(mockPatch).toHaveBeenCalled();
  });

  it("rejects empty --peers value", async () => {
    mockLoad.mockResolvedValue(makeConfig());
    await clusterAdd("gpu", { peers: "  " });
    expect(process.exitCode).toBe(1);
  });

  it("emits JSON output when requested", async () => {
    mockLoad.mockResolvedValue(makeConfig());
    mockPatch.mockResolvedValue(makeConfig());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await clusterAdd("fast", { peers: "forge", json: true });
    const out = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(out.name).toBe("fast");
    expect(out.peers).toContain("forge");
    spy.mockRestore();
  });
});

// ── clusterShow ───────────────────────────────────────────────────────────────

describe("clusterShow", () => {
  it("shows peers in a cluster", async () => {
    mockLoad.mockResolvedValue(makeConfig({ clusters: { gpu: ["glados", "piper"] } }));
    await clusterShow("gpu");
    expect(p.log.info).toHaveBeenCalledWith(expect.stringContaining("glados"));
    expect(p.log.info).toHaveBeenCalledWith(expect.stringContaining("piper"));
  });

  it("exits with code 1 for unknown cluster", async () => {
    mockLoad.mockResolvedValue(makeConfig({ clusters: {} }));
    await clusterShow("missing");
    expect(process.exitCode).toBe(1);
  });

  it("warns about stale peers", async () => {
    mockLoad.mockResolvedValue(makeConfig({ clusters: { gpu: ["glados", "phantomnode"] } }));
    await clusterShow("gpu");
    expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining("stale"));
  });

  it("emits JSON output", async () => {
    mockLoad.mockResolvedValue(makeConfig({ clusters: { fast: ["forge"] } }));
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await clusterShow("fast", { json: true });
    const out = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(out.name).toBe("fast");
    expect(out.peers).toEqual(["forge"]);
    spy.mockRestore();
  });
});

// ── clusterRemove ─────────────────────────────────────────────────────────────

describe("clusterRemove", () => {
  it("removes a cluster with --force", async () => {
    mockLoad.mockResolvedValue(makeConfig({ clusters: { gpu: ["glados"] } }));
    mockPatch.mockResolvedValue(makeConfig());
    await clusterRemove("gpu", { force: true });
    expect(mockPatch).toHaveBeenCalledWith(
      expect.objectContaining({ clusters: expect.not.objectContaining({ gpu: expect.anything() }) }),
    );
    expect(p.log.success).toHaveBeenCalled();
  });

  it("exits with code 1 for unknown cluster", async () => {
    mockLoad.mockResolvedValue(makeConfig({ clusters: {} }));
    await clusterRemove("nope", { force: true });
    expect(process.exitCode).toBe(1);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("emits JSON output when requested", async () => {
    mockLoad.mockResolvedValue(makeConfig({ clusters: { gpu: ["glados"] } }));
    mockPatch.mockResolvedValue(makeConfig());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await clusterRemove("gpu", { force: true, json: true });
    const out = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(out.removed).toBe("gpu");
    spy.mockRestore();
  });

  it("clears clusters key entirely when last cluster removed", async () => {
    mockLoad.mockResolvedValue(makeConfig({ clusters: { gpu: ["glados"] } }));
    mockPatch.mockResolvedValue(makeConfig());
    await clusterRemove("gpu", { force: true });
    expect(mockPatch).toHaveBeenCalledWith(expect.objectContaining({ clusters: undefined }));
  });
});

// ── clusterPeersAdd ───────────────────────────────────────────────────────────

describe("clusterPeersAdd", () => {
  it("adds a peer to an existing cluster", async () => {
    mockLoad.mockResolvedValue(makeConfig({ clusters: { gpu: ["glados"] } }));
    mockPatch.mockResolvedValue(makeConfig());
    await clusterPeersAdd("gpu", "piper");
    expect(mockPatch).toHaveBeenCalledWith(
      expect.objectContaining({ clusters: { gpu: ["glados", "piper"] } }),
    );
    expect(p.log.success).toHaveBeenCalled();
  });

  it("warns if peer already in cluster", async () => {
    mockLoad.mockResolvedValue(makeConfig({ clusters: { gpu: ["glados", "piper"] } }));
    await clusterPeersAdd("gpu", "piper");
    expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining("already in cluster"));
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("exits with code 1 for unknown cluster", async () => {
    mockLoad.mockResolvedValue(makeConfig({ clusters: {} }));
    await clusterPeersAdd("nocluster", "glados");
    expect(process.exitCode).toBe(1);
  });

  it("exits with code 1 for unknown peer without --no-validate", async () => {
    mockLoad.mockResolvedValue(makeConfig({ clusters: { gpu: ["glados"] } }));
    await clusterPeersAdd("gpu", "phantom");
    expect(process.exitCode).toBe(1);
  });

  it("allows unknown peer with --no-validate", async () => {
    mockLoad.mockResolvedValue(makeConfig({ clusters: { gpu: ["glados"] } }));
    mockPatch.mockResolvedValue(makeConfig());
    await clusterPeersAdd("gpu", "phantom", { noValidate: true });
    expect(mockPatch).toHaveBeenCalled();
  });
});

// ── clusterPeersRemove ────────────────────────────────────────────────────────

describe("clusterPeersRemove", () => {
  it("removes a peer from a cluster", async () => {
    mockLoad.mockResolvedValue(makeConfig({ clusters: { gpu: ["glados", "piper"] } }));
    mockPatch.mockResolvedValue(makeConfig());
    await clusterPeersRemove("gpu", "piper");
    expect(mockPatch).toHaveBeenCalledWith(
      expect.objectContaining({ clusters: { gpu: ["glados"] } }),
    );
    expect(p.log.success).toHaveBeenCalled();
  });

  it("warns if peer not in cluster", async () => {
    mockLoad.mockResolvedValue(makeConfig({ clusters: { gpu: ["glados"] } }));
    await clusterPeersRemove("gpu", "forge");
    expect(p.log.warn).toHaveBeenCalledWith(expect.stringContaining("not in cluster"));
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("exits with code 1 for unknown cluster", async () => {
    mockLoad.mockResolvedValue(makeConfig({ clusters: {} }));
    await clusterPeersRemove("nocluster", "glados");
    expect(process.exitCode).toBe(1);
  });

  it("notes cluster is now empty", async () => {
    mockLoad.mockResolvedValue(makeConfig({ clusters: { gpu: ["glados"] } }));
    mockPatch.mockResolvedValue(makeConfig());
    await clusterPeersRemove("gpu", "glados");
    expect(p.log.success).toHaveBeenCalledWith(expect.stringContaining("empty"));
  });

  it("emits JSON with updated cluster state", async () => {
    mockLoad.mockResolvedValue(makeConfig({ clusters: { gpu: ["glados", "piper"] } }));
    mockPatch.mockResolvedValue(makeConfig());
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await clusterPeersRemove("gpu", "piper", { json: true });
    const out = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(out.peers).toEqual(["glados"]);
    spy.mockRestore();
  });
});

// ── resolveClusterPeers ───────────────────────────────────────────────────────

describe("resolveClusterPeers", () => {
  it("returns peer names for a defined cluster", async () => {
    mockLoad.mockResolvedValue(makeConfig({ clusters: { gpu: ["glados", "piper"] } }));
    const result = await resolveClusterPeers("gpu");
    expect(result).toEqual(["glados", "piper"]);
  });

  it("returns null for an undefined cluster", async () => {
    mockLoad.mockResolvedValue(makeConfig({ clusters: {} }));
    const result = await resolveClusterPeers("missing");
    expect(result).toBeNull();
  });

  it("returns null when no config", async () => {
    mockLoad.mockResolvedValue(null);
    const result = await resolveClusterPeers("gpu");
    expect(result).toBeNull();
  });
});
