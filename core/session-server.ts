// Orchestrator dashboard HTTP server.
// Single Bun.serve instance providing real-time view of all workers
// with drill-down to individual session screens.

import { randomBytes } from "crypto";
import type { OrchestratorItem } from "./orchestrator.ts";

// ── Types ──────────────────────────────────────────────────────────────

export interface DashboardServer {
  port: number;
  token: string;
  stop: () => void;
}

export interface SessionUrlProvider {
  /** Called when dashboard starts. Returns the URL to post on PRs. */
  getPublicUrl(localPort: number, token: string): Promise<string | null>;
  /** Called on shutdown. */
  cleanup(): Promise<void>;
}

export interface DashboardDeps {
  /** Optional URL provider for cloud integration. */
  urlProvider?: SessionUrlProvider;
  /** Override token generation for testing. */
  generateToken?: () => string;
  /** Override port for testing (0 = OS-assigned). */
  port?: number;
}

// ── Screen throttle cache ──────────────────────────────────────────────

interface ScreenCache {
  content: string;
  timestamp: number;
}

const SCREEN_THROTTLE_MS = 1000;

// ── Auth ───────────────────────────────────────────────────────────────

function checkAuth(req: Request, token: string): boolean {
  // Check Authorization header
  const authHeader = req.headers.get("authorization");
  if (authHeader === `Bearer ${token}`) return true;

  // Check query param
  const url = new URL(req.url);
  if (url.searchParams.get("token") === token) return true;

  return false;
}

// ── State colors ───────────────────────────────────────────────────────

const STATE_COLORS: Record<string, string> = {
  queued: "#6b7280",
  ready: "#3b82f6",
  launching: "#f59e0b",
  implementing: "#f97316",
  "pr-open": "#8b5cf6",
  "ci-pending": "#eab308",
  "ci-passed": "#22c55e",
  "ci-failed": "#ef4444",
  "review-pending": "#a855f7",
  merging: "#06b6d4",
  merged: "#10b981",
  done: "#059669",
  stuck: "#dc2626",
};

// ── Dashboard HTML ─────────────────────────────────────────────────────

