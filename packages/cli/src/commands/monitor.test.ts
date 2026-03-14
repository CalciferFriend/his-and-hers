/**
 * commands/monitor.test.ts
 *
 * Unit tests for `hh monitor` — snapshot builder types and render output.
 *
 * We test:
 *   1. renderSnapshot() output — headers, sections, edge cases
 *   2. PeerSnapshot shape — reachable / gateway_live combinations
 *   3. Edge cases: empty tasks, zero budget, multi-peer, long objective truncation
 *
 * We do NOT test the live-loop (that's a thin setInterval wrapper) or actual
 * network calls (pingPeer / checkGatewayHealth are integration-tested elsewhere).
 */

import { describe, it, expect } from "vitest";
import { renderSnapshot, type MonitorSnapshot } from "./monitor.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = "2026-03-14T03:54:00.000Z";

function makeSnap(overrides: Partial<MonitorSnapshot> = {}): MonitorSnapshot {
  return {
    ts: NOW,
    this_node: { name: "calcifer", emoji: "🔥", role: "h1" },
    peers: [
      {
        name: "glados",
        emoji: "🤖",
        role: "h2",
        tailscale_ip: "100.64.0.2",
        reachable: true,
        gateway_live: true,
        wol_enabled: true,
        wol_mac: "AA:BB:CC:DD:EE:FF",
        gateway_port: 18789,
      },
    ] as import("./monitor.ts").PeerSnapshot[],
    recent_tasks: [
      {
        id: "abc12345-0000-0000-0000-000000000000",
        from: "calcifer",
        to: "glados",
        objective: "Summarize the project status",
        constraints: [],
        status: "completed",
        created_at: new Date(Date.now() - 120_000).toISOString(),
        updated_at: new Date(Date.now() - 100_000).toISOString(),
        result: {
          output: "Done.",
          success: true,
          artifacts: [],
          tokens_used: 4200,
          duration_ms: 3200,
          cost_usd: 0.0023,
        },
      },
    ],
    budget: {
      cloud_cost_usd: 0.0023,
      local_tokens: 0,
      total_tokens: 4200,
      completed: 1,
      failed: 0,
      pending: 0,
    },
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("renderSnapshot", () => {
  it("includes node name and role in header", () => {
    const out = renderSnapshot(makeSnap());
    expect(out).toContain("calcifer");
    expect(out).toContain("h1");
  });

  it("includes the peer name and IP", () => {
    const out = renderSnapshot(makeSnap());
    expect(out).toContain("glados");
    expect(out).toContain("100.64.0.2");
  });

  it("shows gateway live when reachable and gateway_live both true", () => {
    const out = renderSnapshot(makeSnap());
    expect(out).toContain("gw ✓");
  });

  it("shows gateway dead when peer is unreachable", () => {
    const snap = makeSnap({
      peers: [
        {
          ...makeSnap().peers[0],
          reachable: false,
          gateway_live: false,
        },
      ],
    });
    const out = renderSnapshot(snap);
    expect(out).toContain("gw ✗");
  });

  it("shows WOL MAC when wol_enabled", () => {
    const out = renderSnapshot(makeSnap());
    expect(out).toContain("AA:BB:CC:DD:EE:FF");
  });

  it("shows 'no WOL' when wol_enabled is false", () => {
    const snap = makeSnap({
      peers: [{ ...makeSnap().peers[0], wol_enabled: false }],
    });
    const out = renderSnapshot(snap);
    expect(out).toContain("no WOL");
  });

  it("includes RECENT TASKS header", () => {
    const out = renderSnapshot(makeSnap());
    expect(out).toContain("RECENT TASKS");
  });

  it("shows task objective (truncated to 30 chars)", () => {
    const longObj = "A".repeat(60);
    const snap = makeSnap({
      recent_tasks: [
        {
          ...makeSnap().recent_tasks[0],
          objective: longObj,
        },
      ],
    });
    const out = renderSnapshot(snap);
    // Should not contain the full 60-char string verbatim
    expect(out).not.toContain(longObj);
    // Should contain first 28 chars + ellipsis
    expect(out).toContain("A".repeat(28) + "…");
  });

  it("shows 'No tasks yet' when recent_tasks is empty", () => {
    const snap = makeSnap({ recent_tasks: [] });
    const out = renderSnapshot(snap);
    expect(out).toContain("No tasks yet");
  });

  it("includes BUDGET TODAY section", () => {
    const out = renderSnapshot(makeSnap());
    expect(out).toContain("BUDGET TODAY");
  });

  it("shows cloud cost", () => {
    const out = renderSnapshot(makeSnap());
    expect(out).toContain("$0.0023");
  });

  it("shows task counts in budget line", () => {
    const out = renderSnapshot(makeSnap());
    expect(out).toContain("1 done");
    expect(out).toContain("0 failed");
  });

  it("handles zero budget gracefully", () => {
    const snap = makeSnap({
      budget: {
        cloud_cost_usd: 0,
        local_tokens: 0,
        total_tokens: 0,
        completed: 0,
        failed: 0,
        pending: 0,
      },
    });
    const out = renderSnapshot(snap);
    expect(out).toContain("$0.0000");
    expect(out).toContain("0 done");
  });

  it("renders multiple peers", () => {
    const snap = makeSnap({
      peers: [
        {
          name: "glados",
          emoji: "🤖",
          role: "h2",
          tailscale_ip: "100.64.0.2",
          reachable: true,
          gateway_live: true,
          wol_enabled: true,
          gateway_port: 18789,
        },
        {
          name: "hal9000",
          emoji: "👁",
          role: "h2",
          tailscale_ip: "100.64.0.3",
          reachable: false,
          gateway_live: false,
          wol_enabled: false,
          gateway_port: 18789,
        },
      ],
    });
    const out = renderSnapshot(snap);
    expect(out).toContain("glados");
    expect(out).toContain("hal9000");
  });

  it("shows null probe result as '?'", () => {
    const snap = makeSnap({
      peers: [
        {
          ...makeSnap().peers[0],
          reachable: null,
          gateway_live: null,
        },
      ],
    });
    const out = renderSnapshot(snap);
    // Should contain at least one '?' for the unknown state
    expect(out).toContain("?");
  });

  it("shows 100% local when all tokens are local", () => {
    const snap = makeSnap({
      budget: {
        cloud_cost_usd: 0,
        local_tokens: 5000,
        total_tokens: 5000,
        completed: 3,
        failed: 0,
        pending: 1,
      },
    });
    const out = renderSnapshot(snap);
    expect(out).toContain("100%");
  });

  it("shows failed task count in red region", () => {
    const snap = makeSnap({
      budget: {
        cloud_cost_usd: 0.001,
        local_tokens: 0,
        total_tokens: 1000,
        completed: 2,
        failed: 3,
        pending: 0,
      },
    });
    const out = renderSnapshot(snap);
    expect(out).toContain("3 failed");
  });

  it("includes a horizontal rule footer", () => {
    const out = renderSnapshot(makeSnap());
    expect(out).toContain("Ctrl+C");
  });

  it("returns a non-empty string", () => {
    const out = renderSnapshot(makeSnap());
    expect(out.length).toBeGreaterThan(100);
  });

  it("shows task short ID (first 8 chars)", () => {
    const out = renderSnapshot(makeSnap());
    expect(out).toContain("abc12345");
  });

  it("shows '?' reachable marker as single char (no crash)", () => {
    const snap = makeSnap({
      peers: [
        {
          ...makeSnap().peers[0],
          reachable: null,
          gateway_live: null,
        },
      ],
    });
    expect(() => renderSnapshot(snap)).not.toThrow();
  });
});
