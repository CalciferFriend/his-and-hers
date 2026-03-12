import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface SSHConfig {
  host: string;
  user: string;
  keyPath: string;
  port?: number;
}

/**
 * Execute a command on a remote machine over SSH.
 */
export async function sshExec(
  config: SSHConfig,
  command: string,
  timeoutMs = 30_000,
): Promise<{ stdout: string; stderr: string }> {
  const args = [
    "-i", config.keyPath,
    "-o", "StrictHostKeyChecking=no",
    "-o", "ConnectTimeout=10",
    "-p", String(config.port ?? 22),
    `${config.user}@${config.host}`,
    command,
  ];

  return execFileAsync("ssh", args, { timeout: timeoutMs });
}

/**
 * Test SSH connectivity to a remote host.
 */
export async function testSSH(config: SSHConfig): Promise<boolean> {
  try {
    const { stdout } = await sshExec(config, "echo hh-connected");
    return stdout.trim() === "hh-connected";
  } catch {
    return false;
  }
}
