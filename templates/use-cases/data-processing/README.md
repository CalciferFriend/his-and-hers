# Data Processing Template

H1 continuously ingests streaming data from APIs, webhooks, or logs. H2 wakes on-demand to process CPU/GPU-intensive batch workloads like ETL, ML inference, or video transcoding.

## Use Case

You're building a data pipeline: ingesting events, cleaning data, running transformations, generating insights. Cloud functions are expensive for heavy processing. Your local workstation has plenty of power but shouldn't run 24/7.

**Solution:** H1 runs a lightweight ingest service that queues data. When batch threshold is reached (time or volume), H1 wakes H2 to process the batch, then H2 sleeps.

## Cost Savings Example

**Before (cloud batch processing):**
- AWS Lambda: $0.20 per 1M requests
- 10M events/month = $2/month
- Plus compute time: ~$50/month for heavy processing

**After (H1 + H2):**
- H1: $5/month (ingest server)
- H2: $0/month (your hardware, sleeps between batches)
- Power cost: ~$10/month (2-3 hours/day processing)

**Savings:** $37/month (~70% reduction)

## Setup

### 1. Hardware Requirements

**H1 (ingest):**
- Lightweight VM (2GB RAM)
- Fast network (data flows through H1)

**H2 (processor):**
- CPU: 8+ cores for parallel processing
- RAM: 32GB+ for large datasets
- GPU: Optional (for ML inference, video encoding)
- SSD: Fast I/O for temp storage

### 2. Install Processing Tools on H2

```bash
# Python data stack
pip install pandas numpy scipy scikit-learn

# Video transcoding
sudo apt install ffmpeg

# Database for local processing
docker run -d -p 5432:5432 postgres:15
```

### 3. Initialize Template

```bash
cd ~/.openclaw
hh templates init data-processing
```

## Example Code

### H1: Ingest & Queue

```typescript
// ingest-server.ts on H1
import express from 'express';
import { Queue } from 'bullmq';
import { sendTask } from '@his-and-hers/sdk';

const app = express();
app.use(express.json());

const eventQueue: any[] = [];
const BATCH_SIZE = 1000;
const BATCH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

let batchTimer: NodeJS.Timeout | null = null;

// Webhook endpoint for incoming data
app.post('/ingest', async (req, res) => {
  const event = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    data: req.body,
  };

  eventQueue.push(event);

  // Check if batch is ready
  if (eventQueue.length >= BATCH_SIZE) {
    await processBatch();
  } else if (!batchTimer) {
    // Start timer for partial batch
    batchTimer = setTimeout(processBatch, BATCH_TIMEOUT_MS);
  }

  res.status(202).json({ queued: true });
});

async function processBatch() {
  if (eventQueue.length === 0) return;

  const batch = eventQueue.splice(0, BATCH_SIZE);
  if (batchTimer) {
    clearTimeout(batchTimer);
    batchTimer = null;
  }

  console.log(`Processing batch of ${batch.length} events`);

  await sendTask({
    to: 'H2',
    objective: `Process ${batch.length} events`,
    payload: {
      events: batch,
      pipeline: 'etl-v1',
    },
    wake_required: true,
    shutdown_after: true,
  });
}

app.listen(8000, () => {
  console.log('Ingest server listening on :8000');
});
```

### H2: Batch Processor

