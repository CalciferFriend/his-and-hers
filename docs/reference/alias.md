# hh alias — user-defined CLI shortcuts

`hh alias` lets you save any `hh` subcommand string under a short memorable name.
Aliases are persisted to `~/.his-and-hers/aliases.json` and work across sessions.

## Subcommands

### `hh alias add <name> "<command>"`

Create (or update) a named alias.

```
hh alias add pr-review "workflow run code-review --peer glados"
hh alias add deploy "run summarise ./CHANGELOG.md --wait"
hh alias add daily "broadcast Send me a daily standup prompt"
```

Name rules: `[a-zA-Z0-9_-]+` — letters, digits, dashes, underscores only.

**Options:**

| Flag | Description |
|------|-------------|
| `--desc <text>` | Human-readable description for `hh alias list` |

---

### `hh alias list`

List all defined aliases.

```
hh alias list
hh alias list --json
```

---

### `hh alias show <name>`

Show full details of a single alias.

```
hh alias show pr-review
hh alias show pr-review --json
```

---

### `hh alias remove <name>`

Remove an alias. Prompts for confirmation unless `--force` is passed.

```
hh alias remove pr-review
hh alias remove pr-review --force
```

---

### `hh alias run <name> [args...]`

Expand and execute an alias. Extra `[args...]` are appended to the stored command.

```
hh alias run pr-review
hh alias run pr-review --wait --json
```

You can also invoke aliases via `hh run alias <name>`.

---

## How Aliases Work

When you run `hh alias run pr-review --wait`, hh:

1. Looks up `pr-review` in `~/.his-and-hers/aliases.json`
2. Expands it: `workflow run code-review --peer glados`
3. Appends extra args: `workflow run code-review --peer glados --wait`
4. Re-invokes `hh workflow run code-review --peer glados --wait`

The expanded command is printed in dimmed text before execution so you always
know what's running.

---

## Storage

Aliases are stored in `~/.his-and-hers/aliases.json`:

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
hh alias add pr-review "workflow run code-review" --desc "Standard PR review"

# Save a common summarise shortcut
hh alias add tl "run summarise" --desc "TL;DR any file"

# Use it
hh alias run tl ./meeting-notes.md --wait

# See what you have
hh alias list

# Clean up
hh alias remove tl --force
```

---

## See Also

- [`hh run`](./run.md) — ergonomic task shorthands
- [`hh workflow`](./workflow.md) — saved multi-step pipelines
- [`hh template`](./template.md) — single-step task templates
