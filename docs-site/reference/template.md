# cofounder template

Save named task templates with `{variable}` placeholders and run them without
retyping the full task string each time.

## Synopsis

```
cofounder template add <name> --task "<task>" [options]
cofounder template list [--json]
cofounder template show <name-or-id> [--json]
cofounder template run <name-or-id> [--var key=val ...] [args...] [options]
cofounder template remove <name-or-id> [--force]
```

## Subcommands

### `cofounder template add`

Save a new template to `~/.cofounder/templates.json`.

| Flag | Default | Description |
|---|---|---|
| `--task <string>` | _(required)_ | Task string with optional `{var}`, `{1}`, `{*}` placeholders. |
| `--peer <name>` | _(config default)_ | Pin this template to a specific peer node. |
| `--timeout <seconds>` | _(config default)_ | Default timeout override for this template. |
| `--notify <url>` | — | Default notification webhook for this template. |
| `--desc <text>` | — | Human-readable description shown in `cofounder template list`. |

Names must be slug-like: letters, digits, hyphens, and underscores only.
Duplicate names (case-insensitive) are rejected.

### `cofounder template list`

Print all saved templates.

| Flag | Default | Description |
|---|---|---|
| `--json` | off | Emit raw JSON array instead of the pretty-printed table. |

### `cofounder template show`

Show full details for a single template. Accepts exact name, full UUID, or 6+ character
id prefix.

| Flag | Default | Description |
|---|---|---|
| `--json` | off | Emit the template object as JSON. |

### `cofounder template run`

Expand placeholders and send the resulting task via `cofounder send`.

| Flag | Default | Description |
|---|---|---|
| `--var <key=value>` | — | Provide a named variable. Repeatable. |
| `--peer <name>` | template default | Override peer for this run. |
| `--wait` | off | Wait for the result (same as `cofounder send --wait`). |
| `--timeout <seconds>` | template default | Wait timeout override. |
| `--notify <url>` | template default | One-time webhook override. |
| `--latent` | off | Hard-require latent (CofounderLatentMessage) transport. |
| `--auto-latent` | off | Prefer latent; fall back to text if peer doesn't support it. |

Extra positional arguments after the template name are mapped to `{1}`, `{2}`, …
and `{*}` placeholders.

### `cofounder template remove`

Delete a template by name, full UUID, or id prefix.

| Flag | Default | Description |
|---|---|---|
| `--force` | off | Skip the confirmation prompt. |

## Variable Syntax

| Placeholder | Provided by | Description |
|---|---|---|
| `{varname}` | `--var varname=value` | Named variable. **Required** — throws if not provided. |
| `{1}`, `{2}`, … | positional CLI args | 1-indexed positional arguments. |
| `{*}` | positional CLI args | All positional arguments joined by spaces. |

Named and positional syntaxes can be mixed in a single template.

## Examples

```bash
# Save a summarization template with a named variable and positional splat
cofounder template add summarize \
  --task "Summarise this text in {lang}: {*}" \
  --peer GLaDOS \
  --desc "Language-aware summarizer"

# List all templates
cofounder template list

# Show full details including detected placeholders
cofounder template show summarize

# Run it — named var + positional splat
cofounder template run summarize --var lang=English \
  "This is a very long document about..."

# Run and wait for the result
cofounder template run summarize --var lang=French --wait \
  "Voici un long texte..."

# Code-review template with positional arg
cofounder template add code-review \
  --task "Review this code for correctness and style: {1}" \
  --peer GLaDOS \
  --timeout 120

cofounder template run code-review "$(cat src/myfile.ts)"

# Splat: pass arbitrary words as one big task
cofounder template add ask \
  --task "Answer this question: {*}"

cofounder template run ask What is the capital of France?

# Remove a template
cofounder template remove summarize
cofounder template remove summarize --force   # skip confirmation
```

## Storage

Templates are stored as JSON in `~/.cofounder/templates.json`.

```json
[
  {
    "id": "3f7a1c2b-...",
    "name": "summarize",
    "task": "Summarise this text in {lang}: {*}",
    "peer": "GLaDOS",
    "timeout": null,
    "notify_webhook": null,
    "description": "Language-aware summarizer",
    "created_at": "2026-03-14T20:00:00.000Z"
  }
]
```

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Template not found, duplicate name, missing variable, or invalid input |
