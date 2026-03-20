/**
 * gateway/capabilities-server.test.ts
 *
 * Unit tests for the H2 capabilities HTTP server.
 * All tests spin up a real (loopback) HTTP server and tear it down after each test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startCapabilitiesServer, type CapabilitiesServerHandle } from "./capabilities-server.ts";

// ─── Mock capabilities store ──────────────────────────────────────────────────

vi.mock("../capabilities/store.ts", () => ({
  loadCapabilities: vi.fn(),
}));

import { loadCapabilities } from "../capabilities/store.ts";
const mockLoadCapabilities = vi.mocked(loadCapabilities);

const TOKEN = "test-gateway-token-abc";

const SAMPLE_REPORT = {
  node: "GLaDOS",
  platform: "windows" as const,
  gpu: { available: true, name: "RTX 3070 Ti", vram_gb: 8, backend: "cuda" as const },
  ollama: { running: true, base_url: "http://localhost:11434", models: ["llama3.2"] },
  skills: ["ollama", "gpu-inference"],
  wol_enabled: true,
  version: "0.1.0",
  reported_at: new Date().toISOString(),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function get(port: number, path: string, token?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers["x-cofounder-token"] = token;
  return fetch(`http://127.0.0.1:${port}${path}`, { headers });
}

// ─── Test lifecycle ───────────────────────────────────────────────────────────

let srv: CapabilitiesServerHandle | null = null;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  if (srv) {
    await srv.close();
    srv = null;
  }
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("startCapabilitiesServer", () => {
  it("starts on an OS-assigned port and returns a handle", async () => {
    mockLoadCapabilities.mockResolvedValue(SAMPLE_REPORT as ReturnType<typeof mockLoadCapabilities> extends Promise<infer T> ? T : never);
    srv = await startCapabilitiesServer({ token: TOKEN, bindAddress: "127.0.0.1" });
    expect(srv.port).toBeGreaterThan(0);
    expect(srv.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("GET /health returns 200 without auth", async () => {
    mockLoadCapabilities.mockResolvedValue(null);
    srv = await startCapabilitiesServer({ token: TOKEN, bindAddress: "127.0.0.1" });
    const res = await get(srv.port, "/health");
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; service: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("capabilities");
  });

  it("GET /capabilities returns 401 without token", async () => {
    mockLoadCapabilities.mockResolvedValue(null);
    srv = await startCapabilitiesServer({ token: TOKEN, bindAddress: "127.0.0.1" });
    const res = await get(srv.port, "/capabilities");
    expect(res.status).toBe(401);
  });

  it("GET /capabilities returns 401 with wrong token", async () => {
    mockLoadCapabilities.mockResolvedValue(null);
    srv = await startCapabilitiesServer({ token: TOKEN, bindAddress: "127.0.0.1" });
    const res = await get(srv.port, "/capabilities", "wrong-token");
    expect(res.status).toBe(401);
  });

  it("GET /capabilities returns 404 when no report is saved", async () => {
    mockLoadCapabilities.mockResolvedValue(null);
    srv = await startCapabilitiesServer({ token: TOKEN, bindAddress: "127.0.0.1" });
    const res = await get(srv.port, "/capabilities", TOKEN);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/advertise/);
  });

  it("GET /capabilities returns 200 with report when available", async () => {
    mockLoadCapabilities.mockResolvedValue(SAMPLE_REPORT as ReturnType<typeof mockLoadCapabilities> extends Promise<infer T> ? T : never);
    srv = await startCapabilitiesServer({ token: TOKEN, bindAddress: "127.0.0.1" });
    const res = await get(srv.port, "/capabilities", TOKEN);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; report: typeof SAMPLE_REPORT };
    expect(body.ok).toBe(true);
    expect(body.report.node).toBe("GLaDOS");
    expect(body.report.gpu.available).toBe(true);
    expect(body.report.ollama.models).toContain("llama3.2");
  });

  it("accepts Authorization: Bearer <token> header", async () => {
    mockLoadCapabilities.mockResolvedValue(SAMPLE_REPORT as ReturnType<typeof mockLoadCapabilities> extends Promise<infer T> ? T : never);
    srv = await startCapabilitiesServer({ token: TOKEN, bindAddress: "127.0.0.1" });
    const res = await fetch(`http://127.0.0.1:${srv.port}/capabilities`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
  });

  it("GET /unknown-path returns 404", async () => {
    mockLoadCapabilities.mockResolvedValue(null);
    srv = await startCapabilitiesServer({ token: TOKEN, bindAddress: "127.0.0.1" });
    const res = await get(srv.port, "/bogus", TOKEN);
    expect(res.status).toBe(404);
  });

  it("returns 500 if loadCapabilities throws", async () => {
    mockLoadCapabilities.mockRejectedValue(new Error("disk full"));
    srv = await startCapabilitiesServer({ token: TOKEN, bindAddress: "127.0.0.1" });
    const res = await get(srv.port, "/capabilities", TOKEN);
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/disk full/);
  });

  it("close() shuts the server down", async () => {
    mockLoadCapabilities.mockResolvedValue(null);
    srv = await startCapabilitiesServer({ token: TOKEN, bindAddress: "127.0.0.1" });
    const { port } = srv;
    await srv.close();
    srv = null; // already closed — skip afterEach teardown
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
  });
});
