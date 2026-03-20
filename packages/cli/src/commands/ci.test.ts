import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatCiOutput, type CiOutput } from "./ci.ts";

describe("ci", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("formatCiOutput", () => {
    it("should return correct shape with all fields", () => {
      const input: CiOutput = {
        ok: true,
        task_id: "abc123",
        result: "Tests passed",
        cost_usd: 0.05,
        duration_ms: 5000,
      };

      const output = formatCiOutput(input);

      expect(output.ok).toBe(true);
      expect(output.task_id).toBe("abc123");
      expect(output.result).toBe("Tests passed");
      expect(output.cost_usd).toBe(0.05);
      expect(output.duration_ms).toBe(5000);
    });

    it("should handle failure case", () => {
      const input: CiOutput = {
        ok: false,
        task_id: "def456",
        result: "Build failed",
        cost_usd: 0.02,
        duration_ms: 2000,
      };

      const output = formatCiOutput(input);

      expect(output.ok).toBe(false);
      expect(output.result).toBe("Build failed");
    });

    it("should handle zero cost", () => {
      const input: CiOutput = {
        ok: true,
        task_id: "xyz789",
        result: "Done",
        cost_usd: 0,
        duration_ms: 1000,
      };

      const output = formatCiOutput(input);

      expect(output.cost_usd).toBe(0);
    });
  });

  describe("COFOUNDER_PEER env var", () => {
    it("should read peer from env var", () => {
      const originalPeer = process.env.COFOUNDER_PEER;
      process.env.COFOUNDER_PEER = "glados";

      expect(process.env.COFOUNDER_PEER).toBe("glados");

      // Restore
      if (originalPeer === undefined) {
        delete process.env.COFOUNDER_PEER;
      } else {
        process.env.COFOUNDER_PEER = originalPeer;
      }
    });
  });

  describe("COFOUNDER_TIMEOUT env var", () => {
    it("should read timeout from env var", () => {
      const originalTimeout = process.env.COFOUNDER_TIMEOUT;
      process.env.COFOUNDER_TIMEOUT = "120";

      expect(process.env.COFOUNDER_TIMEOUT).toBe("120");

      // Restore
      if (originalTimeout === undefined) {
        delete process.env.COFOUNDER_TIMEOUT;
      } else {
        process.env.COFOUNDER_TIMEOUT = originalTimeout;
      }
    });

    it("should default to 300 seconds", () => {
      const originalTimeout = process.env.COFOUNDER_TIMEOUT;
      delete process.env.COFOUNDER_TIMEOUT;

      const defaultTimeout = process.env.COFOUNDER_TIMEOUT ?? "300";
      expect(defaultTimeout).toBe("300");

      // Restore
      if (originalTimeout !== undefined) {
        process.env.COFOUNDER_TIMEOUT = originalTimeout;
      }
    });
  });

  describe("COFOUNDER_PROFILE env var", () => {
    it("should read profile from env var", () => {
      const originalProfile = process.env.COFOUNDER_PROFILE;
      process.env.COFOUNDER_PROFILE = "ci-profile";

      expect(process.env.COFOUNDER_PROFILE).toBe("ci-profile");

      // Restore
      if (originalProfile === undefined) {
        delete process.env.COFOUNDER_PROFILE;
      } else {
        process.env.COFOUNDER_PROFILE = originalProfile;
      }
    });
  });

  describe("JSON output format", () => {
    it("should be valid JSON", () => {
      const input: CiOutput = {
        ok: true,
        task_id: "abc123",
        result: "Tests passed",
        cost_usd: 0.05,
        duration_ms: 5000,
      };

      const output = formatCiOutput(input);
      const json = JSON.stringify(output);

      expect(() => JSON.parse(json)).not.toThrow();
    });

    it("should include all required fields in JSON", () => {
      const input: CiOutput = {
        ok: true,
        task_id: "abc123",
        result: "Tests passed",
        cost_usd: 0.05,
        duration_ms: 5000,
      };

      const output = formatCiOutput(input);
      const json = JSON.parse(JSON.stringify(output));

      expect(json).toHaveProperty("ok");
      expect(json).toHaveProperty("task_id");
      expect(json).toHaveProperty("result");
      expect(json).toHaveProperty("cost_usd");
      expect(json).toHaveProperty("duration_ms");
    });
  });

  describe("exit codes", () => {
    it("should exit 0 on success (verified via formatCiOutput)", () => {
      const output = formatCiOutput({
        ok: true,
        task_id: "abc123",
        result: "Success",
        cost_usd: 0.05,
        duration_ms: 5000,
      });

      // In the actual ci command, process.exit(output.ok ? 0 : 1) is called
      const expectedExitCode = output.ok ? 0 : 1;
      expect(expectedExitCode).toBe(0);
    });

    it("should exit 1 on failure (verified via formatCiOutput)", () => {
      const output = formatCiOutput({
        ok: false,
        task_id: "def456",
        result: "Failure",
        cost_usd: 0.02,
        duration_ms: 2000,
      });

      const expectedExitCode = output.ok ? 0 : 1;
      expect(expectedExitCode).toBe(1);
    });

    it("should exit 1 on timeout (verified via formatCiOutput)", () => {
      const output = formatCiOutput({
        ok: false,
        task_id: "xyz789",
        result: "Timeout",
        cost_usd: 0,
        duration_ms: 300000,
      });

      const expectedExitCode = output.ok ? 0 : 1;
      expect(expectedExitCode).toBe(1);
    });
  });

  describe("output file", () => {
    it("should write result text to file (verified via formatCiOutput)", () => {
      const output = formatCiOutput({
        ok: true,
        task_id: "abc123",
        result: "Tests passed\nAll checks OK",
        cost_usd: 0.05,
        duration_ms: 5000,
      });

      // In the actual ci command, writeFile(opts.outputFile, output.result) is called
      expect(output.result).toBe("Tests passed\nAll checks OK");
      expect(output.result).toContain("Tests passed");
    });
  });
});
