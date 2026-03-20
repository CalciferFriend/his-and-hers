export { getTailscaleStatus, getTailscalePeers, getTailscaleVersion, isTailscaleInstalled, pingPeer, waitForPeer, type TailscalePeer } from "./tailscale.ts";
export { sshExec, testSSH, type SSHConfig } from "./ssh.ts";
export { sendMagicPacket, wakeAndWait, type WOLConfig } from "./wol.ts";
