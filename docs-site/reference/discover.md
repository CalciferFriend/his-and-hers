---
title: "hh discover"
description: Browse and filter community H2 nodes from the public registry.
---

# `hh discover` — Reference

Browse community H2 nodes published to the public registry.

---

## Synopsis

```bash
hh discover [flags]
```

---

## Flags

| Flag | Description |
|------|-------------|
| `--gpu` | Filter by GPU keyword (e.g. `4090`, `3070`, `m2`) |
| `--skill <tag>` | Filter by skill tag (e.g. `image-gen`, `inference:70b`) |
| `--os <os>` | Filter by OS: `linux`, `windows`, `macos` |
| `--provider <name>` | Filter by LLM provider: `ollama`, `anthropic`, `openai` |
| `--wol` | Only show WOL-capable nodes |
| `--limit <n>` | Max results to show (default: 20) |
| `--json` | JSON output |

---

## Output

### Default

```bash
$ hh discover

his-and-hers community nodes  (registry: github gist)
Updated: 2m ago · 47 nodes total

#  Name           OS        GPU                   Skills                    WOL
── ────────────── ───────── ───────────────────── ───────────────────────── ────
1  h2-beast    linux     RTX 4090 · 24 GB      inference:70b, image-gen  ✓
2  mymac          macos     M2 Pro · 32 GB        ollama, gpu-inference     –
3  h2-pi-farm  linux     CPU only (Pi 5)       embeddings, summarize     –
4  workstation    windows   RTX 3070 Ti · 8 GB    ollama, gpu-inference     ✓
5  studio-beast   linux     RTX 4090 · 24 GB      inference:70b, image-gen  ✓
...

Run `hh discover --json` for full details.
```

### With filters

```bash
$ hh discover --skill image-gen --wol

his-and-hers community nodes  (registry: github gist)
Filtered: skill=image-gen, wol=true · 12 matches

#  Name          OS       GPU                   Skills                    WOL
── ───────────── ──────── ───────────────────── ───────────────────────── ────
1  h2-beast   linux    RTX 4090 · 24 GB      inference:70b, image-gen  ✓
2  studio-beast  linux    RTX 4090 · 24 GB      inference:70b, image-gen  ✓
3  workstation   windows  RTX 3070 Ti · 8 GB    ollama, gpu-inference     ✓
...
```

---

## JSON output

```bash
$ hh discover --skill image-gen --limit 2 --json
```

```json
[
  {
    "id": "gist:abc123",
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
    "description": "Beast node running Flux and 70B",
    "published_at": "2026-03-10T12:00:00Z"
  },
  {
    "id": "gist:def456",
    "name": "studio-beast",
    "os": "linux",
    "gpu": {
      "name": "NVIDIA GeForce RTX 4090",
      "vram_gb": 24,
      "backend": "cuda"
    },
    "skill_tags": ["inference:70b", "image-gen"],
    "wol_capable": true,
    "provider": "ollama",
    "description": null,
    "published_at": "2026-03-11T08:30:00Z"
  }
]
```

---

## How it works

`hh discover` queries the public community registry stored as GitHub Gists.
Nodes are published anonymously via [`hh publish`](/reference/publish) — no
personal information is included unless you add it in `--description`.

Results are cached locally for 5 minutes to avoid hammering the GitHub API.

---

## Node card fields

Each node in the registry is a `HHNodeCard`:

| Field | Description |
|-------|-------------|
| `name` | Node name (set during `hh onboard`) |
| `os` | Operating system (`linux`, `windows`, `macos`) |
| `gpu` | GPU name, VRAM, backend |
| `skill_tags` | Capability tags (e.g. `image-gen`, `inference:70b`) |
| `wol_capable` | Whether the node supports Wake-on-LAN |
| `provider` | Primary LLM provider |
| `description` | Optional free-form description |
| `published_at` | When this card was last published |

---

## See also

- [`hh publish`](/reference/publish) — publish your node to the registry
- [`hh capabilities`](/reference/capabilities) — manage local capability profile
- [`hh pair`](/reference/pair) — pair with another node you find here
