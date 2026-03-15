/**
 * core/alias/store.test.ts — unit tests for alias CRUD
 *
 * Phase 8c — Calcifer ✅ (2026-03-15)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { addAlias, removeAlias, findAlias, loadAliases, saveAliases } from "./store.ts";

// ─── Mock filesystem ─────────────────────────────────────────────────────────

let _store: string | null = null;

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: (p: string) => {
      if (String(p).endsWith("aliases.json")) return _store !== null;
      return actual.existsSync(p);
    },
    readFileSync: (p: string, enc?: unknown) => {
      if (String(p).endsWith("aliases.json")) return _store ?? "[]";
      return actual.readFileSync(p, enc as any);
    },
    writeFileSync: (p: string, data: string) => {
      if (String(p).endsWith("aliases.json")) { _store = data; return; }
      actual.writeFileSync(p, data);
    },
    mkdirSync: (_p: string, _opts?: unknown) => {},
  };
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("alias store", () => {
  beforeEach(() => { _store = null; });
  afterEach(() => { _store = null; });

  // ── loadAliases ────────────────────────────────────────────────────────────

  it("returns [] when no file exists", () => {
    expect(loadAliases()).toEqual([]);
  });

  it("returns [] on corrupt JSON", () => {
    _store = "not json";
    expect(loadAliases()).toEqual([]);
  });

  // ── addAlias ──────────────────────────────────────────────────────────────

  it("adds a new alias", () => {
    const a = addAlias({ name: "pr-review", command: "workflow run code-review" });
    expect(a.name).toBe("pr-review");
    expect(a.command).toBe("workflow run code-review");
    expect(loadAliases()).toHaveLength(1);
  });

  it("trims the command", () => {
    const a = addAlias({ name: "foo", command: "  send hello  " });
    expect(a.command).toBe("send hello");
  });

  it("stores optional desc", () => {
    const a = addAlias({ name: "foo", command: "send hi", desc: "A greeting" });
    expect(a.desc).toBe("A greeting");
  });

  it("updates an existing alias, preserving created_at", () => {
    addAlias({ name: "foo", command: "send v1" });
    const first = findAlias("foo")!;
    addAlias({ name: "foo", command: "send v2" });
    const second = findAlias("foo")!;
    expect(second.command).toBe("send v2");
    expect(second.created_at).toBe(first.created_at);
    expect(loadAliases()).toHaveLength(1);
  });

  it("rejects invalid name characters", () => {
    expect(() => addAlias({ name: "bad name!", command: "send hi" })).toThrow();
  });

  it("rejects empty command", () => {
    expect(() => addAlias({ name: "foo", command: "   " })).toThrow();
  });

  // ── removeAlias ───────────────────────────────────────────────────────────

  it("removes an existing alias", () => {
    addAlias({ name: "foo", command: "send hi" });
    expect(removeAlias("foo")).toBe(true);
    expect(loadAliases()).toHaveLength(0);
  });

  it("returns false when alias not found", () => {
    expect(removeAlias("ghost")).toBe(false);
  });

  // ── findAlias ─────────────────────────────────────────────────────────────

  it("finds an alias by name", () => {
    addAlias({ name: "deploy", command: "send deploy now" });
    expect(findAlias("deploy")?.command).toBe("send deploy now");
  });

  it("returns undefined for unknown name", () => {
    expect(findAlias("nope")).toBeUndefined();
  });

  // ── multiple aliases ──────────────────────────────────────────────────────

  it("stores multiple aliases independently", () => {
    addAlias({ name: "a1", command: "send task1" });
    addAlias({ name: "a2", command: "send task2" });
    addAlias({ name: "a3", command: "send task3" });
    const all = loadAliases();
    expect(all).toHaveLength(3);
    expect(all.map((a) => a.name).sort()).toEqual(["a1", "a2", "a3"]);
  });

  it("saveAliases + loadAliases round-trip", () => {
    const now = new Date().toISOString();
    saveAliases([
      { name: "x", command: "send hi", created_at: now, updated_at: now },
    ]);
    const loaded = loadAliases();
    expect(loaded[0].name).toBe("x");
    expect(loaded[0].command).toBe("send hi");
  });
});
