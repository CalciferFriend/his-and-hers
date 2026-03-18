# Agent Swarm Template

H1 orchestrates complex multi-step goals and delegates autonomous sub-tasks. H2 executes tasks with full autonomy using powerful local models.

## Use Case

You want to build a multi-agent system where one agent decomposes complex goals into subtasks, and another executes them autonomously. Cloud API costs for multiple agents are prohibitive. You have a GPU for running local models.

**Solution:** H1 runs as always-on orchestrator (cheap cloud model). H2 runs powerful local models (70B+) for deep reasoning and autonomous execution.

## Cost Savings Example

**Before (all cloud APIs):**
- H1 (orchestrator): Claude Opus API, $15/day
- H2 (executor): GPT-4 API, $20/day
- Total: ~$1050/month

**After (H1 cloud + H2 local):**
- H1: Claude Sonnet API, $3/day = $90/month
- H2: Local Llama 3.1 70B, $0/month
- Power cost: ~$15/month

**Savings:** $945/month (~90% reduction)

## Setup

### 1. Hardware Requirements

**H1 (orchestrator):**
- Any VM (minimal specs)
- Needs API access (Anthropic, OpenAI)

**H2 (executor):**
- **Critical:** 48GB+ VRAM for 70B models (A6000, RTX 6000 Ada, or multi-GPU)
- Alternative: 24GB VRAM for 13B-30B models (RTX 4090, RTX 3090)
- 64GB+ system RAM
- NVMe SSD for model storage

### 2. Install LLM Runtime on H2

```bash
# Option 1: vLLM (recommended for production)
pip install vllm
python -m vllm.entrypoints.openai.api_server \
  --model meta-llama/Llama-3.1-70B-Instruct \
  --dtype auto \
  --api-key your-secret-key \
  --port 8000

# Option 2: Ollama (easier setup)
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.1:70b
ollama serve
```

### 3. Initialize Template

```bash
cd ~/.openclaw
hh templates init agent-swarm
```

## Example Code

### H1: Orchestrator (Goal Decomposition)

```typescript
// orchestrator.ts on H1
import Anthropic from '@anthropic-ai/sdk';
import { sendTask } from '@his-and-hers/sdk';

const anthropic = new Anthropic();

interface Goal {
  objective: string;
  constraints: string[];
  context: any;
}

async function decomposeGoal(goal: Goal): Promise<string[]> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4.5',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `You are a task orchestrator. Break down this complex goal into 3-5 specific, executable subtasks.

Goal: ${goal.objective}

Constraints:
${goal.constraints.map(c => `- ${c}`).join('\n')}

Return ONLY a JSON array of subtask strings, nothing else.`,
    }],
  });

  const subtasks = JSON.parse(response.content[0].text);
  return subtasks;
}

async function executeGoal(goal: Goal) {
  console.log(`Orchestrating: ${goal.objective}`);

  // Step 1: Decompose into subtasks
  const subtasks = await decomposeGoal(goal);
  console.log(`Decomposed into ${subtasks.length} subtasks`);

  // Step 2: Execute subtasks on H2 (autonomous agent)
  const results = [];
  for (const subtask of subtasks) {
    const result = await sendTask({
      to: 'H2',
      objective: subtask,
      payload: {
        parent_goal: goal.objective,
        constraints: goal.constraints,
        context: goal.context,
      },
      wake_required: true,
      shutdown_after: false, // Keep awake for next subtask
    });

    results.push(result);

    // If subtask failed, re-plan
    if (result.status === 'failed') {
      console.log(`Subtask failed, re-planning...`);
      // Decompose remaining work into new subtasks
    }
  }

  // Step 3: Synthesize results
  const synthesis = await synthesizeResults(goal, results);

  return synthesis;
}

// Example usage
await executeGoal({
  objective: 'Build a landing page for my SaaS product',
  constraints: [
    'Modern design with Tailwind CSS',
    'Include hero, features, pricing sections',
    'Mobile responsive',
    'Deploy to Vercel',
  ],
  context: {
    product_name: 'DataFlow',
    tagline: 'Real-time analytics for modern teams',
  },
});
```

### H2: Autonomous Executor

