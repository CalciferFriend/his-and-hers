/**
 * attach.test.ts — Unit tests for Phase 7d attachment utilities
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  detectMimeType,
  isMultimodalType,
  loadAttachment,
  loadAttachments,
  formatAttachmentSummary,
  decodeAttachment,
  ATTACH_SIZE_LIMIT_BYTES,
  ATTACH_HARD_LIMIT_BYTES,
} from "./attach.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let testDir: string;

beforeAll(async () => {
  testDir = join(tmpdir(), `hh-attach-test-${Date.now()}`);
  await mkdir(testDir, { recursive: true });
});

afterAll(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ─── MIME detection ───────────────────────────────────────────────────────────

describe("detectMimeType", () => {
  it("detects PDF", () => {
    expect(detectMimeType("/path/to/file.pdf")).toBe("application/pdf");
  });

  it("detects PNG", () => {
    expect(detectMimeType("image.PNG")).toBe("image/png"); // case-insensitive
  });

  it("detects JPEG (both extensions)", () => {
    expect(detectMimeType("photo.jpg")).toBe("image/jpeg");
    expect(detectMimeType("photo.jpeg")).toBe("image/jpeg");
  });

  it("detects WebP", () => {
    expect(detectMimeType("img.webp")).toBe("image/webp");
  });

  it("detects markdown", () => {
    expect(detectMimeType("README.md")).toBe("text/markdown");
    expect(detectMimeType("README.markdown")).toBe("text/markdown");
  });

  it("detects JSON", () => {
    expect(detectMimeType("data.json")).toBe("application/json");
  });

  it("detects TypeScript", () => {
    expect(detectMimeType("index.ts")).toBe("text/x-typescript");
    expect(detectMimeType("app.tsx")).toBe("text/x-typescript");
  });

  it("detects Python", () => {
    expect(detectMimeType("script.py")).toBe("text/x-python");
  });

  it("detects YAML", () => {
    expect(detectMimeType("config.yaml")).toBe("application/yaml");
    expect(detectMimeType("config.yml")).toBe("application/yaml");
  });

  it("falls back to octet-stream for unknown extensions", () => {
    expect(detectMimeType("file.xyz")).toBe("application/octet-stream");
    expect(detectMimeType("noextension")).toBe("application/octet-stream");
  });
});

// ─── isMultimodalType ─────────────────────────────────────────────────────────

describe("isMultimodalType", () => {
  it("returns true for PDF", () => {
    expect(isMultimodalType("application/pdf")).toBe(true);
  });

  it("returns true for image types", () => {
    expect(isMultimodalType("image/png")).toBe(true);
    expect(isMultimodalType("image/jpeg")).toBe(true);
    expect(isMultimodalType("image/webp")).toBe(true);
    expect(isMultimodalType("image/gif")).toBe(true);
  });

  it("returns false for text types", () => {
    expect(isMultimodalType("text/plain")).toBe(false);
    expect(isMultimodalType("text/markdown")).toBe(false);
    expect(isMultimodalType("application/json")).toBe(false);
    expect(isMultimodalType("text/x-typescript")).toBe(false);
  });
});

// ─── loadAttachment ───────────────────────────────────────────────────────────

describe("loadAttachment", () => {
  it("loads a small text file", async () => {
    const fp = join(testDir, "hello.txt");
    await writeFile(fp, "Hello, GLaDOS!");

    const result = await loadAttachment(fp);
    expect(result.ok).toBe(true);
    expect(result.attachment).toBeDefined();
    expect(result.attachment!.filename).toBe("hello.txt");
    expect(result.attachment!.mime_type).toBe("text/plain");
    expect(result.attachment!.size_bytes).toBe(14);
    expect(result.attachment!.data).toBe(
      Buffer.from("Hello, GLaDOS!").toString("base64"),
    );
    expect(result.warning).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it("loads a markdown file", async () => {
    const fp = join(testDir, "notes.md");
    await writeFile(fp, "# Phase 7\n\nAttachments are here.");

    const result = await loadAttachment(fp);
    expect(result.ok).toBe(true);
    expect(result.attachment!.mime_type).toBe("text/markdown");
  });

  it("loads a JSON file", async () => {
    const fp = join(testDir, "data.json");
    await writeFile(fp, JSON.stringify({ key: "value" }));

    const result = await loadAttachment(fp);
    expect(result.ok).toBe(true);
    expect(result.attachment!.mime_type).toBe("application/json");
    // Decode and verify
    const decoded = decodeAttachment(result.attachment!);
    expect(JSON.parse(decoded.toString())).toEqual({ key: "value" });
  });

  it("returns error for missing file", async () => {
    const result = await loadAttachment(join(testDir, "nonexistent.pdf"));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/File not found/);
  });

  it("returns error for a directory path", async () => {
    const result = await loadAttachment(testDir);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Not a file/);
  });

  it("warns for files between soft and hard cap", async () => {
    const fp = join(testDir, "bigfile.txt");
    // Write just over 10 MB
    const overSoftCap = ATTACH_SIZE_LIMIT_BYTES + 1024;
    await writeFile(fp, Buffer.alloc(overSoftCap, 0x41)); // fill with 'A'

    const result = await loadAttachment(fp);
    expect(result.ok).toBe(true);
    expect(result.warning).toMatch(/soft cap/i);
    expect(result.attachment!.size_bytes).toBe(overSoftCap);
  });

  it("errors for files over the hard cap", async () => {
    const fp = join(testDir, "toobig.bin");
    await writeFile(fp, Buffer.alloc(ATTACH_HARD_LIMIT_BYTES + 1, 0x00));

    const result = await loadAttachment(fp);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/hard limit/i);
  });
});

// ─── loadAttachments ──────────────────────────────────────────────────────────

describe("loadAttachments", () => {
  it("loads multiple files", async () => {
    const fp1 = join(testDir, "a.txt");
    const fp2 = join(testDir, "b.json");
    await writeFile(fp1, "file a");
    await writeFile(fp2, "{}");

    const result = await loadAttachments([fp1, fp2]);
    expect(result.attachments).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);

    const names = result.attachments.map((a) => a.filename).sort();
    expect(names).toEqual(["a.txt", "b.json"]);
  });

  it("collects errors per-file without aborting others", async () => {
    const good = join(testDir, "good.txt");
    await writeFile(good, "content");
    const bad = join(testDir, "nope.pdf"); // doesn't exist

    const result = await loadAttachments([good, bad]);
    expect(result.attachments).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/nope\.pdf/);
  });

  it("collects warnings without failing", async () => {
    const fp = join(testDir, "mediumfile.csv");
    await writeFile(fp, Buffer.alloc(ATTACH_SIZE_LIMIT_BYTES + 512, 0x41));

    const result = await loadAttachments([fp]);
    expect(result.attachments).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });

  it("returns empty arrays for empty input", async () => {
    const result = await loadAttachments([]);
    expect(result.attachments).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});

// ─── formatAttachmentSummary ──────────────────────────────────────────────────

describe("formatAttachmentSummary", () => {
  it("returns empty string for no attachments", () => {
    expect(formatAttachmentSummary([])).toBe("");
  });

  it("formats a single attachment", async () => {
    const fp = join(testDir, "report.pdf");
    await writeFile(fp, Buffer.alloc(1024 * 512, 0x00)); // 512 KB

    const { attachment } = await loadAttachment(fp);
    const summary = formatAttachmentSummary([attachment!]);

    expect(summary).toMatch(/HH-Attachments: 1 file/);
    expect(summary).toMatch(/report\.pdf/);
    expect(summary).toMatch(/application\/pdf/);
    expect(summary).toMatch(/\[multimodal\]/);
    expect(summary).toMatch(/H2:/);
  });

  it("marks text types as text-inject", async () => {
    const fp = join(testDir, "code.ts");
    await writeFile(fp, "export const x = 1;");

    const { attachment } = await loadAttachment(fp);
    const summary = formatAttachmentSummary([attachment!]);

    expect(summary).toMatch(/\[text-inject\]/);
  });

  it("formats multiple attachments with correct count", async () => {
    const fpa = join(testDir, "x.txt");
    const fpb = join(testDir, "y.png");
    await writeFile(fpa, "text");
    await writeFile(fpb, Buffer.alloc(256, 0x00)); // tiny "image"

    const ra = await loadAttachment(fpa);
    const rb = await loadAttachment(fpb);
    const summary = formatAttachmentSummary([ra.attachment!, rb.attachment!]);

    expect(summary).toMatch(/HH-Attachments: 2 files/);
    expect(summary).toMatch(/x\.txt/);
    expect(summary).toMatch(/y\.png/);
  });
});

// ─── decodeAttachment ─────────────────────────────────────────────────────────

describe("decodeAttachment", () => {
  it("round-trips text through base64", async () => {
    const original = "Hello from H1 🔥";
    const fp = join(testDir, "roundtrip.txt");
    await writeFile(fp, original, "utf8");

    const { attachment } = await loadAttachment(fp);
    const decoded = decodeAttachment(attachment!);
    expect(decoded.toString("utf8")).toBe(original);
  });

  it("round-trips binary data through base64", async () => {
    const original = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0xff]);
    const fp = join(testDir, "binary.bin");
    await writeFile(fp, original);

    const { attachment } = await loadAttachment(fp);
    const decoded = decodeAttachment(attachment!);
    expect(decoded).toEqual(original);
  });
});

// ─── Schema / zod validation ──────────────────────────────────────────────────

describe("AttachmentPayload schema (via HHTaskPayload)", () => {
  it("accepts tasks with empty attachments array (default)", async () => {
    const { HHTaskPayload } = await import("./protocol/message.schema.ts");
    const payload = HHTaskPayload.parse({ objective: "do something" });
    expect(payload.attachments).toEqual([]);
  });

  it("accepts tasks with valid attachments", async () => {
    const { HHTaskPayload } = await import("./protocol/message.schema.ts");
    const payload = HHTaskPayload.parse({
      objective: "review this file",
      attachments: [
        {
          filename: "doc.pdf",
          mime_type: "application/pdf",
          data: Buffer.from("fake pdf").toString("base64"),
          size_bytes: 8,
        },
      ],
    });
    expect(payload.attachments).toHaveLength(1);
    expect(payload.attachments[0].filename).toBe("doc.pdf");
  });

  it("rejects negative size_bytes", async () => {
    const { HHTaskPayload } = await import("./protocol/message.schema.ts");
    expect(() =>
      HHTaskPayload.parse({
        objective: "test",
        attachments: [
          {
            filename: "f.txt",
            mime_type: "text/plain",
            data: "aGk=",
            size_bytes: -1,
          },
        ],
      }),
    ).toThrow();
  });
});
