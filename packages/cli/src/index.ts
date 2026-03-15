#!/usr/bin/env node
import { Command } from "commander";
import { createRequire } from "node:module";
import { onboard } from "./commands/onboard.ts";
import { pair } from "./commands/pair.ts";
import { status } from "./commands/status.ts";
import { wake } from "./commands/wake.ts";
import { send } from "./commands/send.ts";
import { doctor } from "./commands/doctor.ts";
import { heartbeat } from "./commands/heartbeat.ts";
import { result } from "./commands/result.ts";
import { taskStatus } from "./commands/task-status.ts";
import {
  capabilitiesScan,
  capabilitiesAdvertise,
  capabilitiesFetch,
  capabilitiesShow,
  capabilitiesRoute,
} from "./commands/capabilities.ts";
import { budget } from "./commands/budget.ts";
import { peers } from "./commands/peers.ts";
import { publish } from "./commands/publish.ts";
import { discover } from "./commands/discover.ts";
import { logs } from "./commands/logs.ts";
import { configShow, configGet, configSet, configPath } from "./commands/config.ts";
import { hhTest } from "./commands/test.ts";
import { upgrade } from "./commands/upgrade.ts";
import { replay } from "./commands/replay.ts";
import { cancel } from "./commands/cancel.ts";
import { watch } from "./commands/watch.ts";
import { monitor } from "./commands/monitor.ts";
import {
  scheduleAdd,
  scheduleList,
  scheduleRemove,
  scheduleEnable,
  scheduleDisable,
  scheduleRun,
} from "./commands/schedule.ts";
import { loadConfig } from "./config/store.ts";
import { notify } from "./commands/notify.ts";
import { chat } from "./commands/chat.ts";
import { prune } from "./commands/prune.ts";
import { exportTasks } from "./commands/export.ts";
import { completion } from "./commands/completion.ts";
import {
  templateAdd,
  templateList,
  templateShow,
  templateRun,
  templateRemove,
} from "./commands/template.ts";
import { web } from "./commands/web.ts";
import { broadcast } from "./commands/broadcast.ts";

const _require = createRequire(import.meta.url);
const { version: _hhVersion } = _require("../package.json") as { version: string };

const program = new Command()
  .name("hh")
  .description("H1 & H2 — two agents, separate machines, one command to wire them.")
  .version(_hhVersion)
  // Default action when no subcommand given: onboard if unconfigured, status if already set up
  .action(async () => {
    const config = await loadConfig();
    if (!config) {
      await onboard();
    } else {
      await status();
    }
  });

program
  .command("onboard")
  .description("Run the setup wizard to configure this node and pair with a remote machine")
  .action(onboard);

program
  .command("pair")
  .description("Pair with a remote node using a 6-digit code")
  .requiredOption("--code <code>", "6-digit pairing code from the H1 node")
  .action(pair);

program
  .command("status")
  .description("Show both nodes, connectivity, and last heartbeat")
  .action(status);

program
  .command("wake")
  .description("Manually trigger Wake-on-LAN for the H2 node")
  .action(wake);

program
  .command("send")
  .description("Send a task to the peer node")
  .argument("<task>", "Task description to send")
  .option("--wait", "Wait for the result before exiting")
  .option("--wait-timeout <seconds>", "Max seconds to wait for result (default: 300)", "300")
  .option("--no-state", "Skip writing task state to disk (fire-and-forget)")
  .option("--peer <name>", "Target a specific peer by name (multi-H2 setups)")
  .option("--auto", "Auto-select the best peer based on task + cached capabilities")
  .option("--latent", "[Phase 6] Force latent communication (Vision Wormhole / LatentMAS). Fails if peer doesn't support it.")
  .option("--auto-latent", "[Phase 6] Use latent if peer supports it, fall back to text otherwise")
  .option("--max-retries <n>", "Max delivery retry attempts on failure (default: 3)")
  .option("--no-webhook", "Disable result webhook server (polling only, --wait mode)")
  .option("--force", "Skip cron duplicate-send guard")
  .option("--notify <url>", "Webhook URL for task completion notification (Discord/Slack/generic)")
  .action((task: string, opts: {
    wait?: boolean;
    waitTimeout?: string;
    state?: boolean;
    peer?: string;
    auto?: boolean;
    latent?: boolean;
    autoLatent?: boolean;
    maxRetries?: string;
    webhook?: boolean;
    force?: boolean;
    notify?: string;
  }) => {
    return send(task, {
      wait: opts.wait,
      waitTimeoutSeconds: opts.waitTimeout,
      noState: opts.state === false,
      peer: opts.peer,
      auto: opts.auto,
      latent: opts.latent,
      autoLatent: opts.autoLatent,
      maxRetries: opts.maxRetries,
      noWebhook: opts.webhook === false,
      force: opts.force,
      notify: opts.notify,
    });
  });

