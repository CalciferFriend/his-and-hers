/**
 * commands/release.ts — `cofounder release`
 *
 * Automate the release workflow: bump version, update CHANGELOG, git commit + tag.
 *
 * Usage:
 *   cofounder release                       → patch bump (0.3.0 → 0.3.1)
 *   cofounder release --minor               → minor bump (0.3.0 → 0.4.0)
 *   cofounder release --major               → major bump (0.3.0 → 1.0.0)
 *   cofounder release --dry-run             → preview changes without writing
 *   cofounder release --push                → push commits + tags to origin
 *   cofounder release --yes                 → skip confirmation prompts
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

export interface ReleaseOptions {
  patch?: boolean;
  minor?: boolean;
  major?: boolean;
  dryRun?: boolean;
  push?: boolean;
  yes?: boolean;
}

export async function release(opts: ReleaseOptions = {}) {
  const isDryRun = opts.dryRun ?? false;
  const shouldPush = opts.push ?? false;
  const skipConfirm = opts.yes ?? false;

  // Determine bump type
  const bumpType = opts.major ? "major" : opts.minor ? "minor" : "patch";

  if (!isDryRun) {
    p.intro(pc.bgMagenta(pc.white(` cofounder release — ${bumpType} bump `)));
  }

  // ── Step 1: Read current version ────────────────────────────────────────────

  const rootPkgPath = findRootPackageJson();
  if (!rootPkgPath) {
    p.log.error("Could not find packages/cofounder/package.json");
    process.exit(1);
  }

  const rootPkg = JSON.parse(await readFile(rootPkgPath, "utf-8"));
  const currentVersion = rootPkg.version as string;

  if (!currentVersion) {
    p.log.error("No version field found in package.json");
    process.exit(1);
  }

  // ── Step 2: Bump version ─────────────────────────────────────────────────────

  const newVersion = bumpVersion(currentVersion, bumpType);

  if (!isDryRun) {
    p.log.step(`Current version: ${pc.cyan(currentVersion)}`);
    p.log.step(`New version:     ${pc.green(newVersion)}`);
    p.log.message("");
  }

  // ── Step 3: Find all package.json files ──────────────────────────────────────

  const allPkgPaths = await findAllPackageJsons();

  if (!isDryRun) {
    const s = p.spinner();
    s.start(`Updating ${allPkgPaths.length} package.json files`);
    await sleep(100);
    s.stop(`Updated ${allPkgPaths.length} package.json files`);
  }

  if (!isDryRun && !skipConfirm) {
    const confirm = await p.confirm({
      message: `Bump version to ${pc.green(newVersion)}?`,
    });
    if (p.isCancel(confirm) || !confirm) {
      p.cancel("Release cancelled.");
      process.exit(0);
    }
  }

  // ── Step 4: Update all package.json files ────────────────────────────────────

  if (!isDryRun) {
    for (const pkgPath of allPkgPaths) {
      const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
      pkg.version = newVersion;
      await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
    }
  } else {
    console.log(pc.dim(`[dry-run] Would update ${allPkgPaths.length} package.json files to ${newVersion}`));
  }

  // ── Step 5: Prepend CHANGELOG entry ──────────────────────────────────────────

  const changelogPath = join(process.cwd(), "CHANGELOG.md");
  const changelogExists = existsSync(changelogPath);

  const changelogEntry = buildChangelogEntry(newVersion);

  if (!isDryRun) {
    if (changelogExists) {
      const existingChangelog = await readFile(changelogPath, "utf-8");
      await writeFile(changelogPath, changelogEntry + "\n" + existingChangelog, "utf-8");
    } else {
      await writeFile(changelogPath, changelogEntry, "utf-8");
    }
    p.log.info(`Updated CHANGELOG.md with v${newVersion} entry`);
  } else {
    console.log(pc.dim(`[dry-run] Would prepend CHANGELOG.md with:\n${changelogEntry}`));
  }

  // ── Step 6: Git commit + tag ─────────────────────────────────────────────────

  const commitMsg = `chore(release): bump to v${newVersion}`;
  const tagName = `v${newVersion}`;

  if (!isDryRun) {
    execSync("git add -A", { stdio: "inherit" });
    execSync(`git commit -m "${commitMsg}"`, { stdio: "inherit" });
    execSync(`git tag ${tagName}`, { stdio: "inherit" });
    p.log.success(`Committed and tagged ${pc.green(tagName)}`);
  } else {
    console.log(pc.dim(`[dry-run] Would run: git add -A`));
    console.log(pc.dim(`[dry-run] Would run: git commit -m "${commitMsg}"`));
    console.log(pc.dim(`[dry-run] Would run: git tag ${tagName}`));
  }

  // ── Step 7: Push (if requested) ──────────────────────────────────────────────

  if (shouldPush) {
    if (!isDryRun) {
      execSync("git push", { stdio: "inherit" });
      execSync("git push --tags", { stdio: "inherit" });
      p.log.success("Pushed commits and tags to origin");
    } else {
      console.log(pc.dim(`[dry-run] Would run: git push`));
      console.log(pc.dim(`[dry-run] Would run: git push --tags`));
    }
  }

  // ── Outro ────────────────────────────────────────────────────────────────────

  if (!isDryRun) {
    p.log.message("");
    p.outro(`🚀 Tagged ${pc.green(tagName)} — CI will publish to npm on push`);
  } else {
    console.log(pc.green("\n✓ Dry run complete — no changes made"));
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function bumpVersion(version: string, type: "patch" | "minor" | "major"): string {
  const parts = version.split(".").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid semver version: ${version}`);
  }

  let [major, minor, patch] = parts;

  if (type === "major") {
    major++;
    minor = 0;
    patch = 0;
  } else if (type === "minor") {
    minor++;
    patch = 0;
  } else {
    patch++;
  }

  return `${major}.${minor}.${patch}`;
}

function findRootPackageJson(): string | null {
  const cwd = process.cwd();
  const path = join(cwd, "packages", "cofounder", "package.json");
  return existsSync(path) ? path : null;
}

async function findAllPackageJsons(): Promise<string[]> {
  const cwd = process.cwd();
  const packagesDir = join(cwd, "packages");

  if (!existsSync(packagesDir)) {
    return [];
  }

  const dirs = await readdir(packagesDir, { withFileTypes: true });
  const pkgPaths: string[] = [];

  for (const dir of dirs) {
    if (dir.isDirectory()) {
      const pkgPath = join(packagesDir, dir.name, "package.json");
      if (existsSync(pkgPath)) {
        pkgPaths.push(pkgPath);
      }
    }
  }

  return pkgPaths;
}

export function buildChangelogEntry(version: string): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const commits = getRecentCommits();

  let entry = `## v${version} (${date})\n\n`;
  entry += commits.map((line) => `- ${line}`).join("\n");

  return entry;
}

function getRecentCommits(): string[] {
  try {
    const lastTag = execSync("git describe --tags --abbrev=0 2>/dev/null || echo ''", {
      encoding: "utf-8",
    }).trim();

    const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
    const log = execSync(`git log ${range} --oneline --no-decorate`, {
      encoding: "utf-8",
    }).trim();

    if (!log) return ["Initial release"];

    const lines = log.split("\n").slice(0, 10); // Last 10 commits
    return lines.map((line) => line.replace(/^[a-f0-9]+\s+/, "")); // Strip commit hash
  } catch {
    return ["Initial release"];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
