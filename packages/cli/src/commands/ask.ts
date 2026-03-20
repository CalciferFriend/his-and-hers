/**
 * commands/ask.ts — `cofounder ask`
 *
 * Lightweight single-question command — faster and quieter than `cofounder send`.
 * Sends a question to the peer, waits for the answer, and prints it.
 *
 * Differences from `cofounder send`:
 *   - No audit log entry
 *   - No budget gate
 *   - No notification events
 *   - No context tracking
 *   - Minimal UX: one spinner, plain answer output
 *   - Default timeout 60s (vs 120s for send)
 *
 * Usage:
 *   cofounder ask "what is the weather like on your side?"
 *   cofounder ask --peer glados "list your loaded ollama models"
 *   cofounder ask --timeout 30 "quick disk usage check"
 *   cofounder ask --json "disk usage"
 *   cofounder ask --no-stream "heavy task"   # disable streaming, poll only
 *
 * Phase 14 — Calcifer ✅ (2026-03-16)
 */

import { randomUUID } from "node:crypto";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { loadConfig } from "../config/store.ts";
import { getAllPeers } from "../peers/select.ts";
import {
  wakeAgent,
  pingPeer,
  checkGatewayHealth,
  startResultServer,
  startStreamServer,
  type ResultWebhookPayload,
} from "@cofounder/core";
import { createTaskState, pollTaskCompletion } from "../state/tasks.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AskOptions {
  peer?: string;
  timeoutSeconds?: number;
  json?: boolean;
  noStream?: boolean;
}

