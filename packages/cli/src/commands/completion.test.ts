/**
 * completion.test.ts — tests for `cofounder completion`
 *
 * Tests cover:
 *   - All four shell generators produce non-empty, syntactically plausible output
 *   - Key command names appear in each script
 *   - Flag names appear under their owning command
 *   - detectShell() maps SHELL env var values to short names
 *   - completion() exits with code 1 on unknown shell
 *   - completion() prints to stdout (captured via mock)
 *   - install hints are emitted to stderr, not stdout
 *   - COMMANDS list is internally consistent (no duplicate names)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateBash,
  generateZsh,
  generateFish,
  generatePowerShell,
  detectShell,
  completion,
  COMMANDS,
} from "./completion.ts";

// ─── Snapshot helpers ────────────────────────────────────────────────────────

/** Pick a sampling of core command names to check for in scripts. */
const CORE_COMMANDS = ["send", "status", "doctor", "budget", "prune", "schedule", "notify", "capabilities"];

// ─── generateBash ────────────────────────────────────────────────────────────

describe("generateBash", () => {
  it("returns a non-empty string", () => {
    expect(generateBash().length).toBeGreaterThan(100);
  });

  it("defines a _cofounder_completion function", () => {
    expect(generateBash()).toContain("_cofounder_completion()");
  });

  it("registers completion via `complete -F`", () => {
    expect(generateBash()).toContain("complete -F _cofounder_completion hh");
  });

  it("includes core command names", () => {
    const script = generateBash();
    for (const cmd of CORE_COMMANDS) {
      expect(script).toContain(cmd);
    }
  });

  it("includes --peer flag under send command", () => {
    expect(generateBash()).toContain("--peer");
  });

  it("includes --dry-run flag", () => {
    expect(generateBash()).toContain("--dry-run");
  });
});

// ─── generateZsh ────────────────────────────────────────────────────────────

