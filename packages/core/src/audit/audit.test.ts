import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  appendAuditEntry,
  readAuditLog,
  verifyAuditChain,
  getOrCreateAuditKey,
  type AuditEntry,
} from "./audit.ts";

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  appendFile: vi.fn(),
  mkdir: vi.fn(),
}));

const { readFile, writeFile, appendFile, mkdir } = await import("node:fs/promises");

describe("audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mkdir).mockResolvedValue(undefined);
  });

  describe("appendAuditEntry", () => {
    it("should create first entry with prev_hash genesis", async () => {
      vi.mocked(readFile).mockRejectedValue({ code: "ENOENT" });
      vi.mocked(appendFile).mockResolvedValue(undefined);

      const entry = await appendAuditEntry("task_sent", {
        peer: "glados",
        task_id: "abc123",
        objective: "Run tests",
      });

      expect(entry.seq).toBe(1);
      expect(entry.prev_hash).toBe("genesis");
      expect(entry.hash).toBeDefined();
      expect(entry.event).toBe("task_sent");
      expect(entry.peer).toBe("glados");
      expect(entry.task_id).toBe("abc123");
      expect(appendFile).toHaveBeenCalled();
    });

    it("should create second entry with prev_hash from first", async () => {
      const firstEntry: AuditEntry = {
        ts: "2024-01-01T00:00:00Z",
        seq: 1,
        event: "task_sent",
        peer: "glados",
        task_id: "abc123",
        objective: "First task",
        prev_hash: "genesis",
        hash: "hash1",
      };

      vi.mocked(readFile).mockResolvedValue(JSON.stringify(firstEntry));
      vi.mocked(appendFile).mockResolvedValue(undefined);

      const entry = await appendAuditEntry("task_received", {
        peer: "glados",
        task_id: "def456",
        objective: "Second task",
      });

      expect(entry.seq).toBe(2);
      expect(entry.prev_hash).toBe("hash1");
      expect(entry.hash).toBeDefined();
      expect(entry.hash).not.toBe("hash1");
    });

    it("should include all required fields", async () => {
      vi.mocked(readFile).mockRejectedValue({ code: "ENOENT" });
      vi.mocked(appendFile).mockResolvedValue(undefined);

      const entry = await appendAuditEntry("task_completed", {
        peer: "glados",
        task_id: "abc123",
        objective: "Deploy app",
        status: "completed",
        cost_usd: 0.05,
      });

      expect(entry.ts).toBeDefined();
      expect(entry.seq).toBe(1);
      expect(entry.event).toBe("task_completed");
      expect(entry.peer).toBe("glados");
      expect(entry.task_id).toBe("abc123");
      expect(entry.objective).toBe("Deploy app");
      expect(entry.status).toBe("completed");
      expect(entry.cost_usd).toBe(0.05);
      expect(entry.prev_hash).toBe("genesis");
      expect(entry.hash).toBeDefined();
    });
  });

  describe("readAuditLog", () => {
    it("should return empty array when log does not exist", async () => {
      vi.mocked(readFile).mockRejectedValue({ code: "ENOENT" });

      const entries = await readAuditLog();

      expect(entries).toEqual([]);
    });

    it("should parse multiple entries from log file", async () => {
      const entry1: AuditEntry = {
        ts: "2024-01-01T00:00:00Z",
        seq: 1,
        event: "task_sent",
        peer: "glados",
        task_id: "abc123",
        objective: "Task 1",
        prev_hash: "genesis",
        hash: "hash1",
      };

      const entry2: AuditEntry = {
        ts: "2024-01-01T00:01:00Z",
        seq: 2,
        event: "task_received",
        peer: "glados",
        task_id: "abc123",
        objective: "Task 1",
        prev_hash: "hash1",
        hash: "hash2",
      };

      const logContent = JSON.stringify(entry1) + "\n" + JSON.stringify(entry2) + "\n";
      vi.mocked(readFile).mockResolvedValue(logContent);

      const entries = await readAuditLog();

      expect(entries).toHaveLength(2);
      expect(entries[0].seq).toBe(1);
      expect(entries[1].seq).toBe(2);
    });

    it("should filter by peer name", async () => {
      const entry1: AuditEntry = {
        ts: "2024-01-01T00:00:00Z",
        seq: 1,
        event: "task_sent",
        peer: "glados",
        task_id: "abc123",
        objective: "Task 1",
        prev_hash: "genesis",
        hash: "hash1",
      };

      const entry2: AuditEntry = {
        ts: "2024-01-01T00:01:00Z",
        seq: 2,
        event: "task_sent",
        peer: "piper",
        task_id: "def456",
        objective: "Task 2",
        prev_hash: "hash1",
        hash: "hash2",
      };

      const logContent = JSON.stringify(entry1) + "\n" + JSON.stringify(entry2) + "\n";
      vi.mocked(readFile).mockResolvedValue(logContent);

      const entries = await readAuditLog({ peer: "glados" });

      expect(entries).toHaveLength(1);
      expect(entries[0].peer).toBe("glados");
    });

    it("should filter by since timestamp", async () => {
      const now = Date.now();
      const oneHourAgo = now - 60 * 60 * 1000;

      const entry1: AuditEntry = {
        ts: new Date(oneHourAgo - 1000).toISOString(),
        seq: 1,
        event: "task_sent",
        peer: "glados",
        task_id: "abc123",
        objective: "Old task",
        prev_hash: "genesis",
        hash: "hash1",
      };

      const entry2: AuditEntry = {
        ts: new Date(now).toISOString(),
        seq: 2,
        event: "task_sent",
        peer: "glados",
        task_id: "def456",
        objective: "Recent task",
        prev_hash: "hash1",
        hash: "hash2",
      };

      const logContent = JSON.stringify(entry1) + "\n" + JSON.stringify(entry2) + "\n";
      vi.mocked(readFile).mockResolvedValue(logContent);

      const entries = await readAuditLog({ since: oneHourAgo });

      expect(entries).toHaveLength(1);
      expect(entries[0].objective).toBe("Recent task");
    });

    it("should limit number of entries", async () => {
      const entries: AuditEntry[] = Array.from({ length: 10 }, (_, i) => ({
        ts: new Date().toISOString(),
        seq: i + 1,
        event: "task_sent" as const,
        peer: "glados",
        task_id: `task${i}`,
        objective: `Task ${i}`,
        prev_hash: i === 0 ? "genesis" : `hash${i - 1}`,
        hash: `hash${i}`,
      }));

      const logContent = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
      vi.mocked(readFile).mockResolvedValue(logContent);

      const limited = await readAuditLog({ limit: 3 });

      expect(limited).toHaveLength(3);
      expect(limited[0].seq).toBe(8); // Last 3 entries
      expect(limited[1].seq).toBe(9);
      expect(limited[2].seq).toBe(10);
    });
  });

  describe("verifyAuditChain", () => {
    it("should return ok:true for empty log", async () => {
      const result = await verifyAuditChain([]);

      expect(result.ok).toBe(true);
      expect(result.brokenAt).toBeUndefined();
    });

    it("should return ok:true for valid chain", async () => {
      const entries: AuditEntry[] = [
        {
          ts: "2024-01-01T00:00:00Z",
          seq: 1,
          event: "task_sent",
          peer: "glados",
          task_id: "abc123",
          objective: "Task 1",
          prev_hash: "genesis",
          hash: "",
        },
      ];

      // Compute real hash
      const { createHash } = await import("node:crypto");
      const entryWithoutHash = { ...entries[0] };
      delete (entryWithoutHash as any).hash;
      entries[0].hash = createHash("sha256")
        .update(JSON.stringify(entryWithoutHash))
        .digest("hex");

      const result = await verifyAuditChain(entries);

      expect(result.ok).toBe(true);
    });

    it("should return ok:false when prev_hash is incorrect", async () => {
      const { createHash } = await import("node:crypto");

      const entry1: AuditEntry = {
        ts: "2024-01-01T00:00:00Z",
        seq: 1,
        event: "task_sent",
        peer: "glados",
        task_id: "abc123",
        objective: "Task 1",
        prev_hash: "genesis",
        hash: "",
      };

      const e1WithoutHash = { ...entry1 };
      delete (e1WithoutHash as any).hash;
      entry1.hash = createHash("sha256").update(JSON.stringify(e1WithoutHash)).digest("hex");

      const entry2: AuditEntry = {
        ts: "2024-01-01T00:01:00Z",
        seq: 2,
        event: "task_received",
        peer: "glados",
        task_id: "abc123",
        objective: "Task 1",
        prev_hash: "WRONG_HASH", // Tampered!
        hash: "",
      };

      const e2WithoutHash = { ...entry2 };
      delete (e2WithoutHash as any).hash;
      entry2.hash = createHash("sha256").update(JSON.stringify(e2WithoutHash)).digest("hex");

      const result = await verifyAuditChain([entry1, entry2]);

      expect(result.ok).toBe(false);
      expect(result.brokenAt).toBe(2);
    });

    it("should return ok:false when hash is tampered", async () => {
      const { createHash } = await import("node:crypto");

      const entry1: AuditEntry = {
        ts: "2024-01-01T00:00:00Z",
        seq: 1,
        event: "task_sent",
        peer: "glados",
        task_id: "abc123",
        objective: "Task 1",
        prev_hash: "genesis",
        hash: "",
      };

      const e1WithoutHash = { ...entry1 };
      delete (e1WithoutHash as any).hash;
      entry1.hash = createHash("sha256").update(JSON.stringify(e1WithoutHash)).digest("hex");

      // Tamper with the hash
      entry1.hash = "TAMPERED_HASH";

      const result = await verifyAuditChain([entry1]);

      expect(result.ok).toBe(false);
      expect(result.brokenAt).toBe(1);
    });
  });

  describe("getOrCreateAuditKey", () => {
    it("should return existing key if present", async () => {
      const existingKey = "a".repeat(64);
      vi.mocked(readFile).mockResolvedValue(existingKey);

      const key = await getOrCreateAuditKey();

      expect(key).toBe(existingKey);
      expect(writeFile).not.toHaveBeenCalled();
    });

    it("should generate and save new key if not present", async () => {
      vi.mocked(readFile).mockRejectedValue({ code: "ENOENT" });
      vi.mocked(writeFile).mockResolvedValue(undefined);

      const key = await getOrCreateAuditKey();

      expect(key).toHaveLength(64); // 32 bytes = 64 hex chars
      expect(writeFile).toHaveBeenCalled();
      const writeCall = vi.mocked(writeFile).mock.calls[0];
      expect(writeCall[1]).toBe(key);
    });
  });
});
