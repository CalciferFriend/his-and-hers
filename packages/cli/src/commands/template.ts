/**
 * commands/template.ts — `cofounder template` subcommands
 *
 * Save, list, and run named task templates with {variable} substitution.
 *
 * Usage:
 *   cofounder template add <name> --task "<task>" [--peer h2] [--timeout 120] [--desc "..."]
 *   cofounder template list [--json]
 *   cofounder template show <name>
 *   cofounder template run <name> [--var key=val ...] [args...] [--wait] [--notify <url>]
 *   cofounder template remove <name>
 *
 * Variables:
 *   {varname}  — named variable, provided with --var key=value
 *   {1} {2}    — positional args (1-indexed)
 *   {*}        — all positional args joined by spaces
 *
 * Example:
 *   cofounder template add summarize --task "Summarise this document in {lang}: {*}"
 *   cofounder template run summarize --var lang=English my-report.txt contents here
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  loadTemplates,
  addTemplate,
  removeTemplate,
  findTemplate,
  substituteVars,
  extractPlaceholders,
  type AddTemplateInput,
} from "@cofounder/core";
import { send } from "./send.ts";

// ─── template add ─────────────────────────────────────────────────────────────

export async function templateAdd(opts: {
  name: string;
  task: string;
  peer?: string;
  timeout?: number;
  notify?: string;
  desc?: string;
}) {
  p.intro(pc.bold("Adding task template"));

  // Validate: name must be slug-like
  if (!/^[a-zA-Z0-9_-]+$/.test(opts.name)) {
    p.log.error(`Invalid name "${opts.name}". Use only letters, digits, hyphens, and underscores.`);
    p.outro("Failed.");
    return;
  }

  const input: AddTemplateInput = {
    name: opts.name,
    task: opts.task,
    peer: opts.peer,
    timeout: opts.timeout,
    notify_webhook: opts.notify,
    description: opts.desc,
  };

  let template;
  try {
    template = await addTemplate(input);
  } catch (err) {
    p.log.error(String(err));
    p.outro("Failed.");
    return;
  }

  // Show detected placeholders as a hint
  const { named, positional, hasSplat } = extractPlaceholders(opts.task);
  const placeholders = [
    ...named.map((n) => `--var ${n}=<value>`),
    ...positional.map((i) => `<arg${i}>`),
    ...(hasSplat ? ["<arg1> <arg2> ..."] : []),
  ];

  p.log.info(`${pc.bold("Template ID:")} ${pc.cyan(template.id.slice(0, 8))} (full: ${pc.dim(template.id)})`);
  p.log.info(`${pc.bold("Name:")} ${pc.green(template.name)}`);
  p.log.info(`${pc.bold("Task:")} ${template.task}`);
  if (template.description) p.log.info(`${pc.bold("Description:")} ${template.description}`);
  if (template.peer) p.log.info(`${pc.bold("Peer:")} ${template.peer}`);
  if (template.timeout) p.log.info(`${pc.bold("Timeout:")} ${template.timeout}s`);
  if (template.notify_webhook) p.log.info(`${pc.bold("Notify:")} ${pc.cyan(template.notify_webhook)}`);

  if (placeholders.length > 0) {
    p.log.info(`${pc.bold("Variables:")} ${pc.yellow(placeholders.join("  "))}`);
    p.log.info(
      pc.dim(`Run with: cofounder template run ${template.name} ${placeholders.join(" ")}`),
    );
  } else {
    p.log.info(pc.dim(`Run with: cofounder template run ${template.name}`));
  }

  p.outro("Template saved.");
}

// ─── template list ────────────────────────────────────────────────────────────

export async function templateList(opts: { json?: boolean }) {
  const templates = await loadTemplates();

  if (templates.length === 0) {
    if (opts.json) {
      console.log("[]");
    } else {
      p.log.info("No templates saved.");
      p.log.info(pc.dim("Create one with: cofounder template add <name> --task \"<task>\""));
    }
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify(templates, null, 2));
    return;
  }

  p.intro(pc.bold(`Task templates (${templates.length})`));

  for (const t of templates) {
    const shortId = pc.cyan(t.id.slice(0, 8));
    const taskPreview = t.task.length > 70 ? t.task.slice(0, 67) + "..." : t.task;

    p.log.info("");
    p.log.info(`  ${pc.bold(pc.green(t.name))}  ${pc.dim(shortId)}`);
    if (t.description) p.log.info(`  ${pc.dim(t.description)}`);
    p.log.info(`  ${pc.dim("Task:")} ${taskPreview}`);

    const parts: string[] = [];
    if (t.peer) parts.push(`peer: ${t.peer}`);
    if (t.timeout) parts.push(`timeout: ${t.timeout}s`);
    if (parts.length > 0) p.log.info(`  ${pc.dim(parts.join(" · "))}`);
  }

  p.outro("");
}

// ─── template show ────────────────────────────────────────────────────────────

export async function templateShow(nameOrId: string, opts: { json?: boolean }) {
  const template = await findTemplate(nameOrId);

  if (!template) {
    if (opts.json) {
      console.log(JSON.stringify({ error: `Template "${nameOrId}" not found` }));
    } else {
      p.log.error(`Template "${nameOrId}" not found.`);
      p.log.info(pc.dim("List templates with: cofounder template list"));
    }
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify(template, null, 2));
    return;
  }

  const { named, positional, hasSplat } = extractPlaceholders(template.task);

  p.intro(pc.bold(`Template: ${template.name}`));
  p.log.info(`${pc.bold("ID:")} ${pc.cyan(template.id)}`);
  p.log.info(`${pc.bold("Name:")} ${pc.green(template.name)}`);
  if (template.description) p.log.info(`${pc.bold("Description:")} ${template.description}`);
  p.log.info(`${pc.bold("Task:")} ${template.task}`);
  if (template.peer) p.log.info(`${pc.bold("Peer:")} ${template.peer}`);
  if (template.timeout) p.log.info(`${pc.bold("Timeout:")} ${template.timeout}s`);
  if (template.notify_webhook) p.log.info(`${pc.bold("Notify:")} ${pc.cyan(template.notify_webhook)}`);
  p.log.info(`${pc.bold("Created:")} ${new Date(template.created_at).toLocaleString()}`);

  if (named.length > 0) p.log.info(`${pc.bold("Named vars:")} ${named.map((n) => pc.yellow(`{${n}}`)).join("  ")}`);
  if (positional.length > 0) p.log.info(`${pc.bold("Positional:")} ${positional.map((i) => pc.yellow(`{${i}}`)).join("  ")}`);
  if (hasSplat) p.log.info(`${pc.bold("Splat:")} ${pc.yellow("{*}")} (all positional args)`);

  const exampleVars = named.map((n) => `--var ${n}="value"`).join(" ");
  const exampleArgs = positional.length > 0 ? " <arg1> <arg2>" : hasSplat ? " <args...>" : "";
  p.log.info(pc.dim(`\nRun: cofounder template run ${template.name} ${exampleVars}${exampleArgs}`));

  p.outro("");
}

// ─── template run ─────────────────────────────────────────────────────────────

export async function templateRun(
  nameOrId: string,
  opts: {
    var?: string[];
    peer?: string;
    wait?: boolean;
    notify?: string;
    timeout?: number;
    /** Extra positional args passed after the template name */
    args?: string[];
    latent?: boolean;
    autoLatent?: boolean;
  },
) {
  const template = await findTemplate(nameOrId);

  if (!template) {
    p.log.error(`Template "${nameOrId}" not found.`);
    p.log.info(pc.dim("List templates with: cofounder template list"));
    return;
  }

  // Parse --var key=value pairs
  const vars: Record<string, string> = {};
  for (const varStr of opts.var ?? []) {
    const eqIdx = varStr.indexOf("=");
    if (eqIdx === -1) {
      p.log.error(`Invalid --var "${varStr}". Expected format: key=value`);
      return;
    }
    const key = varStr.slice(0, eqIdx).trim();
    const val = varStr.slice(eqIdx + 1);
    vars[key] = val;
  }

  // Substitute variables
  let expandedTask: string;
  try {
    expandedTask = substituteVars(template.task, { vars, args: opts.args ?? [] });
  } catch (err) {
    p.log.error(String(err));
    return;
  }

  // Resolve runtime overrides
  const effectivePeer = opts.peer ?? template.peer;
  const effectiveTimeout = opts.timeout ?? template.timeout;
  const effectiveNotify = opts.notify ?? template.notify_webhook;

  p.log.info(`${pc.bold("Template:")} ${pc.green(template.name)}`);
  p.log.info(`${pc.bold("Task:")} ${expandedTask}`);
  if (effectivePeer) p.log.info(`${pc.bold("Peer:")} ${effectivePeer}`);

  // Delegate to `cofounder send` pipeline
  await send(expandedTask, {
    peer: effectivePeer,
    wait: opts.wait,
    notify: effectiveNotify,
    waitTimeoutSeconds: effectiveTimeout !== undefined ? String(effectiveTimeout) : undefined,
    latent: opts.latent,
    autoLatent: opts.autoLatent,
  });
}

// ─── template remove ──────────────────────────────────────────────────────────

export async function templateRemove(nameOrId: string, opts: { force?: boolean }) {
  const template = await findTemplate(nameOrId);

  if (!template) {
    p.log.error(`Template "${nameOrId}" not found.`);
    p.log.info(pc.dim("List templates with: cofounder template list"));
    return;
  }

  if (!opts.force) {
    const confirmed = await p.confirm({
      message: `Remove template "${pc.bold(template.name)}" (${pc.dim(template.id.slice(0, 8))})?`,
      initialValue: false,
    });
    if (p.isCancel(confirmed) || !confirmed) {
      p.outro("Cancelled.");
      return;
    }
  }

  await removeTemplate(template.id);
  p.log.info(`${pc.green("✓")} Template "${pc.bold(template.name)}" removed.`);
}