```typescript
// batch-processor.ts on H2
import { onTask } from '@his-and-hers/sdk';
import pandas from 'pandas-js';
import { Client as PgClient } from 'pg';

const db = new PgClient({
  host: 'localhost',
  port: 5432,
  database: 'analytics',
});

await db.connect();

onTask(async (task) => {
  const { events, pipeline } = task.payload;

  console.log(`Processing ${events.length} events with ${pipeline}`);

  // Step 1: Clean data
  const cleaned = events.map(e => ({
    ...e,
    data: cleanData(e.data),
  }));

  // Step 2: Transform
  const transformed = cleaned.map(e => transformEvent(e, pipeline));

  // Step 3: Aggregate metrics
  const metrics = aggregateMetrics(transformed);

  // Step 4: Load to database
  for (const event of transformed) {
    await db.query(
      'INSERT INTO events (id, timestamp, data) VALUES ($1, $2, $3)',
      [event.id, event.timestamp, JSON.stringify(event.data)]
    );
  }

  // Step 5: Generate insights
  const insights = await generateInsights(metrics);

  return {
    output: `Processed ${events.length} events\n\nMetrics:\n${JSON.stringify(metrics, null, 2)}\n\nInsights:\n${insights.join('\n')}`,
    metadata: {
      events_processed: events.length,
      processing_time_ms: Date.now() - task.started_at,
      metrics,
    },
  };
});

function cleanData(data: any): any {
  // Remove null values, normalize formats, etc.
  return data;
}

function transformEvent(event: any, pipeline: string): any {
  // Apply pipeline transformations
  return event;
}

function aggregateMetrics(events: any[]): any {
  return {
    total_events: events.length,
    unique_users: new Set(events.map(e => e.data.user_id)).size,
    avg_value: events.reduce((sum, e) => sum + (e.data.value || 0), 0) / events.length,
  };
}

async function generateInsights(metrics: any): Promise<string[]> {
  // Run analytics, ML predictions, etc.
  return [
    `Total events: ${metrics.total_events}`,
    `Unique users: ${metrics.unique_users}`,
    `Average value: $${metrics.avg_value.toFixed(2)}`,
  ];
}
```

## Advanced: Video Transcoding Pipeline

Process uploaded videos:

```typescript
// On H2
import ffmpeg from 'fluent-ffmpeg';

onTask(async (task) => {
  const { video_url, output_formats } = task.payload;

  // Download video
  const inputPath = `/tmp/input-${Date.now()}.mp4`;
  await downloadFile(video_url, inputPath);

  // Transcode to multiple formats
  const outputs = [];
  for (const format of output_formats) {
    const outputPath = `/tmp/output-${Date.now()}-${format.resolution}.mp4`;

    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .size(format.resolution)
        .videoBitrate(format.bitrate)
        .audioCodec('aac')
        .videoCodec('libx264')
        .output(outputPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    outputs.push({
      resolution: format.resolution,
      path: outputPath,
      size_mb: (await fs.stat(outputPath)).size / 1024 / 1024,
    });
  }

  // Upload to S3/R2
  for (const output of outputs) {
    await uploadToS3(output.path, `videos/${output.resolution}/`);
  }

  return {
    output: `Transcoded video to ${outputs.length} formats`,
    metadata: { outputs },
  };
});
```

## Production Tips

1. **Streaming vs batch:** Use H1 for streaming aggregations (real-time dashboards), H2 for batch analytics (daily reports).

2. **Dead letter queue:** If H2 fails processing, send batch to DLQ for manual review.

3. **Idempotency:** Make batch processing idempotent (safe to retry on failure).

4. **Partitioning:** Shard data by date/user/region for parallel processing.

5. **Monitoring:** Track lag (time between ingest and processing).

## Monitoring

Track with `hh web`:
- **Events queued:** Backlog size
- **Processing throughput:** Events/second on H2
- **Batch size:** Optimize for efficiency

## Troubleshooting

**Batches backing up:**
- Reduce batch size (process more frequently)
- Add second H2 node for parallel processing
- Optimize processing code (use vectorized ops in pandas)

**Out of memory on H2:**
- Process in smaller chunks
- Use generators instead of loading full dataset
- Increase swap space

**Data loss during crashes:**
- Persist queue to Redis/database (don't use in-memory)
- Add acknowledgment system (H2 confirms receipt)
- Implement at-least-once delivery

## Next Steps

- Add real-time dashboard (stream metrics to H1, display via WebSocket)
- Implement data retention policy (auto-delete old data)
- Add ML model serving (H2 runs inference on batches)
- Set up alerting (Slack/PagerDuty when processing fails)