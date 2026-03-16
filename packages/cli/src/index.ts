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
import { contextList, contextShow, contextClear, contextPrune } from "./commands/context.ts";
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
import { pipeline } from "./commands/pipeline.ts";
import {
  workflowAdd,
  workflowList,
  workflowShow,
  workflowRemove,
  workflowRun,
} from "./commands/workflow.ts";
import { sync } from "./commands/sync.ts";
import {
  clusterList,
  clusterAdd,
  clusterShow,
  clusterRemove,
  clusterPeersAdd,
  clusterPeersRemove,
} from "./commands/cluster.ts";
import { runSummarise, runReview, runDiff } from "./commands/run.ts";
import {
  aliasAdd,
  aliasList,
  aliasShow,
  aliasRemove,
  aliasRun,
  tryRunAlias,
} from "./commands/alias.ts";
import { stats } from "./commands/stats.ts";
import { release } from "./commands/release.ts";
import {
  profileList,
  profileUse,
  profileCreate,
  profileShow,
  profileDelete,
} from "./commands/profile.ts";
import { auditList, auditVerify, auditExport } from "./commands/audit.ts";
import { ci } from "./commands/ci.ts";
import { mcp } from "./commands/mcp.ts";
import { ask } from "./commands/ask.ts";
import {
  budgetList,
  budgetSet,
  budgetShow,
  budgetRemove,
} from "./commands/budget-caps.ts";
import {
  notifyAdd,
  notifyList,
  notifyShow,
  notifyRemove,
  notifyTest,
} from "./commands/notify-targets.ts";

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
  .option("--sync <path>", "[Phase 7b] Sync a local path to H2 before dispatching the task")
  .option("--attach <paths...>", "[Phase 7d] Attach one or more files to the task (PDF, images, text, code, JSON). Max 10 MB/file.")
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
    sync?: string;
    attach?: string[];
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
      sync: opts.sync,
      attach: opts.attach,
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

// ── hh budget (summary) ───────────────────────────────────────────────────────
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

// ── hh budget caps (Phase 11b) ────────────────────────────────────────────────
const budgetCapsCmd = program
  .command("budget-cap")
  .alias("cap")
  .description("[Phase 11b] Manage per-peer cost caps with warn/block actions");

budgetCapsCmd
  .command("list")
  .description("List all budget caps with current spend")
  .option("--json", "Output as JSON")
  .action((opts: { json?: boolean }) => budgetList(opts));

budgetCapsCmd
  .command("set <peer>")
  .description("Set or update a budget cap for a peer")
  .option("--daily <usd>", "Daily spending limit in USD")
  .option("--monthly <usd>", "Monthly spending limit in USD")
  .option("--action <action>", "Action when exceeded: warn | block (default: warn)")
  .action((peer: string, opts: { daily?: string; monthly?: string; action?: "warn" | "block" }) =>
    budgetSet(peer, opts),
  );

budgetCapsCmd
  .command("show <peer>")
  .description("Show current spend vs limit for a peer")
  .option("--json", "Output as JSON")
  .action((peer: string, opts: { json?: boolean }) => budgetShow(peer, opts));

budgetCapsCmd
  .command("remove <peer>")
  .alias("rm")
  .description("Remove a budget cap")
  .option("--force", "Skip confirmation prompt")
  .action((peer: string, opts: { force?: boolean }) => budgetRemove(peer, opts));

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
  .option("--cluster <name>", "Filter to peers belonging to a named cluster")
  .option("--json", "Output as JSON")
  .action((opts: { ping?: boolean; cluster?: string; json?: boolean }) => peers(opts));

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

// ─── Context ─────────────────────────────────────────────────────────────────

const contextCmd = program
  .command("context")
  .description("Manage per-peer context history")
  .action(() => contextList());

contextCmd
  .command("list")
  .description("List peers with stored context")
  .action(() => contextList());

