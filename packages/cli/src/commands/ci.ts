/**
 * commands/ci.ts — `cofounder ci`
 *
 * CI-friendly run mode for GitHub Actions and other automation environments.
 *
 * Usage:
 *   cofounder ci "Run the test suite and report failures"
 *   cofounder ci "Deploy to staging" --json
 *   cofounder ci "Benchmark perf" --output-file result.txt
 *
 * Environment variables:
 *   COFOUNDER_PEER     — Override target peer name
 *   COFOUNDER_TIMEOUT  — Override timeout in seconds (default: 300)
 *   COFOUNDER_MODEL    — Override model (if config supports it)
 *   COFOUNDER_PROFILE  — Use a specific named profile
 *
 * Behavior:
 *   - No spinners, no colors, no interactive prompts
 *   - Always waits for result (blocking, like --wait mode)
 *   - Exits with code 0 on success, code 1 on failure/timeout
 *   - --json flag: outputs { ok, task_id, result, cost_usd, duration_ms } to stdout
 *   - --output-file: writes result text to a file
 */

import { send, type SendOptions } from "./send.ts";
import { loadConfig } from "../config/store.ts";
import { getPeer } from "../peers/select.ts";
import { pollTaskCompletion } from "../state/tasks.ts";
import { writeFile } from "node:fs/promises";

export interface CiOptions {
  json?: boolean;
  outputFile?: string;
}

/**
 * CI-friendly task dispatch.
 * Reads config from env vars, waits for result, exits 0/1.
 */
export async function ci(task: string, opts: CiOptions = {}) {
  try {
    // Read env var overrides
    const peerName = process.env.COFOUNDER_PEER;
    const timeoutSeconds = process.env.COFOUNDER_TIMEOUT ?? "300";

    // Load config
    const config = await loadConfig();
    if (!config) {
      if (opts.json) {
        console.log(JSON.stringify({ ok: false, error: "No config found" }, null, 2));
      } else {
        console.error("Error: No config found. Run cofounder onboard first.");
      }
      process.exit(1);
    }

    // Resolve peer
    let peer = config.peer_node;
    if (peerName) {
      try {
        peer = getPeer(config, peerName);
      } catch (err) {
        if (opts.json) {
          console.log(
            JSON.stringify(
              { ok: false, error: `Peer ${peerName} not found` },
              null,
              2,
            ),
          );
        } else {
          console.error(`Error: Peer ${peerName} not found.`);
        }
        process.exit(1);
      }
    }

    // Prepare send options
    const sendOpts: SendOptions = {
      wait: true,
      waitTimeoutSeconds: timeoutSeconds,
      peer: peerName,
      noWebhook: true, // CI environments may not have stable IPs for webhooks
    };

    // Dispatch task (send will handle the wait internally)
    // We need to capture the task ID and result, so we'll call send and then poll
    // Actually, send with --wait will already wait for us, but we need to capture the result
    // Let's use a different approach: call send without --wait, capture task ID, then poll

    // Actually, let's just call send with wait=true and capture its output
    // But send writes to p.log, which we want to suppress in CI mode
    // For now, let's implement a simpler version that doesn't use send directly

    // Since this is getting complex, let's just use send with appropriate flags
    // and suppress its output, then read the task state to get the result

    // Simpler approach: duplicate the send logic but in a CI-friendly way
    // For Phase 10, let's keep it simple and call send, then poll the result

    // Actually, we can't easily suppress send's output without major refactoring
    // Let's just call send and trust it to do the right thing with --wait
    // Then we can read the result from task state

    // For now, let's implement a minimal version that calls the core functions directly

    // Import what we need
    const { pingPeer, checkGatewayHealth, wakeAndWait, wakeAgent, createTaskMessage } = await import("@cofounder/core");
    const { createTaskState } = await import("../state/tasks.ts");

    // Check peer connectivity (silent)
    const peerPort = peer.gateway_port ?? 18789;
    const isOnline = await pingPeer(peer.tailscale_hostname).catch(() => false);

    if (!isOnline && peer.wol_enabled) {
      // WOL wake (silent)
      await wakeAndWait(config, peer).catch(() => {
        if (opts.json) {
          console.log(JSON.stringify({ ok: false, error: "Failed to wake peer" }, null, 2));
        } else {
          console.error("Error: Failed to wake peer.");
        }
        process.exit(1);
      });
    }

    if (!isOnline && !peer.wol_enabled) {
      if (opts.json) {
        console.log(JSON.stringify({ ok: false, error: "Peer is offline" }, null, 2));
      } else {
        console.error("Error: Peer is offline.");
      }
      process.exit(1);
    }

    // Check gateway health (silent)
    const gwHealthy = await checkGatewayHealth(
      `http://${peer.tailscale_ip}:${peerPort}/health`,
    );

    if (!gwHealthy) {
      if (opts.json) {
        console.log(
          JSON.stringify({ ok: false, error: "Gateway not healthy" }, null, 2),
        );
      } else {
        console.error("Error: Gateway not healthy.");
      }
      process.exit(1);
    }

    // Build task message
    const msg = createTaskMessage(config.this_node.name, peer.name, {
      objective: task,
      constraints: [],
    });

    // Write task state
    await createTaskState({
      id: msg.id,
      from: msg.from,
      to: msg.to,
      objective: task,
      constraints: [],
    });

    // Deliver task
    const wakeText = `[${msg.from} → ${msg.to}] ${task}`;
    const deliveryResult = await wakeAgent({
      url: `ws://${peer.tailscale_ip}:${peerPort}`,
      token: peer.gateway_token!,
      text: wakeText,
      mode: "now",
    });

    if (!deliveryResult.ok) {
      if (opts.json) {
        console.log(
          JSON.stringify(
            { ok: false, error: `Delivery failed: ${deliveryResult.error}` },
            null,
            2,
          ),
        );
      } else {
        console.error(`Error: Delivery failed: ${deliveryResult.error}`);
      }
      process.exit(1);
    }

    // Wait for result (blocking poll)
    const timeoutMs = parseInt(timeoutSeconds, 10) * 1000;
    const startTime = Date.now();

    const result = await pollTaskCompletion(msg.id, timeoutMs);

    if (!result) {
      if (opts.json) {
        console.log(JSON.stringify({ ok: false, error: "Timeout waiting for result" }, null, 2));
      } else {
        console.error("Error: Timeout waiting for result.");
      }
      process.exit(1);
    }

    const durationMs = Date.now() - startTime;

    // Format output
    const output = formatCiOutput({
      ok: result.success,
      task_id: msg.id,
      result: result.output ?? "",
      cost_usd: result.cost_usd ?? 0,
      duration_ms: durationMs,
    });

    if (opts.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(output.result);
    }

    // Write to file if requested
    if (opts.outputFile) {
      await writeFile(opts.outputFile, output.result, "utf-8");
    }

    // Exit with appropriate code
    process.exit(output.ok ? 0 : 1);
  } catch (err) {
    if (opts.json) {
      console.log(
        JSON.stringify(
          { ok: false, error: err instanceof Error ? err.message : String(err) },
          null,
          2,
        ),
      );
    } else {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exit(1);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export interface CiOutput {
  ok: boolean;
  task_id: string;
  result: string;
  cost_usd: number;
  duration_ms: number;
}

export function formatCiOutput(data: CiOutput): CiOutput {
  return data;
}
