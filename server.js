#!/usr/bin/env node
/**
 * Virtual Office — Jasvero Digital
 * Server zero-dependency: static hosting + proxy ke Hermes kanban API + fallback SQLite.
 *
 * Storage:
 *  - SQLite (node:sqlite, WAL) di data/vo.db — chat, session, task fallback.
 *    Menggantikan chat-state.json + fallbackDB in-memory yang rentan lost-update
 *    dan hilang saat restart.
 *  - env: PORT, HOST, HERMES_BASE, VO_DB_PATH, VO_ALLOW_OFFLINE_LOGIN, VO_RATELIMIT, dsb.
 *    Lihat lib/config.js.
 *
 * Jalankan: node server.js
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const config = require('./lib/config');
const { securityHeaders, sessionCookieOptions, isHttpsRequest } = require('./lib/security');
const { createRateLimiter } = require('./lib/ratelimit');
const { Store, migrateLegacy, newTaskId } = require('./lib/store');
const { ChatService } = require('./lib/chat');

const log = {
  info: (...a) => console.log('[vo]', ...a),
  warn: (...a) => console.warn('[vo]', ...a),
  error: (...a) => console.error('[vo]', ...a),
};

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/* ---------------- storage ---------------- */
const store = new Store(config.dbPath);
try {
  store.open();
} catch (err) {
  log.error('Gagal membuka database:', err.message);
  process.exit(1);
}

if (config.migrateLegacy) {
  try {
    const r = migrateLegacy(store, path.join(__dirname, 'chat-state.json'));
    if (r.migrated) log.info(`Migrasi chat-state.json → ${config.dbPath}: ${r.messages} pesan, ${r.sessions} sesi`);
    else if (r.reason !== 'file tidak ada') log.info('Migrasi legacy:', r.reason);
  } catch (err) {
    log.warn('Migrasi chat-state.json gagal:', err.message);
  }
}

store.seedDefaultProfiles();

const chat = new ChatService(store, config, log);
chat.bootstrap();

/* ---------------- workflow (definisi kolom, bukan data user) ---------------- */
const WORKFLOW_COLUMNS = [
  { key: 'triage', label: 'Triage', icon: '◇' },
  { key: 'todo', label: 'Todo', icon: '◻' },
  { key: 'scheduled', label: 'Scheduled', icon: '⏱' },
  { key: 'ready', label: 'Ready', icon: '▶' },
  { key: 'running', label: 'Running', icon: '●' },
  { key: 'blocked', label: 'Blocked', icon: '⊘' },
  { key: 'review', label: 'Review', icon: '◎' },
  { key: 'done', label: 'Done', icon: '✓' },
];
const TASK_STATUSES = new Set(WORKFLOW_COLUMNS.map((c) => c.key));