contextCmd
  .command("show")
  .argument("<peer>", "Peer name")
  .description("Show context entries for a peer")
  .action((peer: string) => contextShow(peer));

contextCmd
  .command("clear")
  .argument("<peer>", "Peer name")
  .description("Clear context for a peer")
  .action((peer: string) => contextClear(peer));

contextCmd
  .command("prune")
  .description("Remove context entries older than N days")
  .option("--days <n>", "Age threshold in days", "30")
  .action((opts: { days: string }) => contextPrune(Number(opts.days)));

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

// ─── Notify (Phase 5h) ────────────────────────────────────────────────────────

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

// ─── Notify Targets (Phase 11c) ───────────────────────────────────────────────

const notifyTargetCmd = program
  .command("notify-target")
  .alias("ntarget")
  .description("[Phase 11c] Manage webhook and Slack notification targets with HMAC signing");

notifyTargetCmd
  .command("add <name>")
  .description("Add or update a notification target")
  .requiredOption("--url <url>", "Webhook or Slack URL")
  .option("--type <type>", "Type: webhook | slack (default: webhook)")
  .option("--events <csv>", "Comma-separated events: task_sent,task_completed,task_failed,budget_warn")
  .option("--secret <secret>", "HMAC secret for webhook signature (optional)")
  .action((name: string, opts: { url: string; type?: "webhook" | "slack"; events?: string; secret?: string }) =>
    notifyAdd(name, opts),
  );

notifyTargetCmd
  .command("list")
  .alias("ls")
  .description("List all notification targets")
  .option("--json", "Output as JSON")
  .action((opts: { json?: boolean }) => notifyList(opts));

notifyTargetCmd
  .command("show <name>")
  .description("Show details of a notification target")
  .option("--json", "Output as JSON")
  .action((name: string, opts: { json?: boolean }) => notifyShow(name, opts));

notifyTargetCmd
  .command("remove <name>")
  .alias("rm")
  .description("Remove a notification target")
  .option("--force", "Skip confirmation prompt")
  .action((name: string, opts: { force?: boolean }) => notifyRemove(name, opts));

notifyTargetCmd
  .command("test <name>")
  .description("Send a test notification to a target")
  .action((name: string) => notifyTest(name));

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
  .option("--cluster <name>", "Target peers in a named cluster (mutually exclusive with --peers)")
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
        cluster?: string;
        wait?: boolean;
        waitTimeout?: string;
        strategy?: string;
        check?: boolean;
        json?: boolean;
      },
    ) =>
      broadcast(task, {
        peers: opts.peers,
        cluster: opts.cluster,
        wait: opts.wait,
        waitTimeoutSeconds: opts.waitTimeout,
        strategy: (opts.strategy as "all" | "first") ?? "all",
        noCheck: opts.check === false,
        json: opts.json,
      }),
  );

// ── hh sync ───────────────────────────────────────────────────────────────────
program
  .command("sync")
  .description("Push a local path to the H2 peer over Tailscale SSH using rsync")
  .argument("<path>", "Local file or directory to sync")
  .option("--dest <path>", "Remote destination path (default: ~/basename)")
  .option("--peer <name>", "Target a specific peer node by name")
  .option("--dry-run", "Preview transfers without writing to H2")
  .option("--delete", "Delete remote files not present locally (rsync --delete)")
  .option("--watch", "Re-sync automatically on local file changes")
  .option("--watch-interval <ms>", "Debounce interval for --watch mode (default: 1000ms)")
  .action(
    (
      localPath: string,
      opts: {
        dest?: string;
        peer?: string;
        dryRun?: boolean;
        delete?: boolean;
        watch?: boolean;
        watchInterval?: string;
      },
    ) =>
      sync(localPath, {
        dest: opts.dest,
        peer: opts.peer,
        dryRun: opts.dryRun,
        delete: opts.delete,
        watch: opts.watch,
        watchIntervalMs: opts.watchInterval ? parseInt(opts.watchInterval, 10) : undefined,
      }),
  );

