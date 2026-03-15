# `hh workflow`

Save named pipeline workflows and run them by name — like `hh template` for
single-step tasks, but for multi-step pipelines.

```
hh workflow add <name> "<spec>" [--desc "..."] [--timeout <s>]
hh workflow add <name> --file pipeline.json [--desc "..."]
hh workflow list [--json]
hh workflow show <name> [--json]
hh workflow run <name> [--timeout <s>] [--json]
hh workflow remove <name> [--force]
```

## Why workflows?

`hh pipeline` is great for one-off chains. Workflows let you save a pipeline
and run it repeatedly without retyping the spec:

```sh
# Save once
hh workflow add code-review \
    "glados:write tests for {{feature}} -> piper:review {{previous.output}}"

# Run any time
hh workflow run code-review
```

---

## `hh workflow add`

Save a new named workflow from an inline spec or a JSON pipeline file.

```sh
# Inline spec
hh workflow add daily-brief \
    "glados:summarise overnight logs -> piper:highlight action items"

# From a JSON file
hh workflow add release-check --file ./pipelines/release.json \
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

## `hh workflow list`

List all saved workflows.

```sh
hh workflow list
hh workflow list --json
```

Output includes step count, run count, and last-run timestamp.

---

## `hh workflow show`

Inspect a specific workflow — steps, timeouts, run history.

```sh
hh workflow show code-review
hh workflow show code-review --json
```

---

## `hh workflow run`

Execute a saved workflow. All pipeline mechanics apply: placeholder
interpolation, per-step timeout, `continueOnError`, streaming output.

```sh
hh workflow run code-review
hh workflow run daily-brief --json
hh workflow run release-check --timeout 180
```

| Flag | Description |
|---|---|
| `--timeout <s>` | Override per-step timeout for this run |
| `--json` | Machine-readable output |

Each run increments `run_count` and updates `last_run_at` in the registry.

---

## `hh workflow remove`

Delete a saved workflow. Prompts for confirmation unless `--force` is passed.

```sh
hh workflow remove old-pipeline
hh workflow remove old-pipeline --force
```

---

## Inline spec format

The same `peer:task -> peer:task` format used by `hh pipeline`:

```
"glados:write tests -> piper:review {{previous.output}} -> me:summarise {{steps.2.output}}"
```

See [hh pipeline](/reference/pipeline) for full placeholder reference.

---

## Storage

Workflows are persisted to `~/.his-and-hers/workflows.json`. The file is
human-editable — you can copy workflows between machines by sharing this file
or committing it to your dotfiles.

---

## SDK usage

```ts
import { loadWorkflows, addWorkflow, findWorkflow, removeWorkflow } from "@his-and-hers/core";

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
