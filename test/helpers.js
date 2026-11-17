/**
 * test/helpers.js — util untuk test integrasi server Virtual Office.
 * Zero-dep: node:http, node:child_process, node:net.
 */
'use strict';

const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Mock Hermes: login + kanban plugin. Bisa diset delay / selalu gagal. */
async function startMockHermes({ delayMs = 0, failLogin = false, validPassword = null } = {}) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    requests.push({ method: req.method, url: req.url, body });

    if (delayMs && req.url.startsWith('/api/plugins/kanban')) await sleep(delayMs);

    if (req.url === '/auth/password-login' && req.method === 'POST') {
      let b = {};
      try { b = JSON.parse(body || '{}'); } catch { /* abaikan */ }
      if (failLogin || (validPassword !== null && b.password !== validPassword) || !b.username || !b.password) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'invalid credentials' }));
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': 'hermes_sid=fake-session; Path=/; HttpOnly',
      });
      return res.end(JSON.stringify({ ok: true }));
    }

    if (req.url.startsWith('/api/plugins/kanban')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, source: 'hermes', url: req.url }));
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    async close() { await new Promise((r) => server.close(r)); },
  };
}

/** Jalankan server.js dengan env terisolasi. Default HERMES_BASE tidak terjangkau. */
async function startServer({ dbPath, env = {}, port = null } = {}) {
  const listenPort = port || (await freePort());
  const defaults = {
    PORT: String(listenPort),
    HOST: '127.0.0.1',
    VO_DB_PATH: dbPath,
    VO_DATA_DIR: path.dirname(dbPath),
    VO_CHAT_WORKSPACES: path.join(path.dirname(dbPath), 'chat-workspaces'),
    HERMES_BASE: 'http://127.0.0.1:1', // unreachable → fallback
    HERMES_BIN: '/bin/true',
    VO_ALLOW_OFFLINE_LOGIN: '0',
    VO_HERMES_PROXY_TIMEOUT_MS: '5000',
    VO_RATELIMIT: '1',
    VO_MIGRATE_LEGACY: '0',
    VO_RL_LOGIN_MAX: '5',
    VO_RL_CHAT_MAX: '20',
    VO_RL_API_MAX: '200',
  };
  const merged = { ...defaults };
  for (const [k, v] of Object.entries(env)) if (v !== undefined) merged[k] = v;

  const proc = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, ...merged },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', (d) => { stdout += d; });
  proc.stderr.on('data', (d) => { stderr += d; });

  const url = `http://127.0.0.1:${listenPort}`;
  const ready = await waitReady(url, proc);
  return {
    url,
    port: listenPort,
    proc,
    get stdout() { return stdout; },
    get stderr() { return stderr; },
    ready,
    async stop() {
      if (proc.exitCode !== null || proc.signalCode) return proc.exitCode ?? 0;
      const code = await new Promise((resolve) => {
        const t = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* abaikan */ } }, 8000);
        proc.once('exit', (c) => { clearTimeout(t); resolve(c ?? 0); });
        try { proc.kill('SIGTERM'); } catch { /* abaikan */ }
      });
      return code;
    },
  };
}

async function waitReady(url, proc, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`server keluar lebih awal (code ${proc.exitCode})`);
    try {
      const res = await fetch(url + '/api/me', { method: 'GET' });
      if (res.status) return true; // 401 pun tandanya server sudah hidup
    } catch { /* coba lagi */ }
    await sleep(100);
  }
  throw new Error('server tidak siap dalam ' + timeoutMs + 'ms');
}

/** HTTP request JSON. Mengembalikan {status, headers, data, setCookie}. */
async function req(url, p, { method = 'GET', body, cookie, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (cookie) h['Cookie'] = cookie;
  const res = await fetch(url + p, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, headers: res.headers, data, setCookie: res.headers.get('set-cookie') || '' };
}

function sidFrom(res) {
  const m = res.setCookie.match(/vo_sid=([^;]+)/);
  return m ? m[1] : null;
}

async function login(url, username = 'admin', password = 'admin') {
  const r = await req(url, '/api/login', { method: 'POST', body: { username, password } });
  return { ...r, sid: sidFrom(r) };
}

module.exports = { ROOT, sleep, freePort, startMockHermes, startServer, waitReady, req, sidFrom, login };
