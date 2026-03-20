/**
 * commands/alias.test.ts — unit tests for `cofounder alias` subcommands
 *
 * Phase 8c — Calcifer ✅ (2026-03-15)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import pc from "picocolors";

// ─── Mock store ───────────────────────────────────────────────────────────────

let _aliases: any[] = [];

vi.mock("@cofounder/core", () => ({
  loadAliases: () => _aliases,
  addAlias: (input: any) => {
    const now = new Date().toISOString();
    const existing = _aliases.findIndex((a) => a.name === input.name);
    const entry = {
      name: input.name,
      command: input.command.trim(),
      desc: input.desc,
      created_at: existing >= 0 ? _aliases[existing].created_at : now,
      updated_at: now,
    };
    if (existing >= 0) _aliases[existing] = entry;
    else _aliases.push(entry);
    return entry;
  },
  removeAlias: (name: string) => {
    const idx = _aliases.findIndex((a) => a.name === name);
    if (idx < 0) return false;
    _aliases.splice(idx, 1);
    return true;
  },
  findAlias: (name: string) => _aliases.find((a) => a.name === name),
}));

vi.mock("@clack/prompts", () => ({
  log: { success: vi.fn(), info: vi.fn(), warn: vi.fn() },
  confirm: vi.fn().mockResolvedValue(true),
  isCancel: (v: any) => v === Symbol.for("cancel"),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

const { aliasAdd, aliasList, aliasShow, aliasRemove } = await import("./alias.ts");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("aliasAdd", () => {
  beforeEach(() => { _aliases = []; });

  it("adds a new alias without error", async () => {
    await aliasAdd("pr-review", "workflow run code-review --peer glados", {});
    expect(_aliases).toHaveLength(1);
    expect(_aliases[0].name).toBe("pr-review");
    expect(_aliases[0].command).toBe("workflow run code-review --peer glados");
  });

  it("updates an existing alias", async () => {
    await aliasAdd("foo", "send v1", {});
    await aliasAdd("foo", "send v2", {});
    expect(_aliases).toHaveLength(1);
    expect(_aliases[0].command).toBe("send v2");
  });

  it("stores optional desc", async () => {
    await aliasAdd("bar", "send hi", { desc: "greeting" });
    expect(_aliases[0].desc).toBe("greeting");
  });
});

describe("aliasList", () => {
  beforeEach(() => { _aliases = []; });

  it("prints info message when no aliases", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    aliasList({});
    log.mockRestore();
  });

  it("outputs JSON when --json flag set", () => {
    _aliases = [
      { name: "x", command: "send hi", created_at: "", updated_at: "" },
    ];
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((v) => out.push(v));
    aliasList({ json: true });
    vi.restoreAllMocks();
    const parsed = JSON.parse(out.join(""));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].name).toBe("x");
  });
});

describe("aliasShow", () => {
  beforeEach(() => { _aliases = []; });

  it("shows alias details", () => {
    const now = new Date().toISOString();
    _aliases = [{ name: "foo", command: "send hi", created_at: now, updated_at: now }];
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((v) => out.push(v));
    aliasShow("foo", {});
    vi.restoreAllMocks();
    expect(out.some((l) => l.includes("send hi"))).toBe(true);
  });

  it("outputs JSON when --json flag set", () => {
    const now = new Date().toISOString();
    _aliases = [{ name: "foo", command: "send hi", created_at: now, updated_at: now }];
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((v) => out.push(v));
    aliasShow("foo", { json: true });
    vi.restoreAllMocks();
    const parsed = JSON.parse(out.join(""));
    expect(parsed.name).toBe("foo");
  });

  it("exits with code 1 for unknown alias", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    aliasShow("ghost", {});
    err.mockRestore();
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});

describe("aliasRemove", () => {
  beforeEach(() => { _aliases = []; });

  it("removes an alias with --force", async () => {
    const now = new Date().toISOString();
    _aliases = [{ name: "foo", command: "send hi", created_at: now, updated_at: now }];
    await aliasRemove("foo", { force: true });
    expect(_aliases).toHaveLength(0);
  });

  it("exits with code 1 for unknown alias", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await aliasRemove("ghost", { force: true });
    err.mockRestore();
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});