// ── hh clusters / hh cluster ──────────────────────────────────────────────────

program
  .command("clusters")
  .description("List all defined peer clusters (shorthand for hh cluster list)")
  .option("--json", "Output as JSON")
  .action((opts: { json?: boolean }) => clusterList(opts));

const clusterCmd = program
  .command("cluster")
  .description("Manage named peer groups for cluster-targeted dispatch");

clusterCmd
  .command("list")
  .alias("ls")
  .description("List all defined clusters")
  .option("--json", "Output as JSON")
  .action((opts: { json?: boolean }) => clusterList(opts));

clusterCmd
  .command("add <name>")
  .description("Define a new named cluster (or overwrite an existing one)")
  .requiredOption("--peers <names>", "Comma-separated peer names to include in the cluster")
  .option("--no-validate", "Skip peer name validation against the current roster")
  .option("--json", "Output result as JSON")
  .action((name: string, opts: { peers: string; validate?: boolean; json?: boolean }) =>
    clusterAdd(name, {
      peers: opts.peers,
      noValidate: opts.validate === false,
      json: opts.json,
    }),
  );

clusterCmd
  .command("show <name>")
  .description("Show peers in a named cluster")
  .option("--json", "Output as JSON")
  .action((name: string, opts: { json?: boolean }) => clusterShow(name, opts));

clusterCmd
  .command("remove <name>")
  .alias("rm")
  .description("Remove a named cluster")
  .option("--force", "Skip confirmation prompt")
  .option("--json", "Output result as JSON")
  .action((name: string, opts: { force?: boolean; json?: boolean }) => clusterRemove(name, opts));

const clusterPeersCmd = clusterCmd
  .command("peers")
  .description("Add or remove individual peers from a cluster");

clusterPeersCmd
  .command("add <cluster> <peer>")
  .description("Add a peer to an existing cluster")
  .option("--no-validate", "Skip peer name validation")
  .option("--json", "Output updated cluster as JSON")
  .action((clusterName: string, peerName: string, opts: { validate?: boolean; json?: boolean }) =>
    clusterPeersAdd(clusterName, peerName, {
      noValidate: opts.validate === false,
      json: opts.json,
    }),
  );

clusterPeersCmd
  .command("remove <cluster> <peer>")
  .alias("rm")
  .description("Remove a peer from a cluster")
  .option("--json", "Output updated cluster as JSON")
  .action((clusterName: string, peerName: string, opts: { json?: boolean }) =>
    clusterPeersRemove(clusterName, peerName, opts),
  );

// ── hh pipeline ───────────────────────────────────────────────────────────────
program
  .command("pipeline")
  .description(
    "[Phase 7e] Run a multi-step chained task pipeline across peers.\n\n" +
    "Each step's output is available in the next step via {{previous.output}}\n" +
    "or {{steps.N.output}} (1-based index).\n\n" +
    "Inline spec:  hh pipeline \"peer1:task one -> peer2:review {{previous.output}}\"\n" +
    "File:         hh pipeline --file pipeline.json",
  )
  .argument("[spec]", "Inline pipeline spec: \"peer1:task -> peer2:task\"")
  .option("--file <path>", "Load pipeline definition from a JSON file")
  .option("--timeout <seconds>", "Per-step wait timeout in seconds (default: 120)")
  .option("--json", "Output results as JSON")
  .action((spec: string | undefined, opts: { file?: string; timeout?: string; json?: boolean }) =>
    pipeline(spec, opts),
  );

// ── hh workflow ───────────────────────────────────────────────────────────────

const workflowCmd = program
  .command("workflow")
  .description(
    "[Phase 8a] Manage saved named pipeline workflows.\n\n" +
    "Save any pipeline spec once, run it by name any time.\n\n" +
    "Add:    hh workflow add review \"glados:write tests -> piper:review {{previous.output}}\"\n" +
    "Run:    hh workflow run review\n" +
    "List:   hh workflow list",
  );

