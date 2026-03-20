import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildHealthReport, renderHealthReport, type HealthReport } from "./health-report.ts";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../state/tasks.ts", () => ({
  listTaskStates: vi.fn(),
}));

vi.mock("../state/budget.ts", () => ({
  buildBudgetSummary: vi.fn(),
}));

vi.mock("../config/store.ts", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../peers/select.ts", () => ({
  getAllPeers: vi.fn(),
  findPeerByName: vi.fn(),
}));

vi.mock("@cofounder/core", () => ({
  verifyAuditChain: vi.fn(),
  readAuditLog: vi.fn(),
  formatCost: vi.fn((n: number) => `$${n.toFixed(4)}`),
  formatTokens: vi.fn((n: number) => `${n.toLocaleString()} tok`),
  pingPeer: vi.fn(),
  checkGatewayHealth: vi.fn(),
}));

import { listTaskStates } from "../state/tasks.ts";
import { buildBudgetSummary } from "../state/budget.ts";
import { loadConfig } from "../config/store.ts";
import { getAllPeers } from "../peers/select.ts";
import { verifyAuditChain, readAuditLog, pingPeer, checkGatewayHealth } from "@cofounder/core";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<{
  id: string;
  to: string;
  status: string;
  cost_usd: number;
  duration_ms: number;
  created_at: string;
}> = {}) {
  const now = overrides.created_at ?? new Date().toISOString();
  return {
    id: overrides.id ?? "task-1",
    from: "calcifer",
    to: overrides.to ?? "glados",
    objective: "test task",
    constraints: [],
    status: overrides.status ?? "completed",
    created_at: now,
    updated_at: now,
    result: {
      output: "done",
      success: overrides.status !== "failed",
      artifacts: [],
      tokens_used: 500,
      duration_ms: overrides.duration_ms ?? 1000,
      cost_usd: overrides.cost_usd ?? 0.002,
    },
  };
}

