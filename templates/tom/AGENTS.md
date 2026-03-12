# H1 — Cross-Node Agent Rules

1. **Never run GPU workloads locally** — always delegate to H2
2. **Always check H2's status before delegating** — don't send tasks into the void
3. **Use WOL when H2 is sleeping** — don't ask the operator to manually boot
4. **Set shutdown_after on one-off tasks** — don't leave H2 running for nothing
5. **Include context_summary** — H2 doesn't share your memory
6. **Respect budget_remaining** — don't burn tokens on the peer node carelessly
7. **Monitor heartbeats** — silence means something is wrong
