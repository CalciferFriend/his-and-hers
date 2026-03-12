# Security Model

## Pairing trust
- Nodes pair via a one-time 6-digit code
- Code is hashed (SHA-256) before storage — never stored in plaintext
- After pairing, nodes trust each other via Tailscale IP allowlist

## Credential storage
- API keys and auth tokens stored in OS keychain via `keytar`
- Config file (`~/.# Security Model

## Pairing trust
- Nodes pair via a one-time 6-digit code
- Code is hashed (SHA-256) before storage — never stored in plaintext
- After pairing, nodes trust each other via Tailscale IP allowlist

## Credential storage
- API keys and auth tokens stored in OS keychain via `keytar`
- Config file (`~/.his-and-hers/hh.json`) references keychain keys by name only
- Config file permissions are set to `0o600` (owner read/write only)

## Network security
- All inter-node traffic flows over Tailscale (WireGuard-encrypted)
- Gateway bind modes prevent accidental exposure:
  - H1: binds to loopback (127.0.0.1) — local only
  - H2: binds to Tailscale IP — only reachable via tailnet
- `trustedProxies` allowlist limits which IPs can reach the gateway

## No plaintext credentials
- No API keys in `.env` files (keychain is the source of truth)
- `.env.example` documents available env vars but contains no secrets
- `.gitignore` excludes `.env` and `.env.local`

## Reporting vulnerabilities
Please report security issues to the maintainers privately. Do not open public issues for security vulnerabilities.
/hh.json`) references keychain keys by name only
- Config file permissions are set to `0o600` (owner read/write only)

## Network security
- All inter-node traffic flows over Tailscale (WireGuard-encrypted)
- Gateway bind modes prevent accidental exposure:
  - H1: binds to loopback (127.0.0.1) — local only
  - H2: binds to Tailscale IP — only reachable via tailnet
- `trustedProxies` allowlist limits which IPs can reach the gateway

## No plaintext credentials
- No API keys in `.env` files (keychain is the source of truth)
- `.env.example` documents available env vars but contains no secrets
- `.gitignore` excludes `.env` and `.env.local`

## Reporting vulnerabilities
Please report security issues to the maintainers privately. Do not open public issues for security vulnerabilities.
