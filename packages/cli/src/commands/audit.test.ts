import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { auditList, auditVerify, auditExport } from "./audit.ts";
import type { AuditEntry } from "@his-and-hers/core";

// Mock audit module
vi.mock("@his-and-hers/core", async () => {
  const actual = await vi.importActual("@his-and-hers/core");
  return {
    ...actual,
    readAuditLog: vi.fn(),
    verifyAuditChain: vi.fn(),
  };
});

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn(),
}));

const { readAuditLog, verifyAuditChain } = await import("@his-and-hers/core");
const { writeFile } = await import("node:fs/promises");

describe("audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress console output
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("auditList", () => {
    it("should display empty message when no entries", async () => {
      vi.mocked(readAuditLog).mockResolvedValue([]);

      await auditList();

      expect(readAuditLog).toHaveBeenCalled();
    });

    it("should display entries", async () => {
      const entries: AuditEntry[] = [
        {
          ts: "2024-01-01T00:00:00Z",
          seq: 1,
          event: "task_sent",
          peer: "glados",
          task_id: "abc123",
          objective: "Run tests",
          prev_hash: "genesis",
          hash: "hash1",
        },
        {
          ts: "2024-01-01T00:01:00Z",
          seq: 2,
          event: "task_completed",
          peer: "glados",
          task_id: "abc123",
          objective: "Run tests",
          status: "completed",
          cost_usd: 0.05,
          prev_hash: "hash1",
          hash: "hash2",
        },
      ];

      vi.mocked(readAuditLog).mockResolvedValue(entries);

      await auditList();

      expect(readAuditLog).toHaveBeenCalled();
    });

    it("should output JSON when --json flag set", async () => {
      const entries: AuditEntry[] = [
        {
          ts: "2024-01-01T00:00:00Z",
          seq: 1,
          event: "task_sent",
          peer: "glados",
          task_id: "abc123",
          objective: "Run tests",
          prev_hash: "genesis",
          hash: "hash1",
        },
      ];

      vi.mocked(readAuditLog).mockResolvedValue(entries);

      const logSpy = vi.spyOn(console, "log");

      await auditList({ json: true });

      expect(logSpy).toHaveBeenCalled();
      const output = logSpy.mock.calls[0][0];
      expect(output).toContain("task_sent");
      expect(output).toContain("glados");
    });

    it("should pass peer filter to readAuditLog", async () => {
      vi.mocked(readAuditLog).mockResolvedValue([]);

      await auditList({ peer: "glados" });

      expect(readAuditLog).toHaveBeenCalledWith({ peer: "glados" });
    });

    it("should pass limit filter to readAuditLog", async () => {
      vi.mocked(readAuditLog).mockResolvedValue([]);

      await auditList({ limit: "50" });

      expect(readAuditLog).toHaveBeenCalledWith({ limit: 50 });
    });

    it("should parse since duration and pass to readAuditLog", async () => {
      vi.mocked(readAuditLog).mockResolvedValue([]);

      await auditList({ since: "7d" });

      expect(readAuditLog).toHaveBeenCalled();
      const call = vi.mocked(readAuditLog).mock.calls[0][0];
      expect(call?.since).toBeDefined();
    });
  });

  describe("auditVerify", () => {
    it("should show empty message when log is empty", async () => {
      vi.mocked(readAuditLog).mockResolvedValue([]);

      await auditVerify();

      expect(readAuditLog).toHaveBeenCalled();
    });

    it("should verify valid chain and show success", async () => {
      const entries: AuditEntry[] = [
        {
          ts: "2024-01-01T00:00:00Z",
          seq: 1,
          event: "task_sent",
          peer: "glados",
          task_id: "abc123",
          objective: "Run tests",
          prev_hash: "genesis",
          hash: "hash1",
        },
      ];

      vi.mocked(readAuditLog).mockResolvedValue(entries);
      vi.mocked(verifyAuditChain).mockResolvedValue({ ok: true });

      await auditVerify();

      expect(verifyAuditChain).toHaveBeenCalledWith(entries);
    });

    it("should show error when chain is broken", async () => {
      const entries: AuditEntry[] = [
        {
          ts: "2024-01-01T00:00:00Z",
          seq: 1,
          event: "task_sent",
          peer: "glados",
          task_id: "abc123",
          objective: "Run tests",
          prev_hash: "genesis",
          hash: "hash1",
        },
      ];

      vi.mocked(readAuditLog).mockResolvedValue(entries);
      vi.mocked(verifyAuditChain).mockResolvedValue({ ok: false, brokenAt: 1 });

      await auditVerify();

      expect(verifyAuditChain).toHaveBeenCalledWith(entries);
      expect(process.exitCode).toBe(1);
    });
  });

  describe("auditExport", () => {
    it("should export as JSON by default", async () => {
      const entries: AuditEntry[] = [
        {
          ts: "2024-01-01T00:00:00Z",
          seq: 1,
          event: "task_sent",
          peer: "glados",
          task_id: "abc123",
          objective: "Run tests",
          prev_hash: "genesis",
          hash: "hash1",
        },
      ];

      vi.mocked(readAuditLog).mockResolvedValue(entries);

      const logSpy = vi.spyOn(console, "log");

      await auditExport();

      expect(logSpy).toHaveBeenCalled();
      const output = logSpy.mock.calls[0][0];
      expect(output).toContain("task_sent");
    });

    it("should export as CSV when --csv flag set", async () => {
      const entries: AuditEntry[] = [
        {
          ts: "2024-01-01T00:00:00Z",
          seq: 1,
          event: "task_sent",
          peer: "glados",
          task_id: "abc123",
          objective: "Run tests",
          prev_hash: "genesis",
          hash: "hash1",
        },
      ];

      vi.mocked(readAuditLog).mockResolvedValue(entries);

      const logSpy = vi.spyOn(console, "log");

      await auditExport({ csv: true });

      expect(logSpy).toHaveBeenCalled();
      const output = logSpy.mock.calls[0][0];
      expect(output).toContain("seq,ts,event,peer,task_id");
      expect(output).toContain("1,2024-01-01T00:00:00Z,task_sent,glados,abc123");
    });

    it("should write to file when --output flag set", async () => {
      const entries: AuditEntry[] = [
        {
          ts: "2024-01-01T00:00:00Z",
          seq: 1,
          event: "task_sent",
          peer: "glados",
          task_id: "abc123",
          objective: "Run tests",
          prev_hash: "genesis",
          hash: "hash1",
        },
      ];

      vi.mocked(readAuditLog).mockResolvedValue(entries);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      await auditExport({ output: "audit.json" });

      expect(writeFile).toHaveBeenCalled();
      const writeCall = vi.mocked(writeFile).mock.calls[0];
      expect(writeCall[0]).toBe("audit.json");
      const content = writeCall[1] as string;
      expect(content).toContain("task_sent");
    });

    it("should handle empty log gracefully", async () => {
      vi.mocked(readAuditLog).mockResolvedValue([]);

      await auditExport();

      expect(readAuditLog).toHaveBeenCalled();
    });
  });
});
