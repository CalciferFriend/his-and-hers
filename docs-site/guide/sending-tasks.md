# Sending Tasks

`hh send` is how you delegate work to H2. Everything else in his-and-hers exists to make `hh send` work reliably.

---

## Basic usage

```bash
hh send "summarize this week's meeting notes"
hh send "write unit tests for the auth module"
hh send "generate a product image, dark background, minimal"
```

Each call:
1. Checks if H2 is reachable
2. Sends a WOL magic packet if H2 is asleep (and waits)
3. Builds a `HHMessage` and POSTs it to H2's gateway
4. Assigns a task ID (e.g. `task_01j8fzq7r4`)
5. Returns immediately (unless `--wait` is passed)

---

## Task IDs

Every task gets a unique ID. You'll see it in the output:

```bash
$ hh send "extract action items from report.pdf" --attach report.pdf
→ Task dispatched: task_01j8fzq7r4
  H2: GLaDOS (100.x.y.z)
  Status: queued
```

Use the task ID to check status or retrieve results later:

```bash
hh logs | grep task_01j8fzq7r4
hh logs --task task_01j8fzq7r4
```

---

## `--wait` flag

By default, `hh send` returns immediately after dispatching. Use `--wait` to block until H2 finishes and print the result:

```bash
hh send "what is 1 + 1" --wait
# → 2

hh send "write a haiku about distributed systems" --wait
# → Packets travel far,
#    Through nodes that never quite meet—
#    Latency blooms soft.

hh send "summarize the attached doc" --attach report.pdf --wait --timeout 120
```

`--wait` polls H2's task state every 2 seconds. The result is printed to stdout when `done: true` arrives.

---

## Flags reference

| Flag | Default | Description |
|------|---------|-------------|
| `--wait` | false | Block until result received |
| `--peer <name>` | auto | Target a specific H2 by name |
| `--timeout <s>` | 300 | Max seconds to wait in `--wait` mode |
| `--attach <path>` | — | Attach a file (PDF, image, text) |
| `--no-wol` | false | Don't wake H2 if offline — fail fast |
| `--context <text>` | auto | Override context summary sent with task |
| `--json` | false | Output task ID and status as JSON |

---

## Targeting a specific peer

If you have multiple H2 nodes:

```bash
hh send "70B inference task" --peer h2-beast
hh send "embed this document" --peer h2-pi
hh send "generate an image" --peer h2-home
```

Use `hh peers` to see available peers and their status:

```bash
hh peers
# → h2-home     RTX 3070 Ti   ✓ online   ollama:3 models
# → h2-pi       Raspberry Pi  ✓ online   ollama:2 models
# → h2-beast    RTX 4090      ✗ offline  (WOL configured)
```

Without `--peer`, H1 uses capability-based routing to pick the best available H2. See [Capability routing](/guide/capabilities).

---

## Attaching files

```bash
hh send "summarize this PDF" --attach ~/Documents/report.pdf
hh send "what's in this image?" --attach screenshot.png
hh send "review this code" --attach src/auth.ts
```

Attached files are read locally and included in the task payload. Large files (> 10 MB) are chunked automatically.

---

## Monitoring tasks

### Live log tail

```bash
hh logs --follow
```

Output while a task is running:

```
[12:34:01] task_01j8fzq7r4  queued    → h2-home
[12:34:02] task_01j8fzq7r4  running   H2 received task
[12:34:08] task_01j8fzq7r4  running   H2: processing...
[12:34:23] task_01j8fzq7r4  complete  21.4s · $0.00 local
```

### Check a specific task

```bash
hh logs --task task_01j8fzq7r4
hh logs --task task_01j8fzq7r4 --output   # include result text
```

### All recent tasks

```bash
hh logs                  # last 20 tasks
hh logs --limit 50
hh logs --since 24h
hh logs --status failed  # only failed tasks
```

---

## Task states

| State | Meaning |
|-------|---------|
| `queued` | Dispatched, waiting for H2 to pick up |
| `running` | H2 is executing the task |
| `complete` | Done, result available |
| `failed` | Error — see logs for details |
| `timeout` | Exceeded `--timeout` without completion |
| `wol-pending` | Waiting for H2 to boot |

---

## Example: agentic workflow

Tasks can be chained from agent workflows. H1's OpenClaw agent can call `hh send` directly:

```typescript
// Inside an OpenClaw agent skill
const result = await sendToJerry({
  task: "generate a product image for: " + productDescription,
  peer: "h2-home",  // RTX 3070 Ti — good for SDXL
  waitForResult: true
});

// result.output contains H2's response
console.log(result.output);  // → "/results/task_01j8.../output.png"
```

Or from the shell inside an agent:

```bash
RESULT=$(hh send "compress this log file" --attach app.log --wait --json)
echo $RESULT | jq .output
```

---

## WOL behavior during send

If H2 is offline:

```bash
$ hh send "render a video thumbnail" --peer h2-beast
→ H2 (h2-beast) is offline — sending magic packet
  MAC: D8:5E:D3:04:18:B4 → 192.168.1.1:9
→ Waiting for H2 to boot... (0/60)
→ Waiting for H2 to boot... (7/60)
→ Tailscale reachable — checking gateway health
→ Gateway healthy — dispatching task
→ Task dispatched: task_01j8fzq8a2
```

Total wait from offline H2: typically 30–90 seconds (depending on hardware boot time).

To prevent automatic WOL:

```bash
hh send "quick task" --no-wol
# → Error: h2-beast is offline and --no-wol is set
```