```typescript
// executor.ts on H2
import { onTask } from '@his-and-hers/sdk';
import OpenAI from 'openai';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// Connect to local vLLM server
const openai = new OpenAI({
  baseURL: 'http://localhost:8000/v1',
  apiKey: 'dummy-key',
});

onTask(async (task) => {
  const { parent_goal, constraints, context } = task.payload;

  console.log(`Executing autonomous task: ${task.objective}`);

  // H2 has full autonomy to use tools, write code, execute commands
  const response = await openai.chat.completions.create({
    model: 'meta-llama/Llama-3.1-70B-Instruct',
    messages: [
      {
        role: 'system',
        content: `You are an autonomous agent executing a subtask as part of a larger goal.

Parent goal: ${parent_goal}

Constraints:
${constraints.map(c => `- ${c}`).join('\n')}

Context:
${JSON.stringify(context, null, 2)}

You have access to:
- File system (read/write)
- Shell commands (via execAsync)
- Network requests
- Code execution

Complete the subtask FULLY. Return the result and any artifacts created.`,
      },
      {
        role: 'user',
        content: task.objective,
      },
    ],
    temperature: 0.7,
    max_tokens: 4000,
  });

  const agentResponse = response.choices[0].message.content;

  // Agent might request to run commands
  if (agentResponse.includes('```bash')) {
    const codeMatch = agentResponse.match(/```bash\n([\s\S]+?)\n```/);
    if (codeMatch) {
      const command = codeMatch[1];
      console.log(`Agent wants to run: ${command}`);

      try {
        const { stdout, stderr } = await execAsync(command);
        console.log('Command output:', stdout);
      } catch (error) {
        console.error('Command failed:', error);
      }
    }
  }

  return {
    output: agentResponse,
    metadata: {
      model: 'Llama 3.1 70B',
      tokens: response.usage?.total_tokens,
      autonomous: true,
    },
  };
});
```

## Advanced: Multi-Agent Collaboration

Run multiple H2 agents in parallel:

```typescript
// On H1
const subtasks = [
  'Design the database schema',
  'Implement the API endpoints',
  'Build the frontend UI',
];

// Execute in parallel on multiple H2 nodes
const results = await Promise.all(
  subtasks.map(subtask =>
    sendTask({
      to: 'H2', // Could route to different H2 nodes
      objective: subtask,
      parallel: true,
    })
  )
);
```

## Advanced: Self-Improving Agents

H2 can critique its own work and iterate:

```typescript
// On H2
let attempt = 1;
let result = await executeTask(task);

while (attempt < 3 && !isGoodEnough(result)) {
  console.log(`Attempt ${attempt} not good enough, iterating...`);

  // Self-critique
  const critique = await openai.chat.completions.create({
    model: 'meta-llama/Llama-3.1-70B-Instruct',
    messages: [
      { role: 'user', content: `Critique this result and suggest improvements:\n\n${result}` },
    ],
  });

  // Improve
  result = await improveResult(result, critique.choices[0].message.content);
  attempt++;
}

return result;
```

## Production Tips

1. **Safety rails:** Limit H2's command execution (whitelist allowed commands, sandboxed environment).

2. **Cost monitoring:** Track token usage per subtask (even local models have electricity cost).

3. **Fallback to cloud:** If H2 is offline/busy, route to cloud API temporarily.

4. **Context sharing:** Pass artifacts between subtasks (files, outputs) via shared storage.

5. **Human-in-the-loop:** For critical decisions, pause and ask H1 to confirm before proceeding.

## Monitoring

Track with `hh web`:
- **Goal completion rate:** % of goals fully executed
- **Subtask distribution:** How H1 decomposes work
- **H2 autonomy:** How often H2 makes independent decisions

## Troubleshooting

**H2 gets stuck in loops:**
- Add max iterations limit
- Implement circuit breaker (abort after N failures)
- Log decision tree for debugging

**Inconsistent results:**
- Lower temperature for more deterministic outputs
- Add explicit success criteria in prompts
- Use structured outputs (JSON mode)

**Too slow:**
- Use smaller model for simple subtasks (13B instead of 70B)
- Batch similar subtasks together
- Cache common responses

## Next Steps

- Add memory system (H2 remembers past executions, learns from mistakes)
- Implement multi-modal agents (H2 can see images, hear audio)
- Add tool use (H2 can call APIs, use databases autonomously)
- Build agent marketplace (H1 delegates to specialized H2 nodes: code, design, research)