export interface AskResult {
  ok: boolean;
  question: string;
  answer?: string;
  peer: string;
  duration_ms: number;
  error?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build the wake-message text for an ask request.
 * Lighter than `cofounder send`: no attachments, no context summary, no cron hints.
 */
export function buildAskText(
  from: string,
  taskId: string,
  question: string,
  webhookUrl: string | null,
  streamUrl?: string | null,
  streamToken?: string | null,
): string {
  const resultCmd = webhookUrl
    ? `cofounder result ${taskId} "<your answer>" --webhook-url ${webhookUrl}`
    : `cofounder result ${taskId} "<your answer>"`;

  const lines = [
    `[CofounderMessage:ask from ${from} id=${taskId}] ${question}`,
    ``,
    `When done, run: ${resultCmd}`,
  ];

  if (webhookUrl) {
    lines.push(``, `HH-Result-Webhook: ${webhookUrl}`);
  }

  if (streamUrl && streamToken) {
    lines.push(``, `HH-Stream-URL: ${streamUrl}`, `HH-Stream-Token: ${streamToken}`);
  }

  return lines.join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function ask(question: string, opts: AskOptions = {}): Promise<void> {
  const { timeoutSeconds = 60, json = false, noStream = false } = opts;
  const timeoutMs = timeoutSeconds * 1000;

  // ── Validate ──────────────────────────────────────────────────────────────
  if (!question.trim()) {
    if (!json) p.log.error("Question cannot be empty.");
    else console.log(JSON.stringify({ ok: false, error: "Question cannot be empty." }));
    process.exit(1);
  }

  // ── Config ─────────────────────────────────────────────────────────────────
  const config = await loadConfig();
  if (!config) {
    if (!json) p.log.error("No cofounder config found. Run `cofounder onboard` first.");
    else console.log(JSON.stringify({ ok: false, error: "No cofounder config found." }));
    process.exit(1);
  }

  const allPeers = getAllPeers(config);
  if (allPeers.length === 0) {
    if (!json) p.log.error("No peers configured. Run `cofounder onboard` to add a peer.");
    else console.log(JSON.stringify({ ok: false, error: "No peers configured." }));
    process.exit(1);
  }

  const targetPeer = opts.peer
    ? allPeers.find((pr) => pr.name === opts.peer)
    : allPeers[0];

  if (!targetPeer) {
    const names = allPeers.map((pr) => pr.name).join(", ");
    if (!json)
      p.log.error(`Peer "${opts.peer}" not found. Available: ${names}`);
    else
      console.log(JSON.stringify({ ok: false, error: `Peer "${opts.peer}" not found.` }));
    process.exit(1);
  }

  const started = Date.now();

  if (!json) p.intro(`${pc.bold("cofounder ask")} → ${pc.cyan(targetPeer.name)}`);

  // ── Reachability (best effort) ─────────────────────────────────────────────
  const peerPort = targetPeer.gateway_port ?? 18789;
  const gwUrl = `ws://${targetPeer.tailscale_ip}:${peerPort}`;
  const gwHealthUrl = `http://${targetPeer.tailscale_ip}:${peerPort}/health`;

  const [reachable, gwHealthy] = await Promise.all([
    pingPeer(targetPeer.tailscale_ip, 4_000).catch(() => false),
    checkGatewayHealth(gwHealthUrl, 4_000).catch(() => false),
  ]);
  if (!json && (!reachable || !gwHealthy)) {
    p.log.warn(pc.yellow(`${targetPeer.name} may be offline — sending anyway`));
  }

  // ── Task state ─────────────────────────────────────────────────────────────
  const taskId = `ask-${randomUUID().slice(0, 8)}`;
  const fromName = config.this_node?.name ?? "h1";

  await createTaskState({
    id: taskId,
    from: fromName,
    to: targetPeer.name,
    objective: question,
    constraints: [],
  }).catch(() => null);

  // ── Servers: result webhook + streaming ───────────────────────────────────
  let webhookUrl: string | null = null;
  let resultDone: Promise<ResultWebhookPayload> | undefined;

  const resultToken = randomUUID().replace(/-/g, "");
  const resultSrv = await startResultServer({ taskId, token: resultToken, timeoutMs }).catch(
    () => null,
  );
  if (resultSrv) {
    webhookUrl = resultSrv.url;
    resultDone = resultSrv.result;
  }

  let streamUrl: string | null = null;
  let streamToken: string | null = null;
  let streamHandle: Awaited<ReturnType<typeof startStreamServer>> | null = null;

  if (!noStream) {
    const token = randomUUID().replace(/-/g, "");
    streamHandle = await startStreamServer({
      taskId,
      token,
      timeoutMs,
    }).catch(() => null);
    if (streamHandle) {
      streamUrl = streamHandle.url;
      streamToken = token;
    }
  }

  // ── Wake the peer ──────────────────────────────────────────────────────────
  if (!targetPeer.gateway_token) {
    streamHandle?.close();
    if (!json) {
      p.log.error("Peer gateway token not set. Run `cofounder pair` first.");
      p.outro("Ask failed.");
    } else {
      console.log(JSON.stringify({ ok: false, error: "Gateway token not set." }));
    }
    process.exit(1);
  }

  const wakeText = buildAskText(fromName, taskId, question, webhookUrl, streamUrl, streamToken);
  const sendResult = await wakeAgent({
    url: gwUrl,
    token: targetPeer.gateway_token,
    text: wakeText,
    timeoutMs: 10_000,
  });

  if (!sendResult.ok) {
    const errMsg = sendResult.error ?? "send failed";
    streamHandle?.close();
    if (json) {
      console.log(
        JSON.stringify({
          ok: false,
          question,
          peer: targetPeer.name,
          duration_ms: Date.now() - started,
          error: errMsg,
        } satisfies AskResult),
      );
    } else {
      p.log.error(`Send failed: ${errMsg}`);
      p.outro(pc.red("Ask failed."));
    }
    process.exit(1);
  }

  // ── Collect the answer ─────────────────────────────────────────────────────
  let answer: string | null = null;

  const collectAnswer = async (): Promise<string | null> => {
    // 1. Try streaming first (real-time chunks)
    if (streamHandle) {
      const chunks: string[] = [];
      streamHandle.on("chunk", (chunk: string) => chunks.push(chunk));
      await Promise.race([
        streamHandle.done,
        new Promise<void>((r) => setTimeout(r, timeoutMs)),
      ]);
      const streamed = chunks.join("").trim();
      if (streamed) return streamed;
    }

    // 2. Fall back to webhook result
    if (resultDone) {
      const payload = await Promise.race([
        resultDone.then((r) => r).catch(() => null),
        new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
      ]);
      if (payload?.output) return payload.output;
    }

    // 3. Last resort: poll task state file
    const state = await pollTaskCompletion(taskId, {
      timeoutMs,
      pollIntervalMs: 2_000,
    }).catch(() => null);
    return state?.result?.output ?? null;
  };

  if (!json) {
    const spinner = p.spinner();
    spinner.start(`Waiting for ${targetPeer.name}…`);

    if (streamHandle) {
      const chunks: string[] = [];
      streamHandle.on("chunk", (chunk: string) => {
        chunks.push(chunk);
        spinner.message(pc.dim(chunks.join("").slice(-70).replace(/\n/g, " ")));
      });
      await Promise.race([
        streamHandle.done,
        new Promise<void>((r) => setTimeout(r, timeoutMs)),
      ]);
      answer = chunks.join("").trim() || null;
    }

    if (!answer) {
      if (resultDone) {
        const payload = await Promise.race([
          resultDone.then((r) => r).catch(() => null),
          new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
        ]);
        answer = payload?.output ?? null;
      } else {
        const state = await pollTaskCompletion(taskId, {
          timeoutMs,
          pollIntervalMs: 2_000,
        }).catch(() => null);
        answer = state?.result?.output ?? null;
      }
    }

    spinner.stop(
      answer ? pc.green("Answer received ✓") : pc.yellow(`Timed out after ${timeoutSeconds}s`),
    );
  } else {
    answer = await collectAnswer();
  }

  streamHandle?.close();

  const duration_ms = Date.now() - started;

  // ── Output ─────────────────────────────────────────────────────────────────
  if (json) {
    const result: AskResult = {
      ok: answer !== null,
      question,
      answer: answer ?? undefined,
      peer: targetPeer.name,
      duration_ms,
      error: answer === null ? `No response within ${timeoutSeconds}s` : undefined,
    };
    console.log(JSON.stringify(result, null, 2));
    process.exit(answer !== null ? 0 : 1);
  }

  if (answer !== null) {
    p.note(answer, `${targetPeer.name} says`);
    p.outro(`${pc.green("✓")} Answered in ${pc.dim(`${(duration_ms / 1000).toFixed(1)}s`)}`);
  } else {
    p.log.warn(`No response from ${targetPeer.name} within ${timeoutSeconds}s.`);
    p.log.info(`Tip: check status with: cofounder status`);
    p.outro(pc.yellow("Ask timed out."));
    process.exit(1);
  }
}