workflowCmd
  .command("add <name> [spec]")
  .description("Save a new named pipeline workflow")
  .option("--file <path>", "Load pipeline definition from a JSON file instead of inline spec")
  .option("--desc <text>", "Optional human-readable description")
  .option("--timeout <seconds>", "Default per-step timeout in seconds", parseInt)
  .action(
    (
      name: string,
      spec: string | undefined,
      opts: { file?: string; desc?: string; timeout?: number },
    ) => workflowAdd({ name, spec, ...opts }),
  );

workflowCmd
  .command("list")
  .alias("ls")
  .description("List all saved workflows")
  .option("--json", "Output as JSON")
  .action((opts: { json?: boolean }) => workflowList(opts));

workflowCmd
  .command("show <name>")
  .description("Show full details of a saved workflow including steps")
  .option("--json", "Output as JSON")
  .action((name: string, opts: { json?: boolean }) => workflowShow(name, opts));

workflowCmd
  .command("run <name>")
  .description("Execute a saved workflow")
  .option("--timeout <seconds>", "Override per-step timeout in seconds")
  .option("--json", "Output results as JSON")
  .action((name: string, opts: { timeout?: string; json?: boolean }) =>
    workflowRun(name, opts),
  );

workflowCmd
  .command("remove <name>")
  .alias("rm")
  .description("Remove a saved workflow")
  .option("--force", "Skip confirmation prompt")
  .option("--json", "Output result as JSON")
  .action((name: string, opts: { force?: boolean; json?: boolean }) =>
    workflowRemove(name, opts),
  );

// ── hh run ────────────────────────────────────────────────────────────────────

const runCmd = program
  .command("run")
  .description(
    "[Phase 8b] Ergonomic shorthands for the most common one-shot task patterns.\n\n" +
    "  hh run summarise <file>           — executive summary + bullet points\n" +
    "  hh run review <file>              — structured code review\n" +
    "  hh run diff [<base> [<head>]]     — review git diff (defaults to HEAD)\n" +
    "  hh run alias <name> [args...]     — expand and execute a user-defined alias",
  );

runCmd
  .command("summarise <path>")
  .alias("summarize")
  .description("Send a file to H2 for summarisation")
  .option("--peer <name>", "Target a specific peer by name")
  .option("--wait", "Wait for the result before exiting")
  .option("--json", "Output task receipt as JSON")
  .option("--notify <url>", "Webhook URL to notify on completion")
  .option("--prompt <text>", "Override the default summarise prompt")
  .action(
    (
      filePath: string,
      opts: { peer?: string; wait?: boolean; json?: boolean; notify?: string; prompt?: string },
    ) => runSummarise(filePath, opts),
  );

runCmd
  .command("review <path>")
  .description("Send a file or directory to H2 for code review")
  .option("--peer <name>", "Target a specific peer by name")
  .option("--wait", "Wait for the result before exiting")
  .option("--json", "Output task receipt as JSON")
  .option("--notify <url>", "Webhook URL to notify on completion")
  .option("--prompt <text>", "Override the default review prompt")
  .action(
    (
      filePath: string,
      opts: { peer?: string; wait?: boolean; json?: boolean; notify?: string; prompt?: string },
    ) => runReview(filePath, opts),
  );

runCmd
  .command("diff [base] [head]")
  .description(
    "Review a git diff via H2. Defaults to `git diff HEAD` (working tree).\n" +
    "Pass a base ref, or base + head for historical/branch diffs.",
  )
  .option("--peer <name>", "Target a specific peer by name")
  .option("--wait", "Wait for the result before exiting")
  .option("--json", "Output task receipt as JSON")
  .option("--notify <url>", "Webhook URL to notify on completion")
  .option("--prompt <text>", "Override the default diff review prompt")
  .option("--stat", "Print git diff --stat before sending")
  .action(
    (
      base: string | undefined,
      head: string | undefined,
      opts: {
        peer?: string;
        wait?: boolean;
        json?: boolean;
        notify?: string;
        prompt?: string;
        stat?: boolean;
      },
    ) => runDiff({ base, head, ...opts }),
  );

