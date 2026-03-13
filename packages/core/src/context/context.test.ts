import { describe, it, expect, afterEach } from "vitest";
import { summarizeTask } from "./summarize.ts";
import {
  appendContextEntry,
  loadContextEntries,
  loadContextSummary as buildContextSummary,
  clearContextEntries,
  contextEntryCount,
} from "./store.ts";
import { randomUUID } from "node:crypto";

// ─── summarizeTask ────────────────────────────────────────────────────────────

describe("summarizeTask", () => {
  it("includes objective and success status", () => {
    const s = summarizeTask({
      task_id: randomUUID(),
      objective: "Generate an image of a sunset",
      output: "Image saved to /tmp/sunset.png",
      success: true,
    });
    expect(s).toContain("✓ completed");
    expect(s).toContain("Generate an image of a sunset");
    expect(s).toContain("Image saved");
  });

  it("includes failure status and error message", () => {
    const s = summarizeTask({
      task_id: randomUUID(),
      objective: "Run Stable Diffusion",
      output: "",
      success: false,
      error: "CUDA out of memory",
    });
    expect(s).toContain("✗ failed");
    expect(s).toContain("CUDA out of memory");
  });

  it("truncates long objectives", () => {
    const longObjective = "A".repeat(200);
    const s = summarizeTask({
      task_id: randomUUID(),
      objective: longObjective,
      output: "done",
      success: true,
    });
    expect(s).toContain("…");
    // Summary should not balloon — objective portion capped at 120 + ellipsis
    expect(s.length).toBeLessThan(600);
  });

  it("truncates long output", () => {
    const longOutput = "word ".repeat(200);
    const s = summarizeTask({
      task_id: randomUUID(),
      objective: "Summarize something",
      output: longOutput,
      success: true,
    });
    expect(s).toContain("…");
  });

  it("includes artifacts when present", () => {
    const s = summarizeTask({
      task_id: randomUUID(),
      objective: "Generate files",
      output: "done",
      success: true,
      artifacts: ["/tmp/a.png", "/tmp/b.txt"],
    });
    expect(s).toContain("/tmp/a.png");
    expect(s).toContain("/tmp/b.txt");
  });

  it("includes token count when provided", () => {
    const s = summarizeTask({
      task_id: randomUUID(),
      objective: "Do some work",
      output: "done",
      success: true,
      tokens_used: 5000,
    });
    expect(s).toContain("5.0k tokens");
  });

  it("skips token count when tokens < 1k", () => {
    const s = summarizeTask({
      task_id: randomUUID(),
      objective: "Tiny task",
      output: "ok",
      success: true,
      tokens_used: 300,
    });
    expect(s).toContain("300 tokens");
  });

  it("does not include output section for (no output)", () => {
    const s = summarizeTask({
      task_id: randomUUID(),
      objective: "Empty task",
      output: "(no output)",
      success: true,
    });
    expect(s).not.toContain("Output:");
  });
});

// ─── context store ────────────────────────────────────────────────────────────

const TEST_PEER = `test-peer-${randomUUID().slice(0, 8)}`;

describe("context store", () => {
  afterEach(async () => {
    await clearContextEntries(TEST_PEER);
  });

  it("starts empty", async () => {
    const entries = await loadContextEntries(TEST_PEER);
    expect(entries).toHaveLength(0);
  });

  it("appends and retrieves entries", async () => {
    await appendContextEntry(TEST_PEER, {
      task_id: randomUUID(),
      summary: "First task completed successfully.",
      created_at: new Date().toISOString(),
    });
    const entries = await loadContextEntries(TEST_PEER);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.summary).toBe("First task completed successfully.");
  });

  it("accumulates multiple entries", async () => {
    for (let i = 0; i < 5; i++) {
      await appendContextEntry(TEST_PEER, {
        task_id: randomUUID(),
        summary: `Task ${i + 1} done.`,
        created_at: new Date().toISOString(),
      });
    }
    const count = await contextEntryCount(TEST_PEER);
    expect(count).toBe(5);
  });

  it("trims to MAX_ENTRIES (10)", async () => {
    for (let i = 0; i < 15; i++) {
      await appendContextEntry(TEST_PEER, {
        task_id: randomUUID(),
        summary: `Entry ${i + 1}`,
        created_at: new Date().toISOString(),
      });
    }
    const entries = await loadContextEntries(TEST_PEER);
    expect(entries).toHaveLength(10);
    // Oldest entries are pruned; last entry should be most recent
    expect(entries.at(-1)!.summary).toBe("Entry 15");
    expect(entries[0]!.summary).toBe("Entry 6");
  });

  it("buildContextSummary returns null when empty", async () => {
    const summary = await buildContextSummary(TEST_PEER);
    expect(summary).toBeNull();
  });

  it("buildContextSummary returns formatted string", async () => {
    await appendContextEntry(TEST_PEER, {
      task_id: randomUUID(),
      summary: "Image generated at /tmp/cat.png",
      created_at: new Date().toISOString(),
    });
    await appendContextEntry(TEST_PEER, {
      task_id: randomUUID(),
      summary: "Model list fetched: llama3.2, mistral",
      created_at: new Date().toISOString(),
    });
    const summary = await buildContextSummary(TEST_PEER, 3);
    expect(summary).not.toBeNull();
    expect(summary!).toContain("Recent task context");
    expect(summary!).toContain("[1]");
    expect(summary!).toContain("[2]");
    expect(summary!).toContain("Image generated");
    expect(summary!).toContain("Model list fetched");
  });

  it("buildContextSummary respects limit", async () => {
    for (let i = 0; i < 8; i++) {
      await appendContextEntry(TEST_PEER, {
        task_id: randomUUID(),
        summary: `Task ${i + 1} done.`,
        created_at: new Date().toISOString(),
      });
    }
    const summary = await buildContextSummary(TEST_PEER, 2);
    // Should only include last 2
    expect(summary!).toContain("[1]");
    expect(summary!).toContain("[2]");
    expect(summary!).not.toContain("[3]");
    // Last 2 should be task 7 and 8
    expect(summary!).toContain("Task 7 done");
    expect(summary!).toContain("Task 8 done");
  });

  it("clearContextEntries resets to empty", async () => {
    await appendContextEntry(TEST_PEER, {
      task_id: randomUUID(),
      summary: "something",
      created_at: new Date().toISOString(),
    });
    await clearContextEntries(TEST_PEER);
    const entries = await loadContextEntries(TEST_PEER);
    expect(entries).toHaveLength(0);
  });
});
