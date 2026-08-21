/**
 * core/web/dashboard-server.ts — Local web dashboard for task monitoring
 *
 * Serves a single-page HTML dashboard on localhost with:
 * - Live task feed via SSE
 * - Peer status indicators
 * - Budget summary
 * - Send task form
 *
 * Usage:
 *   const { url, close } = await startDashboard(3847);
 *   console.log(`Dashboard at ${url}`);
 *   // Later: close();
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readAuditLog } from "../audit/audit.ts";
import { listTaskStates, type TaskState } from "../../../sdk/src/state.ts";
import { loadConfig } from "../../../sdk/src/config.ts";

const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HH Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Courier New', monospace;
      background: #0a0a0a;
      color: #e0e0e0;
      padding: 20px;
      font-size: 14px;
      line-height: 1.5;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
    }
    .header h1 {
      font-size: 24px;
      font-weight: bold;
      color: #fff;
      margin-bottom: 5px;
    }
    .header .subtitle {
      color: rgba(255,255,255,0.8);
      font-size: 13px;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 350px;
      gap: 20px;
      margin-bottom: 20px;
    }
    .panel {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 20px;
    }
    .panel h2 {
      font-size: 16px;
      font-weight: bold;
      margin-bottom: 15px;
      color: #fff;
      border-bottom: 1px solid #333;
      padding-bottom: 10px;
    }
    .task-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-height: 600px;
      overflow-y: auto;
    }
    .task-item {
      background: #222;
      border: 1px solid #333;
      border-radius: 6px;
      padding: 12px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .task-item:hover {
      border-color: #667eea;
      background: #252525;
    }
    .task-item.expanded {
      border-color: #667eea;
    }
    .task-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 10px;
      margin-bottom: 8px;
    }
    .task-objective {
      flex: 1;
      font-size: 13px;
      color: #fff;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .task-item.expanded .task-objective {
      white-space: normal;
      overflow: visible;
    }
    .task-meta {
      display: flex;
      gap: 12px;
      font-size: 11px;
      color: #888;
    }
    .task-output {
      display: none;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid #333;
      font-size: 12px;
      color: #aaa;
      white-space: pre-wrap;
      word-wrap: break-word;
      max-height: 200px;
      overflow-y: auto;
    }
    .task-item.expanded .task-output {
      display: block;
    }
    .badge {
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: bold;
      text-transform: uppercase;
    }
    .badge.pending { background: #fbbf24; color: #000; }
    .badge.running { background: #3b82f6; color: #fff; }
    .badge.completed { background: #10b981; color: #fff; }
    .badge.failed { background: #ef4444; color: #fff; }
    .badge.timeout { background: #f97316; color: #fff; }
    .badge.cancelled { background: #6b7280; color: #fff; }
    .peer-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .peer-item {
      background: #222;
      border: 1px solid #333;
      border-radius: 6px;
      padding: 12px;
    }
    .peer-name {
      font-weight: bold;
      color: #fff;
      margin-bottom: 6px;
    }
    .peer-status {
      font-size: 11px;
      color: #888;
    }
    .peer-status .dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 6px;
    }
    .peer-status .dot.online { background: #10b981; }
    .peer-status .dot.offline { background: #ef4444; }
    .budget-card {
      background: #222;
      border: 1px solid #333;
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 15px;
    }
    .budget-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 6px;
      font-size: 12px;
    }
    .budget-row .label {
      color: #888;
    }
    .budget-row .value {
      color: #fff;
      font-weight: bold;
    }
    .send-form {
      background: #222;
      border: 1px solid #333;
      border-radius: 6px;
      padding: 15px;
    }
    .form-group {
      margin-bottom: 12px;
    }
    .form-group label {
      display: block;
      margin-bottom: 6px;
      font-size: 12px;
      color: #888;
    }
    .form-group select,
    .form-group textarea {
      width: 100%;
      background: #1a1a1a;
      border: 1px solid #333;
      color: #e0e0e0;
      border-radius: 4px;
      padding: 8px;
      font-family: inherit;
      font-size: 12px;
    }
    .form-group textarea {
      resize: vertical;
      min-height: 80px;
    }
    .form-group button {
      width: 100%;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #fff;
      border: none;
      border-radius: 4px;
      padding: 10px;
      font-weight: bold;
      cursor: pointer;
      font-size: 13px;
      transition: opacity 0.2s;
    }
    .form-group button:hover {
      opacity: 0.9;
    }
    .form-group button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .filters {
      display: flex;
      gap: 10px;
      margin-bottom: 15px;
      flex-wrap: wrap;
    }
    .filter-btn {
      padding: 6px 12px;
      background: #222;
      border: 1px solid #333;
      color: #888;
      border-radius: 4px;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .filter-btn.active {
      background: #667eea;
      border-color: #667eea;
      color: #fff;
    }
    .empty-state {
      text-align: center;
      padding: 40px;
      color: #666;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>HH Dashboard</h1>
    <div class="subtitle">Real-time task monitoring and peer status</div>
  </div>

  <div class="grid">
    <div class="panel">
      <h2>Live Task Feed</h2>
      <div class="filters">
        <button class="filter-btn active" data-filter="all">All</button>
        <button class="filter-btn" data-filter="pending">Pending</button>
        <button class="filter-btn" data-filter="running">Running</button>
        <button class="filter-btn" data-filter="completed">Completed</button>
        <button class="filter-btn" data-filter="failed">Failed</button>
      </div>
      <div class="task-list" id="taskList">
        <div class="empty-state">Loading tasks...</div>
      </div>
    </div>

    <div>
      <div class="panel" style="margin-bottom: 20px;">
        <h2>Send Task</h2>
        <div class="send-form">
          <form id="sendForm">
            <div class="form-group">
              <label for="peerSelect">Peer</label>
              <select id="peerSelect" required>
                <option value="">Select peer...</option>
              </select>
            </div>
            <div class="form-group">
              <label for="taskInput">Task</label>
              <textarea id="taskInput" required placeholder="Describe the task..."></textarea>
            </div>
            <div class="form-group">
              <button type="submit" id="submitBtn">Send Task</button>
            </div>
          </form>
        </div>
      </div>

      <div class="panel" style="margin-bottom: 20px;">
        <h2>Budget Summary</h2>
        <div class="budget-card">
          <div class="budget-row">
            <span class="label">Weekly Spend</span>
            <span class="value" id="weeklySpend">$0.00</span>
          </div>
          <div class="budget-row">
            <span class="label">Cloud</span>
            <span class="value" id="cloudSpend">$0.00</span>
          </div>
          <div class="budget-row">
            <span class="label">Local</span>
            <span class="value" id="localSpend">$0.00</span>
          </div>
          <div class="budget-row">
            <span class="label">Savings</span>
            <span class="value" id="savings">$0.00</span>
          </div>
        </div>
      </div>

      <div class="panel">
        <h2>Peer Status</h2>
        <div class="peer-list" id="peerList">
          <div class="empty-state">Loading peers...</div>
        </div>
      </div>
    </div>
  </div>

  <script>
    let currentFilter = 'all';
    let allTasks = [];
    let eventSource = null;

    // Initialize SSE for live updates
    function initSSE() {
      eventSource = new EventSource('/events');
      eventSource.onmessage = (e) => {
        const data = JSON.parse(e.data);
        allTasks = data.tasks || [];
        renderTasks();
      };
      eventSource.onerror = () => {
        console.warn('SSE connection lost, falling back to polling');
        eventSource.close();
        startPolling();
      };
    }

    // Polling fallback
    function startPolling() {
      setInterval(async () => {
        try {
          const res = await fetch('/api/tasks');
          const data = await res.json();
          allTasks = data.tasks || [];
          renderTasks();
        } catch (err) {
          console.error('Polling failed:', err);
        }
      }, 5000);
    }

    // Render tasks
    function renderTasks() {
      const list = document.getElementById('taskList');
      const filtered = currentFilter === 'all'
        ? allTasks
        : allTasks.filter(t => t.status === currentFilter);

      if (filtered.length === 0) {
        list.innerHTML = '<div class="empty-state">No tasks to display</div>';
        return;
      }

      list.innerHTML = filtered.slice(0, 20).map(t => {
        const age = formatAge(t.created_at);
        const outputPreview = (t.result?.output || '').slice(0, 500);
        const cost = t.result?.cost_usd ? \`$\${t.result.cost_usd.toFixed(3)}\` : '';
        return \`
          <div class="task-item" onclick="toggleTask(this)">
            <div class="task-header">
              <div class="task-objective">\${escapeHtml(t.objective)}</div>
              <span class="badge \${t.status}">\${t.status}</span>
            </div>
            <div class="task-meta">
              <span>\${escapeHtml(t.to)}</span>
              <span>\${age}</span>
              \${cost ? \`<span>\${cost}</span>\` : ''}
            </div>
            <div class="task-output">\${escapeHtml(outputPreview)}\${outputPreview.length === 500 ? '...' : ''}</div>
          </div>
        \`;
      }).join('');
    }

    function toggleTask(el) {
      el.classList.toggle('expanded');
    }

    function formatAge(ts) {
      const now = Date.now();
      const then = new Date(ts).getTime();
      const diff = Math.floor((now - then) / 1000);
      if (diff < 60) return \`\${diff}s ago\`;
      if (diff < 3600) return \`\${Math.floor(diff / 60)}m ago\`;
      if (diff < 86400) return \`\${Math.floor(diff / 3600)}h ago\`;
      return \`\${Math.floor(diff / 86400)}d ago\`;
    }

    function escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    // Filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        renderTasks();
      });
    });

    // Load initial data
    async function loadInitialData() {
      try {
        const [tasksRes, peersRes, statsRes] = await Promise.all([
          fetch('/api/tasks'),
          fetch('/api/peers'),
          fetch('/api/stats'),
        ]);

        const tasksData = await tasksRes.json();
        const peersData = await peersRes.json();
        const statsData = await statsRes.json();

        allTasks = tasksData.tasks || [];
        renderTasks();

        // Populate peer select
        const select = document.getElementById('peerSelect');
        peersData.peers.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.name;
          opt.textContent = p.name;
          select.appendChild(opt);
        });

        // Render peers
        const peerList = document.getElementById('peerList');
        peerList.innerHTML = peersData.peers.map(p => \`
          <div class="peer-item">
            <div class="peer-name">\${escapeHtml(p.name)}</div>
            <div class="peer-status">
              <span class="dot online"></span>
              <span>\${escapeHtml(p.ip || 'unknown')}</span>
            </div>
          </div>
        \`).join('');

        // Budget summary
        if (statsData.budget) {
          document.getElementById('weeklySpend').textContent = \`$\${statsData.budget.weekly_total.toFixed(2)}\`;
          document.getElementById('cloudSpend').textContent = \`$\${statsData.budget.cloud.toFixed(2)}\`;
          document.getElementById('localSpend').textContent = \`$\${statsData.budget.local.toFixed(2)}\`;
          document.getElementById('savings').textContent = \`$\${statsData.budget.savings.toFixed(2)}\`;
        }

      } catch (err) {
        console.error('Failed to load initial data:', err);
      }
    }

    // Send form
    document.getElementById('sendForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const peer = document.getElementById('peerSelect').value;
      const task = document.getElementById('taskInput').value;
      const btn = document.getElementById('submitBtn');

      btn.disabled = true;
      btn.textContent = 'Sending...';

      try {
        const res = await fetch('/api/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ peer, task }),
        });
        const data = await res.json();
        if (data.ok) {
          document.getElementById('taskInput').value = '';
          alert(\`Task sent! ID: \${data.task_id}\`);
        } else {
          alert(\`Error: \${data.error}\`);
        }
      } catch (err) {
        alert(\`Network error: \${err.message}\`);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Send Task';
      }
    });

    // Start
    loadInitialData();
    initSSE();
  </script>
</body>
</html>`;

export interface DashboardServerHandle {
  url: string;
  close: () => void;
}

export async function startDashboard(port: number = 3847): Promise<DashboardServerHandle> {
  let lastTasksSnapshot: TaskState[] = [];

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url || "/";

    // CORS for local dev
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // GET / → HTML dashboard
    if (url === "/" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(HTML_TEMPLATE);
      return;
    }

    // GET /api/tasks → paginated task list
    if (url === "/api/tasks" && req.method === "GET") {
      try {
        const tasks = await listTaskStates();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, tasks: tasks.slice(0, 50) }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(err) }));
      }
      return;
    }

    // GET /api/audit → recent audit entries
    if (url === "/api/audit" && req.method === "GET") {
      try {
        const entries = await readAuditLog({ limit: 20 });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, entries }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(err) }));
      }
      return;
    }

    // GET /api/stats → budget summary
    if (url === "/api/stats" && req.method === "GET") {
      try {
        const tasks = await listTaskStates();
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days
        const recentTasks = tasks.filter((t) => new Date(t.created_at).getTime() >= cutoff);

        // Budget summary
        const cloudCost = recentTasks.reduce((sum, t) => {
          if (t.result?.cost_usd && t.to !== "local") {
            return sum + t.result.cost_usd;
          }
          return sum;
        }, 0);
        const localCost = 0; // Local tasks have no cost
        const totalTasks = recentTasks.length;
        const localTasks = recentTasks.filter((t) => t.to === "local").length;
        const avgCloudCost = cloudCost / Math.max(totalTasks - localTasks, 1);
        const savings = localTasks * avgCloudCost;

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            budget: {
              weekly_total: cloudCost + localCost,
              cloud: cloudCost,
              local: localCost,
              savings,
            },
          }),
        );
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(err) }));
      }
      return;
    }

    // GET /api/peers → peer list from config
    if (url === "/api/peers" && req.method === "GET") {
      try {
        const config = await loadConfig();
        const peers = config?.peer_nodes || (config?.peer_node ? [config.peer_node] : []);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, peers }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(err) }));
      }
      return;
    }

    // GET /events → SSE endpoint for live updates
    if (url === "/events" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const sendUpdate = async () => {
        try {
          const tasks = await listTaskStates();
          if (JSON.stringify(tasks) !== JSON.stringify(lastTasksSnapshot)) {
            lastTasksSnapshot = tasks;
            res.write(`data: ${JSON.stringify({ tasks: tasks.slice(0, 50) })}\n\n`);
          }
        } catch (err) {
          console.error("SSE update failed:", err);
        }
      };

      // Send initial snapshot
      sendUpdate();

      // Poll every 3s and send changed tasks
      const interval = setInterval(sendUpdate, 3000);

      req.on("close", () => {
        clearInterval(interval);
        res.end();
      });
      return;
    }

    // POST /api/send → send task (delegates to CLI command internally)
    if (url === "/api/send" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", async () => {
        try {
          const { peer, task } = JSON.parse(body);
          if (!peer || !task) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "Missing peer or task" }));
            return;
          }

          // Import dynamically to avoid circular deps
          const { send } = await import("../../../cli/src/commands/send.ts");
          // Fire-and-forget send
          send(task, { peer, noState: false }).catch((err: Error) => {
            console.error("Send failed:", err);
          });

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, task_id: "pending" }));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err) }));
        }
      });
      return;
    }

    // 404
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${port}`;
      resolve({
        url,
        close: () => {
          server.close();
        },
      });
    });
  });
}
