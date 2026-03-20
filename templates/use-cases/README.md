# Cofounder Use Case Templates

Pre-built templates to get you started with cofounder. Each template includes:
- SOUL.md configuration for both H1 and H2
- README with use case description
- Example code demonstrating the pattern

## Available Templates

### 1. GPU Inference
Route heavy LLM inference to H2's GPU while H1 stays responsive to API traffic.

**Best for:** Cost-optimized inference, avoiding cloud API calls for bulk workloads

### 2. Content Generation
H1 schedules content, H2 generates images/videos on-demand.

**Best for:** Social media automation, marketing content, automated design

### 3. CI Runner
H1 watches GitHub webhooks, H2 wakes to run builds/tests.

**Best for:** Personal projects, team CI without GitHub Actions costs

### 4. Data Processing
H1 ingests streaming data, H2 processes batches.

**Best for:** ETL pipelines, ML inference, video transcoding

### 5. Agent Swarm
H1 orchestrates complex goals, H2 executes autonomous tasks.

**Best for:** Multi-agent systems, complex workflows, research tasks

## Usage

```bash
# List available templates
cofounder templates list

# View template details
cofounder templates show gpu-inference

# Initialize from template
cofounder templates init gpu-inference
```

## Creating Your Own Template

Each template directory should contain:

```
my-template/
  ├─ README.md           # Description + setup instructions
  ├─ h1/
  │   ├─ SOUL.md         # H1 configuration
  │   └─ example.ts      # H1 example code
  └─ h2/
      ├─ SOUL.md         # H2 configuration
      └─ example.ts      # H2 example code
```

Submit your template via PR to share with the community!