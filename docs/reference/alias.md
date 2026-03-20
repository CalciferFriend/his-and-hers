# cofounder alias — user-defined CLI shortcuts

`cofounder alias` lets you save any `cofounder` subcommand string under a short memorable name.
Aliases are persisted to `~/.cofounder/aliases.json` and work across sessions.

## Subcommands

### `cofounder alias add <name> "<command>"`

Create (or update) a named alias.

```
cofounder alias add pr-review "workflow run code-review --peer glados"
cofounder alias add deploy "run summarise ./CHANGELOG.md --wait"
cofounder alias add daily "broadcast Send me a daily standup prompt"
```

Name rules: `[a-zA-Z0-9_-]+` — letters, digits, dashes, underscores only.

**Options:**

| Flag | Description |
|------|-------------|
| `--desc <text>` | Human-readable description for `cofounder alias list` |

---

### `cofounder alias list`

List all defined aliases.

```
cofounder alias list
cofounder alias list --json
```

---

### `cofounder alias show <name>`

Show full details of a single alias.

```
cofounder alias show pr-review
cofounder alias show pr-review --json
```

---

### `cofounder alias remove <name>`

Remove an alias. Prompts for confirmation unless `--force` is passed.

```
cofounder alias remove pr-review
cofounder alias remove pr-review --force
```

---

### `cofounder alias run <name> [args...]`

Expand and execute an alias. Extra `[args...]` are appended to the stored command.

```
cofounder alias run pr-review
cofounder alias run pr-review --wait --json
```

You can also invoke aliases via `cofounder run alias <name>`.

---

## How Aliases Work

When you run `cofounder alias run pr-review --wait`, hh:

1. Looks up `pr-review` in `~/.cofounder/aliases.json`
2. Expands it: `workflow run code-review --peer glados`
3. Appends extra args: `workflow run code-review --peer glados --wait`
4. Re-invokes `cofounder workflow run code-review --peer glados --wait`

The expanded command is printed in dimmed text before execution so you always
know what's running.

---

## Storage

Aliases are stored in `~/.cofounder/aliases.json`:

```json
[
  {
    "name": "pr-review",
    "command": "workflow run code-review --peer glados",
    "desc": "Full PR review pipeline",
    "created_at": "2026-03-15T09:00:00.000Z",
    "updated_at": "2026-03-15T09:00:00.000Z"
  }
]
```

---

## Examples

```bash
# Save a PR review workflow as an alias
cofounder alias add pr-review "workflow run code-review" --desc "Standard PR review"

# Save a common summarise shortcut
cofounder alias add tl "run summarise" --desc "TL;DR any file"

# Use it
cofounder alias run tl ./meeting-notes.md --wait

# See what you have
cofounder alias list

# Clean up
cofounder alias remove tl --force
```

---

## See Also

- [`cofounder run`](./run.md) — ergonomic task shorthands
- [`cofounder workflow`](./workflow.md) — saved multi-step pipelines
- [`cofounder template`](./template.md) — single-step task templates
