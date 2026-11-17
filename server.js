#!/usr/bin/env node
/**
 * Virtual Office — Jasvero Digital
 * Server zero-dependency: static hosting + proxy ke Hermes kanban API + login session.
 * Jalankan: node server.js   (env: PORT, HOST, HERMES_BASE)
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

async function hermes(path, { method = 'GET', body, jar } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (jar) headers['Cookie'] = jarToHeader(jar);
  const res = await fetch(HERMES + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, setCookies, data };
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

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = u.pathname;

  const cookies = parseCookies(req);
  const sid = cookies['vo_sid'];
  const sess = sid ? sessions.get(sid) : null;
  if (sess && Date.now() - sess.created > SESSION_TTL) sessions.delete(sid);

  try {
    // ---- auth ----
    if (p === '/api/login' && req.method === 'POST') {
      const b = await readBody(req);
      const r = await hermes('/auth/password-login', {
        method: 'POST',
        body: { provider: 'basic', username: b.username, password: b.password },
      });
      if (r.status !== 200) return json(res, 401, { error: 'Username atau password salah' });
      const jar = {};
      mergeSetCookie(jar, r.setCookies);
      const nsid = crypto.randomBytes(24).toString('hex');
      sessions.set(nsid, { jar, username: b.username, created: Date.now() });
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': `vo_sid=${nsid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}`,
      });
      return res.end(JSON.stringify({ ok: true, username: b.username }));
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

    // ---- proxy kanban ----
    if (p.startsWith('/api/kanban/')) {
      if (!sess) return json(res, 401, { error: 'unauthenticated' });
      const rest = p.slice('/api/kanban'.length);
      const method = req.method;
      const body = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) ? await readBody(req) : undefined;
      const r = await hermes('/api/plugins/kanban' + rest + (u.search || ''), { method, body, jar: sess.jar });
      mergeSetCookie(sess.jar, r.setCookies);
      return json(res, r.status, r.data);
    }

    serveStatic(res, p);
  } catch (e) {
    json(res, 500, { error: String((e && e.message) || e) });
  }
});

server.listen(PORT, HOST, () => console.log(`Virtual Office → http://${HOST}:${PORT}`));