/* ---------------- HTTP helpers ---------------- */
function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}
function json(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}
function clientIp(req) {
  if (config.trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
  }
  return String(req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
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
  return Object.entries(jar || {}).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');
}
function mergeSetCookie(jar, setCookies) {
  for (const sc of setCookies || []) {
    const first = sc.split(';')[0];
    const i = first.indexOf('=');
    if (i > 0) jar[first.slice(0, i).trim()] = decodeURIComponent(first.slice(i + 1).trim());
  }
}
function serializeCookie(name, value, opts) {
  let s = `${name}=${value}; HttpOnly; Path=${opts.path}; SameSite=${opts.sameSite}; Max-Age=${opts.maxAge}`;
  if (opts.secure) s += '; Secure';
  return s;
}

const limiter = createRateLimiter(config);
function rateLimit(res, result) {
  const retry = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
  res.setHeader('Retry-After', String(retry));
  json(res, 429, { error: 'Terlalu banyak percobaan. Coba lagi nanti.' });
}

/* ---------------- Hermes proxy ---------------- */
async function hermes(p, { method = 'GET', body, jar } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (jar) headers['Cookie'] = jarToHeader(jar);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.hermesProxyTimeoutMs);
  try {
    const res = await fetch(config.hermesBase + p, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
      signal: controller.signal,
    });
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch { /* biarkan teks mentah */ }
    return { ok: true, status: res.status, setCookies, data };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'timeout' : err.message };
  } finally {
    clearTimeout(timeoutId);
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

/* ---------------- fallback kanban (SQLite) ---------------- */
function handleFallbackKanban(rest, method, body, res) {
  if (rest === '/workflow') return json(res, 200, { columns: WORKFLOW_COLUMNS });
  if (rest === '/profiles') return json(res, 200, { profiles: store.listProfiles() });
  if (rest === '/projects') return json(res, 200, { projects: store.listProjects() });

  if (rest === '/stats') {
    const tasks = store.listTasks();
    return json(res, 200, {
      total_tasks: tasks.length,
      done_tasks: tasks.filter((t) => t.status === 'done').length,
      active_tasks: tasks.filter((t) => ['running', 'ready', 'review'].includes(t.status)).length,
    });
  }

  if (rest === '/board') {
    const tasks = store.listTasks();
    const columns = WORKFLOW_COLUMNS.map((c) => ({
      name: c.key,
      tasks: tasks.filter((t) => t.status === c.key),
    }));
    return json(res, 200, { columns });
  }

  if (rest === '/tasks' && method === 'POST') {
    const title = String(body.title || '').trim() || 'Untitled Task';
    const task = store.createTask({
      id: newTaskId(),
      title,
      body: body.body || null,
      assignee: body.assignee || null,
      priority: Number.isFinite(Number(body.priority)) ? Number(body.priority) : 0,
      status: 'triage',
      created_at: Math.floor(Date.now() / 1000),
      updated_at: Math.floor(Date.now() / 1000),
    });
    return json(res, 200, { ok: true, task });
  }

  if (rest.startsWith('/tasks/')) {
    const id = decodeURIComponent(rest.slice('/tasks/'.length));
    const task = store.getTask(id);
    if (!task) return json(res, 404, { error: 'Task not found' });

    if (method === 'GET') return json(res, 200, { ok: true, task });

    if (method === 'PATCH' || method === 'PUT') {
      const patch = { updated_at: Math.floor(Date.now() / 1000) };
      if (body.status !== undefined) {
        if (!TASK_STATUSES.has(body.status)) return json(res, 400, { error: `Status tidak dikenal: ${body.status}` });
        patch.status = body.status;
        if (body.status === 'done' && !task.completed_at) {
          patch.completed_at = Math.floor(Date.now() / 1000);
          patch.latest_summary = task.latest_summary || 'Tugas selesai dikerjakan dengan hasil optimal.';
        }
      }
      if (body.assignee !== undefined) patch.assignee = body.assignee;
      if (body.priority !== undefined) {
        const n = Number(body.priority);
        if (!Number.isFinite(n)) return json(res, 400, { error: 'Priority harus angka' });
        patch.priority = n;
      }
      if (body.title !== undefined) patch.title = String(body.title).trim() || task.title;
      if (body.body !== undefined) patch.body = body.body;
      if (body.latest_summary !== undefined) patch.latest_summary = body.latest_summary;
      if (body.result !== undefined) patch.result = body.result;
      return json(res, 200, { ok: true, task: store.updateTask(id, patch) });
    }
  }

  return json(res, 404, { error: 'Unknown fallback route' });
}

/* ---------------- session ---------------- */
function createSession(res, req, username, jar) {
  const sid = crypto.randomBytes(24).toString('hex');
  store.createSession(sid, username, jar);
  const opts = sessionCookieOptions(config, isHttpsRequest(req));
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Set-Cookie': serializeCookie('vo_sid', sid, opts),
  });
  res.end(JSON.stringify({ ok: true, username }));
}

function clearSessionCookie(res, req) {
  const opts = sessionCookieOptions(config, isHttpsRequest(req));
  return serializeCookie('vo_sid', '', { ...opts, maxAge: 0 });
}

function lookupSession(sid) {
  if (!sid) return null;
  const sess = store.getSession(sid);
  if (!sess) return null;
  if (Date.now() - sess.created > config.sessionTtlMs) {
    store.deleteSession(sid);
    return null;
  }
  return sess;
}

// Bersihkan session kedaluwarsa secara berkala.
const sessionTimer = setInterval(() => {
  try { store.pruneSessions(config.sessionTtlMs); } catch { /* abaikan */ }
}, 60 * 60 * 1000);
sessionTimer.unref?.();

