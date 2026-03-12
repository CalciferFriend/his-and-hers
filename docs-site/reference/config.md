# `tj config`

View and manage your TJ configuration from the CLI.

The config file lives at `~/.his-and-hers/tj.json` and holds all node settings
(names, IPs, ports, roles, etc.). **Sensitive secrets** — API keys and gateway
tokens — are **never stored here**; they live in the OS keychain (Keychain Access
on macOS, `secret-tool` / `libsecret` on Linux, Credential Manager on Windows).

---

## Subcommands

| Subcommand | Description |
|---|---|
| `tj config show` | Pretty-print the entire config. Sensitive fields are redacted. |
| `tj config get <key>` | Read a single key (dot-notation path supported). |
| `tj config set <key> <value>` | Write a key with automatic type coercion. |
| `tj config path` | Print the raw config file path (machine-readable, no decoration). |

Running `tj config` with no subcommand is the same as `tj config show`.

---

## Examples

### Show the current config

```bash
tj config show
```

Output (secrets are redacted):

```
◆ TJ Configuration — /home/nic/.his-and-hers/tj.json

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
tj config get this_node

# Dot-notation for nested fields
tj config get this_node.name
tj config get peer_node.tailscale_ip
```

Returns the raw value (plain string/number/bool) or pretty-printed JSON for objects.

---

### Set a value

```bash
# String
tj config set this_node.name "my-calcifer"

# Boolean (auto-coerced)
tj config set peer_node.wol_enabled true

# Number (auto-coerced)
tj config set peer_node.gateway_port 18789

# Nested object (JSON)
tj config set peer_node.wol '{"enabled":true,"mac":"AA:BB:CC:DD:EE:FF"}'
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
tj config path
# /home/nic/.his-and-hers/tj.json
```

Useful for piping into editors or scripts:

```bash
$EDITOR "$(tj config path)"
```

---

## About secrets

API keys (Anthropic, OpenAI, etc.) and gateway tokens are **never stored in
`tj.json`**. They are loaded at runtime from the OS keychain:

- **macOS** — Keychain Access (`security` CLI)
- **Linux** — `libsecret` / `secret-tool`
- **Windows** — Windows Credential Manager (`cmdkey`)

To update a secret, run `tj onboard` (full wizard) or manually update the
relevant keychain entry. The `gateway_token` field shown as `[redacted]` in
`tj config show` is the runtime-loaded value, not a stored secret.
