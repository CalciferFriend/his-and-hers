/**
 * commands/use-cases.ts — `cofounder use-cases` subcommands
 *
 * Browse and initialize starter templates for common cofounder patterns.
 *
 * Usage:
 *   cofounder use-cases list [--json]
 *   cofounder use-cases show <name> [--json]
 *   cofounder use-cases init <name> [--force]
 *
 * Available templates:
 *   - gpu-inference      Route heavy LLM inference to H2's GPU
 *   - content-generation H1 schedules, H2 generates images/videos
 *   - ci-runner          H1 watches webhooks, H2 runs builds/tests
 *   - data-processing    H1 ingests data, H2 processes batches
 *   - agent-swarm        H1 orchestrates, H2 executes autonomous tasks
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { readFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to templates directory (relative to compiled dist/)
const TEMPLATES_DIR = join(__dirname, "..", "..", "..", "..", "templates", "use-cases");

interface UseCaseTemplate {
  name: string;
  title: string;
  description: string;
  bestFor: string;
}

const USE_CASES: UseCaseTemplate[] = [
  {
    name: "gpu-inference",
    title: "GPU Inference",
    description: "Route heavy LLM inference to H2's GPU while H1 stays responsive to API traffic.",
    bestFor: "Cost-optimized inference, avoiding cloud API calls for bulk workloads",
  },
  {
    name: "content-generation",
    title: "Content Generation",
    description: "H1 schedules content, H2 generates images/videos on-demand.",
    bestFor: "Social media automation, marketing content, automated design",
  },
  {
    name: "ci-runner",
    title: "CI Runner",
    description: "H1 watches GitHub webhooks, H2 wakes to run builds/tests.",
    bestFor: "Personal projects, team CI without GitHub Actions costs",
  },
  {
    name: "data-processing",
    title: "Data Processing",
    description: "H1 ingests streaming data, H2 processes batches.",
    bestFor: "ETL pipelines, ML inference, video transcoding",
  },
  {
    name: "agent-swarm",
    title: "Agent Swarm",
    description: "H1 orchestrates complex goals, H2 executes autonomous tasks.",
    bestFor: "Multi-agent systems, complex workflows, research tasks",
  },
];

// ─── use-cases list ───────────────────────────────────────────────────────────

export async function useCasesList(opts: { json?: boolean }) {
  if (opts.json) {
    console.log(JSON.stringify(USE_CASES, null, 2));
    return;
  }

  p.intro(pc.bold("Available Use Case Templates"));

  for (const template of USE_CASES) {
    p.log.message("");
    p.log.message(pc.cyan(pc.bold(`${template.title}`)) + pc.dim(` (${template.name})`));
    p.log.message(pc.dim(template.description));
    p.log.message(pc.green("Best for: ") + template.bestFor);
  }

  p.log.message("");
  p.log.message(pc.dim("View details:") + " cofounder use-cases show <name>");
  p.log.message(pc.dim("Initialize:  ") + " cofounder use-cases init <name>");
  p.outro("Done.");
}

// ─── use-cases show ───────────────────────────────────────────────────────────

export async function useCasesShow(name: string, opts: { json?: boolean }) {
  const template = USE_CASES.find((t) => t.name === name);

  if (!template) {
    p.log.error(`Use case "${name}" not found.`);
    p.log.message(`Available: ${USE_CASES.map((t) => t.name).join(", ")}`);
    process.exit(1);
  }

  const readmePath = join(TEMPLATES_DIR, name, "README.md");

  if (!existsSync(readmePath)) {
    p.log.error(`Template README not found at: ${readmePath}`);
    p.log.message("This may indicate a package installation issue.");
    process.exit(1);
  }

  const readme = readFileSync(readmePath, "utf-8");

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          ...template,
          readme,
        },
        null,
        2
      )
    );
    return;
  }

  p.intro(pc.bold(template.title));
  p.log.message("");
  p.log.message(readme);
  p.log.message("");
  p.outro(`Initialize with: cofounder use-cases init ${name}`);
}

// ─── use-cases init ───────────────────────────────────────────────────────────

export async function useCasesInit(name: string, opts: { force?: boolean }) {
  const template = USE_CASES.find((t) => t.name === name);

  if (!template) {
    p.log.error(`Use case "${name}" not found.`);
    p.log.message(`Available: ${USE_CASES.map((t) => t.name).join(", ")}`);
    process.exit(1);
  }

  p.intro(pc.bold(`Initializing ${template.title}`));

  const templateDir = join(TEMPLATES_DIR, name);

  if (!existsSync(templateDir)) {
    p.log.error(`Template directory not found: ${templateDir}`);
    p.log.message("This may indicate a package installation issue.");
    p.outro("Failed.");
    process.exit(1);
  }

  // Target: ~/.openclaw/ (or ~/.cofounder/ for backwards compat)
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (!homeDir) {
    p.log.error("Could not determine home directory.");
    process.exit(1);
  }

  const targetDir = join(homeDir, ".openclaw");

  // Create target directory if it doesn't exist
  if (!existsSync(targetDir)) {
    p.log.warn(`Target directory does not exist: ${targetDir}`);
    const shouldCreate = await p.confirm({
      message: `Create ${targetDir}?`,
      initialValue: true,
    });

    if (p.isCancel(shouldCreate) || !shouldCreate) {
      p.cancel("Cancelled.");
      process.exit(0);
    }

    mkdirSync(targetDir, { recursive: true });
    p.log.success(`Created ${targetDir}`);
  }

  // Copy README.md to target
  const readmePath = join(templateDir, "README.md");
  const targetReadmePath = join(targetDir, `use-case-${name}.md`);

  if (existsSync(targetReadmePath) && !opts.force) {
    p.log.warn(`File already exists: ${targetReadmePath}`);
    const shouldOverwrite = await p.confirm({
      message: "Overwrite?",
      initialValue: false,
    });

    if (p.isCancel(shouldOverwrite) || !shouldOverwrite) {
      p.cancel("Cancelled.");
      process.exit(0);
    }
  }

  copyFileSync(readmePath, targetReadmePath);
  p.log.success(`Copied README → ${targetReadmePath}`);

  // Check for example files
  const exampleFiles: string[] = [];

  function scanForExamples(dir: string, prefix = "") {
    const items = readdirSync(dir);
    for (const item of items) {
      const fullPath = join(dir, item);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        scanForExamples(fullPath, prefix + item + "/");
      } else if (item.endsWith(".ts") || item.endsWith(".js") || item.endsWith(".json")) {
        exampleFiles.push({ source: fullPath, relative: prefix + item });
      }
    }
  }

  scanForExamples(templateDir);

  if (exampleFiles.length > 0) {
    p.log.message("");
    p.log.message(pc.cyan("Example files found:"));

    const examplesDir = join(targetDir, "examples", name);
    mkdirSync(examplesDir, { recursive: true });

    for (const { source, relative } of exampleFiles) {
      const targetPath = join(examplesDir, relative);
      mkdirSync(dirname(targetPath), { recursive: true });
      copyFileSync(source, targetPath);
      p.log.success(`  ${relative} → ${targetPath}`);
    }
  }

  p.log.message("");
  p.log.message(pc.green("✓ Template initialized!"));
  p.log.message("");
  p.log.message(pc.dim("Next steps:"));
  p.log.message(`  1. Read the guide: ${pc.cyan(targetReadmePath)}`);
  if (exampleFiles.length > 0) {
    p.log.message(`  2. Explore examples: ${pc.cyan(join(targetDir, "examples", name))}`);
  }
  p.log.message(`  3. Customize for your setup`);

  p.outro("Done.");
}
