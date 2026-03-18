# Content Generation Template

H1 schedules and monitors content needs. H2 wakes on-demand to generate images, videos, or other creative assets using GPU-accelerated tools.

## Use Case

You run a social media presence, marketing agency, or content business that needs regular visual content. Hiring designers is expensive. Cloud rendering services charge per minute. You have a GPU sitting idle.

**Solution:** H1 monitors trends, schedules content needs, and queues generation tasks. H2 wakes up, runs Stable Diffusion/ComfyUI/video tools, generates assets, then goes back to sleep.

## Cost Savings Example

**Before (cloud services):**
- Midjourney: $30/month for 200 images
- RunwayML: $12/100 video seconds
- Total: ~$50-100/month for modest usage

**After (H1 + H2):**
- H1: $10/month (always-on VM)
- H2: $0/month (your existing hardware, sleeps when idle)
- Power cost: ~$5/month (only runs 1-2 hours/day)

**Savings:** $35-85/month (~70-85% reduction)

## Setup

### 1. Hardware Requirements

**H1 (scheduler):**
- Any cheap cloud VM
- No GPU needed

**H2 (generator):**
- NVIDIA GPU with 8GB+ VRAM (RTX 3060 Ti or better)
- For video: 12GB+ VRAM recommended
- 16GB+ system RAM

### 2. Install Generation Tools on H2

**For images (Stable Diffusion):**
```bash
# Install ComfyUI (recommended - most flexible)
git clone https://github.com/comfyanonymous/ComfyUI
cd ComfyUI
pip install -r requirements.txt

# Download models
cd models/checkpoints
wget https://huggingface.co/runwayml/stable-diffusion-v1-5/resolve/main/v1-5-pruned-emaonly.safetensors

# Or use Automatic1111 WebUI
git clone https://github.com/AUTOMATIC1111/stable-diffusion-webui
cd stable-diffusion-webui
./webui.sh
```

**For video:**
```bash
# AnimateDiff for video generation
pip install animatediff
```

### 3. Initialize Template

```bash
cd ~/.openclaw
hh templates init content-generation
```

### 4. Configure Workflow

Edit `~/.openclaw/SOUL.md` on H1:

```markdown
## Content Strategy

Monitor daily:
1. Trending topics on X/Twitter (via API)
2. Viral content patterns (via Virlo API)
3. Competitor content (scheduled scrapes)

When content gap detected:
1. Generate prompt based on trend + brand voice
2. Wake H2
3. Send generation task with parameters
4. Post generated content to social platforms
5. Shut down H2
```

## Example Code

### H1: Content Scheduler

```typescript
// content-scheduler.ts on H1
import { sendTask } from '@his-and-hers/sdk';
import { TwitterApi } from 'twitter-api-v2';

interface ContentRequest {
  type: 'image' | 'video';
  prompt: string;
  style: string;
  aspectRatio: string;
}

async function monitorTrends() {
  const twitter = new TwitterApi(process.env.TWITTER_API_KEY);
  const trends = await twitter.v2.trends();

  for (const trend of trends) {
    // Check if we need content for this trend
    const needsContent = await checkContentGap(trend.name);

    if (needsContent) {
      const prompt = await generatePrompt(trend);

      await sendTask({
        to: 'H2',
        objective: `Generate social media image`,
        payload: {
          type: 'image',
          prompt: prompt,
          style: 'photorealistic',
          aspectRatio: '16:9',
        } as ContentRequest,
        wake_required: true,
        shutdown_after: true,
      });
    }
  }
}

// Run every hour
setInterval(monitorTrends, 60 * 60 * 1000);
```

### H2: Content Generator

```typescript
// content-generator.ts on H2
import { onTask } from '@his-and-hers/sdk';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

onTask(async (task) => {
  const { type, prompt, style, aspectRatio } = task.payload;

  if (type === 'image') {
    // Generate via ComfyUI API
    const response = await fetch('http://localhost:8188/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: {
          '3': {
            inputs: {
              text: prompt,
              clip: ['4', 1],
            },
            class_type: 'CLIPTextEncode',
          },
          '5': {
            inputs: {
              samples: ['3', 0],
              vae: ['4', 2],
            },
            class_type: 'VAEDecode',
          },
          // ... full ComfyUI workflow
        },
      }),
    });

    const result = await response.json();
    const outputPath = `/path/to/output/${result.prompt_id}.png`;

    return {
      output: outputPath,
      metadata: {
        prompt,
        model: 'SD 1.5',
        generation_time_s: result.exec_info.queue_time,
      },
    };
  }

  // Video generation similar pattern
});
```

## Advanced: Batch Processing

Generate multiple variants in one wake cycle:

```typescript
// On H1
const prompts = [
  'Modern tech startup office, bright lighting',
  'Cozy coffee shop interior, warm tones',
  'Futuristic city skyline at sunset',
];

await sendTask({
  to: 'H2',
  objective: 'Generate 3 image variants',
  payload: {
    batch: prompts.map(p => ({
      type: 'image',
      prompt: p,
      style: 'photorealistic',
    })),
  },
  wake_required: true,
  shutdown_after: true,
});
```

## Production Tips

1. **Queue management:** Don't wake H2 for every single image. Queue 5-10 requests, then batch generate.

2. **Model caching:** Keep commonly-used models loaded in VRAM between tasks (don't unload after each generation).

3. **Scheduling:** Wake H2 during off-peak hours (2-4 AM) for daily content batch generation.

4. **Watermarking:** Add automated watermarks on H2 before returning to H1.

5. **Storage:** Use S3 or Cloudflare R2 for generated assets (cheap storage, fast delivery).

## Monitoring

Track with `hh web`:
- **Generation count:** Images/videos per day
- **H2 uptime:** Optimize wake cycles
- **Cost savings:** vs Midjourney/RunwayML equivalent pricing

## Troubleshooting

**ComfyUI won't start:**
- Check GPU drivers: `nvidia-smi`
- Verify CUDA version matches PyTorch version
- Check port 8188 isn't blocked

**Out of VRAM errors:**
- Reduce batch size
- Use smaller models (SD 1.5 instead of SDXL)
- Lower resolution (512x512 instead of 1024x1024)

**Slow generation:**
- Enable xformers: `pip install xformers`
- Use FP16 instead of FP32
- Reduce sampling steps (20-30 is usually fine)

## Next Steps

- Integrate DALL-E 3 API as fallback for urgent requests
- Add content calendar (schedule generation 1 day ahead)
- A/B test prompts (generate 3 variants, pick best performer)
- Auto-post to social platforms after generation