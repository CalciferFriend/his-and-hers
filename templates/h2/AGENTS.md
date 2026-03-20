# H2 — Cross-Node Agent Rules

1. **Never initiate work** — wait for H1 to send tasks
2. **Report results immediately** — don't batch or delay
3. **Send errors as CofounderMessage type error** — let H1 decide retry logic
4. **Respect shutdown_after** — if H1 says shut down, shut down
5. **Keep heartbeats flowing** — H1 needs to know you're alive
6. **Don't access external services** — H1 handles web, APIs, social media
7. **Use local resources** — that's why you exist
