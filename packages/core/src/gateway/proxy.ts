/**
 * gateway/proxy.ts
 *
 * Tailscale↔Loopback TCP proxy helpers for H1 (Linux) and H2 (Windows).
 *
 * ## The Problem
 *
 * OpenClaw's local tools (message, cron, sessions) expect the gateway on
 * loopback (127.0.0.1:18789). But the peer agent needs to reach this node
 * via its Tailscale IP. You can't bind the gateway to both at once.
 *
 * ## Solutions by role
 *
 * ### H1 (Linux) — gateway binds to loopback, proxy exposes Tailscale
 *
 *   Keep H1's gateway on loopback. Run a socat proxy that listens on the
 *   Tailscale interface and forwards to loopback.
 *
 *   H2                                      H1
 *   ─────                                      ───
 *   ws://tom-tailscale-ip:18789 ─ Tailscale ─► socat (tailscale IF:18789)
 *                                                   │ forwards
 *                                              127.0.0.1:18789 (gateway)
 *
 *   Persistent via systemd user service. See buildSystemdService().
 *   Command: socat TCP-LISTEN:18789,bind=<tailscaleIP>,reuseaddr,fork TCP:127.0.0.1:18789
 *
 * ### H2 (Windows) — gateway binds to Tailscale, proxy exposes loopback
 *
 *   H2's gateway binds to the Tailscale IP so H1 can reach it.
 *   But the local OpenClaw TUI connects to ws://127.0.0.1:18789 — which
 *   isn't listening — so the TUI fails to open.
 *
 *   Fix: Windows netsh portproxy (built-in, registry-persistent, no extra tools).
 *   Routes loopback:18789 → tailscale-ip:18789, making the TUI work locally.
 *
 *   TUI (local)                                H2 gateway
 *   ───────────                                ─────────────
 *   127.0.0.1:18789 ─► netsh portproxy ──────► tailscale-ip:18789
 *
 *   Persistent: netsh rules survive reboots (stored in registry).
 *   Command: netsh interface portproxy add v4tov4
 *              listenaddress=127.0.0.1 listenport=18789
 *              connectaddress=<tailscaleIP> connectport=18789
 *
 *   See buildNetshPortProxyCommand() and addWindowsLoopbackProxy().
 *
 * ## Summary
 *
 *   Role   | Gateway binds to | Proxy direction          | Tool
 *   ────── | ──────────────── | ─────────────────────── | ──────────────
 *   H1    | loopback         | tailscale → loopback    | socat (Linux)
 *   H2  | tailscale        | loopback → tailscale    | netsh (Windows)
 */

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface ProxyConfig {
  /** H1's Tailscale IP (e.g. 100.116.25.69) */
  tailscaleIP: string;
  /** Port to listen on and forward to (default: 18789) */
  port?: number;
}

/**
 * Returns the socat command that proxies the Tailscale interface to loopback.
 * This is what runs inside the systemd user service.
 */
export function buildSocatCommand(config: ProxyConfig): string {
  const port = config.port ?? 18789;
  // GLaDOS review (2026-03-11): systemd user units don't inherit PATH,
  // so "socat" without an absolute path fails silently. Always use full path.
  return [
    "/usr/bin/socat",
    `TCP-LISTEN:${port},bind=${config.tailscaleIP},reuseaddr,fork`,
    `TCP:127.0.0.1:${port}`,
  ].join(" ");
}

/**
 * Generates the content of the systemd user service file.
 */
export function buildSystemdService(config: ProxyConfig): string {
  const port = config.port ?? 18789;
  // GLaDOS review (2026-03-11): systemd user services run with a minimal PATH,
  // so 'socat' won't be found without an absolute path. Use /usr/bin/socat or
  // detect the path at setup time via 'which socat'.
  const socatBin = "/usr/bin/socat"; // override with which() result at install time
  const cmd = buildSocatCommand(config).replace(/^socat/, socatBin);
  return `[Unit]
Description=H1 Tailscale→Loopback Gateway Proxy (port ${port})
After=network.target tailscaled.service openclaw-gateway.service
Requires=openclaw-gateway.service

[Service]
Type=simple
ExecStart=${cmd}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`;
}

/**
 * Checks whether socat is installed on the current system.
 */
export async function isSocatInstalled(): Promise<boolean> {
  try {
    await execAsync("which socat");
    return true;
  } catch {
    return false;
  }
}

// ─── Windows (H2) helpers ─────────────────────────────────────────────────

/**
 * Returns the netsh portproxy command that makes the OpenClaw TUI work locally
 * on a H2 node whose gateway is bound to a Tailscale IP.
 *
 * Problem: H2 binds its gateway to <tailscaleIP>:18789 so H1 can reach it.
 * The local OpenClaw TUI always connects to ws://127.0.0.1:18789 — which isn't
 * listening — so the TUI fails to open on the same machine.
 *
 * Fix: Add a Windows portproxy rule (loopback → tailscaleIP). Persists in the
 * registry across reboots — no scheduled task or service needed.
 *
 * @example
 * // Run once (elevated prompt on H2):
 * const cmd = buildNetshPortProxyCommand({ tailscaleIP: "100.119.44.38" });
 * // netsh interface portproxy add v4tov4 listenaddress=127.0.0.1 listenport=18789 connectaddress=100.119.44.38 connectport=18789
 */
export function buildNetshPortProxyCommand(config: ProxyConfig): string {
  const port = config.port ?? 18789;
  return [
    "netsh interface portproxy add v4tov4",
    `listenaddress=127.0.0.1`,
    `listenport=${port}`,
    `connectaddress=${config.tailscaleIP}`,
    `connectport=${port}`,
  ].join(" ");
}

/**
 * Returns the netsh command to remove the portproxy rule (e.g. during uninstall).
 */
export function buildNetshPortProxyRemoveCommand(config: ProxyConfig): string {
  const port = config.port ?? 18789;
  return `netsh interface portproxy delete v4tov4 listenaddress=127.0.0.1 listenport=${port}`;
}

/**
 * Adds the loopback→tailscale portproxy rule on the current Windows machine.
 * Must be run in an elevated (admin) context.
 *
 * Idempotent: if the rule already exists, netsh returns an error which we swallow.
 */
export async function addWindowsLoopbackProxy(config: ProxyConfig): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("addWindowsLoopbackProxy is Windows-only");
  }
  const cmd = buildNetshPortProxyCommand(config);
  try {
    await execAsync(cmd);
  } catch (err: unknown) {
    // netsh exits non-zero if the rule already exists — that's fine
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("already exists") && !msg.includes("The object already exists")) {
      throw err;
    }
  }
}

/**
 * Verifies the portproxy rule is present on the current Windows machine.
 */
export async function isWindowsLoopbackProxyInstalled(config: ProxyConfig): Promise<boolean> {
  if (process.platform !== "win32") return false;
  const port = config.port ?? 18789;
  try {
    const { stdout } = await execAsync("netsh interface portproxy show all");
    return stdout.includes(`127.0.0.1`) && stdout.includes(String(port)) && stdout.includes(config.tailscaleIP);
  } catch {
    return false;
  }
}