function renderDashboard(items: OrchestratorItem[], token: string): string {
  const rows = items
    .map((item) => {
      const color = STATE_COLORS[item.state] || "#6b7280";
      const age = getAge(item.lastTransition);
      const prLink = item.prNumber
        ? `<a href="#" class="pr-link">#${item.prNumber}</a>`
        : "—";
      const sessionLink = `<a href="/session/${encodeURIComponent(item.id)}?token=${encodeURIComponent(token)}" class="session-link">view</a>`;
      return `<tr>
        <td class="id-cell">${escapeHtml(item.id)}</td>
        <td><span class="state-badge" style="background:${color}">${escapeHtml(item.state)}</span></td>
        <td>${prLink}</td>
        <td>${sessionLink}</td>
        <td class="age-cell">${escapeHtml(age)}</td>
      </tr>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ninthwave dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#c9d1d9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px}
.container{max-width:960px;margin:0 auto;padding:16px}
header{display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid #21262d;margin-bottom:16px}
h1{font-size:18px;font-weight:600;color:#f0f6fc}
.meta{color:#8b949e;font-size:13px}
table{width:100%;border-collapse:collapse}
th{text-align:left;padding:8px 12px;color:#8b949e;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #21262d}
td{padding:8px 12px;border-bottom:1px solid #161b22}
tr:hover{background:#161b22}
.id-cell{font-family:'SF Mono',SFMono-Regular,Consolas,monospace;font-weight:600;color:#f0f6fc}
.state-badge{display:inline-block;padding:2px 8px;border-radius:12px;color:#fff;font-size:12px;font-weight:500}
.age-cell{color:#8b949e;font-size:13px}
a{color:#58a6ff;text-decoration:none}
a:hover{text-decoration:underline}
.pr-link{color:#8b949e}
.session-link{color:#58a6ff}
.empty{text-align:center;padding:32px;color:#8b949e}
@media(max-width:600px){
  .container{padding:8px}
  td,th{padding:6px 8px;font-size:13px}
}
</style>
</head>
<body>
<div class="container">
<header>
  <h1>ninthwave dashboard</h1>
  <span class="meta">${items.length} item${items.length === 1 ? "" : "s"}</span>
</header>
${
  items.length === 0
    ? '<p class="empty">No items</p>'
    : `<table>
<thead><tr><th>ID</th><th>State</th><th>PR</th><th>Session</th><th>Age</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`
}
</div>
<script>
setTimeout(()=>location.reload(),2000);
</script>
</body>
</html>`;
}

// ── Session HTML ───────────────────────────────────────────────────────

function renderSession(
  itemId: string,
  content: string,
  token: string,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(itemId)} — ninthwave</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#c9d1d9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px}
.container{max-width:960px;margin:0 auto;padding:16px}
header{display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid #21262d;margin-bottom:16px}
h1{font-size:16px;font-weight:600;color:#f0f6fc}
a{color:#58a6ff;text-decoration:none}
a:hover{text-decoration:underline}
.terminal{background:#161b22;border:1px solid #21262d;border-radius:6px;padding:12px;font-family:'SF Mono',SFMono-Regular,Consolas,monospace;font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-all;overflow-x:auto;min-height:200px;color:#c9d1d9}
@media(max-width:600px){
  .container{padding:8px}
  .terminal{font-size:11px;padding:8px}
}
</style>
</head>
<body>
<div class="container">
<header>
  <h1>${escapeHtml(itemId)}</h1>
  <a href="/?token=${encodeURIComponent(token)}">← back</a>
</header>
<div class="terminal" id="screen">${escapeHtml(content)}</div>
</div>
<script>
setInterval(async()=>{
  try{
    const r=await fetch("/api/screen/${encodeURIComponent(itemId)}?token=${encodeURIComponent(token)}");
    if(r.ok){const d=await r.json();document.getElementById("screen").textContent=d.content}
  }catch(e){}
},2000);
</script>
</body>
</html>`;
}

// ── Helpers ────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getAge(isoTimestamp: string): string {
  const ms = Date.now() - new Date(isoTimestamp).getTime();
  if (ms < 0) return "0s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return `${hours}h ${remainMin}m`;
}

// ── Server ─────────────────────────────────────────────────────────────

export function startDashboard(
  getItems: () => OrchestratorItem[],
  readScreen: (ref: string, lines: number) => string,
  deps?: DashboardDeps,
): DashboardServer {
  const token = deps?.generateToken
    ? deps.generateToken()
    : randomBytes(32).toString("hex");
  const port = deps?.port ?? 0;

  // Per-worker screen cache for throttling
  const screenCache = new Map<string, ScreenCache>();

  function getScreen(itemId: string): string {
    const items = getItems();
    const item = items.find((i) => i.id === itemId);
    if (!item?.workspaceRef) return "";

    const now = Date.now();
    const cached = screenCache.get(itemId);
    if (cached && now - cached.timestamp < SCREEN_THROTTLE_MS) {
      return cached.content;
    }

    const content = readScreen(item.workspaceRef, 100);
    screenCache.set(itemId, { content, timestamp: now });
    return content;
  }

  const server = Bun.serve({
    port,
    hostname: "localhost",
    fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      // Health check — no auth required
      if (path === "/health") {
        return new Response(JSON.stringify({ status: "ok" }), {
          headers: { "content-type": "application/json" },
        });
      }

      // Auth check for all other routes
      if (!checkAuth(req, token)) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }

      // GET / — Dashboard
      if (path === "/") {
        const items = getItems();
        return new Response(renderDashboard(items, token), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      // GET /session/:itemId — Session view
      const sessionMatch = path.match(/^\/session\/([^/]+)$/);
      if (sessionMatch) {
        const itemId = decodeURIComponent(sessionMatch[1]!);
        const content = getScreen(itemId);
        return new Response(renderSession(itemId, content, token), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      // GET /api/items — JSON items
      if (path === "/api/items") {
        const items = getItems();
        return new Response(JSON.stringify({ items }), {
          headers: { "content-type": "application/json" },
        });
      }

      // GET /api/screen/:itemId — JSON screen
      const screenMatch = path.match(/^\/api\/screen\/([^/]+)$/);
      if (screenMatch) {
        const itemId = decodeURIComponent(screenMatch[1]!);
        const content = getScreen(itemId);
        return new Response(
          JSON.stringify({
            itemId,
            content,
            timestamp: new Date().toISOString(),
          }),
          { headers: { "content-type": "application/json" } },
        );
      }

      // 404
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const actualPort = server.port;

  return {
    port: actualPort,
    token,
    stop: () => server.stop(),
  };
}

export function stopDashboard(server: DashboardServer): void {
  server.stop();
}