runCmd
  .command("alias <name> [args...]")
  .description("Expand and execute a user-defined alias")
  .allowUnknownOption()
  .action((name: string, args: string[]) => aliasRun(name, args));

// ── hh alias ──────────────────────────────────────────────────────────────────

const aliasCmd = program
  .command("alias")
  .description(
    "[Phase 8c] Manage user-defined CLI shortcuts persisted in ~/.his-and-hers/aliases.json.\n\n" +
    "  hh alias add pr-review \"workflow run code-review --peer glados\"\n" +
    "  hh alias list\n" +
    "  hh alias run pr-review\n" +
    "  hh alias remove pr-review",
  );

aliasCmd
  .command("add <name> <command>")
  .description("Create or update a named alias for any hh subcommand string")
  .option("--desc <text>", "Human-readable description of this alias")
  .action((name: string, command: string, opts: { desc?: string }) =>
    aliasAdd(name, command, opts),
  );

aliasCmd
  .command("list")
  .alias("ls")
  .description("List all defined aliases")
  .option("--json", "Output as JSON")
  .action((opts: { json?: boolean }) => aliasList(opts));

aliasCmd
  .command("show <name>")
  .description("Show details of a specific alias")
  .option("--json", "Output as JSON")
  .action((name: string, opts: { json?: boolean }) => aliasShow(name, opts));

aliasCmd
  .command("remove <name>")
  .alias("rm")
  .description("Remove an alias")
  .option("--force", "Skip confirmation prompt")
  .option("--json", "Output result as JSON")
  .action((name: string, opts: { force?: boolean; json?: boolean }) =>
    aliasRemove(name, opts),
  );

aliasCmd
  .command("run <name> [args...]")
  .description("Expand and execute an alias (with optional extra args)")
  .allowUnknownOption()
  .action((name: string, args: string[]) => aliasRun(name, args));

// ── hh stats ──────────────────────────────────────────────────────────────────
program
  .command("stats")
  .description("Deep task analytics with charts, heatmaps, and peer breakdowns")
  .option("--days <n>", "Time window in days (default: 14)", "14")
  .option("--peer <name>", "Filter to a specific peer by name")
  .option("--json", "Output raw analytics as JSON")
  .action((opts: { days?: string; peer?: string; json?: boolean }) =>
    stats({
      days: opts.days ? parseInt(opts.days, 10) : undefined,
      peer: opts.peer,
      json: opts.json,
    }),
  );

// ── hh release ────────────────────────────────────────────────────────────────
program
  .command("release")
  .description("Automate the release workflow: bump version, update CHANGELOG, git commit + tag")
  .option("--patch", "Patch version bump (default)", true)
  .option("--minor", "Minor version bump")
  .option("--major", "Major version bump")
  .option("--dry-run", "Preview changes without writing")
  .option("--push", "Push commits and tags to origin")
  .option("--yes", "Skip confirmation prompts")
  .action(
    (opts: {
      patch?: boolean;
      minor?: boolean;
      major?: boolean;
      dryRun?: boolean;
      push?: boolean;
      yes?: boolean;
    }) => release(opts),
  );

// ── hh profile ────────────────────────────────────────────────────────────────
const profileCmd = program
  .command("profile")
  .description("[Phase 10a] Manage named config profiles for switching between setups");

profileCmd
  .command("list")
  .alias("ls")
  .description("List all profiles, mark active with star symbol")
  .option("--json", "Output as JSON")
  .action((opts: { json?: boolean }) => profileList(opts));

profileCmd
  .command("use <name>")
  .description("Switch active profile")
  .action((name: string) => profileUse(name));

