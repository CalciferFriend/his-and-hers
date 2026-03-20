# `cofounder workflow`

Save named pipeline workflows and run them by name — like `cofounder template` for
single-step tasks, but for multi-step pipelines.

```
cofounder workflow add <name> "<spec>" [--desc "..."] [--timeout <s>]
cofounder workflow add <name> --file pipeline.json [--desc "..."]
cofounder workflow list [--json]
cofounder workflow show <name> [--json]
cofounder workflow run <name> [--timeout <s>] [--json]
cofounder workflow remove <name> [--force]
```

## Why workflows?

`cofounder pipeline` is great for one-off chains. Workflows let you save a pipeline
and run it repeatedly without retyping the spec:

```sh
# Save once
cofounder workflow add code-review \
    "glados:write tests for {{feature}} -> piper:review {{previous.output}}"

# Run any time
cofounder workflow run code-review
```

---

## `cofounder workflow add`

Save a new named workflow from an inline spec or a JSON pipeline file.

```sh
# Inline spec
cofounder workflow add daily-brief \
    "glados:summarise overnight logs -> piper:highlight action items"

# From a JSON file
cofounder workflow add release-check --file ./pipelines/release.json \
    --desc "Pre-release checklist across all peers" \
    --timeout 120
```

| Flag | Description |
|---|---|
| `--desc <text>` | Human-readable description shown in list/show |
| `--timeout <s>` | Per-step timeout override (seconds) |
| `--file <path>` | Load definition from a JSON pipeline file |

Names must be alphanumeric with hyphens/underscores (`[a-zA-Z0-9_-]+`).

---

## `cofounder workflow list`

List all saved workflows.

```sh
cofounder workflow list
cofounder workflow list --json
```

Output includes step count, run count, and last-run timestamp.

---

## `cofounder workflow show`

Inspect a specific workflow — steps, timeouts, run history.

```sh
cofounder workflow show code-review
cofounder workflow show code-review --json
```

---

## `cofounder workflow run`

Execute a saved workflow. All pipeline mechanics apply: placeholder
interpolation, per-step timeout, `continueOnError`, streaming output.

```sh
cofounder workflow run code-review
cofounder workflow run daily-brief --json
cofounder workflow run release-check --timeout 180
```

| Flag | Description |
|---|---|
| `--timeout <s>` | Override per-step timeout for this run |
| `--json` | Machine-readable output |

Each run increments `run_count` and updates `last_run_at` in the registry.

---

## `cofounder workflow remove`

Delete a saved workflow. Prompts for confirmation unless `--force` is passed.

```sh
cofounder workflow remove old-pipeline
cofounder workflow remove old-pipeline --force
```

---

## Inline spec format

The same `peer:task -> peer:task` format used by `cofounder pipeline`:

```
"glados:write tests -> piper:review {{previous.output}} -> me:summarise {{steps.2.output}}"
```

See [cofounder pipeline](/reference/pipeline) for full placeholder reference.

---

## Storage

Workflows are persisted to `~/.cofounder/workflows.json`. The file is
human-editable — you can copy workflows between machines by sharing this file
or committing it to your dotfiles.

---

## SDK usage

```ts
import { loadWorkflows, addWorkflow, findWorkflow, removeWorkflow } from "@cofounder/core";

const wf = await addWorkflow({
  name: "code-review",
  spec: "glados:write tests -> piper:review {{previous.output}}",
  steps: [
    { peer: "glados", task: "write tests" },
    { peer: "piper", task: "review {{previous.output}}" },
  ],
  description: "Automated test + review pipeline",
  timeout: 90,
});

const all = await loadWorkflows();
const found = await findWorkflow("code-review");
await removeWorkflow("code-review");
```
