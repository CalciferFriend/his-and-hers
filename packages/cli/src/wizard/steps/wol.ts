import * as p from "@clack/prompts";
import pc from "picocolors";
import { networkInterfaces } from "node:os";
import { sshExec } from "@cofounder/core";
import { isCancelled, type WizardContext } from "../context.ts";

// ── Network adapter detection ────────────────────────────────────────────────

interface NetworkAdapter {
  name: string;
  mac: string;
  ipv4: string;
  broadcastIP: string;
}

/**
 * Detect physical network adapters on the local machine via os.networkInterfaces().
 * Filters out Tailscale, loopback, Hyper-V virtual, and point-to-point interfaces.
 */
function detectLocalAdapters(): NetworkAdapter[] {
  const ifaces = networkInterfaces();
  const adapters: NetworkAdapter[] = [];

  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue;
    const lower = name.toLowerCase();
    if (lower.includes("tailscale")) continue;
    if (lower.includes("loopback")) continue;
    if (lower.includes("vethernet")) continue;
    if (lower === "lo") continue;

    for (const addr of addrs) {
      if (addr.internal) continue;
      if (addr.family !== "IPv4") continue;
      if (addr.mac === "00:00:00:00:00:00") continue;
      if (addr.netmask === "255.255.255.255") continue;

      const ipParts = addr.address.split(".").map(Number);
      const maskParts = addr.netmask.split(".").map(Number);
      const broadcastParts = ipParts.map((ip, i) => ip | (~maskParts[i] & 255));

      adapters.push({
        name,
        mac: addr.mac.toUpperCase(),
        ipv4: addr.address,
        broadcastIP: broadcastParts.join("."),
      });
    }
  }

  return adapters;
}

/**
 * Detect network adapters on a remote peer via SSH.
 * Runs a Node.js one-liner (guaranteed available since cofounder requires Node 22+).
 */
async function detectRemoteAdapters(
  ssh: { host: string; user: string; keyPath: string },
  peerOS: string,
): Promise<NetworkAdapter[]> {
  try {
    // Same logic as detectLocalAdapters() but run as a Node one-liner over SSH.
    // Works on all platforms since cofounder requires Node.js.
    const nodeScript = [
      `const o=require('os').networkInterfaces()`,
      `for(const[k,v]of Object.entries(o)){`,
      `const l=k.toLowerCase()`,
      `if(l.includes('tailscale')||l.includes('loopback')||l==='lo'||l.includes('vethernet'))continue`,
      `for(const a of v){`,
      `if(a.internal||a.family!=='IPv4'||a.mac==='00:00:00:00:00:00'||a.netmask==='255.255.255.255')continue`,
      `const p=a.address.split('.').map(Number)`,
      `const m=a.netmask.split('.').map(Number)`,
      `const b=p.map((x,i)=>x|(~m[i]&255))`,
      `console.log(JSON.stringify({name:k,mac:a.mac.toUpperCase(),ipv4:a.address,broadcastIP:b.join('.')}))`,
      `}}`,
    ].join(";");

    const cmd = peerOS === "windows"
      ? `node -e "${nodeScript.replace(/"/g, '\\"')}"`
      : `node -e '${nodeScript.replace(/'/g, "'\\''")}'`;

    const output = await sshExec(ssh, cmd, 15_000);
    return output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line) as NetworkAdapter; } catch { return null; }
      })
      .filter(Boolean) as NetworkAdapter[];
  } catch {
    return [];
  }
}

// ── Main step ────────────────────────────────────────────────────────────────