/* ---------------- server ---------------- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = u.pathname;
  const ip = clientIp(req);

  securityHeaders(req, res, isHttpsRequest(req));

  const cookies = parseCookies(req);
  const sid = cookies['vo_sid'];
  let sess = lookupSession(sid);
  if (sid && !sess) {
    // cookie ada tapi tidak valid/kedaluwarsa → bersihkan di respons ini
    res.setHeader('Set-Cookie', clearSessionCookie(res, req));
  }

  try {
    /* ---- auth ---- */
    if (p === '/api/login' && req.method === 'POST') {
      const rl = limiter.login.consume('login:' + ip);
      if (!rl.allowed) return rateLimit(res, rl);

      const b = await readBody(req);
      const username = String(b.username || '').trim();
      const password = String(b.password || '');
      if (!username || !password) return json(res, 400, { error: 'Username dan password wajib diisi' });

      const r = await hermes('/auth/password-login', {
        method: 'POST',
        body: { provider: 'basic', username, password },
      });

      if (r.ok && r.status === 200) {
        const jar = {};
        mergeSetCookie(jar, r.setCookies);
        return createSession(res, req, username, jar);
      }

      if (!r.ok) {
        // Hermes tidak terjangkau / timeout.
        if (config.allowOfflineLogin) {
          // BYPASS: hanya aktif bila VO_ALLOW_OFFLINE_LOGIN=1.
          log.warn(`login bypass offline untuk "${username}" dari ${ip} (Hermes: ${r.error})`);
          return createSession(res, req, username, {});
        }
        log.warn(`login gagal, Hermes tidak terjangkau (${r.error}) dari ${ip}`);
        return json(res, 503, { error: 'Hermes sedang tidak terjangkau. Login standalone dinonaktifkan.' });
      }

      return json(res, 401, { error: 'Username atau password salah' });
    }

    if (p === '/api/logout' && req.method === 'POST') {
      if (sid) store.deleteSession(sid);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': clearSessionCookie(res, req) });
      return res.end(JSON.stringify({ ok: true }));
    }

    if (p === '/api/me') {
      if (!sess) return json(res, 401, { error: 'unauthenticated' });
      return json(res, 200, { username: sess.username });
    }

    /* ---- proxy kanban / fallback SQLite ---- */
    if (p.startsWith('/api/kanban/')) {
      if (!sess) return json(res, 401, { error: 'unauthenticated' });
      const rl = limiter.api.consume('api:' + ip);
      if (!rl.allowed) return rateLimit(res, rl);

      const rest = p.slice('/api/kanban'.length);
      const method = req.method;
      const body = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) ? await readBody(req) : undefined;

      const r = await hermes('/api/plugins/kanban' + rest + (u.search || ''), { method, body, jar: sess.jar });
      if (r.ok) {
        mergeSetCookie(sess.jar, r.setCookies);
        store.updateSessionJar(sess.sid, sess.jar);
        return json(res, r.status, r.data);
      }

      log.warn(`Hermes kanban tidak terjangkau (${r.error}) → fallback SQLite untuk ${method} ${rest}`);
      return handleFallbackKanban(rest, method, body, res);
    }

    /* ---- log aktivitas chat lintas agen ---- */
    if (p === '/api/chat/log') {
      if (!sess) return json(res, 401, { error: 'unauthenticated' });
      const agent = u.searchParams.get('agent');
      const limitRaw = parseInt(u.searchParams.get('limit') || '120', 10);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 300) : 120;
      return json(res, 200, {
        ok: true,
        log: chat.logActivity(agent || null, limit),
        busy: Object.fromEntries(Array.from(chat.busy).map((a) => [a, true])),
      });
    }

    /* ---- chat sungguhan ke agen ---- */
    if (p.startsWith('/api/chat/')) {
      if (!sess) return json(res, 401, { error: 'unauthenticated' });
      const agent = decodeURIComponent(p.slice('/api/chat/'.length));
      if (!chat.isAgent(agent)) return json(res, 404, { error: 'Agen tidak dikenal' });

      if (req.method === 'GET') {
        return json(res, 200, {
          ok: true,
          agent,
          messages: chat.history(agent),
          session: chat.session(agent),
          busy: chat.isBusy(agent),
        });
      }

      if (req.method === 'POST') {
        const rl = limiter.chat.consume('chat:' + ip);
        if (!rl.allowed) return rateLimit(res, rl);

        const b = await readBody(req);
        const text = String(b.text || '').trim();
        if (!text) return json(res, 400, { error: 'Pesan kosong' });
        if (text.length > 4000) return json(res, 400, { error: 'Pesan terlalu panjang (maks 4000 karakter)' });

        const r = chat.send(agent, text);
        if (r.reason === 'busy') return json(res, 409, { error: 'Agen sedang sibuk menjawab pesan sebelumnya' });
        if (r.reason === 'closed') return json(res, 503, { error: 'Server sedang ditutup' });
        return json(res, 202, { ok: true, agent, busy: true });
      }

      return json(res, 405, { error: 'Method not allowed' });
    }

    serveStatic(res, p);
  } catch (e) {
    log.error('Handler error:', e && e.stack ? e.stack : e);
    if (!res.headersSent) json(res, 500, { error: String((e && e.message) || e) });
  }
});

/* ---------------- graceful shutdown ---------------- */
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`${signal} diterima — menutup server & menghentikan agen...`);
  try { server.close(); } catch { /* abaikan */ }
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await Promise.race([
    chat.close(4000),
    new Promise((resolve) => setTimeout(resolve, 6000)),
  ]);
  clearInterval(sessionTimer);
  try { store.close(); } catch { /* abaikan */ }
  log.info('Server ditutup dengan bersih.');
  process.exit(0);
}
process.on('SIGTERM', () => { shutdown('SIGTERM').catch((e) => { log.error(e); process.exit(1); }); });
process.on('SIGINT', () => { shutdown('SIGINT').catch((e) => { log.error(e); process.exit(1); }); });
process.on('unhandledRejection', (reason) => log.error('unhandledRejection:', reason));

server.listen(config.port, config.host, () => {
  log.info(`Virtual Office Jasvero → http://${config.host}:${config.port}`);
  log.info(`DB: ${config.dbPath} · offline login: ${config.allowOfflineLogin ? 'AKTIF' : 'nonaktif'}`);
});

module.exports = { server, store, chat, config };
