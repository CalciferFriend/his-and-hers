/**
 * template/store.test.ts — unit tests for HHTemplate CRUD + variable substitution
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import {
  type HHTemplate,
  type AddTemplateInput,
  addTemplate,
  removeTemplate,
  findTemplate,
  loadTemplates,
  saveTemplates,
  extractPlaceholders,
  substituteVars,
} from "./store.ts";

// ─── File-system isolation ────────────────────────────────────────────────────

const testDir = join(tmpdir(), `cofounder-template-test-${process.pid}`);
const templatesPath = join(testDir, ".cofounder", "templates.json");

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => testDir };
});

beforeEach(async () => {
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ─── loadTemplates ────────────────────────────────────────────────────────────

describe("loadTemplates", () => {
  it("returns [] when file does not exist", async () => {
    const result = await loadTemplates();
    expect(result).toEqual([]);
  });

  it("returns [] on malformed JSON", async () => {
    await mkdir(join(testDir, ".cofounder"), { recursive: true });
    await writeFile(templatesPath, "not json", "utf8");
    const result = await loadTemplates();
    expect(result).toEqual([]);
  });

  it("parses a valid templates file", async () => {
    const template: HHTemplate = {
      id: "11111111-1111-1111-1111-111111111111",
      name: "greet",
      task: "Say hello to {name}",
      created_at: new Date().toISOString(),
    };
    await mkdir(join(testDir, ".cofounder"), { recursive: true });
    await writeFile(templatesPath, JSON.stringify([template]), "utf8");
    const result = await loadTemplates();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("greet");
  });
});

// ─── addTemplate ─────────────────────────────────────────────────────────────

describe("addTemplate", () => {
  it("creates a new template with generated id and timestamp", async () => {
    const input: AddTemplateInput = { name: "summarize", task: "Summarize: {text}" };
    const t = await addTemplate(input);
    expect(t.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(t.name).toBe("summarize");
    expect(t.task).toBe("Summarize: {text}");
    expect(t.created_at).toBeTruthy();
  });

  it("persists template to disk", async () => {
    await addTemplate({ name: "mytemplate", task: "Do {thing}" });
    const loaded = await loadTemplates();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("mytemplate");
  });

  it("stores optional fields (peer, timeout, description)", async () => {
    const t = await addTemplate({
      name: "heavy",
      task: "Run {model} on {input}",
      peer: "glados",
      timeout: 300,
      description: "Heavy inference task",
    });
    expect(t.peer).toBe("glados");
    expect(t.timeout).toBe(300);
    expect(t.description).toBe("Heavy inference task");
  });

  it("rejects duplicate name (case-insensitive)", async () => {
    await addTemplate({ name: "foo", task: "Do {x}" });
    await expect(addTemplate({ name: "FOO", task: "Do {y}" })).rejects.toThrow(
      'Template "FOO" already exists',
    );
  });

  it("allows multiple distinct templates", async () => {
    await addTemplate({ name: "a", task: "Task A: {x}" });
    await addTemplate({ name: "b", task: "Task B: {y}" });
    const all = await loadTemplates();
    expect(all).toHaveLength(2);
  });
});

// ─── removeTemplate ───────────────────────────────────────────────────────────

describe("removeTemplate", () => {
  it("removes by name and returns the removed template", async () => {
    await addTemplate({ name: "remove-me", task: "Do {x}" });
    const removed = await removeTemplate("remove-me");
    expect(removed).not.toBeNull();
    expect(removed!.name).toBe("remove-me");
    const remaining = await loadTemplates();
    expect(remaining).toHaveLength(0);
  });

  it("removes by full UUID", async () => {
    const t = await addTemplate({ name: "byid", task: "Task {x}" });
    const removed = await removeTemplate(t.id);
    expect(removed).not.toBeNull();
  });

  it("removes by id prefix", async () => {
    const t = await addTemplate({ name: "prefix", task: "Task {x}" });
    const removed = await removeTemplate(t.id.slice(0, 8));
    expect(removed).not.toBeNull();
  });

  it("returns null when not found", async () => {
    const result = await removeTemplate("nonexistent");
    expect(result).toBeNull();
  });

  it("does not affect other templates", async () => {
    await addTemplate({ name: "keep", task: "Keep {x}" });
    await addTemplate({ name: "delete", task: "Delete {x}" });
    await removeTemplate("delete");
    const remaining = await loadTemplates();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].name).toBe("keep");
  });
});

// ─── findTemplate ─────────────────────────────────────────────────────────────

describe("findTemplate", () => {
  it("finds by exact name", async () => {
    await addTemplate({ name: "find-me", task: "Task {x}" });
    const t = await findTemplate("find-me");
    expect(t).not.toBeNull();
    expect(t!.name).toBe("find-me");
  });

  it("finds by name case-insensitively", async () => {
    await addTemplate({ name: "CamelCase", task: "Task {x}" });
    const t = await findTemplate("camelcase");
    expect(t).not.toBeNull();
  });

  it("returns null when not found", async () => {
    const t = await findTemplate("missing");
    expect(t).toBeNull();
  });

  it("finds by id prefix", async () => {
    const added = await addTemplate({ name: "prefix-test", task: "Task {x}" });
    const found = await findTemplate(added.id.slice(0, 6));
    expect(found).not.toBeNull();
    expect(found!.name).toBe("prefix-test");
  });
});

// ─── extractPlaceholders ─────────────────────────────────────────────────────

describe("extractPlaceholders", () => {
  it("extracts named vars", () => {
    const { named, positional, hasSplat } = extractPlaceholders("Hello {name}, you are {age} years old");
    expect(named).toEqual(["name", "age"]);
    expect(positional).toEqual([]);
    expect(hasSplat).toBe(false);
  });

  it("extracts positional indexes", () => {
    const { named, positional, hasSplat } = extractPlaceholders("First: {1}, second: {2}");
    expect(named).toEqual([]);
    expect(positional).toEqual([1, 2]);
    expect(hasSplat).toBe(false);
  });

  it("detects {*} splat", () => {
    const { hasSplat } = extractPlaceholders("Do this: {*}");
    expect(hasSplat).toBe(true);
  });

  it("handles template with no placeholders", () => {
    const { named, positional, hasSplat } = extractPlaceholders("Just run everything");
    expect(named).toEqual([]);
    expect(positional).toEqual([]);
    expect(hasSplat).toBe(false);
  });

  it("deduplicates repeated vars", () => {
    const { named } = extractPlaceholders("{x} and {x} and {y}");
    expect(named).toEqual(["x", "y"]);
  });

  it("handles mixed named + positional", () => {
    const { named, positional } = extractPlaceholders("{1} and {name} and {2}");
    expect(named).toEqual(["name"]);
    expect(positional).toEqual([1, 2]);
  });
});

// ─── substituteVars ───────────────────────────────────────────────────────────

describe("substituteVars", () => {
  it("substitutes named vars", () => {
    const result = substituteVars("Summarize {text} in {lang}", { vars: { text: "hello", lang: "English" } });
    expect(result).toBe("Summarize hello in English");
  });

  it("throws on missing named var", () => {
    expect(() => substituteVars("Say {greeting}", { vars: {} })).toThrow(
      'Template variable "{greeting}" not provided',
    );
  });

  it("substitutes positional args", () => {
    const result = substituteVars("First: {1}, second: {2}", { args: ["alpha", "beta"] });
    expect(result).toBe("First: alpha, second: beta");
  });

  it("substitutes {*} splat with all args joined", () => {
    const result = substituteVars("Do this: {*}", { args: ["a", "b", "c"] });
    expect(result).toBe("Do this: a b c");
  });

  it("leaves unmatched positionals intact when args not provided", () => {
    // No args provided — {1} stays as-is (not an error for positionals)
    const result = substituteVars("Run {1}", { args: [] });
    expect(result).toBe("Run {1}");
  });

  it("handles template with no placeholders", () => {
    const result = substituteVars("Just run everything");
    expect(result).toBe("Just run everything");
  });

  it("substitutes multiple occurrences of the same var", () => {
    const result = substituteVars("Hello {name}, dear {name}", { vars: { name: "Nic" } });
    expect(result).toBe("Hello Nic, dear Nic");
  });

  it("substitutes mixed named + positional", () => {
    const result = substituteVars("{1} said {greeting} to {2}", {
      vars: { greeting: "hello" },
      args: ["Alice", "Bob"],
    });
    expect(result).toBe("Alice said hello to Bob");
  });
});
