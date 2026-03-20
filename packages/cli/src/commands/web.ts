/**
 * commands/web.ts — `cofounder web`
 *
 * Launch a local web dashboard for the H1 node.
 *
 * Serves a single-page app with:
 *   - Live task feed (SSE, watching ~/.cofounder/state/tasks/)
 *   - Peer status cards with gateway health
 *   - Budget summary (this week)
 *   - Send-task form
 *
 * Uses ONLY Node built-ins (http, fs, path, os) — no new dependencies.
 *
 * Usage:
 *   cofounder web                 # start on default port 3847
 *   cofounder web --port 8080     # custom port
 *   cofounder web --no-open       # don't open browser automatically
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, readdir, watch as fsWatch } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import pc from "picocolors";
import { loadConfig } from "../config/store.ts";
import { listTaskStates, type TaskState, type TaskStatus } from "../state/tasks.ts";
import { buildBudgetSummary } from "../state/budget.ts";
import { checkGatewayHealth, pingPeer } from "@cofounder/core";
import { getAllPeers } from "../peers/select.ts";
import { createTaskState } from "../state/tasks.ts";
import { wakeAgent, createTaskMessage, loadContextSummary, withRetry } from "@cofounder/core";

const STATE_DIR = join(homedir(), ".cofounder", "state", "tasks");
const DEFAULT_PORT = 3847;

export interface WebOptions {
  port?: string;
  open?: boolean;
}

// ─── SSE client registry ──────────────────────────────────────────────────────

const sseClients = new Set<ServerResponse>();

function broadcastSSE(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

// ─── Task directory watcher ───────────────────────────────────────────────────

async function watchTaskDir() {
  if (!existsSync(STATE_DIR)) return;
  try {
    const watcher = fsWatch(STATE_DIR, { persistent: false });
    for await (const event of watcher) {
      if (event.filename?.endsWith(".json")) {
        try {
          const tasks = await listTaskStates();
          broadcastSSE("tasks", tasks.slice(0, 200));
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // directory may not exist yet; retry on next request
  }
}

// ─── HTML ─────────────────────────────────────────────────────────────────────

function buildHTML(port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>cofounder dashboard</title>
<style>
  :root {
    --bg: #0d0d0f;
    --bg2: #161618;
    --bg3: #1e1e21;
    --border: #2a2a2e;
    --text: #e8e8ec;
    --dim: #666;
    --accent: #f97316;
    --green: #22c55e;
    --red: #ef4444;
    --yellow: #eab308;
    --blue: #3b82f6;
    --purple: #a855f7;
    --cyan: #06b6d4;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 13px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); min-height: 100vh; }
  
  /* ── Layout ─────────────────────────── */
  .layout { display: grid; grid-template-rows: auto 1fr; min-height: 100vh; }
  .header {
    background: var(--bg2); border-bottom: 1px solid var(--border);
    padding: 12px 20px; display: flex; align-items: center; gap: 12px;
  }
  .header h1 { font-size: 14px; font-weight: 600; color: var(--text); }
  .header h1 span { color: var(--accent); }
  .header .badge {
    font-size: 11px; padding: 2px 8px; border-radius: 999px;
    background: var(--bg3); color: var(--dim); border: 1px solid var(--border);
  }
  .header .badge.live { color: var(--green); border-color: var(--green); }
  .header .spacer { flex: 1; }
  .header .version { color: var(--dim); font-size: 11px; }

  .main { display: grid; grid-template-columns: 280px 1fr; gap: 0; }
  
  /* ── Sidebar ────────────────────────── */
  .sidebar {
    background: var(--bg2); border-right: 1px solid var(--border);
    padding: 16px; display: flex; flex-direction: column; gap: 16px;
    overflow-y: auto; max-height: calc(100vh - 49px);
  }
  .section-title {
    font-size: 10px; font-weight: 600; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--dim); margin-bottom: 8px;
  }
  
  /* ── Peer cards ─────────────────────── */
  .peer-card {
    background: var(--bg3); border: 1px solid var(--border); border-radius: 6px;
    padding: 10px 12px; margin-bottom: 8px;
  }
  .peer-card .peer-name { font-weight: 600; font-size: 13px; margin-bottom: 4px; }
  .peer-card .peer-detail { color: var(--dim); font-size: 11px; line-height: 1.6; }
  .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; }
  .dot.green { background: var(--green); box-shadow: 0 0 6px var(--green); }
  .dot.red { background: var(--red); }
  .dot.dim { background: var(--dim); }
  
  /* ── Budget ─────────────────────────── */
  .budget-card {
    background: var(--bg3); border: 1px solid var(--border); border-radius: 6px;
    padding: 10px 12px;
  }
  .budget-row { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 12px; }
  .budget-row .label { color: var(--dim); }
  .budget-row .val { color: var(--text); font-weight: 500; }
  .budget-row .val.accent { color: var(--accent); }
  .budget-row .val.green { color: var(--green); }
  
  /* ── Send form ──────────────────────── */
  .send-form { display: flex; flex-direction: column; gap: 8px; }
  .send-form textarea {
    background: var(--bg3); border: 1px solid var(--border); color: var(--text);
    border-radius: 4px; padding: 8px 10px; font-family: inherit; font-size: 12px;
    resize: vertical; min-height: 60px; outline: none; width: 100%;
    transition: border-color 0.15s;
  }
  .send-form textarea:focus { border-color: var(--accent); }
  .send-form select {
    background: var(--bg3); border: 1px solid var(--border); color: var(--text);
    border-radius: 4px; padding: 6px 8px; font-family: inherit; font-size: 12px;
    outline: none; width: 100%;
  }
  .send-form button {
    background: var(--accent); color: #000; border: none; border-radius: 4px;
    padding: 7px 14px; font-family: inherit; font-size: 12px; font-weight: 600;
    cursor: pointer; transition: opacity 0.15s;
  }
  .send-form button:hover { opacity: 0.85; }
  .send-form button:disabled { opacity: 0.4; cursor: not-allowed; }
  .send-msg { font-size: 11px; color: var(--green); margin-top: 2px; min-height: 16px; }
  .send-msg.err { color: var(--red); }

  /* ── Task list ──────────────────────── */
  .content {
    padding: 16px 20px; overflow-y: auto; max-height: calc(100vh - 49px);
  }
  .content-header {
    display: flex; align-items: center; gap: 10px; margin-bottom: 14px;
  }
  .content-header h2 { font-size: 13px; font-weight: 600; }
  .content-header .count {
    font-size: 11px; color: var(--dim); background: var(--bg2);
    border: 1px solid var(--border); border-radius: 999px; padding: 1px 8px;
  }
  .filter-bar { display: flex; gap: 6px; margin-left: auto; flex-wrap: wrap; }
  .filter-btn {
    font-size: 11px; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--border);
    background: transparent; color: var(--dim); cursor: pointer; font-family: inherit;
    transition: all 0.1s;
  }
  .filter-btn.active { background: var(--accent); color: #000; border-color: var(--accent); font-weight: 600; }

  .task-list { display: flex; flex-direction: column; gap: 6px; }
  .task-card {
    background: var(--bg2); border: 1px solid var(--border); border-radius: 6px;
    padding: 10px 14px; cursor: pointer; transition: border-color 0.1s;
  }
  .task-card:hover { border-color: #3a3a3e; }
  .task-card.expanded { border-color: var(--accent); }
  .task-header { display: flex; align-items: center; gap: 8px; }
  .task-status-badge {
    font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 3px;
    text-transform: uppercase; letter-spacing: 0.04em; flex-shrink: 0;
  }
  .status-completed { background: rgba(34,197,94,0.15); color: var(--green); }
  .status-failed    { background: rgba(239,68,68,0.15);  color: var(--red); }
  .status-pending   { background: rgba(234,179,8,0.15);  color: var(--yellow); }
  .status-running   { background: rgba(6,182,212,0.15);  color: var(--cyan); }
  .status-timeout   { background: rgba(168,85,247,0.15); color: var(--purple); }
  .status-cancelled { background: rgba(102,102,102,0.15); color: var(--dim); }
  .task-objective {
    flex: 1; font-size: 12px; white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis; color: var(--text);
  }
  .task-meta { display: flex; gap: 12px; color: var(--dim); font-size: 11px; flex-shrink: 0; }
  .task-body {
    display: none; margin-top: 10px; padding-top: 10px;
    border-top: 1px solid var(--border);
  }
  .task-body.open { display: block; }
  .task-body-label { font-size: 10px; color: var(--dim); text-transform: uppercase;
    letter-spacing: 0.06em; margin-bottom: 4px; margin-top: 8px; }
  .task-body-label:first-child { margin-top: 0; }
  .task-body pre {
    background: var(--bg); border: 1px solid var(--border); border-radius: 4px;
    padding: 8px 10px; font-size: 11px; white-space: pre-wrap; word-break: break-word;
    color: var(--text); max-height: 200px; overflow-y: auto;
  }
  .task-id { font-size: 10px; color: var(--dim); font-family: monospace; }

  .empty-state {
    text-align: center; padding: 40px 20px; color: var(--dim);
  }
  .empty-state .icon { font-size: 32px; margin-bottom: 12px; }
  .empty-state p { font-size: 12px; line-height: 1.6; }

  /* ── Scrollbar ──────────────────────── */
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--dim); }
</style>
</head>
<body>
<div class="layout">
  <header class="header">
    <h1>cofounder <span>🔥</span> dashboard</h1>
    <span class="badge" id="live-badge">connecting…</span>
    <div class="spacer"></div>
    <span class="version" id="node-name">H1</span>
  </header>
  <div class="main">
    <!-- Sidebar -->
    <aside class="sidebar">
      <div>
        <div class="section-title">Peers</div>
        <div id="peer-list"><div class="peer-card"><div class="peer-detail" style="color:var(--dim)">loading…</div></div></div>
      </div>
      <div>
        <div class="section-title">Budget — this week</div>
        <div class="budget-card" id="budget-card">
          <div class="budget-row"><span class="label">loading…</span></div>
        </div>
      </div>
      <div>
        <div class="section-title">Send task</div>
        <form class="send-form" id="send-form" onsubmit="return false">
          <textarea id="task-input" placeholder="Ask your peer to do something…" rows="3"></textarea>
          <select id="peer-select"><option value="">default peer</option></select>
          <button type="submit" id="send-btn">Send →</button>
          <div class="send-msg" id="send-msg"></div>
        </form>
      </div>
    </aside>
    <!-- Main content -->
    <main class="content">
      <div class="content-header">
        <h2>Tasks</h2>
        <span class="count" id="task-count">0</span>
        <div class="filter-bar">
          <button class="filter-btn active" onclick="setFilter('all')">all</button>
          <button class="filter-btn" onclick="setFilter('running')">running</button>
          <button class="filter-btn" onclick="setFilter('pending')">pending</button>
          <button class="filter-btn" onclick="setFilter('completed')">done</button>
          <button class="filter-btn" onclick="setFilter('failed')">failed</button>
        </div>
      </div>
      <div class="task-list" id="task-list">
        <div class="empty-state">
          <div class="icon">📭</div>
          <p>No tasks yet.<br>Send one with <code>cofounder send</code> or the form above.</p>
        </div>
      </div>
    </main>
  </div>
