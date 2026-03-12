import * as p from "@clack/prompts";
import { isCancelled, type WizardContext } from "../context.ts";

export async function stepWOL(ctx: Partial<WizardContext>): Promise<Partial<WizardContext>> {
  // WOL only makes sense when the H2 node is a sleeping machine.
  // If this machine IS H2, WOL is configured on the H1 side (peer).
  // If this machine IS H1, we configure WOL for reaching H2.

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

  const answers = await p.group(
    {
      mac: () =>
        p.text({
          message: "MAC address of the H2 node's network adapter",
          placeholder: "D8:5E:D3:04:18:B4",
          validate: (v: string) => {
            const cleaned = v.replace(/[:-]/g, "");
            if (cleaned.length !== 12 || !/^[0-9a-fA-F]+$/.test(cleaned))
              return "Enter a valid MAC address (e.g., AA:BB:CC:DD:EE:FF)";
          },
        }),
      broadcastIP: () =>
        p.text({
          message: "Broadcast IP for the WOL packet (usually your router's broadcast address)",
          placeholder: "192.168.50.255",
          validate: (v: string) => {
            if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v.trim()))
              return "Enter a valid IPv4 broadcast address";
          },
        }),
      routerPort: () =>
        p.text({
          message: "UDP port for WOL (router port forward target)",
          initialValue: "9",
          validate: (v: string) => {
            const n = parseInt(v, 10);
            if (isNaN(n) || n < 1 || n > 65535) return "Enter a valid port (1–65535)";
          },
        }),
      timeoutSeconds: () =>
        p.text({
          message: "Max seconds to wait for boot after sending magic packet",
          initialValue: "120",
          validate: (v: string) => {
            const n = parseInt(v, 10);
            if (isNaN(n) || n < 10) return "Enter at least 10 seconds";
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

  p.log.info(
    `WOL configured: MAC ${answers.mac}, broadcast ${answers.broadcastIP}:${answers.routerPort}, ` +
    `timeout ${answers.timeoutSeconds}s`,
  );

  return {
    ...ctx,
    wolEnabled: true,
    wolMAC: answers.mac,
    wolBroadcastIP: answers.broadcastIP,
    wolRouterPort: parseInt(answers.routerPort, 10),
    wolTimeoutSeconds: parseInt(answers.timeoutSeconds, 10),
    wolPollIntervalSeconds: 2,
  };
}
