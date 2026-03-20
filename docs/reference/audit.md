# cofounder audit — Tamper-Evident Audit Log

> **Phase 10b** — Append-only HMAC audit log for task send/receive events

Every `cofounder send`, task reception, and task completion creates an entry in the audit log. Each entry is chained via SHA-256 hashes to detect tampering.

## Usage

```bash
# List recent audit entries
cofounder audit list
cofounder audit list --limit 50
cofounder audit list --peer glados
cofounder audit list --since 7d
cofounder audit list --json

# Verify chain integrity
cofounder audit verify

# Export full log
cofounder audit export
cofounder audit export --csv
cofounder audit export --output audit.json
```

## Storage

Audit log is stored at `~/.cofounder/audit.log` as newline-delimited JSON (one entry per line).

A per-install HMAC key is generated at `~/.cofounder/audit-key` (32-byte hex string) on first use.

## Entry Format

Each audit entry contains:

```json
{
  "ts": "2024-01-15T12:34:56.789Z",
  "seq": 1,
  "event": "task_sent",
  "peer": "glados",
  "task_id": "abc123",
  "objective": "Run integration tests",
  "status": "completed",
  "cost_usd": 0.05,
  "prev_hash": "genesis",
  "hash": "a1b2c3..."
}
```

Fields:
- **ts** — ISO 8601 timestamp
- **seq** — Sequence number (1-based, monotonic)
- **event** — One of: `task_sent`, `task_received`, `task_completed`
- **peer** — Peer node name
- **task_id** — Task ID
- **objective** — Task objective text
- **status** — Task status (for `task_completed` events)
- **cost_usd** — Task cost in USD (for `task_completed` events)
- **prev_hash** — SHA-256 of previous entry (or `"genesis"` for first entry)
- **hash** — SHA-256 of this entry (without `hash` field) concatenated with `prev_hash`

## Chain Verification

The audit log uses a hash chain to detect tampering:

1. First entry has `prev_hash: "genesis"`
2. Each subsequent entry's `prev_hash` equals the previous entry's `hash`
3. Each entry's `hash` is computed as: `SHA-256(JSON(entry without hash) + prev_hash)`

To verify integrity:

```bash
cofounder audit verify
```

Output on success:
```
✓ Audit chain is valid.
All 127 entries verified successfully.
```

Output on tampering:
```
✗ Audit chain is broken!
Chain integrity failed at sequence 42
```

## Examples

### View recent activity

```bash
cofounder audit list --limit 10
```

Output:
```
   1 task_sent       glados       abc12345 Run integration tests
   2 task_received   glados       abc12345 Run integration tests
   3 task_completed  glados       abc12345 Run integration tests
       status: completed
       cost: $0.050
```

### Filter by peer

```bash
cofounder audit list --peer glados
```

### Last 7 days

```bash
cofounder audit list --since 7d
```

Duration formats:
- `30m` — last 30 minutes
- `24h` — last 24 hours
- `7d` — last 7 days

### Export to CSV

```bash
cofounder audit export --csv --output audit.csv
```

CSV format:
```csv
seq,ts,event,peer,task_id,objective,status,cost_usd,prev_hash,hash
1,2024-01-15T12:34:56.789Z,task_sent,glados,abc123,"Run tests",,,"genesis",a1b2c3...
2,2024-01-15T12:35:10.123Z,task_completed,glados,abc123,"Run tests",completed,0.05,a1b2c3...,d4e5f6...
```

### Machine-readable JSON

```bash
cofounder audit list --json
```

Returns an array of entry objects:
```json
[
  {
    "ts": "2024-01-15T12:34:56.789Z",
    "seq": 1,
    "event": "task_sent",
    "peer": "glados",
    "task_id": "abc123",
    "objective": "Run tests",
    "prev_hash": "genesis",
    "hash": "a1b2c3..."
  }
]
```

## Integration with cofounder send

Audit entries are automatically created:

- **task_sent** — When `cofounder send` dispatches a task
- **task_received** — When `cofounder watch` (H2) receives a task
- **task_completed** — When `cofounder result` (H2) reports completion

No manual action required — the audit log is populated automatically.

## Security Model

**What the audit log protects against:**

- **Tampering** — Any modification to a past entry breaks the hash chain
- **Deletion** — Missing entries break the sequence numbers
- **Insertion** — New entries can't be inserted without rehashing the entire chain

**What it doesn't protect against:**

- **Full log deletion** — If `~/.cofounder/audit.log` is deleted, the chain starts fresh
- **Concurrent writes** — The log is append-only but not lock-protected for multi-process writes
- **Replay attacks** — The log records events but doesn't prevent re-sending identical tasks

## Compliance Use Cases

The audit log is useful for:

- **Task history tracking** — Permanent record of all delegated work
- **Cost accounting** — Sum `cost_usd` across entries for billing
- **Security audits** — Detect unauthorized task submissions
- **Debugging** — Trace task lifecycle (sent → received → completed)

## Export for External Analysis

Export the full log and analyze with standard tools:

```bash
# Export as JSON
cofounder audit export --output audit.json

# Parse with jq
jq '.[] | select(.event == "task_completed") | .cost_usd' audit.json | \
  awk '{sum+=$1} END {print "Total cost: $"sum}'

# Export as CSV and analyze with Excel/pandas
cofounder audit export --csv --output audit.csv
```
