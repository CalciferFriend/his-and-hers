import * as p from "@clack/prompts";
import pc from "picocolors";
import { pingPeer, testSSH } from "@his-and-hers/core";
import { isCancelled, type WizardContext } from "../context.ts";

export async function stepPeer(ctx: Partial<WizardContext>): Promise<Partial<WizardContext>> {
  const peerRole = ctx.role === "tom" ? "Jerry (executor)" : "Tom (orchestrator)";

  p.log.info(`Now let's configure the remote ${peerRole} node.`);

  const answers = await p.group(
    {
      peerTailscaleHostname: () =>
        p.text({
          message: `Tailscale hostname of the ${peerRole} machine`,
          placeholder: ctx.role === "tom" ? "glados" : "calcifer-aws",
          validate: (v) => {
            if (!v.trim()) return "Tailscale hostname is required";
          },
        }),
      peerTailscaleIP: () =>
        p.text({
          message: `Tailscale IP of the ${peerRole} machine`,
          placeholder: "100.x.x.x",
          validate: (v) => {
            if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v.trim()))
              return "Enter a valid IPv4 address";
          },
        }),
      peerSSHUser: () =>
        p.text({
          message: `SSH username on the ${peerRole} machine`,
          placeholder: ctx.role === "tom" ? "Nic" : "ubuntu",
          validate: (v) => {
            if (!v.trim()) return "SSH user is required";
          },
        }),
      peerSSHKeyPath: () =>
        p.text({
          message: "Path to SSH private key for the remote machine",
          placeholder: "~/.ssh/id_ed25519",
          validate: (v) => {
            if (!v.trim()) return "SSH key path is required";
          },
        }),
      peerOS: () =>
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

  // Resolve ~ in key path
  const resolvedKeyPath = answers.peerSSHKeyPath.replace(/^~/, process.env.HOME ?? process.env.USERPROFILE ?? "~");

  // Test connectivity
  const spinner = p.spinner();
  spinner.start("Testing connectivity to peer...");

  const peerReachable = await pingPeer(answers.peerTailscaleIP);
  if (!peerReachable) {
    spinner.stop(`${pc.yellow("!")} Peer not reachable via Tailscale — it may be offline.`);
    p.log.warn("If this is the Jerry node and it's a sleeping machine, that's expected. We'll configure WOL next.");
  } else {
    spinner.stop(`${pc.green("✓")} Peer reachable via Tailscale.`);

    // Try SSH
    const sshSpinner = p.spinner();
    sshSpinner.start("Testing SSH connection...");
    const sshOk = await testSSH({
      host: answers.peerTailscaleIP,
      user: answers.peerSSHUser,
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
    peerTailscaleHostname: answers.peerTailscaleHostname,
    peerTailscaleIP: answers.peerTailscaleIP,
    peerSSHUser: answers.peerSSHUser,
    peerSSHKeyPath: resolvedKeyPath,
    peerOS: answers.peerOS as "linux" | "windows" | "macos",
  };
}
