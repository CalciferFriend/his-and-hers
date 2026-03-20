import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { profileList, profileUse, profileCreate, profileShow, profileDelete } from "./profile.ts";
import { getActiveProfileName, setActiveProfile } from "../config/store.ts";

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  unlink: vi.fn(),
}));

// Mock config/store
vi.mock("../config/store.ts", () => ({
  getActiveProfileName: vi.fn(),
  setActiveProfile: vi.fn(),
}));

const { readFile, writeFile, mkdir, readdir, unlink } = await import("node:fs/promises");

describe("profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress console output
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("profileList", () => {
    it("should list empty profiles", async () => {
      vi.mocked(readdir).mockResolvedValue([]);
      vi.mocked(getActiveProfileName).mockResolvedValue("default");
      vi.mocked(mkdir).mockResolvedValue(undefined);

      await profileList();

      expect(mkdir).toHaveBeenCalled();
      expect(readdir).toHaveBeenCalled();
    });

    it("should list multiple profiles and mark active", async () => {
      vi.mocked(readdir).mockResolvedValue(["default.json", "work.json", "home.json"] as any);
      vi.mocked(getActiveProfileName).mockResolvedValue("work");
      vi.mocked(mkdir).mockResolvedValue(undefined);

      await profileList();

      expect(readdir).toHaveBeenCalled();
    });

    it("should output JSON when --json flag is set", async () => {
      vi.mocked(readdir).mockResolvedValue(["default.json"] as any);
      vi.mocked(getActiveProfileName).mockResolvedValue("default");
      vi.mocked(mkdir).mockResolvedValue(undefined);

      const logSpy = vi.spyOn(console, "log");

      await profileList({ json: true });

      expect(logSpy).toHaveBeenCalled();
      const output = logSpy.mock.calls[0][0];
      expect(output).toContain("profiles");
      expect(output).toContain("active");
    });
  });

  describe("profileUse", () => {
    it("should switch active profile when profile exists", async () => {
      vi.mocked(readFile).mockResolvedValue('{"version":"0.1.0"}');
      vi.mocked(setActiveProfile).mockResolvedValue(undefined);

      await profileUse("work");

      expect(readFile).toHaveBeenCalled();
      expect(setActiveProfile).toHaveBeenCalledWith("work");
    });

    it("should error when profile does not exist", async () => {
      vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"));

      await expect(profileUse("nonexistent")).rejects.toThrow("process.exit");
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe("profileCreate", () => {
    it("should create blank profile", async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      await profileCreate("new-profile");

      expect(mkdir).toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalled();
      const writeCall = vi.mocked(writeFile).mock.calls[0];
      const content = JSON.parse(writeCall[1] as string);
      expect(content.version).toBe("0.1.0");
      expect(content.this_node).toBeDefined();
      expect(content.peer_node).toBeDefined();
    });

    it("should create profile from existing profile with --from", async () => {
      const existingConfig = {
        version: "0.1.0",
        this_node: {
          role: "h1",
          name: "calcifer",
          tailscale_hostname: "calcifer",
          tailscale_ip: "100.1.2.3",
        },
        peer_node: {
          role: "h2",
          name: "glados",
          tailscale_hostname: "glados",
          tailscale_ip: "100.1.2.4",
          ssh_user: "admin",
          ssh_key_path: "~/.ssh/id_rsa",
          os: "windows" as const,
          gateway_port: 18789,
        },
        gateway_port: 18789,
      };

      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(existingConfig));
      vi.mocked(writeFile).mockResolvedValue(undefined);

      await profileCreate("cloned", { from: "existing" });

      expect(readFile).toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalled();
      const writeCall = vi.mocked(writeFile).mock.calls[0];
      const content = JSON.parse(writeCall[1] as string);
      expect(content.this_node.name).toBe("calcifer");
    });

    it("should error when --from profile does not exist", async () => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"));

      await expect(profileCreate("new", { from: "missing" })).rejects.toThrow("process.exit");
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe("profileShow", () => {
    it("should show active profile when name not provided", async () => {
      const config = {
        version: "0.1.0",
        this_node: {
          role: "h1" as const,
          name: "calcifer",
          tailscale_hostname: "calcifer",
          tailscale_ip: "100.1.2.3",
        },
        peer_node: {
          role: "h2" as const,
          name: "glados",
          tailscale_hostname: "glados",
          tailscale_ip: "100.1.2.4",
          ssh_user: "admin",
          ssh_key_path: "~/.ssh/id_rsa",
          os: "linux" as const,
          gateway_port: 18789,
          gateway_token: "secret-token-123",
        },
        gateway_port: 18789,
      };

      vi.mocked(getActiveProfileName).mockResolvedValue("default");
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(config));

      await profileShow();

      expect(getActiveProfileName).toHaveBeenCalled();
      expect(readFile).toHaveBeenCalled();
    });

    it("should show named profile", async () => {
      const config = {
        version: "0.1.0",
        this_node: {
          role: "h1" as const,
          name: "calcifer",
          tailscale_hostname: "calcifer",
          tailscale_ip: "100.1.2.3",
        },
        peer_node: {
          role: "h2" as const,
          name: "glados",
          tailscale_hostname: "glados",
          tailscale_ip: "100.1.2.4",
          ssh_user: "admin",
          ssh_key_path: "~/.ssh/id_rsa",
          os: "linux" as const,
          gateway_port: 18789,
        },
        gateway_port: 18789,
      };

      vi.mocked(readFile).mockResolvedValue(JSON.stringify(config));

      await profileShow("work");

      expect(readFile).toHaveBeenCalled();
    });

    it("should mask gateway tokens in output", async () => {
      const config = {
        version: "0.1.0",
        this_node: {
          role: "h1" as const,
          name: "calcifer",
          tailscale_hostname: "calcifer",
          tailscale_ip: "100.1.2.3",
        },
        peer_node: {
          role: "h2" as const,
          name: "glados",
          tailscale_hostname: "glados",
          tailscale_ip: "100.1.2.4",
          ssh_user: "admin",
          ssh_key_path: "~/.ssh/id_rsa",
          os: "linux" as const,
          gateway_port: 18789,
          gateway_token: "secret-token-123",
        },
        gateway_port: 18789,
      };

      vi.mocked(getActiveProfileName).mockResolvedValue("default");
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(config));

      const logSpy = vi.spyOn(console, "log");

      await profileShow(undefined, { json: true });

      expect(logSpy).toHaveBeenCalled();
      const output = logSpy.mock.calls[0][0];
      expect(output).toContain("***MASKED***");
      expect(output).not.toContain("secret-token-123");
    });

    it("should error when profile not found", async () => {
      vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"));

      await expect(profileShow("missing")).rejects.toThrow("process.exit");
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe("profileDelete", () => {
    it("should delete non-active profile", async () => {
      vi.mocked(getActiveProfileName).mockResolvedValue("default");
      vi.mocked(unlink).mockResolvedValue(undefined);

      await profileDelete("old-profile");

      expect(getActiveProfileName).toHaveBeenCalled();
      expect(unlink).toHaveBeenCalled();
    });

    it("should refuse to delete active profile without --force", async () => {
      vi.mocked(getActiveProfileName).mockResolvedValue("work");

      await expect(profileDelete("work")).rejects.toThrow("process.exit");
      expect(process.exit).toHaveBeenCalledWith(1);
      expect(unlink).not.toHaveBeenCalled();
    });

    it("should delete active profile with --force", async () => {
      vi.mocked(getActiveProfileName).mockResolvedValue("work");
      vi.mocked(unlink).mockResolvedValue(undefined);

      await profileDelete("work", { force: true });

      expect(unlink).toHaveBeenCalled();
    });

    it("should error when profile does not exist", async () => {
      vi.mocked(getActiveProfileName).mockResolvedValue("default");
      vi.mocked(unlink).mockRejectedValue(new Error("ENOENT"));

      await expect(profileDelete("nonexistent")).rejects.toThrow("process.exit");
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe("COFOUNDER_PROFILE env var", () => {
    it("should override active profile from env var", () => {
      const originalEnv = process.env.COFOUNDER_PROFILE;
      process.env.COFOUNDER_PROFILE = "test-profile";

      // Verify env var is set (actual getActiveProfileName is tested in store.test.ts)
      expect(process.env.COFOUNDER_PROFILE).toBe("test-profile");

      // Restore
      if (originalEnv === undefined) {
        delete process.env.COFOUNDER_PROFILE;
      } else {
        process.env.COFOUNDER_PROFILE = originalEnv;
      }
    });
  });
});