function makeBudgetSummary(overrides: Record<string, unknown> = {}) {
  return {
    window: "week",
    cloud_cost_usd: 0.05,
    local_cost_usd: 0.0,
    total_cost_usd: 0.05,
    local_savings_estimate_usd: 0.0,
    total_tokens: 5000,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listTaskStates).mockResolvedValue([]);
  vi.mocked(buildBudgetSummary).mockResolvedValue(makeBudgetSummary());
  vi.mocked(loadConfig).mockResolvedValue(null);
  vi.mocked(getAllPeers).mockReturnValue([]);
  vi.mocked(verifyAuditChain).mockResolvedValue({ ok: true });
  vi.mocked(readAuditLog).mockResolvedValue([]);
  vi.mocked(pingPeer).mockResolvedValue(true);
  vi.mocked(checkGatewayHealth).mockResolvedValue(true);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("buildHealthReport", () => {
  it("returns zero stats when no tasks exist", async () => {
    const report = await buildHealthReport({ days: 7 });
    expect(report.total_tasks).toBe(0);
    expect(report.completed).toBe(0);
    expect(report.failed).toBe(0);
    expect(report.success_rate).toBe(0);
  });

  it("counts completed tasks correctly", async () => {
    vi.mocked(listTaskStates).mockResolvedValue([
      makeTask({ status: "completed" }),
      makeTask({ id: "t2", status: "completed" }),
      makeTask({ id: "t3", status: "failed" }),
    ]);
    const report = await buildHealthReport({ days: 7 });
    expect(report.total_tasks).toBe(3);
    expect(report.completed).toBe(2);
    expect(report.failed).toBe(1);
    expect(report.success_rate).toBeCloseTo(2 / 3, 5);
  });

  it("counts timeout and cancelled tasks", async () => {
    vi.mocked(listTaskStates).mockResolvedValue([
      makeTask({ status: "timeout" }),
      makeTask({ id: "t2", status: "cancelled" }),
    ]);
    const report = await buildHealthReport({ days: 7 });
    expect(report.timeout).toBe(1);
    expect(report.cancelled).toBe(1);
  });

  it("filters tasks by peer name", async () => {
    vi.mocked(listTaskStates).mockResolvedValue([
      makeTask({ id: "t1", to: "glados" }),
      makeTask({ id: "t2", to: "other-node" }),
    ]);
    const report = await buildHealthReport({ days: 7, peer: "glados" });
    expect(report.total_tasks).toBe(1);
    expect(report.peer_filter).toBe("glados");
  });

  it("filters out tasks older than the window", async () => {
    const old = makeTask({
      id: "t-old",
      created_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    });
    const recent = makeTask({ id: "t-new" });
    vi.mocked(listTaskStates).mockResolvedValue([old, recent]);
    const report = await buildHealthReport({ days: 7 });
    expect(report.total_tasks).toBe(1);
  });

  it("calculates average duration from task results", async () => {
    vi.mocked(listTaskStates).mockResolvedValue([
      makeTask({ duration_ms: 1000 }),
      makeTask({ id: "t2", duration_ms: 3000 }),
    ]);
    const report = await buildHealthReport({ days: 7 });
    expect(report.avg_duration_ms).toBe(2000);
  });

  it("aggregates budget data from buildBudgetSummary", async () => {
    vi.mocked(buildBudgetSummary).mockResolvedValue(
      makeBudgetSummary({ cloud_cost_usd: 1.5, total_tokens: 10000 }),
    );
    const report = await buildHealthReport({ days: 7 });
    expect(report.cloud_cost_usd).toBe(1.5);
    expect(report.total_tokens).toBe(10000);
  });

  it("builds tasks_per_day with one bucket per day", async () => {
    const report = await buildHealthReport({ days: 7 });
    expect(report.tasks_per_day).toHaveLength(7);
  });

  it("builds per-peer breakdown", async () => {
    vi.mocked(listTaskStates).mockResolvedValue([
      makeTask({ id: "t1", to: "glados", cost_usd: 0.01 }),
      makeTask({ id: "t2", to: "glados", status: "failed", cost_usd: 0.0 }),
      makeTask({ id: "t3", to: "other", cost_usd: 0.005 }),
    ]);
    const report = await buildHealthReport({ days: 7 });
    const glados = report.peer_breakdown.find((p) => p.peer === "glados")!;
    expect(glados).toBeDefined();
    expect(glados.tasks).toBe(2);
    expect(glados.success_rate).toBeCloseTo(0.5, 5);
  });

  it("checks peer uptime from config peers", async () => {
    vi.mocked(loadConfig).mockResolvedValue({ peer_node: {} } as any);
    vi.mocked(getAllPeers).mockReturnValue([
      { name: "glados", tailscale_ip: "100.1.2.3", gateway: { port: 18789 } } as any,
    ]);
    vi.mocked(checkGatewayHealth).mockResolvedValue(true);
    vi.mocked(pingPeer).mockResolvedValue(true);

    const report = await buildHealthReport({ days: 7 });
    expect(report.peer_uptime).toHaveLength(1);
    expect(report.peer_uptime[0].name).toBe("glados");
    expect(report.peer_uptime[0].gateway_ok).toBe(true);
    expect(report.peer_uptime[0].tailscale_ok).toBe(true);
  });

  it("skips peers with no tailscale_ip", async () => {
    vi.mocked(loadConfig).mockResolvedValue({} as any);
    vi.mocked(getAllPeers).mockReturnValue([
      { name: "bare-peer" } as any,
    ]);
    const report = await buildHealthReport({ days: 7 });
    expect(report.peer_uptime).toHaveLength(0);
  });

  it("verifies audit chain and reports ok", async () => {
    vi.mocked(readAuditLog).mockResolvedValue([{} as any, {} as any]);
    vi.mocked(verifyAuditChain).mockResolvedValue({ ok: true });
    const report = await buildHealthReport({ days: 7 });
    expect(report.audit_chain_ok).toBe(true);
    expect(report.audit_entries).toBe(2);
  });

  it("reports broken audit chain", async () => {
    vi.mocked(readAuditLog).mockResolvedValue([{} as any]);
    vi.mocked(verifyAuditChain).mockResolvedValue({ ok: false, brokenAt: "entry-42" });
    const report = await buildHealthReport({ days: 7 });
    expect(report.audit_chain_ok).toBe(false);
    expect(report.audit_broken_at).toBe("entry-42");
  });

  it("skips audit verification when verifyAudit=false", async () => {
    const report = await buildHealthReport({ days: 7, verifyAudit: false });
    expect(verifyAuditChain).not.toHaveBeenCalled();
    expect(report.audit_chain_ok).toBe(true);
  });

  it("does not crash when audit log is missing", async () => {
    vi.mocked(readAuditLog).mockRejectedValue(new Error("ENOENT"));
    vi.mocked(verifyAuditChain).mockRejectedValue(new Error("ENOENT"));
    const report = await buildHealthReport({ days: 7 });
    expect(report.audit_chain_ok).toBe(true);
    expect(report.audit_entries).toBe(0);
  });

  describe("anomaly detection", () => {
    it("flags critical failure rate (>40% fail, >5 tasks)", async () => {
      const tasks = Array.from({ length: 6 }, (_, i) =>
        makeTask({ id: `t${i}`, status: i < 4 ? "failed" : "completed" }),
      );
      vi.mocked(listTaskStates).mockResolvedValue(tasks);
      const report = await buildHealthReport({ days: 7 });
      const a = report.anomalies.find((x) => x.kind === "high_failure_rate");
      expect(a).toBeDefined();
      expect(a!.severity).toBe("critical");
    });

    it("flags warn failure rate (>20% fail, >2 tasks)", async () => {
      const tasks = Array.from({ length: 4 }, (_, i) =>
        makeTask({ id: `t${i}`, status: i === 0 ? "failed" : "completed" }),
      );
      vi.mocked(listTaskStates).mockResolvedValue(tasks);
      const report = await buildHealthReport({ days: 7 });
      const a = report.anomalies.find((x) => x.kind === "high_failure_rate");
      expect(a).toBeDefined();
      expect(a!.severity).toBe("warn");
    });

    it("flags no_activity when zero tasks in 7d window", async () => {
      const report = await buildHealthReport({ days: 7 });
      const a = report.anomalies.find((x) => x.kind === "no_activity");
      expect(a).toBeDefined();
    });

    it("does not flag no_activity for short windows", async () => {
      const report = await buildHealthReport({ days: 1 });
      const a = report.anomalies.find((x) => x.kind === "no_activity");
      expect(a).toBeUndefined();
    });

    it("flags cost_spike above $5", async () => {
      vi.mocked(buildBudgetSummary).mockResolvedValue(
        makeBudgetSummary({ total_cost_usd: 7.5 }),
      );
      const report = await buildHealthReport({ days: 7 });
      const a = report.anomalies.find((x) => x.kind === "cost_spike");
      expect(a).toBeDefined();
    });

    it("flags audit_broken anomaly", async () => {
      vi.mocked(verifyAuditChain).mockResolvedValue({ ok: false, brokenAt: "abc" });
      vi.mocked(readAuditLog).mockResolvedValue([{} as any]);
      const report = await buildHealthReport({ days: 7 });
      const a = report.anomalies.find((x) => x.kind === "audit_broken");
      expect(a).toBeDefined();
      expect(a!.severity).toBe("critical");
    });

    it("returns no anomalies for a healthy system with activity", async () => {
      vi.mocked(listTaskStates).mockResolvedValue([
        makeTask({ id: "t1" }),
        makeTask({ id: "t2" }),
      ]);
      vi.mocked(buildBudgetSummary).mockResolvedValue(makeBudgetSummary({ total_cost_usd: 0.10 }));
      vi.mocked(verifyAuditChain).mockResolvedValue({ ok: true });
      const report = await buildHealthReport({ days: 7 });
      // no_activity should not fire since we have tasks; no other threshold hit
      expect(report.anomalies.filter((a) => a.kind !== "no_activity")).toHaveLength(0);
    });
  });
});

// ─── renderHealthReport ───────────────────────────────────────────────────────

describe("renderHealthReport", () => {
  const baseReport: HealthReport = {
    generated_at: "2026-03-16T10:00:00.000Z",
    window_days: 7,
    total_tasks: 10,
    completed: 8,
    failed: 1,
    timeout: 1,
    cancelled: 0,
    success_rate: 0.8,
    avg_duration_ms: 2500,
    tasks_per_day: [
      { date: "2026-03-10", count: 1 },
      { date: "2026-03-11", count: 3 },
    ],
    cloud_cost_usd: 0.15,
    local_cost_usd: 0.0,
    total_cost_usd: 0.15,
    local_savings_usd: 0.0,
    total_tokens: 15000,
    peer_uptime: [
      { name: "glados", gateway_ok: true, tailscale_ok: true },
    ],
    audit_chain_ok: true,
    audit_entries: 10,
    anomalies: [],
    peer_breakdown: [
      { peer: "glados", tasks: 10, success_rate: 0.8, avg_cost_usd: 0.015, total_cost_usd: 0.15 },
    ],
  };

  it("includes the report header", () => {
    const md = renderHealthReport(baseReport);
    expect(md).toContain("cofounder Health Report");
  });

  it("includes the time window", () => {
    const md = renderHealthReport(baseReport);
    expect(md).toContain("Last 7 days");
  });

  it("includes peer filter when set", () => {
    const md = renderHealthReport({ ...baseReport, peer_filter: "glados" });
    expect(md).toContain("Peer: glados");
  });

  it("shows task counts", () => {
    const md = renderHealthReport(baseReport);
    expect(md).toContain("10");
    expect(md).toContain("80%");
  });

  it("renders the activity chart", () => {
    const md = renderHealthReport(baseReport);
    expect(md).toContain("Daily Activity");
    expect(md).toContain("2026-03-10");
  });

  it("shows peer uptime section", () => {
    const md = renderHealthReport(baseReport);
    expect(md).toContain("Peer Status");
    expect(md).toContain("glados");
    expect(md).toContain("✅ online");
  });

  it("shows offline peer correctly", () => {
    const md = renderHealthReport({
      ...baseReport,
      peer_uptime: [{ name: "glados", gateway_ok: false, tailscale_ok: false }],
    });
    expect(md).toContain("❌ offline");
    expect(md).toContain("❌ unreachable");
  });

  it("shows audit OK", () => {
    const md = renderHealthReport(baseReport);
    expect(md).toContain("✅ OK");
  });

  it("shows audit BROKEN", () => {
    const md = renderHealthReport({
      ...baseReport,
      audit_chain_ok: false,
      audit_broken_at: "entry-99",
    });
    expect(md).toContain("❌ BROKEN");
    expect(md).toContain("entry-99");
  });

  it("shows no anomalies message when clean", () => {
    const md = renderHealthReport(baseReport);
    expect(md).toContain("No Anomalies");
  });

  it("shows anomalies list when present", () => {
    const md = renderHealthReport({
      ...baseReport,
      anomalies: [
        { kind: "high_failure_rate", severity: "critical", message: "40% failed" },
      ],
    });
    expect(md).toContain("Anomalies");
    expect(md).toContain("high_failure_rate");
    expect(md).toContain("40% failed");
    expect(md).toContain("🔴");
  });

  it("shows warn anomaly with yellow icon", () => {
    const md = renderHealthReport({
      ...baseReport,
      anomalies: [
        { kind: "cost_spike", severity: "warn", message: "High spend" },
      ],
    });
    expect(md).toContain("🟡");
  });

  it("shows per-peer breakdown table", () => {
    const md = renderHealthReport(baseReport);
    expect(md).toContain("Per-Peer Breakdown");
    expect(md).toContain("glados");
    expect(md).toContain("80%");
  });

  it("includes footer attribution", () => {
    const md = renderHealthReport(baseReport);
    expect(md).toContain("cofounder health-report");
    expect(md).toContain("CalciferFriend/cofounder");
  });

  it("omits peer status section when no peers", () => {
    const md = renderHealthReport({ ...baseReport, peer_uptime: [] });
    expect(md).not.toContain("Peer Status");
  });

  it("omits per-peer breakdown when empty", () => {
    const md = renderHealthReport({ ...baseReport, peer_breakdown: [] });
    expect(md).not.toContain("Per-Peer Breakdown");
  });

  it("omits activity chart when no data", () => {
    const md = renderHealthReport({ ...baseReport, tasks_per_day: [] });
    expect(md).not.toContain("Daily Activity");
  });
});
