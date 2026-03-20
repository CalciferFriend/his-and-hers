import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface TailscaleStatus {
  online: boolean;
  hostname: string;
  tailscaleIP: string;
}

/**
 * Get local Tailscale status.
 */
export async function getTailscaleStatus(): Promise<TailscaleStatus> {
  try {
    const { stdout } = await execFileAsync("tailscale", ["status", "--json"]);
    const status = JSON.parse(stdout);
    return {
      online: status.BackendState === "Running",
      hostname: status.Self?.HostName ?? "",
      tailscaleIP: status.TailscaleIPs?.[0] ?? "",
    };
  } catch {
    return { online: false, hostname: "", tailscaleIP: "" };
  }
}

export interface TailscalePeer {
  hostname: string;
  os: string;
  tailscaleIP: string;
  online: boolean;
  dnsName: string;
  lastSeen: string;
}

/**
 * Check if Tailscale is installed on this machine.
 */
export async function isTailscaleInstalled(): Promise<boolean> {
  try {
    await execFileAsync("tailscale", ["version"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get Tailscale version string, or null if not installed.
 */
export async function getTailscaleVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("tailscale", ["version"], { timeout: 5000 });
    return stdout.trim().split("\n")[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * List all peers on the tailnet with their hostname, OS, IP, and online status.
 */
export async function getTailscalePeers(): Promise<TailscalePeer[]> {
  try {
    const { stdout } = await execFileAsync("tailscale", ["status", "--json"]);
    const status = JSON.parse(stdout);
    const peerMap = status.Peer ?? {};
    const peers: TailscalePeer[] = [];
    for (const peer of Object.values(peerMap) as Record<string, unknown>[]) {
      peers.push({
        hostname: (peer.HostName as string) ?? "",
        os: (peer.OS as string) ?? "",
        tailscaleIP: ((peer.TailscaleIPs as string[]) ?? [])[0] ?? "",
        online: (peer.Online as boolean) ?? false,
        dnsName: (peer.DNSName as string) ?? "",
        lastSeen: (peer.LastSeen as string) ?? "",
      });
    }
    return peers;
  } catch {
    return [];
  }
}

/**
 * Ping a Tailscale peer to check reachability.
 * Returns true if the peer responds within timeout.
 */
export async function pingPeer(
  ip: string,
  timeoutMs = 5000,
): Promise<boolean> {
  try {
    // Note: tailscale ping uses -c (single dash), not --c. GLaDOS caught this in review 2026-03-11.
    const { stdout } = await execFileAsync("tailscale", ["ping", "-c", "1", "--timeout", `${Math.ceil(timeoutMs / 1000)}s`, ip]);
    return stdout.includes("pong");
  } catch {
    return false;
  }
}

/**
 * Poll a Tailscale peer until it's reachable or we time out.
 */
export async function waitForPeer(
  ip: string,
  { intervalMs = 2000, maxAttempts = 60 } = {},
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (await pingPeer(ip)) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}