program
  .command("replay")
  .description("Re-send a previous task with the same objective (useful after failures or timeouts)")
  .argument("<id>", "Task ID or prefix to replay (see `hh logs` for IDs)")
  .option("--peer <name>", "Override the target peer")
  .option("--wait", "Wait for the result before exiting")
  .option("--wait-timeout <seconds>", "Max seconds to wait (default: 300)", "300")
  .option("--no-webhook", "Disable result webhook server (polling only)")
  .option("--notify <url>", "Webhook URL for task completion notification (Discord/Slack/generic)")
  .option("--dry-run", "Show what would be sent without sending")
  .option("--json", "Output replay plan as JSON (dry-run only)")
  .action((id: string, opts: {
    peer?: string;
    wait?: boolean;
    waitTimeout?: string;
    webhook?: boolean;
    notify?: string;
    dryRun?: boolean;
    json?: boolean;
  }) =>
    replay(id, {
      peer: opts.peer,
      wait: opts.wait,
      waitTimeoutSeconds: opts.waitTimeout,
      noWebhook: opts.webhook === false,
      notify: opts.notify,
      dryRun: opts.dryRun,
      json: opts.json,
    }),
  );

program
  .command("cancel")
  .description("Cancel a pending or running task (marks it as cancelled, unblocks hh logs / replay)")
  .argument("[id]", "Task ID or prefix to cancel")
  .option("--force", "Cancel even if the task is already in a terminal state")
  .option("--all-pending", "Cancel every pending task at once")
  .option("--json", "Machine-readable JSON output")
  .action((id: string | undefined, opts: { force?: boolean; allPending?: boolean; json?: boolean }) =>
    cancel(id, { force: opts.force, allPending: opts.allPending, json: opts.json }),
  );

program
  .command("result")
  .description("Record the result of a completed task (called by the peer after processing)")
  .argument("<task-id>", "Task ID (or prefix) to mark as complete")
  .argument("[output]", "Result output text")
  .option("--fail", "Mark task as failed instead of completed")
  .option("--output-file <path>", "Read output from a file instead of inline")
  .option("--json <json>", "Full TaskResult JSON payload")
  .option("--tokens <n>", "Number of tokens used")
  .option("--duration-ms <ms>", "Processing duration in milliseconds")
  .option("--artifact <path>", "Add an artifact path (repeatable)", (v: string, prev: string[]) => [...prev, v], [] as string[])
  .option("--webhook-url <url>", "POST result back to H1 immediately (URL from HH-Result-Webhook in wake message)")
  .action((taskId: string, output: string | undefined, opts: {
    fail?: boolean;
    outputFile?: string;
    json?: string;
    tokens?: string;
    durationMs?: string;
    artifact?: string[];
    webhookUrl?: string;
  }) => {
    return result(taskId, output, {
      fail: opts.fail,
      outputFile: opts.outputFile,
      json: opts.json,
      tokens: opts.tokens,
      durationMs: opts.durationMs,
      artifacts: opts.artifact,
      webhookUrl: opts.webhookUrl,
    });
  });

program
  .command("heartbeat")
  .description("Check or send a liveness heartbeat to the peer node")
  .argument("[action]", "Action: send | show | record (default: show)", "show")
  .option("--from <name>", "Peer name (used with record)")
  .option("--at <iso>", "Timestamp to record (used with record, default: now)")
  .action((action: string, opts: { from?: string; at?: string }) => {
    return heartbeat(action as "send" | "show" | "record", opts);
  });