</div>

<script>
const PORT = ${port};
let allTasks = [];
let currentFilter = 'all';
let expandedId = null;

// ── Formatting ────────────────────────────────────────────────────────────────
function relTime(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return Math.round(ms / 1000) + 's ago';
  if (ms < 3600000) return Math.round(ms / 60000) + 'm ago';
  if (ms < 86400000) return Math.round(ms / 3600000) + 'h ago';
  return new Date(iso).toLocaleDateString();
}
function fmtMs(ms) {
  if (!ms) return '';
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  return Math.floor(ms / 60000) + 'm' + Math.round((ms % 60000) / 1000) + 's';
}
function fmtCost(usd) {
  if (usd === undefined || usd === null) return '';
  if (usd === 0) return '$0 (local)';
  return '$' + usd.toFixed(4);
}

// ── Filter ────────────────────────────────────────────────────────────────────
function setFilter(f) {
  currentFilter = f;
  document.querySelectorAll('.filter-btn').forEach(b => {
    b.classList.toggle('active', b.textContent.trim() === (f === 'all' ? 'all' : f === 'completed' ? 'done' : f));
  });
  renderTasks(allTasks);
}

function filteredTasks(tasks) {
  if (currentFilter === 'all') return tasks;
  return tasks.filter(t => t.status === currentFilter);
}

