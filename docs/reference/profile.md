# hh profile — Named Config Profiles

> **Phase 10a** — Switch between multiple his-and-hers setups (home/work, dev/prod, etc.)

Users who work with multiple environments often need different node configurations. Named profiles let you maintain separate configs and switch between them instantly.

## Usage

```bash
# List all profiles (active marked with ★)
hh profile list
hh profile list --json

# Switch to a different profile
hh profile use <name>

# Create a new profile
hh profile create <name>                 # blank profile
hh profile create <name> --from existing # copy from existing

# View profile config (masks gateway tokens)
hh profile show                 # show active profile
hh profile show <name>          # show named profile
hh profile show --json          # machine-readable output

# Delete a profile
hh profile delete <name>        # refuses if active
hh profile delete <name> --force # force delete even if active
```

## Storage

Profiles are stored in `~/.his-and-hers/profiles/` as `<name>.json` files.

The active profile is tracked in `~/.his-and-hers/active-profile.json`:

```json
{
  "active": "work"
}
```

## Priority Order

When loading config, `hh` checks:

1. **`HH_PROFILE` env var** — Override for the current shell session
2. **`~/.his-and-hers/active-profile.json`** — Persistent active profile
3. **`default`** — Backward compat with `~/.his-and-hers/hh.json`

## Environment Variable Override

Set `HH_PROFILE` to temporarily use a different profile without changing the active selection:

```bash
# Use "dev" profile for this command only
HH_PROFILE=dev hh send "Run integration tests"

# Use "prod" profile for an entire session
export HH_PROFILE=prod
hh send "Deploy latest build"
hh logs --limit 10
```

This is useful for:
- CI/CD pipelines (different config per environment)
- Multi-account setups (personal vs. work)
- Testing new configurations without switching globally

## Examples

### Create a work profile

```bash
# Start from scratch
hh profile create work

# Or copy from your existing default setup
hh profile create work --from default
```

### Switch between home and work

```bash
# At the office
hh profile use work
hh send "Review PR #123"

# At home
hh profile use home
hh send "Train the image model overnight"
```

### Check which profile is active

```bash
hh profile list
```

Output:
```
  default
★ work
  home
```

### Inspect a profile's config

```bash
hh profile show work
```

Gateway tokens are automatically masked in the output:
```json
{
  "peer_node": {
    "gateway_token": "***MASKED***"
  }
}
```

### Delete an old profile

```bash
hh profile delete old-setup
```

If you try to delete the active profile, you'll get an error:
```
Cannot delete active profile work
Switch to another profile first, or use --force
```

## Backward Compatibility

If you've been using `~/.his-and-hers/hh.json` before profiles were added:

- It's automatically treated as the `default` profile
- When you switch to a different profile, the old `hh.json` remains untouched
- You can migrate by running:
  ```bash
  hh profile create work --from default
  hh profile use work
  ```

## JSON Output

All `hh profile` commands support `--json` for scripting and automation:

```bash
hh profile list --json
hh profile show work --json
```

Example:
```json
{
  "profiles": ["default", "work", "home"],
  "active": "work"
}
```
