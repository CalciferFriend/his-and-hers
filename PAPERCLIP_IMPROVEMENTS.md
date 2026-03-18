# Paperclip-Inspired Improvements for H&H

Based on analysis of Paperclip's UX, we're implementing 4 key improvements:

## 1. Fast Onboarding (`hh onboard --yes`)

**Problem:** Current 13-step wizard is thorough but intimidating for users who just want to try it.

**Solution:** Add `--yes` flag with sane defaults:
```bash
hh onboard --yes --role=h1 --name=Alice --model=sonnet
```

**Defaults:**
- Role: Prompt (required)
- Name: System hostname
- Emoji: Auto-assign based on role (H1 = 🔥, H2 = ⚡)
- Provider: `anthropic` (most common)
- Model: `claude-sonnet-4.5`
- Peer: Skip initial config (pair later with code)
- Gateway bind: Smart default (loopback for H1, tailscale for H2)
- WOL: Skip (can configure later)
- AutoLogin/Firewall/Startup: Auto-detect and apply if possible
- Soul templates: Install defaults without customization prompts

**Files to modify:**
- `packages/cli/src/commands/onboard.ts` - Add `--yes` flag handling
- `packages/cli/src/wizard/defaults.ts` - New file with default values
- Each step file - Add bypass logic when `--yes` is set

---

## 2. Template Gallery (5 Starter Templates)

**Problem:** Users don't know what use cases H&H is good for. Need inspiration.

**Solution:** Ship 5 pre-built templates in `templates/use-cases/`:

### 2.1 GPU Inference Template
**Use case:** H1 handles API requests, H2 runs local LLM inference
**Files:**
- `templates/use-cases/gpu-inference/SOUL.md`
- `templates/use-cases/gpu-inference/README.md`
- `templates/use-cases/gpu-inference/example.ts`

**Description:**
> Route heavy LLM inference to H2's GPU while H1 stays responsive to API traffic. Perfect for cost-optimized inference where you want to avoid cloud API calls for bulk workloads.

### 2.2 Content Generation Template
**Use case:** H1 schedules content, H2 generates images/videos
**Files:**
- `templates/use-cases/content-generation/SOUL.md`
- `templates/use-cases/content-generation/README.md`
- `templates/use-cases/content-generation/example.ts`

**Description:**
> H1 runs 24/7 monitoring social media trends, H2 wakes on-demand to generate images via Stable Diffusion / ComfyUI. Save power by sleeping the GPU node between content batches.

### 2.3 CI Runner Template
**Use case:** H1 watches GitHub webhooks, H2 runs builds/tests
**Files:**
- `templates/use-cases/ci-runner/SOUL.md`
- `templates/use-cases/ci-runner/README.md`
- `templates/use-cases/ci-runner/example.ts`

**Description:**
> Lightweight CI system where H1 listens for GitHub push events and H2 wakes to run builds, tests, and deployments. Much cheaper than GitHub Actions for personal projects.

### 2.4 Data Processing Template
**Use case:** H1 ingests data, H2 processes batches
**Files:**
- `templates/use-cases/data-processing/SOUL.md`
- `templates/use-cases/data-processing/README.md`
- `templates/use-cases/data-processing/example.ts`

**Description:**
> H1 continuously ingests streaming data (API calls, webhooks, logs), queues batches, then wakes H2 for CPU-intensive processing (ETL, ML inference, video transcoding).

### 2.5 Agent Swarm Template
**Use case:** H1 orchestrates, H2 runs agent tasks
**Files:**
- `templates/use-cases/agent-swarm/SOUL.md`
- `templates/use-cases/agent-swarm/README.md`
- `templates/use-cases/agent-swarm/example.ts`

**Description:**
> Multi-agent system where H1 decomposes complex goals into subtasks and H2 executes them with full autonomy. H1 stays cheap (always-on cloud), H2 uses powerful local models (wakes on-demand).

**CLI Integration:**
```bash
hh templates list
hh templates show gpu-inference
hh templates init gpu-inference
```

**Files to create:**
- `packages/cli/src/commands/templates.ts` - New CLI command
- `templates/use-cases/*` - 5 template directories
- `packages/core/src/templates/loader.ts` - Template loader utility

---

## 3. Project/Workspace Layer

**Problem:** Users think in terms of "projects" and "goals", not raw protocol messages.

**Solution:** Add workspace abstraction on top of H1/H2 messaging:

### Conceptual Model
```
Workspace (e.g., "My SaaS Company")
  ├─ Project: "Customer Support Bot"
  │   ├─ Goal: "Answer support tickets"
  │   └─ Tasks: [task1, task2, ...]
  └─ Project: "Content Engine"
      ├─ Goal: "Generate blog posts daily"
      └─ Tasks: [...]
```

### Config Schema
Add to `~/.his-and-hers/hh.json`:
```json
{
  "version": "0.2.0",
  "self": { ... },
  "peers": [ ... ],
  "workspaces": [
    {
      "id": "ws-abc123",
      "name": "My SaaS Company",
      "created_at": "2026-03-18T16:00:00Z",
      "projects": [
        {
          "id": "proj-xyz789",
          "name": "Customer Support Bot",
          "description": "Automated support ticket responder",
          "default_peer": "GLaDOS",
          "goals": [
            {
              "id": "goal-123",
              "objective": "Answer support tickets within 5min",
              "constraints": ["Use knowledge base", "Escalate if uncertain"],
              "tasks": ["task-001", "task-002"]
            }
          ]
        }
      ]
    }
  ]
}
```

