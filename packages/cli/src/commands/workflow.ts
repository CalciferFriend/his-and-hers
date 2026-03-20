/**
 * commands/workflow.ts — `cofounder workflow` subcommands
 *
 * Save, list, and run named pipeline workflows.
 *
 * A workflow is a saved pipeline spec — like `cofounder template` for single-step tasks,
 * but for multi-step pipelines. Add a workflow once, run it by name any time.
 *
 * Usage:
 *   cofounder workflow add <name> "<spec>" [--desc "..."] [--timeout <s>]
 *   cofounder workflow add <name> --file pipeline.json [--desc "..."]
 *   cofounder workflow list [--json]
 *   cofounder workflow show <name> [--json]
 *   cofounder workflow run <name> [--timeout <s>] [--json]
 *   cofounder workflow remove <name> [--force]
 *
 * Example:
 *   cofounder workflow add code-review \
 *       "glados:write tests -> piper:review {{previous.output}}"
 *   cofounder workflow run code-review
 *
 * Phase 8a — Calcifer ✅ (2026-03-15)
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { readFileSync, existsSync } from "node:fs";
import {
  loadWorkflows,
  addWorkflow,
  removeWorkflow,
  findWorkflow,
  recordWorkflowRun,
  workflowToPipelineDefinition,
  type HHWorkflow,
} from "@cofounder/core";
import { parsePipelineSpec, parsePipelineFile } from "@cofounder/core";
import { pipeline } from "./pipeline.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function stepBadge(count: number): string {
  return pc.dim(`${count} step${count === 1 ? "" : "s"}`);
}

// ─── workflow add ─────────────────────────────────────────────────────────────

export async function workflowAdd(opts: {
  name: string;
  spec?: string;
  file?: string;
  desc?: string;
  timeout?: number;
}) {
  p.intro(pc.bold("Saving workflow"));

  // Validate name
  if (!/^[a-zA-Z0-9_-]+$/.test(opts.name)) {
    p.log.error(`Invalid name "${opts.name}". Use only letters, digits, hyphens, and underscores.`);
    p.outro("Failed.");
    return;
  }

  // Require exactly one source
  if (!opts.spec && !opts.file) {
    p.log.error("Provide either an inline spec (positional argument) or --file <path>.");
    p.outro("Failed.");
    return;
  }
  if (opts.spec && opts.file) {
    p.log.error("Specify either an inline spec or --file — not both.");
    p.outro("Failed.");
    return;
  }

  let steps: ReturnType<typeof parsePipelineSpec>;
  let spec: string | undefined;

  if (opts.spec) {
    // Parse inline spec
    try {
      steps = parsePipelineSpec(opts.spec);
      spec = opts.spec;
    } catch (err: any) {
      p.log.error(`Invalid pipeline spec: ${err.message}`);
      p.outro("Failed.");
      return;
    }
  } else {
    // Load from file
    const filePath = opts.file!;
    if (!existsSync(filePath)) {
      p.log.error(`File not found: ${filePath}`);
      p.outro("Failed.");
      return;
    }
    try {
      const raw = readFileSync(filePath, "utf8");
      const def = parsePipelineFile(raw, filePath);
      steps = def.steps;
    } catch (err: any) {
      p.log.error(`Failed to parse pipeline file: ${err.message}`);
      p.outro("Failed.");
      return;
    }
  }

  try {
    const wf = await addWorkflow({
      name: opts.name,
      steps,
      spec,
      description: opts.desc,
      timeout: opts.timeout,
    });
    p.log.success(
      `Workflow ${pc.bold(wf.name)} saved — ${wf.steps.length} step${wf.steps.length === 1 ? "" : "s"}.`,
    );
    p.log.info(`Run it with: ${pc.dim(`cofounder workflow run ${wf.name}`)}`);
    p.outro("Done.");
  } catch (err: any) {
    p.log.error(err.message);
    p.outro("Failed.");
  }
}

// ─── workflow list ────────────────────────────────────────────────────────────

export async function workflowList(opts: { json?: boolean }) {
  const workflows = await loadWorkflows();

  if (opts.json) {
    console.log(JSON.stringify(workflows, null, 2));
    return;
  }

  if (workflows.length === 0) {
    p.log.info("No workflows saved yet. Add one with: cofounder workflow add <name> \"<spec>\"");
    return;
  }

  console.log(pc.bold(`\n  Saved workflows (${workflows.length})\n`));
  for (const wf of workflows) {
    const runInfo =
      wf.run_count > 0
        ? pc.dim(` · ${wf.run_count} run${wf.run_count === 1 ? "" : "s"}, last ${fmtDate(wf.last_run_at!)}`)
        : pc.dim(" · never run");
    const desc = wf.description ? `  ${pc.dim(wf.description)}` : "";
    console.log(
      `  ${pc.green("●")} ${pc.bold(wf.name)}  ${stepBadge(wf.steps.length)}${runInfo}`,
    );
    if (desc) console.log(desc);
  }
  console.log();
}

// ─── workflow show ────────────────────────────────────────────────────────────

export async function workflowShow(name: string, opts: { json?: boolean }) {
  const wf = await findWorkflow(name);

  if (!wf) {
    console.error(`Workflow "${name}" not found. List with: cofounder workflow list`);
    process.exitCode = 1;
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify(wf, null, 2));
    return;
  }

  console.log(pc.bold(`\n  Workflow: ${wf.name}`));
  if (wf.description) console.log(`  ${pc.dim(wf.description)}`);
  console.log();
  console.log(`  ${pc.dim("ID:")}           ${wf.id}`);
  console.log(`  ${pc.dim("Steps:")}        ${wf.steps.length}`);
  if (wf.timeout) console.log(`  ${pc.dim("Timeout:")}      ${wf.timeout}s (per step)`);
  console.log(`  ${pc.dim("Created:")}      ${fmtDate(wf.created_at)}`);
  console.log(
    `  ${pc.dim("Runs:")}         ${wf.run_count}` +
      (wf.last_run_at ? ` (last: ${fmtDate(wf.last_run_at)})` : ""),
  );

  if (wf.spec) {
    console.log(`\n  ${pc.dim("Spec:")}`);
    console.log(`    ${pc.cyan(wf.spec)}`);
  }

  console.log(`\n  ${pc.dim("Steps:")}`);
  wf.steps.forEach((step, i) => {
    const label = step.label ? ` (${step.label})` : "";
    const timeout = step.timeout ? pc.dim(` [${step.timeout}s]`) : "";
    const cont = step.continueOnError ? pc.yellow(" [continue-on-error]") : "";
    console.log(`    ${pc.dim(`${i + 1}.`)} ${pc.bold(step.peer)}${label}${timeout}${cont}`);
    console.log(`       ${step.task}`);
  });
  console.log();
}

// ─── workflow remove ──────────────────────────────────────────────────────────

export async function workflowRemove(name: string, opts: { force?: boolean; json?: boolean }) {
  const wf = await findWorkflow(name);

  if (!wf) {
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, error: `Workflow "${name}" not found.` }));
    } else {
      console.error(`Workflow "${name}" not found.`);
    }
    process.exitCode = 1;
    return;
  }

  if (!opts.force) {
    const confirmed = await p.confirm({
      message: `Remove workflow "${wf.name}" (${wf.steps.length} steps, ${wf.run_count} runs)?`,
    });
    if (!confirmed || p.isCancel(confirmed)) {
      p.log.info("Cancelled.");
      return;
    }
  }

  await removeWorkflow(name);

  if (opts.json) {
    console.log(JSON.stringify({ ok: true, removed: wf.name, id: wf.id }));
  } else {
    p.log.success(`Workflow "${wf.name}" removed.`);
  }
}

// ─── workflow run ─────────────────────────────────────────────────────────────

export async function workflowRun(name: string, opts: { timeout?: string; json?: boolean }) {
  const wf = await findWorkflow(name);

  if (!wf) {
    console.error(`Workflow "${name}" not found. List with: cofounder workflow list`);
    process.exitCode = 1;
    return;
  }

  if (!opts.json) {
    p.intro(pc.bold(`Running workflow: ${wf.name}`));
    if (wf.description) p.log.info(wf.description);
    p.log.info(`${wf.steps.length} step${wf.steps.length === 1 ? "" : "s"}`);
  }

  // Build pipeline options from workflow config + any runtime overrides
  const pipelineOpts: { file?: string; timeout?: string; json?: boolean } = {
    json: opts.json,
    timeout: opts.timeout ?? (wf.timeout ? String(wf.timeout) : undefined),
  };

  // Convert workflow to pipeline definition and run via a temp JSON file
  // We pass the steps as a JSON-encoded pipeline by writing to a temp path
  // and delegating to the existing pipeline command (reuse all execution logic).
  const def = workflowToPipelineDefinition(wf);

  // Instead of writing a temp file, we reconstruct the inline spec if available,
  // or fall back to executing via the programmatic pipeline definition directly.
  // We import the core pipeline runner directly here to avoid the file indirection.
  await runWorkflowDefinition(def, pipelineOpts);

  // Record the run regardless of success/failure (pipeline command handles errors)
  await recordWorkflowRun(name).catch(() => {
    /* best-effort */
  });
}

// ─── Internal runner ─────────────────────────────────────────────────────────

/**
 * Execute a PipelineDefinition by serialising to a temp JSON file and
 * delegating to the existing `pipeline` command.  This reuses 100% of
 * the execution, retry, streaming, and output logic without duplication.
 */
async function runWorkflowDefinition(
  def: ReturnType<typeof workflowToPipelineDefinition>,
  opts: { timeout?: string; json?: boolean },
): Promise<void> {
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { randomUUID } = await import("node:crypto");

  const tmpPath = join(tmpdir(), `cofounder-workflow-${randomUUID()}.json`);
  writeFileSync(tmpPath, JSON.stringify(def, null, 2), "utf8");

  try {
    await pipeline(undefined, { file: tmpPath, ...opts });
  } finally {
    try {
      const { unlinkSync } = await import("node:fs");
      unlinkSync(tmpPath);
    } catch {
      /* ignore cleanup errors */
    }
  }
}
