/**
 * commands/completion.ts — `hh completion`
 *
 * Print a shell completion script to stdout, then source it to get tab
 * completion for all `hh` commands and their flags.
 *
 * Supported shells:
 *   bash        — eval "$(hh completion bash)"
 *   zsh         — eval "$(hh completion zsh)"
 *   fish        — hh completion fish | source
 *   powershell  — hh completion powershell | Out-String | Invoke-Expression
 *
 * Usage:
 *   hh completion bash
 *   hh completion zsh
 *   hh completion fish
 *   hh completion powershell
 *   hh completion          # auto-detect current shell
 */

import pc from "picocolors";

// ─── Command registry ─────────────────────────────────────────────────────────
// Keep in sync with index.ts. Grouped by logical category for easy maintenance.

export interface CompletionCommand {
  name: string;
  description: string;
  subcommands?: string[];
  flags?: string[];
}

export const COMMANDS: CompletionCommand[] = [
  // Core workflow
  { name: "onboard", description: "Run the setup wizard" },
  { name: "pair", description: "Pair with a remote node", flags: ["--code"] },
  { name: "status", description: "Show both nodes and connectivity" },
  { name: "wake", description: "Wake a peer node via WOL or gateway ping", flags: ["--peer", "--wait", "--timeout"] },
  {
    name: "send",
    description: "Send a task to the peer node",
    flags: [
      "--peer",
      "--wait",
      "--timeout",
      "--auto",
      "--latent",
      "--auto-latent",
      "--notify",
      "--max-retries",
      "--dry-run",
    ],
  },
  {
    name: "replay",
    description: "Re-send a previous task by ID",
    flags: ["--peer", "--wait", "--timeout", "--notify", "--dry-run"],
  },
  { name: "cancel", description: "Cancel a pending or running task", flags: ["--force", "--all-pending"] },
  {
    name: "result",
    description: "Deliver a task result from H2 back to H1",
    flags: ["--task-id", "--output", "--status", "--cost", "--tokens"],
  },
  { name: "heartbeat", description: "Send or check a heartbeat", subcommands: ["send", "check", "schedule"] },
  { name: "task-status", description: "Show status of a task by ID", flags: ["--json"] },

  // Monitoring & diagnostics
  {
    name: "monitor",
    description: "Live TUI dashboard for both nodes",
    flags: ["--peer", "--interval", "--json", "--no-color"],
  },
  {
    name: "logs",
    description: "View task history",
    flags: ["--status", "--peer", "--since", "--limit", "--output", "--follow", "--json"],
  },
  {
    name: "doctor",
    description: "Run health diagnostics",
    flags: ["--peer", "--json"],
  },
  { name: "test", description: "Run connectivity tests", flags: ["--peer", "--json"] },
  { name: "status", description: "Show live node status" },

  // Budget & capabilities
  {
    name: "budget",
    description: "Show token and cost usage",
    flags: ["--today", "--week", "--month", "--all", "--tasks", "--json"],
  },
  {
    name: "capabilities",
    description: "Manage node capability registry",
    subcommands: ["scan", "advertise", "fetch", "show", "route"],
    flags: ["--quiet", "--json", "--peer", "--task"],
  },

  // Peer management
  { name: "peers", description: "List configured peer nodes", flags: ["--ping", "--json"] },
  {
    name: "discover",
    description: "Browse community nodes",
    flags: ["--gpu", "--skill", "--provider", "--os", "--json"],
  },
  { name: "publish", description: "Publish your node card to the community registry", flags: ["--dry-run"] },

  // Scheduling & automation
  {
    name: "schedule",
    description: "Manage recurring task delegations",
    subcommands: ["add", "list", "remove", "enable", "disable", "run"],
    flags: ["--cron", "--peer", "--json"],
  },
  {
    name: "notify",
    description: "Manage persistent notification webhooks",
    subcommands: ["add", "list", "remove", "test"],
    flags: ["--name", "--on"],
  },

  // Chat & interactive
  {
    name: "chat",
    description: "Interactive multi-turn session with the peer node",
    flags: ["--peer", "--no-context", "--timeout"],
  },

  // Data management
  {
    name: "template",
    description: "Manage named task templates with {variable} substitution",
    subcommands: ["add", "list", "show", "run", "remove"],
    flags: ["--task", "--peer", "--timeout", "--notify", "--desc", "--var", "--wait", "--force", "--json"],
  },
  {
    name: "export",
    description: "Export task history to markdown, CSV, or JSON",
    flags: ["--format", "--out", "--since", "--status", "--peer", "--no-output"],
  },
  {
    name: "prune",
    description: "Clean up stale task state and logs",
    flags: ["--older-than", "--status", "--include-retry", "--include-logs", "--dry-run", "--json", "--force"],
  },

  // Configuration
  {
    name: "config",
    description: "Read and write configuration values",
    subcommands: ["show", "get", "set", "path"],
    flags: ["--json"],
  },
  { name: "upgrade", description: "Check for and install upgrades", flags: ["--check", "--json"] },

  // Local web dashboard
  { name: "web", description: "Launch local web dashboard (task feed, peer status, send form)", flags: ["--port", "--no-open"] },
  // Broadcast
  { name: "broadcast", description: "Send the same task to multiple peer nodes concurrently", flags: ["--peers", "--wait", "--wait-timeout", "--strategy", "--no-check", "--json"] },

  // Shell completion
  { name: "completion", description: "Print shell completion script", flags: [] },

  // Saved pipeline workflows
  {
    name: "workflow",
    description: "Manage saved named pipeline workflows",
    subcommands: ["add", "list", "show", "run", "remove"],
    flags: ["--file", "--desc", "--timeout", "--force", "--json"],
  },
];