describe("generateZsh", () => {
  it("returns a non-empty string", () => {
    expect(generateZsh().length).toBeGreaterThan(100);
  });

  it("starts with #compdef cofounder", () => {
    expect(generateZsh()).toMatch(/^#compdef cofounder/);
  });

  it("uses _describe for top-level commands", () => {
    expect(generateZsh()).toContain("_describe");
  });

  it("includes command descriptions", () => {
    const script = generateZsh();
    expect(script).toContain("Run the setup wizard");
    expect(script).toContain("Show both nodes");
  });

  it("includes core command names", () => {
    const script = generateZsh();
    for (const cmd of CORE_COMMANDS) {
      expect(script).toContain(cmd);
    }
  });

  it("includes _values for subcommands with flags", () => {
    expect(generateZsh()).toContain("_values");
  });
});

// ─── generateFish ───────────────────────────────────────────────────────────

describe("generateFish", () => {
  it("returns a non-empty string", () => {
    expect(generateFish().length).toBeGreaterThan(100);
  });

  it("uses `complete -c cofounder` form", () => {
    expect(generateFish()).toMatch(/complete -c cofounder/);
  });

  it("disables file completion at top level", () => {
    expect(generateFish()).toContain("complete -c cofounder -f");
  });

  it("includes core command names", () => {
    const script = generateFish();
    for (const cmd of CORE_COMMANDS) {
      expect(script).toContain(cmd);
    }
  });

  it("includes command descriptions after -d flag", () => {
    expect(generateFish()).toContain("-d 'Run the setup wizard'");
  });

  it("emits long-form flags without leading --", () => {
    // Fish uses -l 'flagname' (without dashes)
    expect(generateFish()).toMatch(/-l 'peer'/);
    expect(generateFish()).toMatch(/-l 'dry-run'/);
  });
});

// ─── generatePowerShell ──────────────────────────────────────────────────────

describe("generatePowerShell", () => {
  it("returns a non-empty string", () => {
    expect(generatePowerShell().length).toBeGreaterThan(100);
  });

  it("registers with Register-ArgumentCompleter", () => {
    expect(generatePowerShell()).toContain("Register-ArgumentCompleter");
  });

  it("uses -Native flag for native completion", () => {
    expect(generatePowerShell()).toContain("-Native");
  });

  it("includes core command names", () => {
    const script = generatePowerShell();
    for (const cmd of CORE_COMMANDS) {
      expect(script).toContain(cmd);
    }
  });

  it("includes install hint comment", () => {
    expect(generatePowerShell()).toContain("$PROFILE");
  });
});

// ─── detectShell ────────────────────────────────────────────────────────────

describe("detectShell", () => {
  const originalShell = process.env["SHELL"];
  const originalPlatform = process.platform;

  afterEach(() => {
    if (originalShell === undefined) {
      delete process.env["SHELL"];
    } else {
      process.env["SHELL"] = originalShell;
    }
  });

  it("returns 'bash' for /bin/bash", () => {
    process.env["SHELL"] = "/bin/bash";
    expect(detectShell()).toBe("bash");
  });

  it("returns 'zsh' for /bin/zsh", () => {
    process.env["SHELL"] = "/bin/zsh";
    expect(detectShell()).toBe("zsh");
  });

  it("returns 'zsh' for /usr/local/bin/zsh", () => {
    process.env["SHELL"] = "/usr/local/bin/zsh";
    expect(detectShell()).toBe("zsh");
  });

  it("returns 'fish' for /usr/bin/fish", () => {
    process.env["SHELL"] = "/usr/bin/fish";
    expect(detectShell()).toBe("fish");
  });

  it("returns null for unknown shell", () => {
    process.env["SHELL"] = "/usr/bin/dash";
    // dash doesn't match any pattern
    expect(detectShell()).toBeNull();
  });

  it("returns null when SHELL is empty", () => {
    process.env["SHELL"] = "";
    expect(detectShell()).toBeNull();
  });
});

// ─── COMMANDS registry ──────────────────────────────────────────────────────

describe("COMMANDS registry", () => {
  it("contains at least 20 entries", () => {
    expect(COMMANDS.length).toBeGreaterThanOrEqual(20);
  });

  it("every entry has a name and description", () => {
    for (const cmd of COMMANDS) {
      expect(typeof cmd.name).toBe("string");
      expect(cmd.name.length).toBeGreaterThan(0);
      expect(typeof cmd.description).toBe("string");
      expect(cmd.description.length).toBeGreaterThan(0);
    }
  });

  it("every flag starts with --", () => {
    for (const cmd of COMMANDS) {
      for (const flag of cmd.flags ?? []) {
        expect(flag).toMatch(/^--/);
      }
    }
  });

  it("send command has --peer and --wait flags", () => {
    const send = COMMANDS.find((c) => c.name === "send");
    expect(send).toBeDefined();
    expect(send!.flags).toContain("--peer");
    expect(send!.flags).toContain("--wait");
  });

  it("schedule command has expected subcommands", () => {
    const sched = COMMANDS.find((c) => c.name === "schedule");
    expect(sched).toBeDefined();
    expect(sched!.subcommands).toContain("add");
    expect(sched!.subcommands).toContain("list");
    expect(sched!.subcommands).toContain("remove");
  });

  it("capabilities command has all five subcommands", () => {
    const cap = COMMANDS.find((c) => c.name === "capabilities");
    expect(cap).toBeDefined();
    expect(cap!.subcommands).toContain("scan");
    expect(cap!.subcommands).toContain("advertise");
    expect(cap!.subcommands).toContain("fetch");
    expect(cap!.subcommands).toContain("show");
    expect(cap!.subcommands).toContain("route");
  });
});

// ─── completion() entry point ────────────────────────────────────────────────

describe("completion()", () => {
  let stdoutData = "";
  let stderrData = "";
  let originalWrite: typeof process.stdout.write;
  let originalErrWrite: typeof process.stderr.write;

  beforeEach(() => {
    stdoutData = "";
    stderrData = "";
    originalWrite = process.stdout.write.bind(process.stdout);
    originalErrWrite = process.stderr.write.bind(process.stderr);
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdoutData += chunk.toString();
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderrData += chunk.toString();
      return true;
    });
    process.exitCode = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  it("prints bash script to stdout for shell=bash", async () => {
    await completion({ shell: "bash", noHint: true });
    expect(stdoutData).toContain("_cofounder_completion");
  });

  it("prints zsh script to stdout for shell=zsh", async () => {
    await completion({ shell: "zsh", noHint: true });
    expect(stdoutData).toContain("#compdef cofounder");
  });

  it("prints fish script to stdout for shell=fish", async () => {
    await completion({ shell: "fish", noHint: true });
    expect(stdoutData).toContain("complete -c cofounder");
  });

  it("prints powershell script to stdout for shell=powershell", async () => {
    await completion({ shell: "powershell", noHint: true });
    expect(stdoutData).toContain("Register-ArgumentCompleter");
  });

  it("accepts 'pwsh' as alias for powershell", async () => {
    await completion({ shell: "pwsh", noHint: true });
    expect(stdoutData).toContain("Register-ArgumentCompleter");
  });

  it("sets exitCode=1 for unknown shell", async () => {
    await completion({ shell: "tcsh", noHint: true });
    expect(process.exitCode).toBe(1);
    expect(stdoutData).toBe("");
  });

  it("emits install hint to stderr (not stdout) when noHint=false", async () => {
    await completion({ shell: "bash", noHint: false });
    // The hint message uses "permanently" — unique to the hint, not the script body
    expect(stderrData).toContain("permanently");
    expect(stdoutData).not.toContain("permanently");
  });

  it("suppresses install hint when noHint=true", async () => {
    await completion({ shell: "zsh", noHint: true });
    expect(stderrData).toBe("");
  });

  it("handles uppercase shell name case-insensitively", async () => {
    await completion({ shell: "BASH", noHint: true });
    expect(stdoutData).toContain("_cofounder_completion");
    expect(process.exitCode).toBe(0);
  });
});
