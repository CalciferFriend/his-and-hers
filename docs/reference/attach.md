# `hh send --attach` — File Attachments

> **Phase 7d** · Owned by Calcifer 🔥 (H1) + GLaDOS 🤖 (H2 injection)

Attach files to a task so H2 can process them as part of its response.
Supported types: **PDF, images** (PNG/JPEG/WebP/GIF), **text, code, Markdown, JSON**, and more.

---

## Usage

```bash
# Attach a single file
hh send "Review this report and summarise key findings" --attach ./report.pdf

# Attach multiple files
hh send "Compare these two charts" --attach chart1.png chart2.png

# Attach a code file for review
hh send "Review this TypeScript module for bugs" --attach src/index.ts

# Combine with --wait to get the result immediately
hh send "Describe this image" --attach diagram.webp --wait

# Combine with --sync for large workspaces
hh send "Run the benchmark suite" --sync ./project --attach ./project/results.json --wait
```

---

## File Size Limits

| Limit | Size | Behaviour |
|-------|------|-----------|
| Soft cap | 10 MB/file | Warning shown, send continues |
| Hard cap | 50 MB/file | Error — send aborted |
| Total | ~50 MB/task | Practical transport limit |

For large files, compress or split before attaching. Use `--sync` to push entire directories.

---

## Supported Types

### Multimodal (H2 injects via message API)

| Extension | MIME type |
|-----------|-----------|
| `.pdf` | `application/pdf` |
| `.png` | `image/png` |
| `.jpg` / `.jpeg` | `image/jpeg` |
| `.webp` | `image/webp` |
| `.gif` | `image/gif` |

### Text / Code (H2 injects as fenced code blocks)

| Extension | MIME type |
|-----------|-----------|
| `.txt` | `text/plain` |
| `.md` / `.markdown` | `text/markdown` |
| `.json` | `application/json` |
| `.jsonl` | `application/x-ndjson` |
| `.csv` | `text/csv` |
| `.yaml` / `.yml` | `application/yaml` |
| `.ts` / `.tsx` | `text/x-typescript` |
| `.js` / `.mjs` | `text/javascript` |
| `.py` | `text/x-python` |
| `.sh` / `.bash` / `.zsh` | `application/x-sh` |
| `.go` | `text/x-go` |
| `.rs` | `text/x-rustsrc` |
| `.sql` | `application/sql` |
| `.html` / `.css` | `text/html` / `text/css` |

Unknown extensions → `application/octet-stream` (passed through, H2 will attempt to decode).

---

## Protocol

Attachments are embedded in `HHTaskMessage.payload.attachments[]` as base64-encoded
`AttachmentPayload` objects:

```ts
type AttachmentPayload = {
  filename: string;      // "report.pdf"
  mime_type: string;     // "application/pdf"
  data: string;          // base64-encoded file contents
  size_bytes: number;    // original file size in bytes
};
```

The wake text sent to H2 includes a human-readable summary:

```
HH-Attachments: 2 files
  [1] report.pdf (application/pdf, 1.42 MB) [multimodal]
  [2] notes.md (text/markdown, 0.01 MB) [text-inject]
  H2: decode attachments from HHTaskMessage.payload.attachments[]; inject multimodal types via message API, text types as fenced code blocks.
```

---

## H2 Integration Guide (GLaDOS)

When H2 receives a task with attachments, it should:

1. Read `msg.payload.attachments[]`
2. For each attachment, call `decodeAttachment(a)` → `Buffer`
3. For **multimodal** types (`isMultimodalType(mime_type) === true`): inject as an image/document part via the multimodal message API
4. For **text** types: inject file contents as a fenced code block in the task context:

```
**Attached file: notes.md**
```markdown
# Phase 7
...
```

5. After injecting, strip attachments from the wake text (don't re-encode in the response)

```ts
import { decodeAttachment, isMultimodalType } from "@his-and-hers/core";

for (const attachment of msg.payload.attachments) {
  const buffer = decodeAttachment(attachment);
  if (isMultimodalType(attachment.mime_type)) {
    // pass buffer to multimodal API
  } else {
    // inject as fenced code block in task text
    const text = buffer.toString("utf8");
    taskContext += `\n\n**Attached: ${attachment.filename}**\n\`\`\`\n${text}\n\`\`\`\n`;
  }
}
```

---

## SDK Usage

```ts
import { loadAttachments, formatAttachmentSummary } from "@his-and-hers/core";

const { attachments, warnings, errors } = await loadAttachments([
  "./report.pdf",
  "./diagram.png",
]);

if (errors.length > 0) {
  console.error("Attachment errors:", errors);
  process.exit(1);
}

for (const warn of warnings) {
  console.warn(warn);
}

// Attachments are ready to embed in HHTaskPayload
const payload = {
  objective: "Analyse these documents",
  attachments,
};
```

---

## See Also

- [`hh sync`](./sync.md) — push directories to H2 over Tailscale SSH
- [`hh send`](./cli.md) — full send reference
- [`@his-and-hers/sdk`](../sdk.md) — programmatic API
