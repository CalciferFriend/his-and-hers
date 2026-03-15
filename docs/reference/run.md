# hh run — ergonomic task shorthands

`hh run` provides one-liner shortcuts for the most common one-shot task patterns.
Instead of crafting a full prompt and `hh send` invocation, use `hh run` for
instant code review, file summarisation, and diff analysis.

## Subcommands

### `hh run summarise <path>`

Send a file to H2 for an executive summary and bullet-point breakdown.

```
hh run summarise ./meeting-notes.md
hh run summarise ./report.pdf --peer glados --wait
hh run summarise ./README.md --prompt "One sentence TLDR"
```

H2 receives the file as an attachment and returns:
- A concise 3–5 sentence executive summary
- A bullet-point breakdown of key points

**Options:**

| Flag | Description |
|------|-------------|
| `--peer <name>` | Target a specific peer (default: auto-route) |
| `--wait` | Block until H2 returns a result |
| `--json` | Output task receipt as JSON |
| `--notify <url>` | Webhook to call on completion |
| `--prompt <text>` | Override the default summarise prompt |

---

### `hh run review <path>`

Send a source file or directory to H2 for structured code review.

```
hh run review ./src/commands/send.ts
hh run review ./packages/core/src --peer glados --wait
hh run review ./main.go --prompt "Focus on error handling only"
```

H2 returns a structured review covering:
1. Correctness and edge cases
2. Readability and naming
3. Performance concerns
4. Missing tests or error handling

Verdict: `approve` | `approve-with-nits` | `request-changes`

**Options:** Same as `summarise` above.

---

### `hh run diff [base] [head]`

Capture a `git diff` and send it to H2 for review.

```
hh run diff                          # git diff HEAD (working tree + staged)
hh run diff main                     # git diff main
hh run diff main feature/my-branch   # git diff main..feature/my-branch
hh run diff HEAD~3 HEAD --peer glados --wait --stat
```

The diff is embedded directly in the task (no attachment).
`--stat` prints the diff stat locally before sending.

**Options:** Same as `summarise` + `--stat`.

---

### `hh run alias <name> [args...]`

Expand and execute a user-defined alias with optional extra arguments.

```
hh run alias pr-review
hh run alias deploy --wait
```

Equivalent to `hh alias run <name>`. See [`hh alias`](./alias.md).

---

## Examples

```bash
# Summarise a design doc, then review the implementation
hh run summarise ./docs/design.md --wait
hh run review ./src/gateway.ts --wait

# Review a PR diff
git fetch origin
hh run diff main origin/feature/my-pr --peer glados --wait

# Diff with stat preview
hh run diff HEAD~1 HEAD --stat --wait
```

---

## See Also

- [`hh send`](./send.md) — low-level task dispatch
- [`hh alias`](./alias.md) — user-defined shortcuts
- [`hh workflow`](./workflow.md) — saved multi-step pipelines