profileCmd
  .command("create <name>")
  .description("Create new profile (blank or copied from existing)")
  .option("--from <existing>", "Copy from an existing profile")
  .action((name: string, opts: { from?: string }) => profileCreate(name, opts));

profileCmd
  .command("show [name]")
  .description("Print profile config (mask gateway tokens)")
  .option("--json", "Output as JSON")
  .action((name: string | undefined, opts: { json?: boolean }) => profileShow(name, opts));

profileCmd
  .command("delete <name>")
  .alias("rm")
  .description("Delete a profile (refuses if active)")
  .option("--force", "Force delete even if active")
  .action((name: string, opts: { force?: boolean }) => profileDelete(name, opts));

// ── hh audit ──────────────────────────────────────────────────────────────────
const auditCmd = program
  .command("audit")
  .description("[Phase 10b] View and verify the append-only audit log");

auditCmd
  .command("list")
  .description("Display audit log entries with optional filters")
  .option("--peer <name>", "Filter by peer node name")
  .option("--since <duration>", "Show entries from last N time units (e.g. 7d, 24h, 30m)")
  .option("--limit <n>", "Limit number of entries shown (default: all)")
  .option("--json", "Output as JSON")
  .action((opts: { peer?: string; since?: string; limit?: string; json?: boolean }) =>
    auditList(opts),
  );

auditCmd
  .command("verify")
  .description("Verify hash chain integrity of the audit log")
  .action(() => auditVerify());

auditCmd
  .command("export")
  .description("Export full audit log")
  .option("--json", "Export as JSON (default)")
  .option("--csv", "Export as CSV")
  .option("--output <path>", "Write to file instead of stdout")
  .action((opts: { json?: boolean; csv?: boolean; output?: string }) => auditExport(opts));

// ── hh ci ─────────────────────────────────────────────────────────────────────
program
  .command("ci <task>")
  .description("[Phase 10c] CI-friendly task delegation (no TTY, machine-readable, blocking wait)")
  .option("--json", "Output result as JSON (for parsing in CI scripts)")
  .option("--output-file <path>", "Write result text to a file")
  .action((task: string, opts: { json?: boolean; outputFile?: string }) => ci(task, opts));

// ── hh mcp ────────────────────────────────────────────────────────────────────
program
  .command("mcp")
  .description(
    "Start an MCP (Model Context Protocol) stdio server — exposes hh_send, hh_status, " +
      "hh_peers, hh_tasks, hh_broadcast, hh_wake as tools for Claude Desktop, Cursor, Zed, etc.",
  )
  .option("--list-tools", "Print tool schemas as JSON and exit (no server started)")
  .action((opts: { listTools?: boolean }) => mcp(opts));

// ── hh ask ────────────────────────────────────────────────────────────────────
program
  .command("ask")
  .description(
    "Ask your peer a quick question and stream the answer directly to the terminal.\n" +
      "Unlike `hh send`, ask is lightweight: no task state file, no polling loop, just a fast round-trip.\n\n" +
      "Examples:\n" +
      "  hh ask \"what is the weather like on your side?\"\n" +
      "  hh ask --peer glados \"list your loaded ollama models\"\n" +
      "  hh ask --timeout 30 \"run a quick disk usage check\"",
  )
  .argument("<question>", "The question or one-liner to send to the peer")
  .option("--peer <name>", "Target peer by name (default: first configured peer)")
  .option("--timeout <seconds>", "Seconds to wait for an answer (default: 60)", "60")
  .option("--json", "Output raw JSON response")
  .option("--no-stream", "Disable streaming output (print full answer at end)")
  .action(
    (
      question: string,
      opts: { peer?: string; timeout?: string; json?: boolean; stream?: boolean },
    ) =>
      ask(question, {
        peer: opts.peer,
        timeoutSeconds: opts.timeout ? parseInt(opts.timeout, 10) : 60,
        json: opts.json,
        noStream: opts.stream === false,
      }),
  );

program.parseAsync();