### CLI Commands
```bash
hh workspace create "My SaaS Company"
hh workspace list
hh workspace use my-saas-company

hh project create "Customer Support Bot" --peer=GLaDOS
hh project list
hh project use customer-support

hh goal create "Answer tickets within 5min" --constraints="Use KB"
hh goal list

hh send "Process today's tickets"  # auto-routes to current project/peer
```

### Dashboard Integration
Web dashboard (`hh web`) shows:
- **Workspace dropdown** in header
- **Project sidebar** (filterable)
- **Goal → Task** hierarchy view (not flat task list)
- **Cost tracking per project** (not just global)

**Files to modify:**
- `packages/core/src/config/schema.ts` - Add workspace types
- `packages/core/src/workspace/*` - New workspace management module
- `packages/cli/src/commands/workspace.ts` - New CLI commands
- `packages/cli/src/commands/project.ts` - New CLI commands
- `packages/cli/src/commands/goal.ts` - New CLI commands
- `packages/cli/src/commands/send.ts` - Auto-route based on current project
- `packages/cli/src/commands/web.ts` - Add workspace/project UI

---

## 4. React Web Dashboard

**Problem:** Current dashboard is vanilla JS with SSE. Works, but limited UX.

**Solution:** Replace with React + Vite for richer interactions:

### Features to Add
1. **Peer Status Cards** ✅ (already exists, but enhance)
   - Add real-time gateway health polling (every 5s)
   - Show wake/sleep state with timeline
   - Display current task being executed

2. **Task Timeline View** (NEW)
   - Horizontal timeline showing task execution over time
   - Color-coded by status (green=done, red=failed, yellow=running)
   - Click to expand full details

3. **Cost Tracking Dashboard** (enhance existing)
   - Add chart: cost over time (daily)
   - Breakdown by peer (H1 vs H2)
   - Breakdown by project (when workspace layer is added)
   - Show savings from local inference vs cloud API

4. **One-Click Task Dispatch** ✅ (already exists, but enhance)
   - Add template selector (quick tasks like "summarize", "generate image")
   - Show estimated cost before sending
   - Add "Schedule task" (cron-like)

### Tech Stack
- **React 19** (latest)
- **Vite** (dev server + build)
- **Tailwind CSS** (styling - matches existing dark theme)
- **Recharts** (cost charts)
- **React Query** (API state management)
- **Zustand** (local state)

### File Structure
```
packages/dashboard/
  ├─ src/
  │   ├─ App.tsx
  │   ├─ components/
  │   │   ├─ PeerCard.tsx
  │   │   ├─ TaskTimeline.tsx
  │   │   ├─ CostChart.tsx
  │   │   ├─ SendTaskForm.tsx
  │   │   └─ ProjectSidebar.tsx (for workspace layer)
  │   ├─ hooks/
  │   │   ├─ useTasks.ts
  │   │   ├─ usePeers.ts
  │   │   └─ useBudget.ts
  │   └─ lib/
  │       └─ api.ts
  ├─ public/
  ├─ index.html
  ├─ vite.config.ts
  └─ package.json
```

### Integration with CLI
- `packages/cli/src/commands/web.ts` - Serve built React app instead of inline HTML
- `packages/dashboard` - Build to `dist/`, CLI serves static files
- Keep SSE API (`/events`, `/api/*`) unchanged - React consumes it

**Build flow:**
1. User runs `hh web`
2. CLI checks if `packages/dashboard/dist/` exists
3. If not, runs `pnpm --filter dashboard build` (or shows warning to build first)
4. Serves static files from `dist/` + existing API endpoints

**Files to create:**
- `packages/dashboard/*` - Entire new package
- Modify `packages/cli/src/commands/web.ts` - Serve React build

---

## Implementation Order

1. **Week 1:** Fast onboarding (`--yes` flag) - Quick win, unblocks new users
2. **Week 2:** Template gallery - Provides inspiration, demonstrates use cases
3. **Week 3:** Workspace/project layer - Foundational for better UX
4. **Week 4:** React dashboard - Polish, visual upgrade

**Total effort:** ~4 weeks for all improvements

---

## Success Metrics

**Fast onboarding:**
- Reduce time-to-first-pair from 15min → 2min for default setup
- 80% of users choose `--yes` path (measured via telemetry opt-in)

**Template gallery:**
- 50% of new users explore at least 1 template
- Templates included in README/docs drive GitHub stars

**Workspace layer:**
- Users with >5 tasks create at least 1 project
- Cost tracking per-project drives value perception

**React dashboard:**
- 30% higher engagement (measured by session duration on `hh web`)
- Task timeline view most-used feature (measured by clicks)

---

## Competitive Positioning vs Paperclip

**Paperclip strengths we're adopting:**
- Fast onboarding (`npx paperclipai onboard --yes`)
- Project framing ("company → roles → tasks")
- Template gallery ("ClipMart")
- React dashboard (peer status, cost tracking)

**H&H advantages we keep:**
- Physical machine separation (not just process separation)
- Wake-on-LAN (real power savings, not just idle)
- Latent communication roadmap (future-proof for hidden state transfer)
- Open protocol (not SaaS lock-in)

**Result:** H&H becomes as easy to onboard as Paperclip, with unique value prop intact.