program
  .command("task-status")
  .aliases(["tasks", "ts"])
  .description("Show status of sent tasks")
  .argument("[id]", "Task ID or prefix to inspect (omit for list)")
  .action(taskStatus);

program
  .command("doctor")
  .description("Diagnose connectivity and configuration issues")
  .option("--peer <name>", "Run checks only for a specific peer (by name)")
  .option("--json", "Output results as machine-readable JSON")
  .action((opts: { peer?: string; json?: boolean }) => doctor(opts));

program
  .command("budget")
  .description("Show token usage and cost spend across recent tasks")
  .option("--today", "Show today's usage only")
  .option("--month", "Show the last 30 days")
  .option("--all", "Show all-time usage")
  .option("--tasks", "Include per-task breakdown table")
  .option("--json", "Output raw JSON")
  .action((opts: { today?: boolean; month?: boolean; all?: boolean; tasks?: boolean; json?: boolean }) => {
    return budget(opts);
  });

// ─── Capabilities ────────────────────────────────────────────────────────────

const caps = program
  .command("capabilities")
  .aliases(["caps"])
  .description("Manage and query H2 node capability registry");

caps
  .command("scan")
  .description("Probe this machine and print a capability report")
  .option("--save", "Save the report to disk after scanning")
  .option("--notes <text>", "Free-form notes to include in the report")
  .action((opts: { save?: boolean; notes?: string }) => capabilitiesScan(opts));

caps
  .command("advertise")
  .description("Scan capabilities and save to disk (run on H2 node)")
  .option("--notes <text>", "Free-form notes to include in the report")
  .action((opts: { notes?: string }) => capabilitiesAdvertise(opts));

caps
  .command("fetch")
  .description("Fetch peer capabilities from H2 gateway (run on H1 node)")
  .action(() => capabilitiesFetch());

caps
  .command("show")
  .description("Show last known capability report")
  .option("--peer", "Show peer (H2) capabilities instead of local")
  .action((opts: { peer?: boolean }) => capabilitiesShow(opts));

caps
  .command("route")
  .description("Show routing decision for a task, using peer capabilities")
  .argument("<task>", "Task description to evaluate")
  .action((task: string) => capabilitiesRoute(task));

program
  .command("peers")
  .description("List all configured peer nodes with reachability and capability info")
  .option("--ping", "Live reachability check for each peer via Tailscale ping")
  .option("--json", "Output as JSON")
  .action((opts: { ping?: boolean; json?: boolean }) => peers(opts));

// ─── Community registry ───────────────────────────────────────────────────────

program
  .command("publish")
  .description("Publish an anonymised node card to the community registry (GitHub Gist)")
  .option("--tags <csv>", "Comma-separated tags, e.g. rtx3070ti,comfyui,rag")
  .option("--description <text>", "Short description shown in hh discover")
  .option("--token <token>", "GitHub personal access token (or set GITHUB_TOKEN env var)")
  .option("--update", "Force update even if no gist_id saved locally")
  .option("--dry", "Print the node card without publishing")
  .option("--json", "Output result as JSON")
  .action((opts: { tags?: string; description?: string; token?: string; update?: boolean; dry?: boolean; json?: boolean }) => {
    return publish(opts);
  });

program
  .command("logs")
  .description("Show task history with filtering and live-tail support")
  .option("--limit <n>", "Max tasks to show (default: 50)", "50")
  .option("--status <status>", "Filter by status: pending|running|completed|failed|timeout")
  .option("--peer <name>", "Filter by peer node name (substring match)")
  .option("--since <duration>", "Show tasks from last N time units, e.g. 24h, 7d, 30m")
  .option("--output", "Include result output text in the log")
  .option("--json", "Output raw JSON array")
  .option("--follow", "Live tail: poll for new tasks every 2s")
  .action((opts: { limit?: string; status?: string; peer?: string; since?: string; output?: boolean; json?: boolean; follow?: boolean }) => {
    return logs(opts);
  });

// ─── Config ──────────────────────────────────────────────────────────────────

const configCmd = program
  .command("config")
  .description("View and edit the HH configuration")
  .action(() => configShow());

configCmd
  .command("show")
  .description("Pretty-print current config (secrets redacted)")
  .action(configShow);

