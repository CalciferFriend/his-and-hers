import * as p from "@clack/prompts";
import { ROLE_DEFAULTS } from "../../config/defaults.ts";
import { isCancelled, type WizardContext } from "../context.ts";

export async function stepIdentity(ctx: Partial<WizardContext>): Promise<Partial<WizardContext>> {
  const role = ctx.role!;
  const defaults = ROLE_DEFAULTS[role];

  const answers = await p.group(
    {
      name: () =>
        p.text({
          message: "Agent name for this node",
          placeholder: role === "h1" ? "Calcifer" : "GLaDOS",
          validate: (v) => {
            if (!v.trim()) return "Name is required";
          },
        }),
      emoji: () =>
        p.text({
          message: "Emoji for this agent",
          initialValue: defaults.emoji,
        }),
      persona: () =>
        p.text({
          message: "Short persona description",
          initialValue: defaults.persona,
        }),
    },
    {
      onCancel: () => {
        p.cancel("Setup cancelled.");
        process.exit(0);
      },
    },
  );

  p.log.info(`Agent: ${answers.emoji} ${answers.name} — "${answers.persona}"`);

  return {
    ...ctx,
    name: answers.name,
    emoji: answers.emoji,
    persona: answers.persona,
  };
}
