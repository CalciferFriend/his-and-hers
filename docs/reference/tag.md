# `cofounder tag` — Task Tagging & Search

`cofounder tag` lets you label tasks with tags, then filter and search by tag.
Tags help organise task history for reporting, debugging, and retrieval.

## Subcommands

### `cofounder tag add <id> <tags...>`

Add one or more tags to a task. The task ID can be a prefix — the first
matching task state file is used.

```bash
cofounder tag add abc123 deploy prod
cofounder tag add abc123 deploy --note "Shipped v2.1"
cofounder tag add abc123 urgent --json
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--note <text>` | Attach a note to the tag record |
| `--json` | Output the updated tag record as JSON |

### `cofounder tag remove <id> <tags...>`

Remove specific tags from a task. Other tags are preserved.

```bash
cofounder tag remove abc123 urgent
cofounder tag remove abc123 deploy prod
```

### `cofounder tag list [id]`

List tags for a specific task (by ID prefix) or all tagged tasks.

```bash
cofounder tag list                # All tagged tasks
cofounder tag list abc123         # Tags for one task
cofounder tag list --json         # Machine-readable output
cofounder tag list abc123 --json  # JSON for one task
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON |

### `cofounder tag search <tag>`

Find all tasks that have a specific tag.

```bash
cofounder tag search deploy
cofounder tag search deploy --json
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON |

### `cofounder tag clear <id>`

Remove all tags from a task. Prompts for confirmation unless `--force`.

```bash
cofounder tag clear abc123
cofounder tag clear abc123 --force
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--force` | Skip confirmation prompt |

## Tag Rules

- Tag names must be **lowercase**, **alphanumeric + hyphen** only
- Maximum **32 characters** per tag name
- Maximum **20 tags** per task
- Tags are automatically lowercased and trimmed
- Duplicate tags are deduplicated on add

## Output Format

The `--json` flag on `list` and `search` returns `TagListEntry[]`:

```json
[
  {
    "task_id": "abc12345-...",
    "tags": ["deploy", "prod"],
    "note": "Shipped v2.1",
    "tagged_at": "2026-03-16T10:00:00.000Z",
    "task_summary": "Deploy the app to production"
  }
]
```

## Storage

Tag records are stored at `~/.cofounder/tags/<task_id>.json`.

## Use Cases

- **Weekly reviews**: Tag completed tasks by project or sprint
- **Debugging**: Tag tasks that failed for a specific reason (`cofounder tag search flaky`)
- **Filtering**: Combine with `cofounder logs` for task history workflows
- **Reporting**: Export tagged tasks for stakeholder reports

## Related

- [`cofounder logs`](./logs) — task history viewer
- [`cofounder stats`](./stats) — analytics and heatmaps
- [`cofounder health-report`](./health-report) — weekly health digest
- [`cofounder export`](./export) — export task history
