import * as p from "@clack/prompts";
import pc from "picocolors";
import { readdir, stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pingPeer, testSSH, getTailscalePeers, type TailscalePeer } from "@cofounder/core";
import { isCancelled, type WizardContext } from "../context.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function stepPeer(ctx: Partial<WizardContext>): Promise<Partial<WizardContext>> {
  const peerRole = ctx.role === "h1" ? "H2 (executor)" : "H1 (orchestrator)";

  p.log.info(`Now let's find the remote ${peerRole} node.`);

  // ── Auto-discover peers on the tailnet ───────────────────────────────────
  const spinner = p.spinner();
  spinner.start("Scanning your tailnet for peers...");
  let peers = await getTailscalePeers();
  spinner.stop(peers.length > 0
    ? `Found ${pc.cyan(String(peers.length))} peer${peers.length === 1 ? "" : "s"} on your tailnet.`
    : "No peers found on your tailnet yet."
  );

  // ── No peers: guide them through setting up the other machine ────────────
  if (peers.length === 0) {
    const otherSetup = await handleNoPeers(peerRole);
    if (otherSetup === "skip") {
      // Let them configure peer later via `cofounder pair`
      p.log.info(
        `No problem. You can pair later by running ${pc.cyan("cofounder onboard")} on the other machine\n` +
        `and then using ${pc.cyan("cofounder pair --code <code>")} to connect them.`
      );
      return {
        ...ctx,
        peerTailscaleHostname: "",
        peerTailscaleIP: "",
        peerSSHUser: "",
        peerSSHKeyPath: "",
        peerOS: "linux",
      };
    }
    // Re-scan after user says the other machine is ready
    peers = otherSetup;
  }

  // ── Select peer from discovered list ─────────────────────────────────────
  let selectedHostname: string;
  let selectedIP: string;
  let selectedOS: "linux" | "windows" | "macos" = "linux";

  if (peers.length > 0) {
    const peerOptions: { value: string; label: string; hint?: string }[] = peers.map((peer: TailscalePeer) => ({
      value: peer.hostname,
      label: peer.hostname,
      hint: `${peer.os} | ${peer.tailscaleIP} | ${peer.online ? pc.green("online") : pc.dim("offline")}`,
    }));
    peerOptions.push({ value: "__manual__", label: "Enter manually", hint: "type hostname and IP by hand" });

    const choice = await p.select({
      message: `Which machine is your ${peerRole}?`,
      options: peerOptions,
    });

    if (isCancelled(choice)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }

    if (choice !== "__manual__") {
      const found = peers.find((peer: TailscalePeer) => peer.hostname === choice);
      selectedHostname = found?.hostname ?? (choice as string);
      selectedIP = found?.tailscaleIP ?? "";
      selectedOS = mapOS(found?.os ?? "linux");
      p.log.success(`Selected ${pc.cyan(selectedHostname)} (${selectedIP})`);
    } else {
      const manual = await manualPeerEntry(peerRole);
      selectedHostname = manual.hostname;
      selectedIP = manual.ip;
      selectedOS = manual.os;
    }
  } else {
    const manual = await manualPeerEntry(peerRole);
    selectedHostname = manual.hostname;
    selectedIP = manual.ip;
    selectedOS = manual.os;
  }

  // ── SSH credentials (auto-detect) ───────────────────────────────────────
  const sshConfig = await parseSSHConfig(selectedHostname);
  const defaultUser = sshConfig.user ?? (selectedOS === "windows" ? process.env.USERNAME ?? "User" : "ubuntu");

  const sshUser = await p.text({
    message: `SSH username on ${selectedHostname}`,
    initialValue: defaultUser,
    validate: (v) => {
      if (!v.trim()) return "SSH user is required";
    },
  });
  if (isCancelled(sshUser)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  // Auto-detect SSH keys
  const detectedKeys = await discoverSSHKeys();
  let resolvedKeyPath: string;

  if (detectedKeys.length === 0) {
    // No keys found — fall back to manual entry
    p.log.warn("No SSH keys found in ~/.ssh/");
    const sshKeyPath = await p.text({
      message: "Path to SSH private key for the remote machine",
      placeholder: "~/.ssh/id_ed25519",
      validate: (v) => {
        if (!v.trim()) return "SSH key path is required";
      },
    });
    if (isCancelled(sshKeyPath)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }
    resolvedKeyPath = (sshKeyPath as string).replace(/^~/, process.env.HOME ?? process.env.USERPROFILE ?? "~");
  } else if (detectedKeys.length === 1) {
    // Single key — use it automatically
    resolvedKeyPath = detectedKeys[0].path;
    p.log.success(`Using SSH key ${pc.cyan(detectedKeys[0].label)}`);
  } else {
    // Multiple keys — let them pick
    // If ssh config specifies a key for this host, pre-sort it first
    const configKey = sshConfig.identityFile;
    const sortedKeys = configKey
      ? [...detectedKeys].sort((a, b) => {
          const aMatch = a.path === configKey ? -1 : 0;
          const bMatch = b.path === configKey ? -1 : 0;
          return aMatch - bMatch;
        })
      : detectedKeys;

    const keyOptions = sortedKeys.map((k) => ({
      value: k.path,
      label: k.label,
      hint: k.hint,
    }));
    keyOptions.push({ value: "__manual__", label: "Enter path manually", hint: "type a custom key path" });

    const keyChoice = await p.select({
      message: "Which SSH key should we use?",
      options: keyOptions,
    });

    if (isCancelled(keyChoice)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }

    if (keyChoice === "__manual__") {
      const sshKeyPath = await p.text({
        message: "Path to SSH private key",
        placeholder: "~/.ssh/id_ed25519",
        validate: (v) => {
          if (!v.trim()) return "SSH key path is required";
        },
      });
      if (isCancelled(sshKeyPath)) {
        p.cancel("Setup cancelled.");
        process.exit(0);
      }
      resolvedKeyPath = (sshKeyPath as string).replace(/^~/, process.env.HOME ?? process.env.USERPROFILE ?? "~");
    } else {
      resolvedKeyPath = keyChoice as string;
      const chosen = sortedKeys.find((k) => k.path === keyChoice);
      p.log.success(`Using SSH key ${pc.cyan(chosen?.label ?? keyChoice as string)}`);
    }
  }

  // ── Test connectivity ────────────────────────────────────────────────────
  const connSpinner = p.spinner();
  connSpinner.start("Testing connectivity to peer...");

  const peerReachable = await pingPeer(selectedIP);
  if (!peerReachable) {
    connSpinner.stop(`${pc.yellow("!")} Peer not reachable via Tailscale — it may be offline.`);
    p.log.warn("If this is the H2 node and it's a sleeping machine, that's expected. We'll configure WOL next.");
  } else {
    connSpinner.stop(`${pc.green("✓")} Peer reachable via Tailscale.`);

    const sshSpinner = p.spinner();
    sshSpinner.start("Testing SSH connection...");
    const sshOk = await testSSH({
      host: selectedIP,
      user: sshUser as string,
      keyPath: resolvedKeyPath,
    });
    if (sshOk) {
      sshSpinner.stop(`${pc.green("✓")} SSH connection successful.`);
    } else {
      sshSpinner.stop(`${pc.yellow("!")} SSH connection failed — check user, key, and sshd config on the peer.`);
    }
  }

  return {
    ...ctx,
    peerTailscaleHostname: selectedHostname,
    peerTailscaleIP: selectedIP,
    peerSSHUser: sshUser as string,
    peerSSHKeyPath: resolvedKeyPath,
    peerOS: selectedOS,
  };
}