// ─── Shell script generators ──────────────────────────────────────────────────

/** Flattened list of all top-level command names */
function topLevelNames(): string[] {
  return [...new Set(COMMANDS.map((c) => c.name))];
}

/**
 * Bash completion script.
 * Handles top-level subcommand completion + flag completion per subcommand.
 */
export function generateBash(): string {
  const subcmds = topLevelNames().join(" ");

  // Per-command flag maps
  const caseEntries = COMMANDS.filter((c) => (c.flags ?? []).length > 0 || (c.subcommands ?? []).length > 0)
    .map((c) => {
      const subs = (c.subcommands ?? []).join(" ");
      const flags = (c.flags ?? []).join(" ");
      const words = [subs, flags].filter(Boolean).join(" ");
      return `      ${c.name})\n        COMPREPLY=( $(compgen -W "${words}" -- "$cur") )\n        return 0\n        ;;`;
    })
    .join("\n");

  return `# his-and-hers (hh) bash completion
# Add to ~/.bashrc or ~/.bash_profile:
#   eval "$(hh completion bash)"

_hh_completion() {
  local cur prev words
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  words="\${COMP_WORDS[*]}"

  # Top-level subcommands
  local subcmds="${subcmds}"

  if [[ "\${COMP_CWORD}" -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "$subcmds" -- "$cur") )
    return 0
  fi

  # Per-subcommand flags and sub-subcommands
  local cmd="\${COMP_WORDS[1]}"
  case "$cmd" in
${caseEntries}
  esac

  # Default: filenames
  COMPREPLY=( $(compgen -f -- "$cur") )
}

complete -F _hh_completion hh
`;
}

/**
 * Zsh completion script.
 * Uses _arguments and _values for rich completion with descriptions.
 */
export function generateZsh(): string {
  const cmdList = COMMANDS.map((c) => `    '${c.name}:${c.description}'`).join("\n");

  const caseEntries = COMMANDS.filter((c) => (c.flags ?? []).length > 0 || (c.subcommands ?? []).length > 0)
    .map((c) => {
      const items: string[] = [];
      for (const sub of c.subcommands ?? []) {
        items.push(`'${sub}'`);
      }
      for (const flag of c.flags ?? []) {
        items.push(`'${flag}'`);
      }
      return `      (${c.name})\n        _values '${c.name} options' ${items.join(" ")}\n        ;;`;
    })
    .join("\n");

  return `#compdef hh
# his-and-hers (hh) zsh completion
# Add to ~/.zshrc:
#   eval "$(hh completion zsh)"
# Or place this file as _hh in a directory on your $fpath.

_hh() {
  local state

  _arguments \\
    '1: :->command' \\
    '*: :->args'

  case $state in
    command)
      local -a commands
      commands=(
${cmdList}
      )
      _describe 'hh commands' commands
      ;;
    args)
      local cmd=\${words[2]}
      case $cmd in
${caseEntries}
      esac
      ;;
  esac
}

_hh "$@"
`;
}

/**
 * Fish completion script.
 * Uses `complete` builtin for each command and its flags.
 */
export function generateFish(): string {
  const lines: string[] = [
    "# his-and-hers (hh) fish completion",
    "# Add to ~/.config/fish/config.fish:",
    "#   hh completion fish | source",
    "#",
    "# Or save to ~/.config/fish/completions/hh.fish",
    "",
    "# Disable file completion at top level",
    "complete -c hh -f",
    "",
    "# Top-level subcommands",
  ];

  for (const cmd of COMMANDS) {
    lines.push(`complete -c hh -n '__fish_use_subcommand' -a '${cmd.name}' -d '${cmd.description}'`);
  }

  lines.push("");
  lines.push("# Per-subcommand flags and sub-subcommands");

  for (const cmd of COMMANDS) {
    const hasSub = cmd.subcommands && cmd.subcommands.length > 0;
    const hasFlags = cmd.flags && cmd.flags.length > 0;

    if (!hasSub && !hasFlags) continue;

    const cond = `'__fish_seen_subcommand_from ${cmd.name}'`;

    if (hasSub) {
      for (const sub of cmd.subcommands!) {
        lines.push(`complete -c hh -n ${cond} -a '${sub}'`);
      }
    }

    if (hasFlags) {
      for (const flag of cmd.flags!) {
        const flagName = flag.replace(/^--/, "");
        lines.push(`complete -c hh -n ${cond} -l '${flagName}'`);
      }
    }
  }

  return lines.join("\n") + "\n";
}

