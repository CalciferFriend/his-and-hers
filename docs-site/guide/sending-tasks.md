# Sending Tasks

`tj send` is how you delegate work to Jerry. Everything else in his-and-hers exists to make `tj send` work reliably.

---

## Basic usage

```bash
tj send "summarize this week's meeting notes"
tj send "write unit tests for the auth module"
tj send "generate a product image, dark background, minimal"
```

Each call:
1. Checks if Jerry is reachable
2. Sends a WOL magic packet if Jerry is asleep (and waits)
3. Builds a `HHMessage` and POSTs it to Jerry's gateway
4. Assigns a task ID (e.g. `task_01j8fzq7r4`)
5. Returns immediately (unless `--wait` is passed)

---

## Task IDs

Every task gets a unique ID. You'll see it in the output:

```bash
$ tj send "extract action items from report.pdf" --attach report.pdf
→ Task dispatched: task_01j8fzq7r4
  Jerry: GLaDOS (100.x.y.z)
  Status: queued
```

Use the task ID to check status or retrieve results later:

```bash
tj logs | grep task_01j8fzq7r4
tj logs --task task_01j8fzq7r4
```

---

## `--wait` flag

By default, `tj send` returns immediately after dispatching. Use `--wait` to block until Jerry finishes and print the result:

```bash
tj send "what is 1 + 1" --wait
# → 2

tj send "write a haiku about distributed systems" --wait
# → Packets travel far,
#    Through nodes that never quite meet—
#    Latency blooms soft.

tj send "summarize the attached doc" --attach report.pdf --wait --timeout 120
```

`--wait` polls Jerry's task state every 2 seconds. The result is printed to stdout when `done: true` arrives.

---

## Flags reference

| Flag | Default | Description |
|------|---------|-------------|
| `--wait` | false | Block until result received |
| `--peer <name>` | auto | Target a specific Jerry by name |
| `--timeout <s>` | 300 | Max seconds to wait in `--wait` mode |
| `--attach <path>` | — | Attach a file (PDF, image, text) |
| `--no-wol` | false | Don't wake Jerry if offline — fail fast |
| `--context <text>` | auto | Override context summary sent with task |
| `--json` | false | Output task ID and status as JSON |

---

## Targeting a specific peer

If you have multiple Jerry nodes:

```bash
tj send "70B inference task" --peer jerry-beast
tj send "embed this document" --peer jerry-pi
tj send "generate an image" --peer jerry-home
```

Use `tj peers` to see available peers and their status:

```bash
tj peers
# → jerry-home     RTX 3070 Ti   ✓ online   ollama:3 models
# → jerry-pi       Raspberry Pi  ✓ online   ollama:2 models
# → jerry-beast    RTX 4090      ✗ offline  (WOL configured)
```

Without `--peer`, Tom uses capability-based routing to pick the best available Jerry. See [Capability routing](/guide/capabilities).

---

## Attaching files

```bash
tj send "summarize this PDF" --attach ~/Documents/report.pdf
tj send "what's in this image?" --attach screenshot.png
tj send "review this code" --attach src/auth.ts
```

Attached files are read locally and included in the task payload. Large files (> 10 MB) are chunked automatically.

---

## Monitoring tasks

### Live log tail

```bash
tj logs --follow
```

Output while a task is running:

```
[12:34:01] task_01j8fzq7r4  queued    → jerry-home
[12:34:02] task_01j8fzq7r4  running   Jerry received task
[12:34:08] task_01j8fzq7r4  running   Jerry: processing...
[12:34:23] task_01j8fzq7r4  complete  21.4s · $0.00 local
```

### Check a specific task

```bash
tj logs --task task_01j8fzq7r4
tj logs --task task_01j8fzq7r4 --output   # include result text
```

### All recent tasks

```bash
tj logs                  # last 20 tasks
tj logs --limit 50
tj logs --since 24h
tj logs --status failed  # only failed tasks
```

---

## Task states

| State | Meaning |
|-------|---------|
| `queued` | Dispatched, waiting for Jerry to pick up |
| `running` | Jerry is executing the task |
| `complete` | Done, result available |
| `failed` | Error — see logs for details |
| `timeout` | Exceeded `--timeout` without completion |
| `wol-pending` | Waiting for Jerry to boot |

---

## Example: agentic workflow

Tasks can be chained from agent workflows. Tom's OpenClaw agent can call `tj send` directly:

```typescript
// Inside an OpenClaw agent skill
const result = await sendToJerry({
  task: "generate a product image for: " + productDescription,
  peer: "jerry-home",  // RTX 3070 Ti — good for SDXL
  waitForResult: true
});

// result.output contains Jerry's response
console.log(result.output);  // → "/results/task_01j8.../output.png"
```

Or from the shell inside an agent:

```bash
RESULT=$(tj send "compress this log file" --attach app.log --wait --json)
echo $RESULT | jq .output
```

---

## WOL behavior during send

If Jerry is offline:

```bash
$ tj send "render a video thumbnail" --peer jerry-beast
→ Jerry (jerry-beast) is offline — sending magic packet
  MAC: D8:5E:D3:04:18:B4 → 192.168.1.1:9
→ Waiting for Jerry to boot... (0/60)
→ Waiting for Jerry to boot... (7/60)
→ Tailscale reachable — checking gateway health
→ Gateway healthy — dispatching task
→ Task dispatched: task_01j8fzq8a2
```

Total wait from offline Jerry: typically 30–90 seconds (depending on hardware boot time).

To prevent automatic WOL:

```bash
tj send "quick task" --no-wol
# → Error: jerry-beast is offline and --no-wol is set
```