// ── No peers flow ────────────────────────────────────────────────────────────

async function handleNoPeers(peerRole: string): Promise<TailscalePeer[] | "skip"> {
  p.note(
    `Your tailnet doesn't have any other machines on it yet.\n` +
    `That's fine — we just need to get Tailscale running on the ${peerRole} machine too.\n\n` +
    `${pc.bold("On the other machine, do one of these:")}\n\n` +
    `  ${pc.cyan("Linux / Mac:")}  curl -fsSL https://tailscale.com/install.sh | sh\n` +
    `                 sudo tailscale up\n\n` +
    `  ${pc.cyan("Windows:")}      winget install Tailscale.Tailscale\n` +
    `                 (or download from tailscale.com/download)\n\n` +
    `${pc.bold("Important:")} Sign in with the ${pc.underline("same account")} you used on this machine.\n` +
    `Both machines must be on the same Tailscale network to see each other.`,
    `Set up the ${peerRole} machine`
  );

  const action = await p.select({
    message: "What would you like to do?",
    options: [
      { value: "wait", label: "I'm setting it up now — wait for it to appear", hint: "we'll scan every few seconds" },
      { value: "skip", label: "I'll do this later", hint: "finish wizard without a peer" },
      { value: "manual", label: "I know the hostname/IP already", hint: "enter it manually" },
    ],
  });

  if (isCancelled(action)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  if (action === "skip") return "skip";

  if (action === "manual") {
    // Return empty array — caller will fall through to manual entry
    return [];
  }

  // ── Waiting loop: poll for new peers ───────────────────────────────────
  p.log.info(
    `${pc.dim("Watching for new machines on your tailnet...")}\n` +
    `${pc.dim("Set up Tailscale on the other machine and sign in with the same account.")}\n` +
    `${pc.dim("Press Ctrl+C to cancel.")}`
  );

  const waitSpinner = p.spinner();
  waitSpinner.start("Scanning tailnet...");

  const maxAttempts = 60; // ~5 minutes
  for (let i = 0; i < maxAttempts; i++) {
    const found = await getTailscalePeers();
    if (found.length > 0) {
      const names = found.map((peer: TailscalePeer) => pc.cyan(peer.hostname)).join(", ");
      waitSpinner.stop(`${pc.green("✓")} New peer detected: ${names}`);
      return found;
    }

    const elapsed = Math.floor((i + 1) * 5 / 60);
    const secs = ((i + 1) * 5) % 60;
    waitSpinner.message(`Scanning tailnet... (${elapsed}m ${secs}s elapsed — waiting for peer to join)`);
    await sleep(5000);
  }

  waitSpinner.stop(`${pc.yellow("!")} No peers appeared after 5 minutes.`);

  p.log.info(
    "The other machine might still be setting up. You can:\n" +
    `  - Re-run ${pc.cyan("cofounder onboard")} once it's on your tailnet\n` +
    `  - Or enter the details manually now`
  );

  const fallback = await p.confirm({
    message: "Enter peer details manually?",
    initialValue: true,
  });

  if (isCancelled(fallback) || !fallback) return "skip";
  return [];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function mapOS(os: string): "linux" | "windows" | "macos" {
  const lower = os.toLowerCase();
  if (lower.includes("windows") || lower === "win32") return "windows";
  if (lower.includes("darwin") || lower.includes("macos") || lower === "macOS") return "macos";
  return "linux";
}

interface DetectedKey {
  path: string;
  label: string;
  hint: string;
}

async function discoverSSHKeys(): Promise<DetectedKey[]> {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (!home) return [];
  const sshDir = join(home, ".ssh");

  try {
    const entries = await readdir(sshDir);
    const keys: DetectedKey[] = [];

    // Known private key patterns (skip .pub, known_hosts, config, authorized_keys, etc.)
    const skipSuffixes = [".pub", ".old", ".bak"];
    const skipNames = new Set(["known_hosts", "known_hosts.old", "config", "authorized_keys", "agent.env", "environment"]);

    for (const entry of entries) {
      if (skipNames.has(entry)) continue;
      if (skipSuffixes.some((s) => entry.endsWith(s))) continue;

      const fullPath = join(sshDir, entry);
      try {
        const info = await stat(fullPath);
        if (!info.isFile()) continue;
        // Skip files larger than 16KB (not a key)
        if (info.size > 16384) continue;

        // Peek at first line to confirm it looks like a private key or PEM
        const head = await readFile(fullPath, "utf-8").then((c) => c.slice(0, 80));
        const looksLikeKey =
          head.includes("PRIVATE KEY") ||
          head.includes("-----BEGIN") ||
          head.includes("PuTTY-User-Key-File");

        if (!looksLikeKey) continue;

        // Determine key type from header
        let keyType = "key";
        if (head.includes("OPENSSH")) keyType = "OpenSSH";
        else if (head.includes("RSA")) keyType = "RSA";
        else if (head.includes("EC")) keyType = "EC";
        else if (head.includes("ED25519")) keyType = "Ed25519";
        else if (head.includes("PuTTY")) keyType = "PuTTY";
        else if (entry.endsWith(".pem")) keyType = "PEM";

        keys.push({
          path: fullPath,
          label: `~/.ssh/${entry}`,
          hint: keyType,
        });
      } catch {
        // Can't read this file, skip
      }
    }

    return keys;
  } catch {
    return [];
  }
}

interface SSHConfigMatch {
  user?: string;
  identityFile?: string;
}

async function parseSSHConfig(hostname: string): Promise<SSHConfigMatch> {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (!home) return {};
  const configPath = join(home, ".ssh", "config");

  try {
    const content = await readFile(configPath, "utf-8");
    const lines = content.split(/\r?\n/);

    let inMatchingBlock = false;
    let user: string | undefined;
    let identityFile: string | undefined;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const hostMatch = line.match(/^Host\s+(.+)$/i);
      if (hostMatch) {
        // Check if any of the host patterns match our hostname
        const patterns = hostMatch[1].split(/\s+/);
        inMatchingBlock = patterns.some((pat) => {
          if (pat === "*") return false; // skip wildcard-only
          if (pat.includes("*")) {
            const regex = new RegExp("^" + pat.replace(/\*/g, ".*") + "$", "i");
            return regex.test(hostname);
          }
          return pat.toLowerCase() === hostname.toLowerCase();
        });
        continue;
      }

      if (inMatchingBlock) {
        const userMatch = line.match(/^User\s+(.+)$/i);
        if (userMatch && !user) user = userMatch[1].trim();

        const keyMatch = line.match(/^IdentityFile\s+(.+)$/i);
        if (keyMatch && !identityFile) {
          identityFile = keyMatch[1].trim().replace(/^~/, home);
        }
      }
    }

    return { user, identityFile };
  } catch {
    return {};
  }
}

async function manualPeerEntry(peerRole: string) {
  const answers = await p.group(
    {
      hostname: () =>
        p.text({
          message: `Tailscale hostname of the ${peerRole} machine`,
          placeholder: "my-machine",
          validate: (v) => {
            if (!v.trim()) return "Tailscale hostname is required";
          },
        }),
      ip: () =>
        p.text({
          message: `Tailscale IP of the ${peerRole} machine`,
          placeholder: "100.x.x.x",
          validate: (v) => {
            if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v.trim()))
              return "Enter a valid IPv4 address";
          },
        }),
      os: () =>
        p.select({
          message: `Operating system on the ${peerRole} machine`,
          options: [
            { value: "linux" as const, label: "Linux" },
            { value: "windows" as const, label: "Windows" },
            { value: "macos" as const, label: "macOS" },
          ],
        }),
    },
    {
      onCancel: () => {
        p.cancel("Setup cancelled.");
        process.exit(0);
      },
    },
  );

  return {
    hostname: answers.hostname as string,
    ip: answers.ip as string,
    os: answers.os as "linux" | "windows" | "macos",
  };
}