configCmd
  .command("get")
  .argument("<key>", "Config key (dot-notation, e.g. this_node.name)")
  .description("Get a config value")
  .action(configGet);

configCmd
  .command("set")
  .argument("<key>", "Config key (dot-notation, e.g. this_node.name)")
  .argument("<value>", "Value to set (auto-coerced: true/false/number/JSON)")
  .description("Set a config value")
  .action(configSet);

configCmd
  .command("path")
  .description("Print config file path (machine-readable)")
  .action(() => configPath());

// ─── Test ─────────────────────────────────────────────────────────────────────

program
  .command("test")
  .description("End-to-end connectivity test: Tailscale → Gateway → round-trip")
  .option("--peer <name>", "Target peer name")
  .option("--json", "Output as JSON")
  .action((opts: { peer?: string; json?: boolean }) => hhTest(opts));

program
  .command("upgrade")
  .description("Check for newer versions of his-and-hers on npm")
  .option("--check", "Exit 0 if up to date, 1 if upgrade available (CI-friendly)")
  .option("--json", "Output result as JSON")
  .action((opts: { check?: boolean; json?: boolean }) => upgrade(opts));

program
  .command("monitor")
  .description("Live terminal dashboard — peer health, recent tasks, and budget at a glance")
  .option("--interval <seconds>", "Refresh interval in seconds (default: 5)", "5")
  .option("--once", "Print a single snapshot and exit (no live loop)")
  .option("--json", "Output snapshot as JSON and exit")
  .action((opts: { interval?: string; once?: boolean; json?: boolean }) => monitor(opts));

program
  .command("discover")
  .description("Browse the community node registry — nodes published with hh publish")
  .option("--role <role>", "Filter by role: h1 | h2")
  .option("--gpu <backend>", "Filter by GPU backend: cuda | rocm | metal")
  .option("--skill <skill>", "Filter by skill tag, e.g. image-gen | transcription")
  .option("--provider <kind>", "Filter by provider: anthropic | openai | ollama | lmstudio")
  .option("--os <os>", "Filter by OS: linux | windows | macos")
  .option("--limit <n>", "Max results (default: 20)", "20")
  .option("--json", "Output as JSON")
  .option("--token <token>", "GitHub token (higher rate limit)")
  .action((opts: { role?: string; gpu?: string; skill?: string; provider?: string; os?: string; limit?: string; json?: boolean; token?: string }) => {
    return discover({ ...opts, limit: opts.limit ? parseInt(opts.limit) : undefined });
  });

program
  .command("watch")
  .description("H2-side task listener: poll for pending tasks and dispatch to an executor")
  .option("--interval <seconds>", "Poll interval in seconds (default: 5)", "5")
  .option("--exec <cmd>", "Shell command to run for each task (receives task JSON on stdin)")
  .option("--once", "Poll once and exit (single-pass mode)")
  .option("--dry-run", "Detect tasks but do not execute or mutate state")
  .option("--json", "Output machine-readable JSON lines")
  .action((opts: { interval?: string; exec?: string; once?: boolean; dryRun?: boolean; json?: boolean }) =>
    watch(opts),
  );

// ─── Schedule ─────────────────────────────────────────────────────────────────

const scheduleCmd = program
  .command("schedule")
  .description("Manage recurring task delegation via cron");

scheduleCmd
  .command("add")
  .description("Add a new scheduled task")
  .requiredOption("--cron <expression>", "Cron expression (e.g., '0 2 * * *')")
  .argument("<task>", "Task description to send")
  .option("--peer <name>", "Target a specific peer by name")
  .option("--latent", "Use latent communication mode")
  .option("--name <label>", "Human-friendly label for this schedule")
  .option("--notify <url>", "Webhook URL for task completion notifications (Discord/Slack/generic)")
  .action((task: string, opts: { cron: string; peer?: string; latent?: boolean; name?: string; notify?: string }) => {
    return scheduleAdd({
      cron: opts.cron,
      task,
      peer: opts.peer,
      latent: opts.latent,
      name: opts.name,
      notify: opts.notify,
    });
  });

