import * as p from "@clack/prompts";
import { isCancelled, type WizardContext } from "../context.ts";

export async function stepRole(ctx: Partial<WizardContext>): Promise<Partial<WizardContext>> {
  const role = await p.select({
    message: "What role will this machine play?",
    options: [
      {
        value: "h1" as const,
        label: "🐱 H1 — Orchestrator",
        hint: "Always-on, delegates work, watches H2",
      },
      {
        value: "h2" as const,
        label: "🐭 H2 — Executor",
        hint: "Sleeps until needed, GPU/compute heavy lifting",
      },
    ],
  });

  if (isCancelled(role)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  p.log.info(`This machine will be ${role === "h1" ? "🐱 H1 (orchestrator)" : "🐭 H2 (executor)"}.`);

  return { ...ctx, role };
}
