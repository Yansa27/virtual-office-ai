#!/usr/bin/env node
/**
 * Virtual Office — Jasvero Digital
 * Server zero-dependency: static hosting + proxy ke Hermes kanban API + standalone mock fallback.
 * Jalankan: node server.js (env: PORT, HOST, HERMES_BASE)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HERMES = process.env.HERMES_BASE || 'http://127.0.0.1:9119';
const PORT = parseInt(process.env.PORT || '9120', 10);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_TTL = 12 * 60 * 60 * 1000;

/** sid -> { jar, username, created } */
const sessions = new Map();

/* Standalone Fallback In-Memory DB (bersih tanpa dummy data, siap terhubung ke Hermes) */
const fallbackDB = {
  profiles: [],
  workflow: {
    columns: [
      { key: 'triage', label: 'Triage', icon: '◇' },
      { key: 'todo', label: 'Todo', icon: '◻' },
      { key: 'scheduled', label: 'Scheduled', icon: '⏱' },
      { key: 'ready', label: 'Ready', icon: '▶' },
      { key: 'running', label: 'Running', icon: '●' },
      { key: 'blocked', label: 'Blocked', icon: '⊘' },
      { key: 'review', label: 'Review', icon: '◎' },
      { key: 'done', label: 'Done', icon: '✓' },
    ],
  },
  projects: [],
  tasks: [],
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}
function json(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}
function parseCookies(req) {
  const out = {};
  const c = req.headers.cookie;
  if (!c) return out;
  for (const part of c.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function jarToHeader(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');
}
function mergeSetCookie(jar, setCookies) {
  for (const sc of setCookies || []) {
    const first = sc.split(';')[0];
    const i = first.indexOf('=');
    if (i > 0) jar[first.slice(0, i).trim()] = decodeURIComponent(first.slice(i + 1).trim());
  }
}

async function hermes(p, { method = 'GET', body, jar } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (jar) headers['Cookie'] = jarToHeader(jar);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(HERMES + p, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch {}
    return { ok: true, status: res.status, setCookies, data };
  } catch (err) {
    clearTimeout(timeoutId);
    return { ok: false, error: err.message };
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (d) => { buf += d; if (buf.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

function serveStatic(res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) {
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
        if (e2) return send(res, 404, 'Not found');
        send(res, 200, html, { 'Content-Type': MIME['.html'] });
      });
      return;
    }
    send(res, 200, data, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  });
}

/* Fallback Mock Handler */
function handleFallbackKanban(rest, method, body, res) {
  if (rest === '/workflow') {
    return json(res, 200, fallbackDB.workflow);
  }
  if (rest === '/profiles') {
    return json(res, 200, { profiles: fallbackDB.profiles });
  }
  if (rest === '/projects') {
    return json(res, 200, { projects: fallbackDB.projects });
  }
  if (rest === '/stats') {
    return json(res, 200, {
      total_tasks: fallbackDB.tasks.length,
      done_tasks: fallbackDB.tasks.filter((t) => t.status === 'done').length,
      active_tasks: fallbackDB.tasks.filter((t) => ['running', 'ready', 'review'].includes(t.status)).length,
    });
  }
  if (rest === '/board') {
    const cols = fallbackDB.workflow.columns.map((c) => ({
      name: c.key,
      tasks: fallbackDB.tasks.filter((t) => t.status === c.key),
    }));
    return json(res, 200, { columns: cols });
  }
  if (rest === '/tasks' && method === 'POST') {
    const newTask = {
      id: 'tsk-' + Date.now().toString(36),
      title: body.title || 'Untitled Task',
      body: body.body || null,
      assignee: body.assignee || null,
      priority: body.priority || 0,
      status: 'triage',
      created_at: Math.floor(Date.now() / 1000),
      updated_at: Math.floor(Date.now() / 1000),
    };
    fallbackDB.tasks.unshift(newTask);
    return json(res, 200, { ok: true, task: newTask });
  }
  if (rest.startsWith('/tasks/')) {
    const id = rest.slice('/tasks/'.length);
    const idx = fallbackDB.tasks.findIndex((t) => t.id === id);
    if (idx === -1) return json(res, 404, { error: 'Task not found' });
    if (method === 'PATCH') {
      const task = fallbackDB.tasks[idx];
      if (body.status) {
        task.status = body.status;
        if (body.status === 'done' && !task.completed_at) {
          task.completed_at = Math.floor(Date.now() / 1000);
          task.latest_summary = task.latest_summary || 'Tugas selesai dikerjakan dengan hasil optimal.';
        }
      }
      if (body.assignee !== undefined) task.assignee = body.assignee;
      if (body.priority !== undefined) task.priority = body.priority;
      if (body.title) task.title = body.title;
      if (body.body) task.body = body.body;
      task.updated_at = Math.floor(Date.now() / 1000);
      return json(res, 200, { ok: true, task });
    }
    return json(res, 200, { ok: true, task: fallbackDB.tasks[idx] });
  }
  return json(res, 404, { error: 'Unknown fallback route' });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = u.pathname;

  const cookies = parseCookies(req);
  const sid = cookies['vo_sid'];
  let sess = sid ? sessions.get(sid) : null;
  if (sess && Date.now() - sess.created > SESSION_TTL) {
    sessions.delete(sid);
    sess = null;
  }

  try {
    // ---- auth ----
    if (p === '/api/login' && req.method === 'POST') {
      const b = await readBody(req);
      const r = await hermes('/auth/password-login', {
        method: 'POST',
        body: { provider: 'basic', username: b.username, password: b.password },
      });

      let authenticated = false;
      let jar = {};
      const username = b.username || 'admin';

      if (r.ok && r.status === 200) {
        authenticated = true;
        mergeSetCookie(jar, r.setCookies);
      } else if (!r.ok) {
        // Hermes offline: izinkan login standalone fallback
        authenticated = true;
      }

      if (!authenticated) {
        return json(res, 401, { error: 'Username atau password salah' });
      }

      const nsid = crypto.randomBytes(24).toString('hex');
      sessions.set(nsid, { jar, username, created: Date.now() });
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': `vo_sid=${nsid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}`,
      });
      return res.end(JSON.stringify({ ok: true, username }));
    }

    if (p === '/api/logout' && req.method === 'POST') {
      if (sid) sessions.delete(sid);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'vo_sid=; HttpOnly; Path=/; Max-Age=0' });
      return res.end(JSON.stringify({ ok: true }));
    }

    if (p === '/api/me') {
      if (!sess) return json(res, 401, { error: 'unauthenticated' });
      return json(res, 200, { username: sess.username });
    }

    // ---- proxy kanban / fallback ----
    if (p.startsWith('/api/kanban/')) {
      if (!sess) return json(res, 401, { error: 'unauthenticated' });
      const rest = p.slice('/api/kanban'.length);
      const method = req.method;
      const body = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) ? await readBody(req) : undefined;

      const r = await hermes('/api/plugins/kanban' + rest + (u.search || ''), { method, body, jar: sess.jar });
      if (r.ok) {
        mergeSetCookie(sess.jar, r.setCookies);
        return json(res, r.status, r.data);
      }

      // Fallback in-memory
      return handleFallbackKanban(rest, method, body, res);
    }

    serveStatic(res, p);
  } catch (e) {
    json(res, 500, { error: String((e && e.message) || e) });
  }
});

server.listen(PORT, HOST, () => console.log(`Virtual Office Jasvero → http://${HOST}:${PORT}`));
