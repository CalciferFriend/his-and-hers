/**
 * attach.ts — File attachment utilities for `cofounder send --attach`
 *
 * Reads local files, detects MIME type, base64-encodes them,
 * and enforces the 10 MB soft size cap with a truncation warning.
 *
 * Phase 7d — owned by Calcifer 🔥
 */

import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { AttachmentPayload } from "./protocol/message.schema.ts";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Soft cap per attachment: warn if exceeded. Transport may fail above ~50 MB total. */
export const ATTACH_SIZE_LIMIT_BYTES = 10 * 1024 * 1024; // 10 MB

/** Hard per-attachment cutoff: refuse anything over this */
export const ATTACH_HARD_LIMIT_BYTES = 50 * 1024 * 1024; // 50 MB

// ─── MIME detection ───────────────────────────────────────────────────────────

/** Supported MIME types by extension */
const MIME_MAP: Record<string, string> = {
  // Documents
  ".pdf": "application/pdf",
  // Images
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  // Text / Code / Data
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".json": "application/json",
  ".jsonl": "application/x-ndjson",
  ".csv": "text/csv",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".toml": "application/toml",
  ".xml": "application/xml",
  ".html": "text/html",
  ".htm": "text/html",
  // Code
  ".ts": "text/x-typescript",
  ".tsx": "text/x-typescript",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".py": "text/x-python",
  ".sh": "application/x-sh",
  ".bash": "application/x-sh",
  ".zsh": "application/x-sh",
  ".rs": "text/x-rustsrc",
  ".go": "text/x-go",
  ".c": "text/x-csrc",
  ".cpp": "text/x-c++src",
  ".h": "text/x-chdr",
  ".java": "text/x-java",
  ".rb": "text/x-ruby",
  ".sql": "application/sql",
  ".swift": "text/x-swift",
  ".kt": "text/x-kotlin",
  ".css": "text/css",
  ".scss": "text/x-scss",
};

/**
 * Detect MIME type from file extension.
 * Falls back to `application/octet-stream` for unknown types.
 */
export function detectMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_MAP[ext] ?? "application/octet-stream";
}

/**
 * Returns true for MIME types that H2's multimodal API can process natively.
 * Text/code types are injected as fenced code blocks in the task text instead.
 */
export function isMultimodalType(mimeType: string): boolean {
  return (
    mimeType === "application/pdf" ||
    mimeType.startsWith("image/")
  );
}

// ─── Attachment loader ────────────────────────────────────────────────────────

export interface LoadAttachmentResult {
  ok: boolean;
  attachment?: AttachmentPayload;
  /** Human-readable warning (e.g. "file exceeded soft cap") */
  warning?: string;
  error?: string;
}

/**
 * Load a file from disk and return an `AttachmentPayload`.
 *
 * - Enforces 50 MB hard limit (error)
 * - Warns (but continues) for files > 10 MB
 * - Auto-detects MIME type from extension
 *
 * @param filePath - Absolute or relative path to the file
 */
export async function loadAttachment(filePath: string): Promise<LoadAttachmentResult> {
  // Check file exists and get size
  let fileStat: Awaited<ReturnType<typeof stat>>;
  try {
    fileStat = await stat(filePath);
  } catch {
    return { ok: false, error: `File not found: ${filePath}` };
  }

  if (!fileStat.isFile()) {
    return { ok: false, error: `Not a file: ${filePath}` };
  }

  const sizeBytes = fileStat.size;

  // Hard limit
  if (sizeBytes > ATTACH_HARD_LIMIT_BYTES) {
    const mb = (sizeBytes / 1024 / 1024).toFixed(1);
    return {
      ok: false,
      error: `File too large: ${mb} MB (hard limit: 50 MB). Compress or split the file first.`,
    };
  }

  // Read and encode
  let data: Buffer;
  try {
    data = await readFile(filePath);
  } catch (err) {
    return { ok: false, error: `Failed to read file: ${(err as Error).message}` };
  }

  const mimeType = detectMimeType(filePath);
  const attachment: AttachmentPayload = {
    filename: basename(filePath),
    mime_type: mimeType,
    data: data.toString("base64"),
    size_bytes: sizeBytes,
  };

  // Soft limit warning
  const warning =
    sizeBytes > ATTACH_SIZE_LIMIT_BYTES
      ? `⚠ ${basename(filePath)} is ${(sizeBytes / 1024 / 1024).toFixed(1)} MB (soft cap: 10 MB). Large attachments may be slow to transmit.`
      : undefined;

  return { ok: true, attachment, warning };
}

/**
 * Load multiple attachments from disk.
 * Returns aggregated results; partial failures are reported per-file.
 */
export async function loadAttachments(filePaths: string[]): Promise<{
  attachments: AttachmentPayload[];
  warnings: string[];
  errors: string[];
}> {
  const attachments: AttachmentPayload[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  await Promise.all(
    filePaths.map(async (fp) => {
      const result = await loadAttachment(fp);
      if (result.ok && result.attachment) {
        attachments.push(result.attachment);
        if (result.warning) warnings.push(result.warning);
      } else {
        errors.push(result.error ?? `Unknown error loading ${fp}`);
      }
    }),
  );

  return { attachments, warnings, errors };
}

// ─── Wake-text helpers ────────────────────────────────────────────────────────

/**
 * Format a compact attachment summary for inclusion in wake text.
 * H2 reads this to know what files were sent before decoding the full payload.
 *
 * Example output:
 *   HH-Attachments: 2 files
 *     [1] report.pdf (application/pdf, 1.4 MB)
 *     [2] diagram.png (image/png, 0.3 MB)
 */
export function formatAttachmentSummary(attachments: AttachmentPayload[]): string {
  if (attachments.length === 0) return "";
  const lines = [`HH-Attachments: ${attachments.length} file${attachments.length === 1 ? "" : "s"}`];
  for (let i = 0; i < attachments.length; i++) {
    const a = attachments[i];
    const mb = (a.size_bytes / 1024 / 1024).toFixed(2);
    const hint = isMultimodalType(a.mime_type) ? " [multimodal]" : " [text-inject]";
    lines.push(`  [${i + 1}] ${a.filename} (${a.mime_type}, ${mb} MB)${hint}`);
  }
  lines.push(
    `  H2: decode attachments from CofounderTaskMessage.payload.attachments[]; ` +
    `inject multimodal types via message API, text types as fenced code blocks.`,
  );
  return lines.join("\n");
}

/**
 * Decode a base64 attachment back to a Buffer.
 * Used by H2 to process received attachments.
 */
export function decodeAttachment(attachment: AttachmentPayload): Buffer {
  return Buffer.from(attachment.data, "base64");
}
