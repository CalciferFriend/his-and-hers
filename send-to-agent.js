#!/usr/bin/env node
/**
 * send-to-agent.js — Agent-to-agent messaging script for cofounder
 *
 * Usage:
 *   node send-to-agent.js --url ws://100.x.x.x:18789 --token <token> --message "text"
 *   node send-to-agent.js --config ~/.cofounder/config.json --to h2 --message "text"
 *
 * Options:
 *   --url      WebSocket URL of target gateway (ws://host:port)
 *   --token    Gateway auth token (or set HH_PEER_TOKEN env var)
 *   --to       Peer role to message (h1|h2) — resolves from config
 *   --config   Path to cofounder config.json (default: ~/.cofounder/config.json)
 *   --message  Message text to inject (-m short form)
 *   --mode     Delivery mode: now (default) | next-heartbeat
 *   --timeout  Timeout in ms (default: 10000)
 *   --quiet    Suppress output (exit code only)
 *
 * Exit codes:
 *   0 — delivered
 *   1 — delivery failed
 *   2 — configuration error
 *
 * Examples:
 *   # Send from cron/CI with direct params:
 *   node send-to-agent.js --url ws://100.119.44.38:18789 \
 *     --token "abc123" \
 *     --message "[From Calcifer] Phase 2 complete. Requesting review."
 *
 *   # Send using saved config (resolves peer from tj onboard config):
 *   node send-to-agent.js --to h2 \
 *     --message "[Calcifer → GLaDOS] New commits pushed. See git log."
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
// ws may be in a workspace package node_modules; try a few paths
let WebSocket;
try {
  ({ default: WebSocket } = await import("ws"));
} catch {
  // Walk up workspace to find ws
  const { createRequire } = await import("node:module");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join: pathJoin } = await import("node:path");
  const candidates = [
    new URL("./packages/core/node_modules/ws/index.js", import.meta.url),
    new URL("./node_modules/ws/index.js", import.meta.url),
  ];
  let loaded = false;
  for (const c of candidates) {
    try {
      ({ default: WebSocket } = await import(c.href));
      loaded = true;
      break;
    } catch {}
  }
  if (!loaded) {
    console.error("[send-to-agent] Cannot find 'ws' module. Run: npm install ws");
    process.exit(2);
  }
}

// ─── Arg parsing ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(flags, defaultVal = null) {
  for (const flag of flags) {
    const idx = args.indexOf(flag);
    if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  }
  return defaultVal;
}

function hasFlag(...flags) {
  return flags.some((f) => args.includes(f));
}

const url = getArg(["--url"]);
const tokenArg = getArg(["--token"]) ?? process.env.HH_PEER_TOKEN ?? null;
const toPeer = getArg(["--to"]);
const configPath = getArg(["--config"]) ?? join(homedir(), ".cofounder", "config.json");
const message = getArg(["--message", "-m"]);
const mode = getArg(["--mode"]) ?? "now";
const timeoutMs = parseInt(getArg(["--timeout"]) ?? "10000", 10);
const quiet = hasFlag("--quiet", "-q");

function log(...args) {
  if (!quiet) console.log(...args);
}
function err(...args) {
  console.error(...args);
}

// ─── Resolve URL + token from config if not provided ─────────────────────────

let resolvedUrl = url;
let resolvedToken = tokenArg;

if ((!resolvedUrl || !resolvedToken) && toPeer) {
  if (!existsSync(configPath)) {
    err(`[send-to-agent] Config not found: ${configPath}`);
    err(`  Run 'tj onboard' first, or pass --url and --token directly.`);
    process.exit(2);
  }

  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (e) {
    err(`[send-to-agent] Failed to parse config: ${e.message}`);
    process.exit(2);
  }

  const peer = config.peer_node;
  if (!peer) {
    err(`[send-to-agent] No peer_node in config. Run 'tj pair' first.`);
    process.exit(2);
  }

  const peerIP = peer.tailscale_ip;
  const peerPort = peer.gateway_port ?? 18789;

  if (!resolvedUrl) {
    resolvedUrl = `ws://${peerIP}:${peerPort}`;
  }
  if (!resolvedToken) {
    resolvedToken = peer.gateway_token ?? null;
  }
}

// ─── Validate ─────────────────────────────────────────────────────────────────

if (!resolvedUrl) {
  err("[send-to-agent] --url is required (or use --to with a saved config)");
  err("  Usage: node send-to-agent.js --url ws://host:port --token <tok> --message <text>");
  process.exit(2);
}

if (!resolvedToken) {
  err("[send-to-agent] --token is required (or set HH_PEER_TOKEN env var)");
  process.exit(2);
}

if (!message) {
  err("[send-to-agent] --message (-m) is required");
  process.exit(2);
}

// ─── Wake implementation (minimal, no build required) ────────────────────────

async function wakeAgent({ url, token, text, mode = "now", timeoutMs = 10_000 }) {
  return new Promise((resolve) => {
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      resolve({ ok: false, error: `WebSocket init failed: ${e.message}` });
      return;
    }

    let reqId = 1;
    let resolved = false;

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, error: "timeout" });
    }, timeoutMs);

    ws.on("error", (e) => finish({ ok: false, error: e.message }));

    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      // Handle connect.challenge → send connect request
      if (msg.method === "connect.challenge" && msg.params?.challenge) {
        ws.send(JSON.stringify({
          jsonrpc: "2.0",
          id: reqId++,
          method: "connect",
          params: {
            auth: { token },
            client: { id: "cli", mode: "cli", version: "0.1.0" },
            scopes: ["operator.admin"],
          },
        }));
        return;
      }

      // Handle connect response → send wake
      if (msg.id === 1 && msg.result?.payload?.type === "hello-ok") {
        ws.send(JSON.stringify({
          jsonrpc: "2.0",
          id: reqId++,
          method: "wake",
          params: { text, mode },
        }));
        return;
      }

      // Handle wake response
      if (msg.id === 2) {
        if (msg.result?.ok === true) {
          finish({ ok: true });
        } else {
          finish({ ok: false, error: msg.error?.message ?? JSON.stringify(msg) });
        }
      }
    });
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

log(`[send-to-agent] → ${resolvedUrl}`);
log(`[send-to-agent] Message: ${message.slice(0, 80)}${message.length > 80 ? "..." : ""}`);

const result = await wakeAgent({
  url: resolvedUrl,
  token: resolvedToken,
  text: message,
  mode,
  timeoutMs,
});

if (result.ok) {
  log("[send-to-agent] ✓ Delivered");
  process.exit(0);
} else {
  err(`[send-to-agent] ✗ Failed: ${result.error}`);
  process.exit(1);
}
