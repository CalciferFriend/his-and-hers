# `hh config`

View and manage your HH configuration from the CLI.

The config file lives at `~/.his-and-hers/hh.json` and holds all node settings
(names, IPs, ports, roles, etc.). **Sensitive secrets** — API keys and gateway
tokens — are **never stored here**; they live in the OS keychain (Keychain Access
on macOS, `secret-tool` / `libsecret` on Linux, Credential Manager on Windows).

---

## Subcommands

| Subcommand | Description |
|---|---|
| `hh config show` | Pretty-print the entire config. Sensitive fields are redacted. |
| `hh config get <key>` | Read a single key (dot-notation path supported). |
| `hh config set <key> <value>` | Write a key with automatic type coercion. |
| `hh config path` | Print the raw config file path (machine-readable, no decoration). |

Running `hh config` with no subcommand is the same as `hh config show`.

---

## Examples

### Show the current config

```bash
hh config show
```

Output (secrets are redacted):

```
◆ HH Configuration — /home/nic/.his-and-hers/hh.json

{
  "this_node": {
    "role": "tom",
    "name": "calcifer",
    ...
  },
  "peer_node": {
    "gateway_token": [redacted],
    ...
  }
}

◇ Secrets are redacted above. Keys live in the OS keychain.
```

---

### Get a single value

```bash
# Top-level key
hh config get this_node

# Dot-notation for nested fields
hh config get this_node.name
hh config get peer_node.tailscale_ip
```

Returns the raw value (plain string/number/bool) or pretty-printed JSON for objects.

---

### Set a value

```bash
# String
hh config set this_node.name "my-calcifer"

# Boolean (auto-coerced)
hh config set peer_node.wol_enabled true

# Number (auto-coerced)
hh config set peer_node.gateway_port 18789

# Nested object (JSON)
hh config set peer_node.wol '{"enabled":true,"mac":"AA:BB:CC:DD:EE:FF"}'
```

**Auto-coercion rules:**

| Input string | Coerced type |
|---|---|
| `"true"` / `"false"` | `boolean` |
| `"42"`, `"3.14"` | `number` |
| `'{"a":1}'`, `'["x","y"]'` | parsed JSON object/array |
| anything else | `string` |

---

### Print the config file path

```bash
hh config path
# /home/nic/.his-and-hers/hh.json
```

Useful for piping into editors or scripts:

```bash
$EDITOR "$(hh config path)"
```

---

## About secrets

API keys (Anthropic, OpenAI, etc.) and gateway tokens are **never stored in
`hh.json`**. They are loaded at runtime from the OS keychain:

- **macOS** — Keychain Access (`security` CLI)
- **Linux** — `libsecret` / `secret-tool`
- **Windows** — Windows Credential Manager (`cmdkey`)

To update a secret, run `hh onboard` (full wizard) or manually update the
relevant keychain entry. The `gateway_token` field shown as `[redacted]` in
`hh config show` is the runtime-loaded value, not a stored secret.