export async function stepWOL(ctx: Partial<WizardContext>): Promise<Partial<WizardContext>> {
  const jerryIsRemote = ctx.role === "h1";
  const target = jerryIsRemote ? "the remote H2 node" : "this machine (H2)";

  const wolEnabled = await p.confirm({
    message: `Does ${target} need Wake-on-LAN? (i.e., is it a machine that sleeps/shuts down)`,
    initialValue: jerryIsRemote,
  });

  if (isCancelled(wolEnabled)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  if (!wolEnabled) {
    p.log.info("WOL disabled — both machines are assumed always-on.");
    return {
      ...ctx,
      wolEnabled: false,
      wolMAC: "",
      wolBroadcastIP: "",
      wolRouterPort: 9,
      wolTimeoutSeconds: 120,
      wolPollIntervalSeconds: 2,
    };
  }

  // ── Auto-detect network adapters ────────────────────────────────────────
  const spinner = p.spinner();
  spinner.start("Detecting network adapters on H2...");

  let adapters: NetworkAdapter[] = [];

  if (!jerryIsRemote) {
    // Running ON H2 — detect locally
    adapters = detectLocalAdapters();
  } else if (ctx.peerTailscaleIP && ctx.peerSSHUser && ctx.peerSSHKeyPath) {
    // Running on H1 — detect on remote H2 via SSH
    adapters = await detectRemoteAdapters(
      { host: ctx.peerTailscaleIP, user: ctx.peerSSHUser, keyPath: ctx.peerSSHKeyPath },
      ctx.peerOS ?? "linux",
    );
  }

  spinner.stop(
    adapters.length > 0
      ? `Found ${adapters.length} network adapter${adapters.length === 1 ? "" : "s"}.`
      : "Could not auto-detect network adapters.",
  );

  let selectedMAC: string;
  let selectedBroadcast: string;

  if (adapters.length === 1) {
    // Single adapter — use it automatically
    selectedMAC = adapters[0].mac;
    selectedBroadcast = adapters[0].broadcastIP;
    p.log.success(
      `Using ${pc.cyan(adapters[0].name)}: MAC ${pc.cyan(selectedMAC)}, ` +
      `IP ${adapters[0].ipv4}, broadcast ${selectedBroadcast}`,
    );
  } else if (adapters.length > 1) {
    // Multiple adapters — let user pick
    const choice = await p.select({
      message: "Which network adapter should WOL target?",
      options: adapters.map((a) => ({
        value: a.mac,
        label: a.name,
        hint: `${a.mac} | ${a.ipv4} | broadcast ${a.broadcastIP}`,
      })),
    });

    if (isCancelled(choice)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }

    const found = adapters.find((a) => a.mac === choice)!;
    selectedMAC = found.mac;
    selectedBroadcast = found.broadcastIP;
    p.log.success(`Using ${pc.cyan(found.name)}: MAC ${pc.cyan(selectedMAC)}`);
  } else {
    // No adapters detected — manual entry
    const answers = await p.group(
      {
        mac: () =>
          p.text({
            message: "MAC address of the H2 node's network adapter",
            placeholder: "AA:BB:CC:DD:EE:FF",
            validate: (v: string) => {
              const cleaned = v.replace(/[:-]/g, "");
              if (cleaned.length !== 12 || !/^[0-9a-fA-F]+$/.test(cleaned))
                return "Enter a valid MAC address (e.g., AA:BB:CC:DD:EE:FF)";
            },
          }),
        broadcastIP: () =>
          p.text({
            message: "Broadcast IP for the WOL packet",
            placeholder: "192.168.1.255",
            validate: (v: string) => {
              if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v.trim()))
                return "Enter a valid IPv4 address";
            },
          }),
      },
      {
        onCancel: () => {
          p.cancel("Setup cancelled.");
          process.exit(0);
        },
      },
    );
    selectedMAC = answers.mac;
    selectedBroadcast = answers.broadcastIP;
  }

  p.log.info(
    `WOL configured: MAC ${pc.cyan(selectedMAC)}, broadcast ${selectedBroadcast}:9, timeout 120s`,
  );

  return {
    ...ctx,
    wolEnabled: true,
    wolMAC: selectedMAC,
    wolBroadcastIP: selectedBroadcast,
    wolRouterPort: 9,
    wolTimeoutSeconds: 120,
    wolPollIntervalSeconds: 2,
  };
}
