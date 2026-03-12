/**
 * commands/upgrade.ts — `hh upgrade`
 *
 * Checks the npm registry for a newer version of the `his-and-hers` package
 * and prints upgrade instructions if one is available.
 *
 * Features:
 *   - Compares local pkg version vs latest on npm (semver-aware)
 *   - Shows changelog URL for the new version
 *   - --check flag: exit 0 if up to date, exit 1 if upgrade available (CI-friendly)
 *   - --json: machine-readable output
 *   - Respects NO_UPDATE_NOTIFIER env var (same convention as update-notifier)
 *
 * Usage:
 *   hh upgrade             # Check and print instructions
 *   hh upgrade --check     # Scripted: exit 1 if outdated
 *   hh upgrade --json      # JSON output
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ─── Version helpers ──────────────────────────────────────────────────────────

/** Compare two semver strings. Returns negative if a < b, 0 if equal, positive if a > b. */
function compareSemver(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .replace(/^v/, "")
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const [aMaj, aMin, aPatch] = parse(a);
  const [bMaj, bMin, bPatch] = parse(b);
  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  return aPatch - bPatch;
}

/** Fetch the latest published version of a package from the npm registry. */
async function fetchLatestVersion(pkg: string): Promise<string> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`;
  const res = await fetch(url, {
    headers: { "User-Agent": "his-and-hers-cli", Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    throw new Error(`npm registry returned ${res.status} for package "${pkg}"`);
  }
  const data = (await res.json()) as { version: string };
  if (!data.version) throw new Error("Unexpected npm registry response");
  return data.version;
}

/** Read local package version from the nearest package.json. */
function getLocalVersion(): string {
  try {
    // Walk up from this file to find the cli package.json
    const __dir = dirname(fileURLToPath(import.meta.url));
    const req = createRequire(import.meta.url);
    // Try: CLI package → his-and-hers root package
    for (const rel of ["../../package.json", "../../../package.json", "../../../../package.json"]) {
      try {
        const pkg = req(join(__dir, rel)) as { name?: string; version?: string };
        if (pkg.version) return pkg.version;
      } catch {
        // continue
      }
    }
  } catch {
    // ignore
  }
  return "0.1.0"; // fallback
}

// ─── Main command ─────────────────────────────────────────────────────────────

export interface UpgradeOptions {
  check?: boolean;
  json?: boolean;
}

export interface UpgradeResult {
  currentVersion: string;
  latestVersion: string;
  upToDate: boolean;
  upgradeAvailable: boolean;
  error?: string;
}

export async function upgrade(opts: UpgradeOptions = {}): Promise<void> {
  if (process.env["NO_UPDATE_NOTIFIER"] === "1") {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ skipped: true, reason: "NO_UPDATE_NOTIFIER" }) + "\n");
    } else {
      p.log.info("Update check skipped (NO_UPDATE_NOTIFIER=1).");
    }
    return;
  }

  const PKG_NAME = "his-and-hers";
  const CHANGELOG_URL = "https://github.com/CalciferFriend/his-and-hers/blob/master/CHANGELOG.md";

  if (!opts.json && !opts.check) {
    p.intro(pc.bgMagenta(pc.black(" hh upgrade ")));
  }

  const currentVersion = getLocalVersion();
  let latestVersion: string;

  try {
    if (!opts.json && !opts.check) {
      const s = p.spinner();
      s.start("Checking npm registry…");
      latestVersion = await fetchLatestVersion(PKG_NAME);
      s.stop(`Latest: ${pc.cyan(`v${latestVersion}`)}`);
    } else {
      latestVersion = await fetchLatestVersion(PKG_NAME);
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (opts.json) {
      process.stdout.write(
        JSON.stringify({ currentVersion, latestVersion: null, upToDate: null, upgradeAvailable: null, error } satisfies Partial<UpgradeResult> & { latestVersion: null; upToDate: null; upgradeAvailable: null }) + "\n"
      );
    } else {
      p.log.warn(`Could not reach npm registry: ${error}`);
      p.log.info(`You can check manually: https://www.npmjs.com/package/${PKG_NAME}`);
    }
    if (opts.check) process.exit(2); // 2 = unknown
    return;
  }

  const upToDate = compareSemver(currentVersion, latestVersion) >= 0;
  const upgradeAvailable = !upToDate;

  if (opts.json) {
    process.stdout.write(
      JSON.stringify({
        currentVersion,
        latestVersion,
        upToDate,
        upgradeAvailable,
      } satisfies UpgradeResult) + "\n"
    );
    if (opts.check && upgradeAvailable) process.exit(1);
    return;
  }

  if (opts.check) {
    if (upToDate) {
      process.stdout.write(`his-and-hers v${currentVersion} is up to date.\n`);
      process.exit(0);
    } else {
      process.stdout.write(
        `Upgrade available: v${currentVersion} → v${latestVersion}\n`
      );
      process.exit(1);
    }
  }

  // Interactive output
  p.log.message("");
  p.log.info(`Current version : ${pc.yellow(`v${currentVersion}`)}`);
  p.log.info(`Latest version  : ${pc.cyan(`v${latestVersion}`)}`);
  p.log.message("");

  if (upToDate) {
    p.note(
      `${pc.green("✓")} You're running the latest version of his-and-hers!\n\nNothing to do.`,
      "Up to date"
    );
  } else {
    p.note(
      [
        `${pc.bold(`v${currentVersion}`)} → ${pc.bold(pc.green(`v${latestVersion}`))}`,
        "",
        "To upgrade, run one of:",
        "",
        pc.dim("  # npm global install"),
        `  ${pc.cyan(`npm install -g ${PKG_NAME}@latest`)}`,
        "",
        pc.dim("  # pnpm global install"),
        `  ${pc.cyan(`pnpm add -g ${PKG_NAME}@latest`)}`,
        "",
        pc.dim("  # npx (no global install)"),
        `  ${pc.cyan(`npx ${PKG_NAME}@latest`)}`,
        "",
        `Changelog: ${CHANGELOG_URL}`,
      ].join("\n"),
      "Upgrade available"
    );
  }

  p.outro(upToDate ? pc.green("All good 🔥") : pc.yellow("Run the command above to upgrade"));
}