scheduleCmd
  .command("list")
  .description("List all scheduled tasks")
  .option("--json", "Output as JSON")
  .action((opts: { json?: boolean }) => scheduleList(opts));

scheduleCmd
  .command("remove")
  .aliases(["rm"])
  .description("Remove a scheduled task")
  .argument("<id>", "Schedule ID or prefix")
  .action((id: string) => scheduleRemove(id));

scheduleCmd
  .command("enable")
  .description("Enable a disabled schedule")
  .argument("<id>", "Schedule ID or prefix")
  .action((id: string) => scheduleEnable(id));

scheduleCmd
  .command("disable")
  .description("Disable a schedule without removing it")
  .argument("<id>", "Schedule ID or prefix")
  .action((id: string) => scheduleDisable(id));

scheduleCmd
  .command("run")
  .description("Manually trigger a schedule (run now)")
  .argument("<id>", "Schedule ID or prefix")
  .action((id: string) => scheduleRun(id));

// ─── Notify ──────────────────────────────────────────────────────────────────

program
  .command("notify")
  .description("Manage persistent notification webhooks for task completion events")
  .argument("[subcommand]", "add | list | remove | test")
  .argument("[args...]", "Subcommand arguments")
  .option("--name <label>", "Friendly label for the webhook (used with add)")
  .option("--on <events>", "Event filter: all | complete | failure (used with add, default: all)")
  .allowUnknownOption()
  .action((_subcommand: string | undefined, _args: string[], _opts, cmd: Command) => {
    // Pass raw argv after "notify" so the subcommand parser sees flags like --name
    const rawArgs = cmd.parent?.args ?? [];
    const notifyIdx = rawArgs.indexOf("notify");
    const rest = notifyIdx >= 0 ? rawArgs.slice(notifyIdx + 1) : [];
    return notify({ _: rest });
  });

// ─── Chat ────────────────────────────────────────────────────────────────────

program
  .command("chat")
  .description("Interactive multi-turn session with the peer node")
  .option("--peer <name>", "Target a specific peer by name (multi-H2 setups)")
  .option("--no-context", "Start fresh — don't carry forward prior context")
  .option("--timeout <seconds>", "Max seconds to wait per turn (default: 300)", "300")
  .action((opts: { peer?: string; noContext?: boolean; timeout?: string }) => chat(opts));

// ─── Prune ───────────────────────────────────────────────────────────────────

program
  .command("prune")
  .description("Clean up stale task state, retry records, and schedule logs")
  .option("--older-than <duration>", "Prune files older than this (e.g. 7d, 2w, 24h). Default: 30d")
  .option(
    "--status <status>",
    "Which terminal statuses to target: all | completed | failed | timeout | cancelled (default: completed + failed + timeout + cancelled)",
  )
  .option("--include-retry", "Also remove retry state files for pruned tasks")
  .option("--include-logs", "Also truncate matching schedule log files")
  .option("--dry-run", "Show what would be removed without deleting anything")
  .option("--json", "Output machine-readable JSON summary")
  .option("--force", "Skip confirmation prompt")
  .action(
    (opts: {
      olderThan?: string;
      status?: string;
      includeRetry?: boolean;
      includeLogs?: boolean;
      dryRun?: boolean;
      json?: boolean;
      force?: boolean;
    }) => prune(opts),
  );

// ─── Export ──────────────────────────────────────────────────────────────────

program
  .command("export")
  .description("Export task history to a markdown, CSV, or JSON report")
  .option("--format <fmt>", "Output format: markdown | csv | json (default: markdown)")
  .option("--out <path>", "Write report to a file instead of stdout")
  .option("--since <duration>", "Include only tasks from the last N time units (e.g. 7d, 24h, 30m)")
  .option("--status <status>", "Filter by status: pending | running | completed | failed | timeout | cancelled")
  .option("--peer <name>", "Filter by peer node name (substring match)")
  .option("--no-output", "Omit result output text (shorter report)")
  .action(
    (opts: {
      format?: string;
      out?: string;
      since?: string;
      status?: string;
      peer?: string;
      output?: boolean;
    }) => exportTasks(opts),
  );

// ─── Completion ──────────────────────────────────────────────────────────────

