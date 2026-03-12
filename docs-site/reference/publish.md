---
title: "hh publish"
description: Publish your H2 node's capability card to the community registry.
---

# `hh publish` — Reference

Publish an anonymised node card to the community registry so others can discover
nodes with specific hardware or skills.

---

## Synopsis

```bash
hh publish [flags]
```

---

## Flags

| Flag | Description |
|------|-------------|
| `--description <text>` | Optional human-readable description of this node |
| `--tags <csv>` | Override skill tags (default: from `capabilities.json`) |
| `--dry-run` | Preview the card that would be published without actually publishing |
| `--json` | Output the published card as JSON |
| `--revoke` | Remove this node's card from the registry |

---

## Output

### Normal publish

```bash
$ hh publish --description "Beast node, 24 GB VRAM, always on"

Publishing node card...
✓  Capabilities loaded from ~/.his-and-hers/capabilities.json
✓  Card built:
     Name:   h2-beast
     OS:     linux
     GPU:    NVIDIA GeForce RTX 4090 · 24 GB VRAM
     Skills: inference:70b, image-gen, code, embeddings, vision
     WOL:    yes
✓  Published to registry (gist: https://gist.github.com/abc123def456)

Your node is now discoverable via `hh discover`.
To remove it: hh publish --revoke
```

### Dry run

```bash
$ hh publish --dry-run

Dry run — nothing will be published.

Node card preview:
{
  "name": "h2-beast",
  "os": "linux",
  "gpu": {
    "name": "NVIDIA GeForce RTX 4090",
    "vram_gb": 24,
    "backend": "cuda"
  },
  "skill_tags": ["inference:70b", "image-gen", "code", "embeddings"],
  "wol_capable": true,
  "provider": "ollama",
  "description": null,
  "version": "0.1.0"
}
```

### Revoke

```bash
$ hh publish --revoke

Removing node card from registry...
✓  Card removed (gist deleted)
Your node is no longer discoverable.
```

---

## JSON output

```bash
$ hh publish --json
```

```json
{
  "status": "published",
  "gist_id": "abc123def456",
  "gist_url": "https://gist.github.com/abc123def456",
  "card": {
    "name": "h2-beast",
    "os": "linux",
    "gpu": {
      "name": "NVIDIA GeForce RTX 4090",
      "vram_gb": 24,
      "backend": "cuda"
    },
    "skill_tags": ["inference:70b", "image-gen", "code", "embeddings"],
    "wol_capable": true,
    "provider": "ollama",
    "description": "Beast node, 24 GB VRAM, always on",
    "published_at": "2026-03-12T10:00:00Z",
    "version": "0.1.0"
  }
}
```

---

## What gets published

`hh publish` builds a `HHNodeCard` from:

1. `~/.his-and-hers/capabilities.json` — hardware, Ollama models, skill tags
2. Your `hh.json` config — node name, OS, provider
3. WOL config — whether a MAC address is configured

**What is NOT included:**
- Tailscale IP or MAC address
- API keys
- SSH credentials
- Any personal information (unless you add it in `--description`)

---

## Prerequisites

- Run `hh capabilities advertise` first to generate `capabilities.json`
- A GitHub Personal Access Token with `gist` scope stored in your OS keychain:

```bash
# Store token (interactive prompt)
hh auth github
# Or set env var
export GITHUB_TOKEN=ghp_...
```

---

## Auto-refresh

To keep your published card up to date, add `hh publish` to your H2 startup
sequence alongside `hh capabilities advertise`:

```bash
# In systemd ExecStart or startup.bat:
hh capabilities advertise && hh publish
```

---

## See also

- [`hh discover`](/reference/discover) — browse the community registry
- [`hh capabilities`](/reference/capabilities) — manage your capability profile
- [Protocol: HHCapabilityReport](/protocol/capabilities) — the underlying schema
