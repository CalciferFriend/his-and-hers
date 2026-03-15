/**
 * workflow/store.ts
 *
 * Persistent workflow registry — ~/.his-and-hers/workflows.json
 *
 * Workflows are saved, named pipeline specs that you can run on-demand without
 * retyping the full pipeline definition. Supports both inline specs and stored
 * step arrays.
 *
 * Example:
 *   hh workflow add review "glados:write tests -> piper:review {{previous.output}}"
 *   hh workflow run review
 *
 * Phase 8a — Calcifer ✅ (2026-03-15)
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PipelineStep, PipelineDefinition } from "../pipeline.ts";

// ─── Schema ──────────────────────────────────────────────────────────────────

export const HHWorkflowStepSchema = z.object({
  label: z.string().optional(),
  task: z.string().min(1),
  peer: z.string().min(1),
  timeout: z.number().int().positive().optional(),
  continueOnError: z.boolean().optional(),
});

export const HHWorkflowSchema = z.object({
  /** Unique identifier (UUID) */
  id: z.string().uuid(),
  /** Short slug name used on the CLI (e.g. "code-review", "daily-brief") */
  name: z.string().min(1),
  /** Optional human-readable description */
  description: z.string().optional(),
  /**
   * The original inline spec string (e.g. "peer1:task -> peer2:task").
   * Present when workflow was added from an inline spec.
   */
  spec: z.string().optional(),
  /**
   * Stored steps (always present — derived from inline spec or loaded from
   * a pipeline JSON file at add-time).
   */
  steps: z.array(HHWorkflowStepSchema),
  /** Default per-step timeout in seconds (overridable at run time). */
  timeout: z.number().int().positive().optional(),
  /** ISO 8601 creation timestamp */
  created_at: z.string().datetime(),
  /** ISO 8601 last-run timestamp */
  last_run_at: z.string().datetime().optional(),
  /** Total number of successful runs */
  run_count: z.number().int().nonnegative().default(0),
});

export type HHWorkflow = z.infer<typeof HHWorkflowSchema>;
export type HHWorkflowStep = z.infer<typeof HHWorkflowStepSchema>;

export const HHWorkflowListSchema = z.array(HHWorkflowSchema);

// ─── Paths ───────────────────────────────────────────────────────────────────

function getBaseDir(): string {
  return join(homedir(), ".his-and-hers");
}

function getWorkflowsPath(): string {
  return join(getBaseDir(), "workflows.json");
}

async function ensureBaseDir(): Promise<void> {
  await mkdir(getBaseDir(), { recursive: true });
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export async function loadWorkflows(): Promise<HHWorkflow[]> {
  const path = getWorkflowsPath();
  if (!existsSync(path)) return [];
  try {
    const raw = await readFile(path, "utf8");
    return HHWorkflowListSchema.parse(JSON.parse(raw));
  } catch {
    return [];
  }
}

export async function saveWorkflows(workflows: HHWorkflow[]): Promise<void> {
  await ensureBaseDir();
  await writeFile(getWorkflowsPath(), JSON.stringify(workflows, null, 2), "utf8");
}

export interface AddWorkflowInput {
  name: string;
  steps: PipelineStep[];
  spec?: string;
  description?: string;
  timeout?: number;
}

export async function addWorkflow(input: AddWorkflowInput): Promise<HHWorkflow> {
  const workflows = await loadWorkflows();

  // Reject duplicate names (case-insensitive)
  const existing = workflows.find((w) => w.name.toLowerCase() === input.name.toLowerCase());
  if (existing) {
    throw new Error(
      `Workflow "${input.name}" already exists (id: ${existing.id.slice(0, 8)}). ` +
        `Remove it first with: hh workflow remove ${input.name}`,
    );
  }

  const workflow: HHWorkflow = {
    id: randomUUID(),
    name: input.name,
    description: input.description,
    spec: input.spec,
    steps: input.steps,
    timeout: input.timeout,
    created_at: new Date().toISOString(),
    run_count: 0,
  };

  workflows.push(workflow);
  await saveWorkflows(workflows);
  return workflow;
}

export async function removeWorkflow(nameOrId: string): Promise<HHWorkflow | null> {
  const workflows = await loadWorkflows();
  const idx = workflows.findIndex(
    (w) =>
      w.name.toLowerCase() === nameOrId.toLowerCase() ||
      w.id === nameOrId ||
      w.id.startsWith(nameOrId),
  );
  if (idx === -1) return null;
  const [removed] = workflows.splice(idx, 1);
  await saveWorkflows(workflows);
  return removed;
}

export async function findWorkflow(nameOrId: string): Promise<HHWorkflow | null> {
  const workflows = await loadWorkflows();
  return (
    workflows.find(
      (w) =>
        w.name.toLowerCase() === nameOrId.toLowerCase() ||
        w.id === nameOrId ||
        w.id.startsWith(nameOrId),
    ) ?? null
  );
}

/**
 * Record a successful run: increment run_count and update last_run_at.
 * No-op if the workflow is not found.
 */
export async function recordWorkflowRun(nameOrId: string): Promise<void> {
  const workflows = await loadWorkflows();
  const wf = workflows.find(
    (w) =>
      w.name.toLowerCase() === nameOrId.toLowerCase() ||
      w.id === nameOrId ||
      w.id.startsWith(nameOrId),
  );
  if (!wf) return;
  wf.run_count = (wf.run_count ?? 0) + 1;
  wf.last_run_at = new Date().toISOString();
  await saveWorkflows(workflows);
}

// ─── Conversion ──────────────────────────────────────────────────────────────

/** Convert a saved workflow to a PipelineDefinition for execution. */
export function workflowToPipelineDefinition(wf: HHWorkflow): PipelineDefinition {
  return {
    name: wf.name,
    description: wf.description,
    steps: wf.steps,
  };
}
