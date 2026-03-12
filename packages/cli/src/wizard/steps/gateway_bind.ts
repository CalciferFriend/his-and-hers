import * as p from "@clack/prompts";
import pc from "picocolors";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sshExec } from "@his-and-hers/core";
import { addWindowsLoopbackProxy, isWindowsLoopbackProxyInstalled } from "@his-and-hers/core";
import { ROLE_DEFAULTS } from "../../config/defaults.ts";
import { isCancelled, type WizardContext } from "../context.ts";

const execFileAsync = promisify(execFile);

/** Resolve this machine's openclaw.json path */
function localOpenClawConfigPath(): string {
  if (process.platform === "win32") {
    return join(process.env["USERPROFILE"] ?? homedir(), ".openclaw", "openclaw.json");
  }
  return join(homedir(), ".openclaw", "openclaw.json");
}

/** Read, merge, and write openclaw.json */
async function patchLocalOpenClawConfig(patch: Record<string, unknown>): Promise<void> {
  const path = localOpenClawConfigPath();
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(await readFile(path, "utf-8"));
  } catch { /* first run */ }
  const merged = deepMerge(existing, patch);
  await writeFile(path, JSON.stringify(merged, null, 2), { mode: 0o600 });
}

function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === "object" && !Array.isArray(v) && typeof out[k] === "object" && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Restart the local OpenClaw gateway */
async function restartLocalGateway(): Promise<boolean> {
  try {
    await execFileAsync("openclaw", ["gateway", "restart"], { timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

export async function stepGatewayBind(ctx: Partial<WizardContext>): Promise<Partial<WizardContext>> {
  const role = ctx.role!;
  const defaults = ROLE_DEFAULTS[role];
  const peerRole = role === "h1" ? "jerry" : "tom";
  const peerDefaults = ROLE_DEFAULTS[peerRole];

  // ── Step 1: choose bind mode for THIS node ────────────────────────────────
  const thisBindMode = await p.select({
    message: `Gateway bind mode for this node (${ctx.name})`,
    initialValue: defaults.bindMode,
    options: [
      { value: "loopback" as const, label: "Loopback (127.0.0.1)", hint: "local only — recommended for H1" },
      { value: "tailscale" as const, label: "Tailscale IP", hint: "peer-reachable — recommended for H2" },
      { value: "lan" as const, label: "LAN (0.0.0.0)", hint: "all interfaces — use with caution" },
    ],
  });
  if (isCancelled(thisBindMode)) { p.cancel("Setup cancelled."); process.exit(0); }

  const peerGatewayPortStr = await p.text({
    message: "Gateway port on the peer node",
    initialValue: "18789",
    validate: (v) => { const n = parseInt(v, 10); if (isNaN(n) || n < 1 || n > 65535) return "Enter a valid port"; },
  });
  if (isCancelled(peerGatewayPortStr)) { p.cancel("Setup cancelled."); process.exit(0); }
  const peerGatewayPort = parseInt(peerGatewayPortStr as string, 10);

  // ── Step 2: patch THIS node's openclaw.json ───────────────────────────────
  {
    const s = p.spinner();
    s.start("Updating local gateway config...");
    try {
      const bindPatch: Record<string, unknown> = {
        gateway: {
          bind: thisBindMode,
          // For H2 (tailscale bind), also add H1's IP to trustedProxies
          ...(thisBindMode === "tailscale" && ctx.peerTailscaleIP
            ? { trustedProxies: ["127.0.0.1", ctx.peerTailscaleIP] }
            : {}),
          // For H1 (loopback bind), enable tailscale mode off to keep loopback
          ...(thisBindMode === "loopback"
            ? { tailscale: { mode: "off" } }
            : { tailscale: { mode: "on" } }),
        },
      };
      await patchLocalOpenClawConfig(bindPatch);
      s.stop(pc.green(`✓ openclaw.json updated (bind=${thisBindMode})`));
    } catch (err) {
      s.stop(pc.yellow("⚠ Could not update local openclaw.json — update manually if needed"));
      p.log.warn(`Path: ${localOpenClawConfigPath()}`);
    }
  }

  // ── Step 3: For H2 on Windows with tailscale bind ─────────────────────
  //    The local TUI won't work unless we add a loopback→tailscale portproxy.
  //    Discovered during Calcifer/GLaDOS reference setup (2026-03-11).
  if (thisBindMode === "tailscale" && process.platform === "win32" && ctx.tailscaleIP) {
    const proxyConfig = { tailscaleIP: ctx.tailscaleIP, port: 18789 };
    const alreadyInstalled = await isWindowsLoopbackProxyInstalled(proxyConfig);

    if (!alreadyInstalled) {
      p.log.info(
        pc.cyan("ℹ") +
        " H2's gateway binds to the Tailscale IP so H1 can reach it.\n" +
        "  But the local OpenClaw TUI connects to 127.0.0.1 — which won't be listening.\n" +
        "  Installing a loopback portproxy so the TUI works locally too.",
      );

      const s = p.spinner();
      s.start("Installing Windows loopback portproxy (netsh)...");
      try {
        await addWindowsLoopbackProxy(proxyConfig);
        s.stop(pc.green("✓ Loopback portproxy installed — TUI will work locally"));
      } catch {
        s.stop(pc.yellow("⚠ Could not install portproxy automatically (may need elevation)"));
        p.log.warn("Run this manually in an elevated prompt:");
        p.log.message(pc.cyan(`  netsh interface portproxy add v4tov4 listenaddress=127.0.0.1 listenport=18789 connectaddress=${ctx.tailscaleIP} connectport=18789`));
      }
    } else {
      p.log.info(pc.green("✓") + " Loopback portproxy already installed");
    }
  }

  // ── Step 4: restart local gateway to pick up the new bind ─────────────────
  {
    const restart = await p.confirm({
      message: "Restart the local gateway to apply the new bind setting?",
      initialValue: true,
    });
    if (!isCancelled(restart) && restart) {
      const s = p.spinner();
      s.start("Restarting gateway...");
      const ok = await restartLocalGateway();
      s.stop(ok ? pc.green("✓ Gateway restarted") : pc.yellow("⚠ Could not restart — restart manually with: openclaw gateway restart"));
    }
  }

  // ── Step 5: update PEER's gateway config via SSH (H1 setting up H2) ───
  const peerBindMode = peerDefaults.bindMode;

  if (role === "h1" && ctx.peerTailscaleIP && ctx.peerSSHUser) {
    const updatePeer = await p.confirm({
      message: `Update the peer's (H2) gateway to bind=tailscale and add your Tailscale IP to trustedProxies?`,
      initialValue: true,
    });
    if (!isCancelled(updatePeer) && updatePeer) {
      const s = p.spinner();
      s.start("Updating peer gateway config via SSH...");
      try {
        const peerOS = ctx.peerOS ?? "linux";

        if (peerOS === "windows") {
          // PowerShell deep-merge of gateway config on Windows H2
          const tomIP = ctx.tailscaleIP ?? "";
          const psCmd = [
            `$f = "$env:USERPROFILE\\.openclaw\\openclaw.json"`,
            `$j = try { Get-Content $f -Raw | ConvertFrom-Json } catch { [PSCustomObject]@{} }`,
            `if (-not $j.PSObject.Properties['gateway']) { $j | Add-Member -NotePropertyName gateway -NotePropertyValue ([PSCustomObject]@{}) }`,
            `$j.gateway | Add-Member -NotePropertyName bind -NotePropertyValue 'tailscale' -Force`,
            `if (-not $j.gateway.PSObject.Properties['tailscale']) { $j.gateway | Add-Member -NotePropertyName tailscale -NotePropertyValue ([PSCustomObject]@{}) }`,
            `$j.gateway.tailscale | Add-Member -NotePropertyName mode -NotePropertyValue 'on' -Force`,
            // Merge trustedProxies — preserve existing, add H1's IP
            `$existing = if ($j.gateway.PSObject.Properties['trustedProxies']) { @($j.gateway.trustedProxies) } else { @('127.0.0.1') }`,
            `$j.gateway | Add-Member -NotePropertyName trustedProxies -NotePropertyValue ($existing + '${tomIP}' | Select-Object -Unique) -Force`,
            `$j | ConvertTo-Json -Depth 10 | Set-Content $f -Encoding UTF8`,
          ].join("; ");
          await sshExec(
            { host: ctx.peerTailscaleIP, user: ctx.peerSSHUser, keyPath: ctx.peerSSHKeyPath! },
            `powershell -NoProfile -Command "${psCmd.replace(/"/g, '\\"')}"`,
            20_000,
          );
        } else {
          // Linux/macOS — inline Node.js deep-merge
          const nodeCmd = `node --input-type=module << 'EOF'\nimport {readFileSync,writeFileSync} from 'fs';\nimport {homedir} from 'os';\nimport {join} from 'path';\nconst p=join(homedir(),'.openclaw','openclaw.json');\nlet j={};\ntry{j=JSON.parse(readFileSync(p,'utf8'));}catch{}\nj.gateway=j.gateway||{};\nj.gateway.bind='tailscale';\nj.gateway.tailscale={mode:'on'};\nconst existing=Array.isArray(j.gateway.trustedProxies)?j.gateway.trustedProxies:['127.0.0.1'];\nj.gateway.trustedProxies=[...new Set([...existing,'${ctx.tailscaleIP}'])];\nwriteFileSync(p,JSON.stringify(j,null,2),{mode:0o600});\nEOF`;
          await sshExec(
            { host: ctx.peerTailscaleIP, user: ctx.peerSSHUser, keyPath: ctx.peerSSHKeyPath! },
            nodeCmd,
            15_000,
          );
        }

        // Also restart peer gateway
        const peerRestartCmd = peerOS === "windows"
          ? `powershell -NoProfile -Command "Stop-Process -Name node -Force -ErrorAction SilentlyContinue; Start-Sleep 2; Start-Process openclaw -ArgumentList 'gateway' -WindowStyle Hidden"`
          : `pkill -f 'openclaw.*gateway' || true; sleep 2; nohup openclaw gateway &>/dev/null &`;
        await sshExec(
          { host: ctx.peerTailscaleIP, user: ctx.peerSSHUser, keyPath: ctx.peerSSHKeyPath! },
          peerRestartCmd,
          15_000,
        ).catch(() => { /* restart is best-effort */ });

        s.stop(pc.green(`✓ Peer gateway updated and restarted (bind=tailscale, trustedProxies +${ctx.tailscaleIP})`));
      } catch (err) {
        s.stop(pc.yellow("⚠ Could not update peer gateway via SSH — update manually"));
        p.log.warn("On the H2 machine, set: gateway.bind = 'tailscale', gateway.trustedProxies includes this node's Tailscale IP");
      }
    }
  }

  return {
    ...ctx,
    thisBindMode: thisBindMode as "loopback" | "tailscale" | "lan",
    peerBindMode: peerBindMode as "loopback" | "tailscale" | "lan",
    peerGatewayPort,
  };
}
