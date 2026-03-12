import * as p from "@clack/prompts";
import pc from "picocolors";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isCancelled, type WizardContext } from "../context.ts";

/**
 * Resolve the templates directory relative to the package root.
 * In dev: ../../templates (from packages/cli/src/wizard/steps/)
 * After build: depends on bundling, so we use a heuristic.
 */
function findTemplatesDir(): string {
  // Walk up from this file to find the repo root containing 'templates/'
  const thisDir = dirname(fileURLToPath(import.meta.url));
  // From packages/cli/src/wizard/steps → repo root is 5 levels up
  return join(thisDir, "..", "..", "..", "..", "..", "templates");
}

export async function stepSoul(ctx: Partial<WizardContext>): Promise<Partial<WizardContext>> {
  const role = ctx.role!;

  const install = await p.confirm({
    message: `Install SOUL.md and IDENTITY.md templates for the ${role} role?`,
    initialValue: true,
  });

  if (isCancelled(install)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  if (!install) {
    p.log.info("Skipping template installation.");
    return { ...ctx, soulTemplateCopied: false };
  }

  const spinner = p.spinner();
  spinner.start("Installing templates...");

  try {
    const templatesDir = findTemplatesDir();
    const targetDir = join(process.env.HOME ?? process.env.USERPROFILE ?? "~", ".his-and-hers");

    const files = ["SOUL.md", "IDENTITY.md", "AGENTS.md"];

    await mkdir(targetDir, { recursive: true });

    for (const file of files) {
      const src = join(templatesDir, role, file);
      try {
        const content = await readFile(src, "utf-8");
        // Personalize the template
        const personalized = content
          .replace(/\*\*Tom\*\*/g, role === "tom" ? `**${ctx.name}**` : "**Tom**")
          .replace(/\*\*Jerry\*\*/g, role === "jerry" ? `**${ctx.name}**` : "**Jerry**");
        await writeFile(join(targetDir, file), personalized);
      } catch {
        // Template file not found — skip silently
      }
    }

    spinner.stop(`${pc.green("✓")} Templates installed to ${targetDir}`);
    return { ...ctx, soulTemplateCopied: true };
  } catch (err) {
    spinner.stop(`${pc.yellow("!")} Could not install templates.`);
    return { ...ctx, soulTemplateCopied: false };
  }
}
