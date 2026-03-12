import { describe, it, expect } from "vitest";
import { getAllPeers, findPeerByName, getPeer, formatPeerList } from "./select.ts";
import type { TJConfig } from "../config/schema.ts";

// ─── Test fixtures ────────────────────────────────────────────────────────────

function makePeer(name: string, ip: string, emoji = "🤖") {
  return {
    role: "h2" as const,
    name,
    emoji,
    tailscale_hostname: `${name.toLowerCase()}.tailnet`,
    tailscale_ip: ip,
    ssh_user: "ubuntu",
    ssh_key_path: "~/.ssh/id_ed25519",
    os: "linux" as const,
    gateway_port: 18789,
  };
}

const PRIMARY = makePeer("GLaDOS", "100.100.1.1", "🤖");
const SECOND = makePeer("Bender", "100.100.1.2", "🦾");
const THIRD = makePeer("HAL", "100.100.1.3", "🔴");

function makeConfig(extraPeers?: typeof PRIMARY[]): TJConfig {
  return {
    version: "0.1.0",
    this_node: {
      role: "h1",
      name: "Calcifer",
      emoji: "🔥",
      tailscale_hostname: "calcifer.tailnet",
      tailscale_ip: "100.100.0.1",
    },
    peer_node: PRIMARY,
    peer_nodes: extraPeers,
    gateway_port: 18789,
  } as unknown as TJConfig;
}

// ─── getAllPeers ──────────────────────────────────────────────────────────────

describe("getAllPeers", () => {
  it("returns only primary when no peer_nodes", () => {
    const peers = getAllPeers(makeConfig());
    expect(peers).toHaveLength(1);
    expect(peers[0]!.name).toBe("GLaDOS");
  });

  it("returns primary first, then additional peers", () => {
    const peers = getAllPeers(makeConfig([SECOND, THIRD]));
    expect(peers).toHaveLength(3);
    expect(peers[0]!.name).toBe("GLaDOS");
    expect(peers[1]!.name).toBe("Bender");
    expect(peers[2]!.name).toBe("HAL");
  });

  it("handles empty peer_nodes array", () => {
    const peers = getAllPeers(makeConfig([]));
    expect(peers).toHaveLength(1);
  });
});

// ─── findPeerByName ───────────────────────────────────────────────────────────

describe("findPeerByName", () => {
  it("finds primary peer by name", () => {
    const peer = findPeerByName(makeConfig([SECOND]), "GLaDOS");
    expect(peer).not.toBeNull();
    expect(peer!.name).toBe("GLaDOS");
  });

  it("finds additional peer by name", () => {
    const peer = findPeerByName(makeConfig([SECOND, THIRD]), "Bender");
    expect(peer).not.toBeNull();
    expect(peer!.name).toBe("Bender");
  });

  it("is case-insensitive", () => {
    const peer = findPeerByName(makeConfig([SECOND]), "glados");
    expect(peer!.name).toBe("GLaDOS");
  });

  it("returns null for unknown peer", () => {
    const peer = findPeerByName(makeConfig(), "Skynet");
    expect(peer).toBeNull();
  });
});

// ─── getPeer ─────────────────────────────────────────────────────────────────

describe("getPeer", () => {
  it("returns primary when no peerName given", () => {
    const peer = getPeer(makeConfig([SECOND]));
    expect(peer.name).toBe("GLaDOS");
  });

  it("returns named peer when peerName matches", () => {
    const peer = getPeer(makeConfig([SECOND]), "Bender");
    expect(peer.name).toBe("Bender");
  });

  it("throws descriptive error for unknown peer name", () => {
    expect(() => getPeer(makeConfig([SECOND]), "Skynet")).toThrow(
      /Peer "Skynet" not found/,
    );
  });

  it("error message lists known peers", () => {
    expect(() => getPeer(makeConfig([SECOND]), "Skynet")).toThrow(
      /GLaDOS/,
    );
    expect(() => getPeer(makeConfig([SECOND]), "Skynet")).toThrow(
      /Bender/,
    );
  });
});

// ─── formatPeerList ───────────────────────────────────────────────────────────

describe("formatPeerList", () => {
  it("marks primary with asterisk", () => {
    const out = formatPeerList(makeConfig([SECOND]));
    expect(out).toContain("* 🤖 GLaDOS");
    expect(out).toContain("[primary]");
  });

  it("lists additional peers without asterisk", () => {
    const out = formatPeerList(makeConfig([SECOND]));
    expect(out).toContain("🦾 Bender");
    expect(out).not.toMatch(/\* 🦾/);
  });

  it("includes tailscale IPs", () => {
    const out = formatPeerList(makeConfig([SECOND]));
    expect(out).toContain("100.100.1.1");
    expect(out).toContain("100.100.1.2");
  });
});