program
  .command("completion")
  .description("Print shell completion script for bash, zsh, fish, or PowerShell")
  .argument("[shell]", "Target shell: bash | zsh | fish | powershell (auto-detected if omitted)")
  .option("--no-hint", "Suppress the install hint written to stderr")
  .action((shell: string | undefined, opts: { hint?: boolean }) =>
    completion({ shell, noHint: opts.hint === false }),
  );

// ─── hh template ─────────────────────────────────────────────────────────────

const templateCmd = program
  .command("template")
  .description("Manage named task templates with {variable} substitution");

templateCmd
  .command("add <name>")
  .description('Save a new task template (use {var}, {1}, {*} as placeholders in --task)')
  .requiredOption("--task <task>", "Task string with optional {variable} placeholders")
  .option("--peer <name>", "Default peer node to run this template on")
  .option("--timeout <seconds>", "Default task timeout in seconds", parseInt)
  .option("--notify <url>", "Default notification webhook URL")
  .option("--desc <text>", "Optional human-readable description")
  .action((name: string, opts: { task: string; peer?: string; timeout?: number; notify?: string; desc?: string }) =>
    templateAdd({ name, ...opts }),
  );

templateCmd
  .command("list")
  .alias("ls")
  .description("List all saved templates")
  .option("--json", "Output as JSON")
  .action((opts: { json?: boolean }) => templateList(opts));

templateCmd
  .command("show <name>")
  .description("Show full details of a template")
  .option("--json", "Output as JSON")
  .action((name: string, opts: { json?: boolean }) => templateShow(name, opts));

templateCmd
  .command("run <name> [args...]")
  .description("Expand a template and send the task to H2")
  .option("--var <key=value>", "Bind a named template variable (repeatable)", (v: string, acc: string[]) => [...acc, v], [] as string[])
  .option("--peer <name>", "Override the template default peer")
  .option("--timeout <seconds>", "Override the template default timeout", parseInt)
  .option("--notify <url>", "Override the template notification webhook")
  .option("--wait", "Wait for the result before exiting")
  .option("--latent", "Force latent message mode (requires peer latent support)")
  .option("--auto-latent", "Prefer latent mode; fall back to text if peer doesn't support it")
  .action((name: string, args: string[], opts: { var?: string[]; peer?: string; timeout?: number; notify?: string; wait?: boolean; latent?: boolean; autoLatent?: boolean }) =>
    templateRun(name, { ...opts, args }),
  );

templateCmd
  .command("remove <name>")
  .alias("rm")
  .description("Remove a saved template by name or id prefix")
  .option("--force", "Skip confirmation prompt")
  .action((name: string, opts: { force?: boolean }) => templateRemove(name, opts));

// ── hh web ────────────────────────────────────────────────────────────────────
program
  .command("web")
  .description("Launch the local web dashboard (live task feed, peer status, send form)")
  .option("--port <port>", "Port to listen on (default: 3847)")
  .option("--no-open", "Do not automatically open the browser")
  .action((opts: { port?: string; open?: boolean }) => web(opts));

// ── hh broadcast ──────────────────────────────────────────────────────────────
program
  .command("broadcast")
  .description("Send the same task to multiple peer nodes concurrently")
  .argument("<task>", "Task or question to broadcast")
  .option("--peers <names>", "Comma-separated peer names (default: all configured peers)")
  .option("--wait", "Wait for result(s) before exiting")
  .option("--wait-timeout <seconds>", "Timeout for waiting (default: 120s)")
  .option(
    "--strategy <mode>",
    "all — wait for every peer, first — stop after the first response (default: all)",
  )
  .option("--no-check", "Skip gateway health check per peer (faster)")
  .option("--json", "Emit JSON output")
  .action(
    (
      task: string,
      opts: {
        peers?: string;
        wait?: boolean;
        waitTimeout?: string;
        strategy?: string;
        check?: boolean;
        json?: boolean;
      },
    ) =>
      broadcast(task, {
        peers: opts.peers,
        wait: opts.wait,
        waitTimeoutSeconds: opts.waitTimeout,
        strategy: (opts.strategy as "all" | "first") ?? "all",
        noCheck: opts.check === false,
        json: opts.json,
      }),
  );

program.parseAsync();
