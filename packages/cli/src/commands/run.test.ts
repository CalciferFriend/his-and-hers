/**
 * commands/run.test.ts — unit tests for `cofounder run` shorthands
 *
 * Phase 8b — Calcifer ✅ (2026-03-15)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";

// ─── Mocks ────────────────────────────────────────────────────────────────────

let _sentTask: string | null = null;
let _sentOpts: any = null;

// execSync mock state — mutated per test
let _execSyncReturnValue: string = "";
let _execSyncShouldThrow = false;

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    execSync: (_cmd: string, _opts?: any) => {
      if (_execSyncShouldThrow) throw new Error("git failed");
      return _execSyncReturnValue;
    },
  };
});

vi.mock("./send.ts", () => ({
  send: vi.fn().mockImplementation(async (task: string, opts: any) => {
    _sentTask = task;
    _sentOpts = opts;
  }),
}));

vi.mock("@cofounder/core", () => ({
  loadConfig: vi.fn().mockResolvedValue({ peers: [] }),
  routeTask: vi.fn().mockResolvedValue({ peer: "glados" }),
  loadCapabilities: vi.fn().mockResolvedValue([]),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TMP = join(tmpdir(), "cofounder-run-test-" + process.pid);

function setupTmpDir() {
  if (!existsSync(TMP)) mkdirSync(TMP, { recursive: true });
}
function teardownTmpDir() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
}

// ─── Import after mocks ───────────────────────────────────────────────────────

const { runSummarise, runReview, runDiff } = await import("./run.ts");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runSummarise", () => {
  beforeEach(() => {
    _sentTask = null;
    _sentOpts = null;
    setupTmpDir();
  });
  afterEach(() => teardownTmpDir());

  it("sends a summarise task with the file attached", async () => {
    const file = join(TMP, "notes.md");
    writeFileSync(file, "# Meeting notes\n- Point 1\n- Point 2");

    await runSummarise(file, {});

    expect(_sentTask).toContain("summarise");
    expect(_sentTask).toContain("notes.md");
    expect(_sentOpts?.attach).toContain(file);
  });

  it("uses custom prompt if provided", async () => {
    const file = join(TMP, "report.txt");
    writeFileSync(file, "data");

    await runSummarise(file, { prompt: "TL;DR this file" });

    expect(_sentTask).toBe("TL;DR this file");
  });

  it("exits with code 1 for missing file", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await runSummarise("/nonexistent/file.txt", {});
    err.mockRestore();
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});

describe("runReview", () => {
  beforeEach(() => {
    _sentTask = null;
    _sentOpts = null;
    setupTmpDir();
  });
  afterEach(() => teardownTmpDir());

  it("sends a review task with the file attached", async () => {
    const file = join(TMP, "send.ts");
    writeFileSync(file, "export function send() {}");

    await runReview(file, {});

    expect(_sentTask).toContain("review");
    expect(_sentTask).toContain("send.ts");
    expect(_sentOpts?.attach).toContain(file);
  });

  it("uses custom prompt if provided", async () => {
    const file = join(TMP, "main.ts");
    writeFileSync(file, "code");

    await runReview(file, { prompt: "Security audit only" });

    expect(_sentTask).toBe("Security audit only");
  });

  it("exits with code 1 for missing file", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await runReview("/not/here.ts", {});
    err.mockRestore();
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});

describe("runDiff", () => {
  beforeEach(() => {
    _sentTask = null;
    _sentOpts = null;
    _execSyncReturnValue = "";
    _execSyncShouldThrow = false;
  });

  it("exits gracefully when git diff returns empty output", async () => {
    _execSyncReturnValue = "";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await runDiff({});
    log.mockRestore();
  });

  it("sends task with diff content embedded in code fence", async () => {
    _execSyncReturnValue = "diff --git a/foo.ts b/foo.ts\n+export const x = 1;";

    await runDiff({ base: "main", head: "feature" });

    expect(_sentTask).toContain("```diff");
    expect(_sentTask).toContain("main..feature");
    expect(_sentOpts?.attach).toBeUndefined();
  });

  it("uses custom prompt when provided", async () => {
    _execSyncReturnValue = "--- a\n+++ b\n+line";

    await runDiff({ prompt: "Focus on security only" });

    expect(_sentTask).toContain("Focus on security only");
    expect(_sentTask).toContain("```diff");
  });
});
