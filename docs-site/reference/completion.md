# `cofounder completion`

Print a shell completion script to stdout. Source it once to get tab completion for all `cofounder` commands, subcommands, and flags.

## Synopsis

```
cofounder completion [shell] [options]
```

| Argument | Description |
|----------|-------------|
| `shell`  | Target shell: `bash`, `zsh`, `fish`, or `powershell`. Auto-detected from `$SHELL` if omitted. |

## Options

| Flag | Description |
|------|-------------|
| `--no-hint` | Suppress the install hint written to stderr |

## Supported Shells

| Shell | Install method |
|-------|---------------|
| bash | `eval "$(cofounder completion bash)"` |
| zsh | `eval "$(cofounder completion zsh)"` |
| fish | `cofounder completion fish \| source` |
| PowerShell | `cofounder completion powershell \| Out-String \| Invoke-Expression` |

## Quickstart

### bash

```bash
# Temporary (current session)
eval "$(cofounder completion bash)"

# Permanent — add to ~/.bashrc or ~/.bash_profile
echo 'eval "$(cofounder completion bash)"' >> ~/.bashrc
source ~/.bashrc
```

### zsh

```zsh
# Temporary (current session)
eval "$(cofounder completion zsh)"

# Permanent — add to ~/.zshrc
echo 'eval "$(cofounder completion zsh)"' >> ~/.zshrc
source ~/.zshrc
```

### fish

```fish
# Temporary (current session)
cofounder completion fish | source

# Permanent — save to completions directory
cofounder completion fish > ~/.config/fish/completions/cofounder.fish
```

### PowerShell

```powershell
# Temporary (current session)
cofounder completion powershell | Out-String | Invoke-Expression

# Permanent — add to your $PROFILE
Add-Content $PROFILE "`ncofounder completion powershell | Out-String | Invoke-Expression"
```

## What Gets Completed

Once installed, pressing <kbd>Tab</kbd> after `cofounder` completes:

- **Top-level subcommands** — `send`, `status`, `doctor`, `schedule`, etc.
- **Sub-subcommands** — `cofounder capabilities <Tab>` → `scan`, `advertise`, `fetch`, `show`, `route`
- **Flags** — `cofounder send --<Tab>` → `--peer`, `--wait`, `--timeout`, `--notify`, …
- **Per-command context** — flags only show for the subcommand they apply to

### Example session

```
$ cofounder <Tab>
onboard  pair     status   wake     send     replay   cancel   result
heartbeat  task-status  doctor  budget  capabilities  peers  discover
logs     config   test    upgrade  monitor  watch    schedule  notify
chat     prune    export  completion

$ cofounder send --<Tab>
--peer  --wait  --timeout  --auto  --latent  --auto-latent  --notify  --max-retries  --dry-run

$ cofounder schedule <Tab>
add  list  remove  enable  disable  run
```

## Auto-detection

If you omit the shell argument, `cofounder completion` reads `$SHELL` and infers:

| `$SHELL` value | Inferred shell |
|----------------|----------------|
| `/bin/bash` | bash |
| `/bin/zsh` | zsh |
| `/usr/bin/fish` | fish |
| *(Windows / no `$SHELL`)* | powershell |

If detection fails, an error is printed and the command exits with code 1.

## Keeping completions up to date

Completions are embedded in the binary — no network access required. When you upgrade `cofounder`, re-run the install command to pick up new subcommands and flags:

```bash
# bash — re-evaluate to pick up changes
eval "$(cofounder completion bash)"
```

Or re-run `cofounder upgrade` and re-source your shell config.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Script printed successfully |
| `1` | Unknown shell or detection failed |

## See also

- [`cofounder upgrade`](/reference/upgrade) — keep `cofounder` up to date
- [`cofounder config`](/reference/config) — read and write configuration values
- [`cofounder doctor`](/reference/doctor) — diagnose connectivity issues
