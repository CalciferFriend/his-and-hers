# cofounder profile — Named Config Profiles

> **Phase 10a** — Switch between multiple cofounder setups (home/work, dev/prod, etc.)

Users who work with multiple environments often need different node configurations. Named profiles let you maintain separate configs and switch between them instantly.

## Usage

```bash
# List all profiles (active marked with ★)
cofounder profile list
cofounder profile list --json

# Switch to a different profile
cofounder profile use <name>

# Create a new profile
cofounder profile create <name>                 # blank profile
cofounder profile create <name> --from existing # copy from existing

# View profile config (masks gateway tokens)
cofounder profile show                 # show active profile
cofounder profile show <name>          # show named profile
cofounder profile show --json          # machine-readable output

# Delete a profile
cofounder profile delete <name>        # refuses if active
cofounder profile delete <name> --force # force delete even if active
```

## Storage

Profiles are stored in `~/.cofounder/profiles/` as `<name>.json` files.

The active profile is tracked in `~/.cofounder/active-profile.json`:

```json
{
  "active": "work"
}
```

## Priority Order

When loading config, `cofounder` checks:

1. **`HH_PROFILE` env var** — Override for the current shell session
2. **`~/.cofounder/active-profile.json`** — Persistent active profile
3. **`default`** — Backward compat with `~/.cofounder/cofounder.json`

## Environment Variable Override

Set `HH_PROFILE` to temporarily use a different profile without changing the active selection:

```bash
# Use "dev" profile for this command only
HH_PROFILE=dev cofounder send "Run integration tests"

# Use "prod" profile for an entire session
export HH_PROFILE=prod
cofounder send "Deploy latest build"
cofounder logs --limit 10
```

This is useful for:
- CI/CD pipelines (different config per environment)
- Multi-account setups (personal vs. work)
- Testing new configurations without switching globally

## Examples

### Create a work profile

```bash
# Start from scratch
cofounder profile create work

# Or copy from your existing default setup
cofounder profile create work --from default
```

### Switch between home and work

```bash
# At the office
cofounder profile use work
cofounder send "Review PR #123"

# At home
cofounder profile use home
cofounder send "Train the image model overnight"
```

### Check which profile is active

```bash
cofounder profile list
```

Output:
```
  default
★ work
  home
```

### Inspect a profile's config

```bash
cofounder profile show work
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
cofounder profile delete old-setup
```

If you try to delete the active profile, you'll get an error:
```
Cannot delete active profile work
Switch to another profile first, or use --force
```

## Backward Compatibility

If you've been using `~/.cofounder/cofounder.json` before profiles were added:

- It's automatically treated as the `default` profile
- When you switch to a different profile, the old `cofounder.json` remains untouched
- You can migrate by running:
  ```bash
  cofounder profile create work --from default
  cofounder profile use work
  ```

## JSON Output

All `cofounder profile` commands support `--json` for scripting and automation:

```bash
cofounder profile list --json
cofounder profile show work --json
```

Example:
```json
{
  "profiles": ["default", "work", "home"],
  "active": "work"
}
```