// ── Render tasks ──────────────────────────────────────────────────────────────
function renderTasks(tasks) {
  allTasks = tasks;
  const visible = filteredTasks(tasks);
  document.getElementById('task-count').textContent = visible.length;
  const el = document.getElementById('task-list');
  
  if (visible.length === 0) {
    el.innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>No tasks match this filter.</p></div>';
    return;
  }

  el.innerHTML = visible.map(t => {
    const isOpen = t.id === expandedId;
    const dur = t.result?.duration_ms ? fmtMs(t.result.duration_ms) : '';
    const cost = t.result?.cost_usd !== undefined ? fmtCost(t.result.cost_usd) : '';
    const meta = [t.to, relTime(t.created_at), dur, cost].filter(Boolean).join(' · ');
    return \`<div class="task-card \${isOpen ? 'expanded' : ''}" onclick="toggleTask('\${t.id}')">
      <div class="task-header">
        <span class="task-status-badge status-\${t.status}">\${t.status}</span>
        <span class="task-objective">\${escHtml(t.objective)}</span>
        <span class="task-meta">\${escHtml(meta)}</span>
      </div>
      <div class="task-body \${isOpen ? 'open' : ''}">
        <div class="task-id">id: \${t.id}</div>
        \${t.constraints?.length ? \`<div class="task-body-label">constraints</div><pre>\${escHtml(t.constraints.join('\\n'))}</pre>\` : ''}
        \${t.result?.output ? \`<div class="task-body-label">output</div><pre>\${escHtml(t.result.output.slice(0, 2000))}\${t.result.output.length > 2000 ? '\\n… (truncated)' : ''}</pre>\` : ''}
        \${t.result?.error ? \`<div class="task-body-label">error</div><pre style="color:var(--red)">\${escHtml(t.result.error)}</pre>\` : ''}
      </div>
    </div>\`;
  }).join('');
}

function toggleTask(id) {
  expandedId = expandedId === id ? null : id;
  renderTasks(allTasks);
}

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Peers ─────────────────────────────────────────────────────────────────────
function renderPeers(peers) {
  const sel = document.getElementById('peer-select');
  // Keep default option, rebuild rest
  while (sel.options.length > 1) sel.remove(1);

  document.getElementById('peer-list').innerHTML = peers.map(p => {
    const online = p.gateway_ok;
    sel.add(new Option(p.name, p.name));
    return \`<div class="peer-card">
      <div class="peer-name">
        <span class="dot \${online ? 'green' : 'red'}"></span>
        \${escHtml(p.emoji || '🤖')} \${escHtml(p.name)}
        \${p.os ? \`<span style="color:var(--dim);font-size:11px;margin-left:4px">[\${p.os}]</span>\` : ''}
      </div>
      <div class="peer-detail">
        \${online ? '<span style="color:var(--green)">gateway up</span>' : '<span style="color:var(--red)">gateway down</span>'}
        \${p.last_heartbeat ? ' · last seen ' + relTime(p.last_heartbeat) : ''}
        \${p.tailscale_hostname ? '<br>' + escHtml(p.tailscale_hostname) : ''}
        \${p.provider?.model ? '<br>model: ' + escHtml(p.provider.model) : ''}
      </div>
    </div>\`;
  }).join('');
}

// ── Budget ────────────────────────────────────────────────────────────────────
function renderBudget(b) {
  if (!b) return;
  const rows = [
    ['tasks', b.completed + b.failed + b.pending],
    ['cloud cost', b.total_cost_usd !== undefined ? '$' + b.total_cost_usd.toFixed(4) : '$0.0000'],
    ['cloud tokens', b.cloud_tokens?.toLocaleString() || '0'],
    ['local tokens', b.local_tokens?.toLocaleString() || '0'],
    ['savings', b.local_savings_usd !== undefined ? '$' + b.local_savings_usd.toFixed(4) : '$0.0000'],
  ];
  document.getElementById('budget-card').innerHTML = rows.map(([l, v]) =>
    \`<div class="budget-row"><span class="label">\${l}</span><span class="val">\${v}</span></div>\`
  ).join('');
}

// ── SSE connection ────────────────────────────────────────────────────────────
function connect() {
  const badge = document.getElementById('live-badge');
  const es = new EventSource('/events');

  es.addEventListener('tasks', e => {
    renderTasks(JSON.parse(e.data));
  });
  es.addEventListener('peers', e => {
    renderPeers(JSON.parse(e.data));
  });
  es.addEventListener('budget', e => {
    renderBudget(JSON.parse(e.data));
  });
  es.addEventListener('init', e => {
    const d = JSON.parse(e.data);
    document.getElementById('node-name').textContent = d.name || 'H1';
    renderTasks(d.tasks || []);
    renderPeers(d.peers || []);
    renderBudget(d.budget);
    badge.textContent = 'live';
    badge.className = 'badge live';
  });

  es.onopen = () => {
    badge.textContent = 'live';
    badge.className = 'badge live';
  };
  es.onerror = () => {
    badge.textContent = 'reconnecting…';
    badge.className = 'badge';
    es.close();
    setTimeout(connect, 3000);
  };
}
connect();

// ── Send form ─────────────────────────────────────────────────────────────────
document.getElementById('send-form').addEventListener('submit', async () => {
  const objective = document.getElementById('task-input').value.trim();
  const peer = document.getElementById('peer-select').value;
  const btn = document.getElementById('send-btn');
  const msg = document.getElementById('send-msg');
  if (!objective) return;
  btn.disabled = true;
  msg.textContent = 'sending…';
  msg.className = 'send-msg';
  try {
    const res = await fetch('/api/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ objective, peer: peer || undefined }),
    });
    const json = await res.json();
    if (json.ok) {
      msg.textContent = '✓ sent — task ' + json.id.slice(0, 8);
      document.getElementById('task-input').value = '';
    } else {
      msg.textContent = '✗ ' + (json.error || 'failed');
      msg.className = 'send-msg err';
    }
  } catch (e) {
    msg.textContent = '✗ network error';
    msg.className = 'send-msg err';
  } finally {
    btn.disabled = false;
    setTimeout(() => { msg.textContent = ''; msg.className = 'send-msg'; }, 5000);
  }
});
</script>
</body>
</html>`;
}

// ─── API handlers ─────────────────────────────────────────────────────────────

async function getPeerStatuses(config: Awaited<ReturnType<typeof loadConfig>>) {
  if (!config) return [];
  const peers = getAllPeers(config);
  return Promise.all(
    peers.map(async (peer) => {
      let gateway_ok = false;
      try {
        const port = peer.gateway_port ?? 18789;
        const ip = peer.tailscale_ip ?? peer.tailscale_hostname;
        const token = peer.gateway_token ?? "";
        gateway_ok = await checkGatewayHealth({ host: ip, port, token });
      } catch {
        // unreachable
      }
      return {
        name: peer.name,
        emoji: peer.emoji,
        os: peer.os,
        tailscale_hostname: peer.tailscale_hostname,
        provider: peer.provider,
        gateway_ok,
        last_heartbeat: undefined as string | undefined,
      };
    })
  );
}

async function buildInitPayload(config: Awaited<ReturnType<typeof loadConfig>>) {
  const [tasks, budget, peers] = await Promise.all([
    listTaskStates().then((t) => t.slice(0, 200)).catch(() => [] as TaskState[]),
    buildBudgetSummary("week").catch(() => null),
    getPeerStatuses(config),
  ]);
  return {
    name: config?.self?.name ?? "H1",
    tasks,
    budget,
    peers,
  };
}

// ─── HTTP request router ──────────────────────────────────────────────────────

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: Awaited<ReturnType<typeof loadConfig>>,
  port: number
) {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const path = url.pathname;

  // ── SSE endpoint ──────────────────────────────────────────────────────────
  if (path === "/events") {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();

    sseClients.add(res);

    // Send initial snapshot
    try {
      const payload = await buildInitPayload(config);
      res.write(`event: init\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch (e) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: String(e) })}\n\n`);
    }

    // Heartbeat keepalive every 15s
    const hb = setInterval(() => {
      try {
        res.write(": heartbeat\n\n");
      } catch {
        clearInterval(hb);
        sseClients.delete(res);
      }
    }, 15_000);

    req.on("close", () => {
      clearInterval(hb);
      sseClients.delete(res);
    });
    return;
  }

  // ── REST: tasks ───────────────────────────────────────────────────────────
  if (path === "/api/tasks" && req.method === "GET") {
    const tasks = await listTaskStates().catch(() => []);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.end(JSON.stringify(tasks.slice(0, 200)));
    return;
  }

  // ── REST: status ──────────────────────────────────────────────────────────
  if (path === "/api/status" && req.method === "GET") {
    const peers = await getPeerStatuses(config);
    const budget = await buildBudgetSummary("week").catch(() => null);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.end(JSON.stringify({ ok: true, peers, budget, name: config?.self?.name ?? "H1" }));
    return;
  }

  // ── REST: send ────────────────────────────────────────────────────────────
  if (path === "/api/send" && req.method === "POST") {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");

    let body = "";
    for await (const chunk of req) body += chunk;

    try {
      const { objective, peer: peerName } = JSON.parse(body) as { objective?: string; peer?: string };
      if (!objective?.trim()) {
        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: "objective is required" }));
        return;
      }
      if (!config) {
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: "no config found — run cofounder onboard first" }));
        return;
      }

      const { getAllPeers, getPeer } = await import("../peers/select.ts");
      const targetPeer = peerName
        ? getPeer(config, peerName)
        : getPeer(config);

      const contextSummary = await loadContextSummary(targetPeer.name).catch(() => undefined);
      const msg = createTaskMessage({
        from: config.self?.name ?? "h1",
        to: targetPeer.name,
        objective: objective.trim(),
        constraints: [],
        context_summary: contextSummary,
      });

      const taskState = await createTaskState({
        id: msg.task_id,
        from: config.self?.name ?? "h1",
        to: targetPeer.name,
        objective: objective.trim(),
        constraints: [],
      });

      // Fire and forget — don't await wake
      const ip = targetPeer.tailscale_ip ?? targetPeer.tailscale_hostname;
      const port = targetPeer.gateway_port ?? 18789;
      const token = targetPeer.gateway_token ?? "";
      withRetry(
        () => wakeAgent({ host: ip, port, token, message: JSON.stringify(msg) }),
        { maxAttempts: 3, baseDelayMs: 2000, maxDelayMs: 15000, jitter: true }
      ).catch(() => {
        // Non-fatal: task was persisted, peer may be offline
      });

      res.end(JSON.stringify({ ok: true, id: taskState.id, task: taskState }));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  }

  // ── Serve dashboard ───────────────────────────────────────────────────────
  if (path === "/" || path === "/index.html") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(buildHTML(port));
    return;
  }

  res.statusCode = 404;
  res.end("not found");
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function web(opts: WebOptions = {}) {
  const port = parseInt(opts.port ?? String(DEFAULT_PORT), 10);

  const config = await loadConfig().catch(() => null);

  const server = createServer((req, res) => {
    handleRequest(req, res, config, port).catch((e) => {
      res.statusCode = 500;
      res.end(String(e));
    });
  });

  server.listen(port, "127.0.0.1", async () => {
    const url = `http://localhost:${port}`;
    console.log(`${pc.bgMagenta(pc.white(" cofounder web "))} dashboard running at ${pc.cyan(url)}`);
    console.log(pc.dim("  Ctrl-C to stop\n"));

    // Start watching task dir for SSE push
    watchTaskDir().catch(() => {});

    // Broadcast peer + budget updates every 30s
    setInterval(async () => {
      try {
        const peers = await getPeerStatuses(config);
        broadcastSSE("peers", peers);
      } catch { /* ignore */ }
      try {
        const budget = await buildBudgetSummary("week");
        broadcastSSE("budget", budget);
      } catch { /* ignore */ }
    }, 30_000);

    // Try to open browser
    if (opts.open !== false) {
      try {
        const { exec } = await import("node:child_process");
        const cmd =
          process.platform === "darwin"
            ? `open ${url}`
            : process.platform === "win32"
              ? `start ${url}`
              : `xdg-open ${url} 2>/dev/null || true`;
        exec(cmd);
      } catch { /* ignore */ }
    }
  });

  // Keep process alive
  await new Promise<void>((_, reject) => {
    server.on("error", reject);
    process.on("SIGINT", () => {
      console.log(pc.dim("\n  shutting down…"));
      server.close();
      process.exit(0);
    });
  });
}
