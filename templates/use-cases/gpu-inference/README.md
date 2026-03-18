# GPU Inference Template

Route heavy LLM inference workloads to H2's GPU while H1 stays responsive to API traffic and other tasks.

## Use Case

You're running a service that needs LLM capabilities, but cloud API costs are adding up fast. You have a gaming PC or workstation with a decent GPU (RTX 3060+) that sits idle most of the time.

**Solution:** H1 handles API requests and lightweight tasks 24/7 on a cheap cloud VM ($5-10/month). H2 wakes on-demand to run local LLM inference via Ollama or vLLM, then goes back to sleep.

## Cost Savings Example

**Before (cloud-only):**
- 1M tokens/day via Claude API
- ~$30/day = $900/month

**After (H1 + H2):**
- H1: $10/month (always-on VM)
- H2: $0/month (your existing hardware)
- Local inference: Free after hardware cost

**Savings:** $890/month (~97% reduction)

## Setup

### 1. Hardware Requirements

**H1 (always-on orchestrator):**
- Any cheap cloud VM (AWS t3.micro, DigitalOcean $6 droplet, etc.)
- 1 GB RAM minimum
- No GPU needed

**H2 (GPU executor):**
- RTX 3060 Ti or better (12GB+ VRAM recommended)
- 16GB+ system RAM
- Windows 10/11 or Linux

### 2. Install Ollama on H2

```bash
# Linux/macOS
curl -fsSL https://ollama.com/install.sh | sh

# Windows
# Download from https://ollama.com/download
```

Pull your preferred models:
```bash
ollama pull llama3.1:70b    # Large, high-quality
ollama pull mistral:7b      # Fast, efficient
ollama pull codellama:13b   # Code-specific
```

### 3. Initialize Template

```bash
cd ~/.openclaw
hh templates init gpu-inference
```

This installs:
- H1 SOUL.md with API request handling logic
- H2 SOUL.md with Ollama integration
- Example code for both nodes

### 4. Configure Workflow

Edit `~/.openclaw/SOUL.md` on H1:

```markdown
## Delegation Rules

When a user request requires LLM inference:
1. Check if it's latency-sensitive (API endpoint, chat)
   - If yes: Use cloud API (Anthropic, OpenAI) for speed
   - If no: Wake H2 for local inference

2. Route to H2 when:
   - Batch processing (summarize 100 documents)
   - Code generation (non-urgent)
   - Fine-tuning / embeddings
   - Any task where 30s wake time is acceptable

3. Stay on H1 when:
   - Real-time chat
   - User-facing API with <2s SLA
   - Critical path operations
```

### 5. Test the Flow

From H1:
```bash
hh send "Summarize these 50 customer reviews: [...]"
```

Watch the logs:
1. H1 receives task → detects bulk inference workload
2. H1 sends wake packet to H2 → waits for gateway
3. H2 boots (10-30s) → OpenClaw starts → gateway ready
4. H1 sends task to H2 via Tailscale
5. H2 runs Ollama inference → returns result
6. H2 shuts down after task completes

## Example Code

### H1: API Handler

```typescript
// api-server.ts on H1
import express from 'express';
import { sendTask } from '@his-and-hers/sdk';

const app = express();
app.use(express.json());

app.post('/api/summarize', async (req, res) => {
  const { documents, urgent } = req.body;

  if (urgent || documents.length < 5) {
    // Use cloud API for fast response
    const summary = await callClaudeAPI(documents);
    return res.json({ summary, source: 'cloud' });
  }

  // Route to H2 for cost savings
  const result = await sendTask({
    to: 'H2',
    objective: `Summarize these ${documents.length} documents`,
    payload: { documents },
    wake_required: true,
    shutdown_after: true,
  });

  res.json({ summary: result.output, source: 'local-gpu', cost_usd: 0 });
});

app.listen(3000);
```

### H2: Ollama Worker

```typescript
// inference-worker.ts on H2
import { onTask } from '@his-and-hers/sdk';
import ollama from 'ollama';

onTask(async (task) => {
  const { documents } = task.payload;

  const summaries = [];
  for (const doc of documents) {
    const response = await ollama.generate({
      model: 'llama3.1:70b',
      prompt: `Summarize this document:\n\n${doc}`,
      stream: false,
    });
    summaries.push(response.response);
  }

  return {
    output: summaries.join('\n\n'),
    metadata: {
      model: 'llama3.1:70b',
      token_count: summaries.reduce((acc, s) => acc + s.split(' ').length, 0),
      inference_time_ms: Date.now() - task.started_at,
    },
  };
});
```

## Advanced: vLLM for Production

For higher throughput, replace Ollama with [vLLM](https://github.com/vllm-project/vllm):

```bash
# On H2
pip install vllm
python -m vllm.entrypoints.openai.api_server \
  --model meta-llama/Llama-3.1-70B-Instruct \
  --dtype auto \
  --api-key your-secret-key \
  --port 8000
```

Update H2 code to use OpenAI-compatible endpoint:

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:8000/v1',
  apiKey: 'your-secret-key',
});

const completion = await client.chat.completions.create({
  model: 'meta-llama/Llama-3.1-70B-Instruct',
  messages: [{ role: 'user', content: prompt }],
});
```

## Monitoring

Track savings with `hh web`:
- **Cloud Cost:** API calls from H1
- **Local Savings:** Equivalent cost if all tasks ran on cloud
- **H2 Uptime:** How long GPU was awake (optimize to minimize)

## Troubleshooting

**H2 won't wake:**
- Verify WOL is enabled in BIOS
- Check router port forward (UDP port 9)
- Test manually: `hh wake`

**Ollama not responding:**
- Check if service is running: `systemctl status ollama` (Linux)
- Verify firewall allows localhost:11434
- Test manually: `curl http://localhost:11434/api/generate -d '{"model":"llama3.1:70b","prompt":"hello"}'`

**High latency:**
- Consider keeping H2 awake during business hours
- Use smaller/faster models for non-critical tasks
- Add Redis cache on H1 for repeated queries

## Next Steps

- Add model selection logic (route small tasks to 7B, large to 70B)
- Implement request batching (queue tasks, wake H2 once per 5min)
- Set up monitoring dashboard for cost savings visualization