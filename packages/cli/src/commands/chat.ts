/**
 * commands/chat.ts — `cofounder chat`
 *
 * Interactive multi-turn session with a peer node (H2).
 *
 * Instead of running `cofounder send` over and over, `cofounder chat` opens a persistent
 * conversation loop. Each turn:
 *   1. Reads a prompt from stdin (readline interface)
 *   2. Carries forward context_summary from prior turns
 *   3. Sends via wakeAgent, waits for the result (webhook → polling fallback)
 *   4. Streams partial output as it arrives (if H2 supports streaming)
 *   5. Updates context_summary for the next turn
 *   6. Persists each turn to task history (same as `cofounder send --wait`)
 *
 * Session summary is written at exit (Ctrl-C or `exit`/`quit`/`.q`).
 *
 * Usage:
 *   cofounder chat                       # interactive chat with primary peer
 *   cofounder chat --peer GLaDOS          # target a specific peer by name
 *   cofounder chat --no-context           # fresh context each turn (no history carry-over)
 *   cofounder chat --timeout 120          # seconds to wait per turn (default: 300)
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output, exit } from "node:process";
import pc from "picocolors";
import { loadConfig } from "../config/store.ts";
import {
  wakeAgent,
  pingPeer,
  checkGatewayHealth,
  wakeAndWait,
  createTaskMessage,
  startResultServer,
  startStreamServer,
  type StreamServerHandle,
  type ResultWebhookPayload,
} from "@cofounder/core";
import {
  loadContextSummary,
  appendContextEntry,
  buildContextSummary,
  type ContextEntry,
} from "@cofounder/core/context/store";
import { createTaskState, updateTaskState } from "../state/tasks.ts";
import { getPeer } from "../peers/select.ts";

export interface ChatOptions {
  peer?: string;
  noContext?: boolean;
  timeout?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TURN_TIMEOUT_DEFAULT = 300; // seconds
const WAKE_TIMEOUT_ATTEMPTS = 45;
const WAKE_POLL_MS = 2000;

const EXIT_WORDS = new Set(["exit", "quit", ".q", ":q", "/exit", "/quit"]);

// ─── Formatting helpers ───────────────────────────────────────────────────────

function banner(thisName: string, peerName: string, peerEmoji: string): void {
  console.log("");
  console.log(
    pc.bold(pc.cyan("╔══════════════════════════════════════════════════╗")),
  );
  console.log(
    pc.bold(pc.cyan("║")) +
      pc.bold("  cofounder chat — interactive multi-turn session        ") +
      pc.bold(pc.cyan("║")),
  );
  console.log(
    pc.bold(pc.cyan("╚══════════════════════════════════════════════════╝")),
  );
  console.log(
    `  ${pc.dim("You:")} ${pc.bold(thisName)}   ${pc.dim("→")}   ${pc.bold(peerName)} ${peerEmoji}`,
  );
  console.log(`  ${pc.dim('Type "exit" or Ctrl-C to end the session.')}`);
  console.log("");
}

function turnHeader(turn: number, peerName: string, peerEmoji: string): void {
  console.log(
    pc.dim(`\n─── Turn ${turn} · ${peerName} ${peerEmoji} `) +
      pc.dim("─".repeat(Math.max(0, 42 - String(turn).length - peerName.length))),
  );
}

function sessionSummary(
  turns: number,
  totalTokens: number,
  totalCostUsd: number,
  durationSec: number,
): void {
  console.log("");
  console.log(pc.bold(pc.cyan("─── Session summary ─────────────────────────────────")));
  console.log(`  Turns:    ${pc.bold(String(turns))}`);
  console.log(`  Tokens:   ${pc.bold(totalTokens.toLocaleString())}`);
  console.log(`  Cost:     ${pc.bold("$" + totalCostUsd.toFixed(4))}`);
  console.log(`  Duration: ${pc.bold(durationSec.toFixed(1) + "s")}`);
  console.log(pc.dim("  Context saved — next `cofounder send` or `cofounder chat` will carry forward."));
  console.log("");
}

// ─── Core send-and-wait for a single chat turn ───────────────────────────────

interface TurnResult {
  output: string;
  tokensUsed: number;
  costUsd: number;
  contextSummary: string | null;
  durationMs: number;
}

async function sendTurn(
  config: Awaited<ReturnType<typeof loadConfig>>,
  peer: ReturnType<typeof getPeer>,
  task: string,
  contextSummary: string | null,
  turnIdx: number,
  timeoutSec: number,
): Promise<TurnResult | null> {
  const msg = createTaskMessage(config.this_node.name, peer.name, task, {
    context_summary: contextSummary ?? undefined,
    turn: turnIdx,
  });

  // Write task state
  await createTaskState(msg);

  // Start result webhook server (requires gateway token for auth)
  let webhookUrl: string | null = null;
  let webhookHandle: { url: string; waitForResult: () => Promise<ResultWebhookPayload | null> } | null = null;
  const gatewayToken = peer.gateway_token;
  if (gatewayToken) {
    try {
      const h = await startResultServer({
        taskId: msg.id,
        token: gatewayToken,
        timeoutMs: timeoutSec * 1000,
      });
      webhookUrl = h.url;
      webhookHandle = h;
    } catch {
      // webhook server not available — fall back to polling
    }
  }

  // Start stream server
  let streamHandle: StreamServerHandle | null = null;
  if (gatewayToken) {
    try {
      streamHandle = await startStreamServer({
        taskId: msg.id,
        token: gatewayToken,
        timeoutMs: timeoutSec * 1000,
      });
    } catch {
      // streaming not available
    }
  }

  // Build wake text
  const resultCmd = webhookUrl
    ? `cofounder result ${msg.id} "<output>" --webhook-url ${webhookUrl}`
    : `cofounder result ${msg.id} "<output>"`;

  const wakeLines = [
    `[CofounderMessage:task from ${config.this_node.name} id=${msg.id} turn=${turnIdx}] ${task}`,
    ``,
    `When done, run: ${resultCmd}`,
  ];

  if (webhookUrl) {
    wakeLines.push(``, `HH-Result-Webhook: ${webhookUrl}`);
  }
  if (streamHandle) {
    wakeLines.push(
      ``,
      `HH-Stream-URL: ${streamHandle.url}`,
      `HH-Stream-Token: ${streamHandle.token}`,
    );
  }

  const wakeText = wakeLines.join("\n");

  // Update state to running
  await updateTaskState(msg.id, { status: "running" });

  const t0 = Date.now();

  // Ensure peer is awake
  const reachable = await pingPeer(peer.tailscale_ip, 5000);
  if (!reachable) {
    if (peer.wol?.mac) {
      process.stdout.write(pc.dim("  ⚡ H2 is offline — sending WOL magic packet…\n"));
      const woke = await wakeAndWait(peer, WAKE_TIMEOUT_ATTEMPTS, WAKE_POLL_MS);
      if (!woke) {
        console.log(pc.red("  ✗ H2 didn't wake in time."));
        await updateTaskState(msg.id, { status: "failed" });
        return null;
      }
    } else {
      console.log(pc.red(`  ✗ ${peer.name} is unreachable and WOL is not configured.`));
      await updateTaskState(msg.id, { status: "failed" });
      return null;
    }
  }

  // Check gateway
  const port = peer.gateway_port ?? 18789;
  const gatewayAlive = await checkGatewayHealth(`http://${peer.tailscale_ip}:${port}/health`);
  if (!gatewayAlive) {
    console.log(pc.red(`  ✗ ${peer.name} gateway is not responding.`));
    await updateTaskState(msg.id, { status: "failed" });
    return null;
  }

  // Send to peer
  const sent = await wakeAgent(peer, wakeText);
  if (!sent.ok) {
    console.log(pc.red(`  ✗ Failed to send to ${peer.name}: ${sent.error}`));
    await updateTaskState(msg.id, { status: "failed" });
    return null;
  }

  // Stream partial output while waiting
  if (streamHandle) {
    process.stdout.write(pc.dim(`\n  ${peer.name} is working`));
    const chunkCb = (chunk: string) => {
      process.stdout.write(chunk);
    };
    streamHandle.onChunk(chunkCb);
  }

  // Wait for result (webhook first, then poll)
  let webhookResult: ResultWebhookPayload | null = null;
  if (webhookHandle) {
    webhookResult = await webhookHandle.waitForResult();
  }

  if (webhookResult) {
    const durationMs = Date.now() - t0;
    if (streamHandle) streamHandle.close();

    // Persist result
    await updateTaskState(msg.id, {
      status: "completed",
      result: {
        output: webhookResult.output ?? "",
        error: null,
        artifacts: webhookResult.artifacts ?? [],
        tokens_used: webhookResult.tokens_used ?? 0,
        cost_usd: webhookResult.cost_usd ?? 0,
        duration_ms: durationMs,
        context_summary: webhookResult.context_summary ?? null,
      },
    });

    return {
      output: webhookResult.output ?? "",
      tokensUsed: webhookResult.tokens_used ?? 0,
      costUsd: webhookResult.cost_usd ?? 0,
      contextSummary: webhookResult.context_summary ?? null,
      durationMs,
    };
  }

  // Fallback: polling
  process.stdout.write(pc.dim(`\n  Waiting for ${peer.name}…`));
  const pollStart = Date.now();
  const pollDeadline = pollStart + timeoutSec * 1000;

  while (Date.now() < pollDeadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const { loadTaskState } = await import("../state/tasks.ts");
    const state = await loadTaskState(msg.id);
    if (!state) continue;

    if (state.status === "completed" && state.result) {
      const durationMs = Date.now() - t0;
      if (streamHandle) streamHandle.close();
      return {
        output: state.result.output ?? "",
        tokensUsed: state.result.tokens_used ?? 0,
        costUsd: state.result.cost_usd ?? 0,
        contextSummary: state.result.context_summary ?? null,
        durationMs,
      };
    }

    if (state.status === "failed") {
      if (streamHandle) streamHandle.close();
      console.log(pc.red(`\n  ✗ Task failed: ${state.result?.error ?? "unknown error"}`));
      return null;
    }

    process.stdout.write(pc.dim("."));
  }

  if (streamHandle) streamHandle.close();
  console.log(pc.yellow(`\n  ⚠ Timed out after ${timeoutSec}s. Task ${msg.id.slice(0, 8)} is still running.`));
  console.log(pc.dim(`  Check with: cofounder task-status ${msg.id.slice(0, 8)}`));
  await updateTaskState(msg.id, { status: "timeout" });
  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function chat(opts: ChatOptions): Promise<void> {
  const config = await loadConfig();
  const peer = getPeer(config, opts.peer);
  const timeoutSec = Number(opts.timeout ?? TURN_TIMEOUT_DEFAULT);
  const noContext = opts.noContext ?? false;

  banner(config.this_node.name, peer.name, peer.emoji ?? "🤖");

  const rl = readline.createInterface({ input, output, terminal: true });

  // Session state
  let turn = 1;
  let contextSummary: string | null = null;
  let totalTokens = 0;
  let totalCostUsd = 0;
  const sessionStart = Date.now();

  // Load existing context for this peer unless --no-context
  if (!noContext) {
    contextSummary = await loadContextSummary(peer.name, 3);
    if (contextSummary) {
      console.log(pc.dim(`  ↩ Resuming with ${contextSummary.split("\n").length - 1} prior turn(s) of context.`));
      console.log("");
    }
  }

  // Handle Ctrl-C / SIGINT gracefully
  let closing = false;
  const handleClose = () => {
    if (closing) return;
    closing = true;
    const elapsed = (Date.now() - sessionStart) / 1000;
    console.log("");
    if (turn > 1) {
      sessionSummary(turn - 1, totalTokens, totalCostUsd, elapsed);
    } else {
      console.log(pc.dim("  No turns completed."));
      console.log("");
    }
    rl.close();
    exit(0);
  };

  process.on("SIGINT", handleClose);
  rl.on("close", handleClose);

  // ─── Main loop ──────────────────────────────────────────────────────────────
  while (true) {
    let prompt: string;
    try {
      const thisName = config.this_node.name;
      const emoji = config.this_node.emoji ?? "🔥";
      prompt = await rl.question(
        `${pc.bold(pc.green(emoji + " " + thisName))} ${pc.dim(">")} `,
      );
    } catch {
      // readline closed (Ctrl-D / piped EOF)
      handleClose();
      break;
    }

    const trimmed = prompt.trim();
    if (!trimmed) continue;
    if (EXIT_WORDS.has(trimmed.toLowerCase())) {
      handleClose();
      break;
    }

    // Special: .context — show current context summary
    if (trimmed === ".context" || trimmed === "/context") {
      if (contextSummary) {
        console.log(pc.dim("\nCurrent context:\n") + pc.italic(contextSummary) + "\n");
      } else {
        console.log(pc.dim("  No context yet.\n"));
      }
      continue;
    }

    // Special: .clear — reset context for this session
    if (trimmed === ".clear" || trimmed === "/clear") {
      contextSummary = null;
      console.log(pc.dim("  Context cleared for this session.\n"));
      continue;
    }

    // Send the turn
    turnHeader(turn, peer.name, peer.emoji ?? "🤖");

    const turnResult = await sendTurn(
      config,
      peer,
      trimmed,
      noContext ? null : contextSummary,
      turn,
      timeoutSec,
    );

    if (!turnResult) {
      // Error was already printed inside sendTurn
      console.log(pc.dim(`  (Turn ${turn} failed. Continue or type "exit" to quit.)`));
      turn++;
      continue;
    }

    // Print the result
    console.log("\n" + pc.bold(pc.blue(`${peer.emoji ?? "🤖"} ${peer.name}:`)));
    console.log(turnResult.output);
    console.log(
      pc.dim(
        `\n  ↳ ${turnResult.tokensUsed.toLocaleString()} tokens · $${turnResult.costUsd.toFixed(4)} · ${(turnResult.durationMs / 1000).toFixed(1)}s`,
      ),
    );

    // Accumulate stats
    totalTokens += turnResult.tokensUsed;
    totalCostUsd += turnResult.costUsd;

    // Update context summary (carry H2's summary forward, or build one locally)
    const newSummary = turnResult.contextSummary ?? buildContextSummary(trimmed, turnResult.output);
    contextSummary = newSummary;

    // Persist context entry for future sessions
    if (!noContext) {
      const entry: ContextEntry = {
        task_id: `chat-turn-${turn}-${Date.now()}`,
        summary: newSummary,
        created_at: new Date().toISOString(),
      };
      await appendContextEntry(peer.name, entry);
    }

    turn++;
  }
}