/**
 * PowerShell completion script.
 * Uses Register-ArgumentCompleter for native tab completion.
 */
export function generatePowerShell(): string {
  const subcmds = topLevelNames()
    .map((n) => `'${n}'`)
    .join(", ");

  const switchCases = COMMANDS.filter((c) => (c.flags ?? []).length > 0 || (c.subcommands ?? []).length > 0)
    .map((c) => {
      const words = [...(c.subcommands ?? []), ...(c.flags ?? [])].map((w) => `'${w}'`).join(", ");
      return `        '${c.name}' { @(${words}) | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { $_ } }`;
    })
    .join("\n");

  return `# his-and-hers (hh) PowerShell completion
# Add to your $PROFILE:
#   hh completion powershell | Out-String | Invoke-Expression
# Or:
#   Invoke-Expression (& hh completion powershell | Out-String)

Register-ArgumentCompleter -Native -CommandName hh -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)

  $tokens = $commandAst.CommandElements
  $cmd = if ($tokens.Count -ge 2) { $tokens[1].Value } else { $null }

  if ($null -eq $cmd -or ($tokens.Count -eq 2 -and -not $commandAst.ToString().EndsWith(' '))) {
    # Complete top-level subcommand
    $subcmds = @(${subcmds})
    $subcmds | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
    return
  }

  # Per-subcommand completions
  $completions = switch ($cmd) {
${switchCases}
    default { @() }
  }

  $completions | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
  }
}
`;
}

// ─── Shell auto-detection ─────────────────────────────────────────────────────

export function detectShell(): string | null {
  const shell = process.env["SHELL"] ?? "";
  if (shell.includes("zsh")) return "zsh";
  if (shell.includes("fish")) return "fish";
  if (shell.includes("bash")) return "bash";
  if (process.platform === "win32") return "powershell";
  return null;
}

// ─── Install hint ─────────────────────────────────────────────────────────────

function installHint(shell: string): string {
  switch (shell) {
    case "bash":
      return [
        "",
        pc.dim("# To enable permanently, add to ~/.bashrc or ~/.bash_profile:"),
        pc.dim('#   eval "$(hh completion bash)"'),
      ].join("\n");
    case "zsh":
      return [
        "",
        pc.dim("# To enable permanently, add to ~/.zshrc:"),
        pc.dim('#   eval "$(hh completion zsh)"'),
      ].join("\n");
    case "fish":
      return [
        "",
        pc.dim("# To enable permanently:"),
        pc.dim("#   hh completion fish > ~/.config/fish/completions/hh.fish"),
      ].join("\n");
    case "powershell":
      return [
        "",
        pc.dim("# To enable permanently, add to your $PROFILE:"),
        pc.dim("#   hh completion powershell | Out-String | Invoke-Expression"),
      ].join("\n");
    default:
      return "";
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export interface CompletionOptions {
  shell?: string;
  noHint?: boolean;
}

export async function completion(opts: CompletionOptions = {}): Promise<void> {
  let shell = opts.shell?.toLowerCase().trim();

  // Auto-detect if not provided
  if (!shell) {
    const detected = detectShell();
    if (!detected) {
      console.error(
        pc.red("✗") +
          " Could not detect your shell. Specify it explicitly:\n" +
          pc.dim("  hh completion bash | zsh | fish | powershell"),
      );
      process.exitCode = 1;
      return;
    }
    shell = detected;
  }

  let script: string;
  switch (shell) {
    case "bash":
      script = generateBash();
      break;
    case "zsh":
      script = generateZsh();
      break;
    case "fish":
      script = generateFish();
      break;
    case "powershell":
    case "pwsh":
      script = generatePowerShell();
      break;
    default:
      console.error(
        pc.red("✗") +
          ` Unknown shell: ${pc.bold(shell)}\n` +
          pc.dim("  Supported: bash, zsh, fish, powershell"),
      );
      process.exitCode = 1;
      return;
  }

  process.stdout.write(script);

  if (!opts.noHint) {
    const hint = installHint(shell === "pwsh" ? "powershell" : shell);
    if (hint) process.stderr.write(hint + "\n");
  }
}
