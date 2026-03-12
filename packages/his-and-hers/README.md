# his-and-hers

> Two agents. Separate machines. One command to wire them.

```bash
npx his-and-hers
```

That's it. The guided wizard handles everything:

- Picks a role (🐱 Tom orchestrator or 🐭 Jerry executor)
- Configures your LLM provider (Anthropic, OpenAI, Ollama, or any OpenAI-compatible API)
- Pairs the two machines over Tailscale
- Sets up Wake-on-LAN if one machine sleeps
- Configures the gateway, startup scripts, and Windows AutoLogin automatically
- Validates the full round-trip before finishing

**Requirements:** Node ≥ 22, [Tailscale](https://tailscale.com), [OpenClaw](https://github.com/openclaw/openclaw)

---

Full docs: [github.com/CalciferFriend/his-and-hers](https://github.com/CalciferFriend/his-and-hers)
