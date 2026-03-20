# `cofounder upgrade`

Check for newer versions of `cofounder` on npm and print upgrade instructions if one is available.

## Usage

```bash
cofounder upgrade
cofounder upgrade --check
cofounder upgrade --json
```

## Flags

| Flag | Description |
|------|-------------|
| `--check` | Exit 0 if up to date, exit 1 if an upgrade is available (CI-friendly) |
| `--json` | Machine-readable JSON output |

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Already on the latest version (or `--check` confirms up to date) |
| `1` | An upgrade is available (`--check` mode) |

## Environment

| Variable | Effect |
|----------|--------|
| `NO_UPDATE_NOTIFIER` | Set to any value to suppress update checks (follows standard convention) |

## Examples

```bash
# Interactive check with upgrade instructions
cofounder upgrade

# Scripted check — useful in CI or cron
cofounder upgrade --check && echo "up to date" || echo "upgrade available"

# JSON output for automation
cofounder upgrade --json
# → { "current": "0.1.0", "latest": "0.2.0", "upgrade_available": true }
```

## Notes

- Checks the public npm registry (`registry.npmjs.org`) — requires internet access.
- Respects `NO_UPDATE_NOTIFIER` env var (same convention as `update-notifier`).
- The upgrade command only checks; it never modifies your installation. Run the printed npm/pnpm command yourself.

## See also

- [Installation guide](/guide/install-linux) — initial setup
- [`cofounder doctor`](/reference/doctor) — full health diagnostics
