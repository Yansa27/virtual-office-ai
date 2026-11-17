/**
 * test/server.test.js — test integrasi server.js.
 * Fokus P0/P1: login bypass, persistensi fallback, rate limit,
 * timeout proxy → fallback, header keamanan, chat concurrency, graceful shutdown.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { startMockHermes, startServer, req, login, sleep } = require('./helpers');
const { Store } = require('../lib/store');

function tmpDir(label) {
  return fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), `vo-srv-${label}-`));
}

async function waitFor(fn, timeoutMs = 5000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  return last;
}

test('auth guard: endpoint terproteksi menolak tanpa sesi', async () => {
  const dir = tmpDir('guard');
  const srv = await startServer({ dbPath: path.join(dir, 'vo.db') });
  try {
    const me = await req(srv.url, '/api/me');
    assert.equal(me.status, 401);
    const board = await req(srv.url, '/api/kanban/board');
    assert.equal(board.status, 401);
    const chat = await req(srv.url, '/api/chat/dev');
    assert.equal(chat.status, 401);
  } finally {
    await srv.stop();
  }
});

test('P0(c): login bypass offline NONAKTIF secara default', async () => {
  const dir = tmpDir('bypass-off');
  const srv = await startServer({ dbPath: path.join(dir, 'vo.db') }); // HERMES_BASE unreachable
  try {
    const r = await login(srv.url, 'admin', 'admin');
    assert.equal(r.status, 503);
    assert.match(r.data.error, /tidak terjangkau/i);
    // /api/me harus tetap 401 (tidak ada sesi yang dibuat)
    assert.equal((await req(srv.url, '/api/me')).status, 401);
  } finally {
    await srv.stop();
  }
});

test('P0(c): bypass hanya aktif bila VO_ALLOW_OFFLINE_LOGIN=1', async () => {
  const dir = tmpDir('bypass-on');
  const srv = await startServer({
    dbPath: path.join(dir, 'vo.db'),
    env: { VO_ALLOW_OFFLINE_LOGIN: '1' },
  });
  try {
    const r = await login(srv.url, 'admin', 'admin');
    assert.equal(r.status, 200);
    assert.ok(r.sid, 'cookie vo_sid harus ada');

    const me = await req(srv.url, '/api/me', { cookie: `vo_sid=${r.sid}` });
    assert.equal(me.status, 200);
    assert.equal(me.data.username, 'admin');

    const out = await req(srv.url, '/api/logout', { method: 'POST', cookie: `vo_sid=${r.sid}` });
    assert.equal(out.status, 200);
    assert.equal((await req(srv.url, '/api/me', { cookie: `vo_sid=${r.sid}` })).status, 401);
  } finally {
    await srv.stop();
  }
});

test('login valid via Hermes; kredensial salah ditolak', async () => {
  const dir = tmpDir('login');
  const mock = await startMockHermes({ validPassword: 'rahasia' });
  const srv = await startServer({ dbPath: path.join(dir, 'vo.db'), env: { HERMES_BASE: mock.url } });
  try {
    const ok = await login(srv.url, 'admin', 'rahasia');
    assert.equal(ok.status, 200);
    assert.equal((await req(srv.url, '/api/me', { cookie: `vo_sid=${ok.sid}` })).status, 200);

    const bad = await login(srv.url, 'admin', 'salah');
    assert.equal(bad.status, 401);
    assert.match(bad.data.error, /salah/i);

    const empty = await req(srv.url, '/api/login', { method: 'POST', body: { username: '', password: '' } });
    assert.equal(empty.status, 400);
  } finally {
    await srv.stop();
    await mock.close();
  }
});

test('P1(e): rate limit login', async () => {
  const dir = tmpDir('rl');
  const srv = await startServer({
    dbPath: path.join(dir, 'vo.db'),
    env: { VO_RL_LOGIN_MAX: '3' },
  });
  try {
    for (let i = 0; i < 3; i++) {
      const r = await login(srv.url, 'admin', 'admin');
      assert.equal(r.status, 503, `attempt ${i + 1} harusnya masih diproses`);
    }
    const blocked = await login(srv.url, 'admin', 'admin');
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get('retry-after'));
  } finally {
    await srv.stop();
  }
});

test('P0(b): fallback kanban CRUD + validasi + persistensi DB', async () => {
  const dir = tmpDir('fallback');
  const dbPath = path.join(dir, 'vo.db');
  const srv = await startServer({ dbPath, env: { VO_ALLOW_OFFLINE_LOGIN: '1' } });
  try {
    const { sid } = await login(srv.url, 'admin', 'admin');
    const cookie = `vo_sid=${sid}`;

    const created = await req(srv.url, '/api/kanban/tasks', {
      method: 'POST', cookie, body: { title: 'Task Fallback', assignee: 'dev', priority: 2 },
    });
    assert.equal(created.status, 200);
    const id = created.data.task.id;
    assert.ok(id);

    const got = await req(srv.url, `/api/kanban/tasks/${id}`, { cookie });
    assert.equal(got.status, 200);
    assert.equal(got.data.task.title, 'Task Fallback');

    const done = await req(srv.url, `/api/kanban/tasks/${id}`, {
      method: 'PATCH', cookie, body: { status: 'done' },
    });
    assert.equal(done.status, 200);
    assert.equal(done.data.task.status, 'done');
    assert.ok(done.data.task.completed_at, 'completed_at harus diisi saat done');

    const bad = await req(srv.url, `/api/kanban/tasks/${id}`, {
      method: 'PATCH', cookie, body: { status: 'bogus' },
    });
    assert.equal(bad.status, 400);

    const board = await req(srv.url, '/api/kanban/board', { cookie });
    assert.equal(board.status, 200);
    const doneCol = board.data.columns.find((c) => c.name === 'done');
    assert.ok(doneCol.tasks.some((t) => t.id === id));

    const stats = await req(srv.url, '/api/kanban/stats', { cookie });
    assert.equal(stats.data.total_tasks, 1);
    assert.equal(stats.data.done_tasks, 1);

    // Preflight: task benar-benar tertulis ke SQLite (bukan in-memory).
    const reader = new Store(dbPath).open();
    assert.equal(reader.listTasks().length, 1);
    reader.close();
  } finally {
    await srv.stop();
  }
});

test('P0(b): task fallback bertahan across restart', async () => {
  const dir = tmpDir('persist');
  const dbPath = path.join(dir, 'vo.db');
  const env = { VO_ALLOW_OFFLINE_LOGIN: '1' };

  const srv1 = await startServer({ dbPath, env });
  try {
    const { sid } = await login(srv1.url, 'admin', 'admin');
    const created = await req(srv1.url, '/api/kanban/tasks', {
      method: 'POST', cookie: `vo_sid=${sid}`, body: { title: 'Tahan Restart' },
    });
    assert.equal(created.status, 200);
  } finally {
    await srv1.stop();
  }

  const srv2 = await startServer({ dbPath, env });
  try {
    const { sid } = await login(srv2.url, 'admin', 'admin');
    const board = await req(srv2.url, '/api/kanban/board', { cookie: `vo_sid=${sid}` });
    const all = board.data.columns.flatMap((c) => c.tasks);
    assert.ok(all.some((t) => t.title === 'Tahan Restart'), 'task harus masih ada setelah restart');
  } finally {
    await srv2.stop();
  }
});

test('chat: riwayat agen + log aktivitas', async () => {
  const dir = tmpDir('chatlog');
  const srv = await startServer({ dbPath: path.join(dir, 'vo.db'), env: { VO_ALLOW_OFFLINE_LOGIN: '1' } });
  try {
    const { sid } = await login(srv.url, 'admin', 'admin');
    const cookie = `vo_sid=${sid}`;

    const h = await req(srv.url, '/api/chat/dev', { cookie });
    assert.equal(h.status, 200);
    assert.ok(Array.isArray(h.data.messages));
    assert.equal(h.data.busy, false);

    const lg = await req(srv.url, '/api/chat/log?limit=5', { cookie });
    assert.equal(lg.status, 200);
    assert.ok(Array.isArray(lg.data.log));
    assert.equal(typeof lg.data.busy, 'object');

    const unknown = await req(srv.url, '/api/chat/bukan-agen', { cookie });
    assert.equal(unknown.status, 404);
  } finally {
    await srv.stop();
  }
});

test('P1(d): proxy timeout → fallback (bukan error ke klien)', async () => {
  const dir = tmpDir('timeout');
  const mock = await startMockHermes({ delayMs: 900 });
  const srv = await startServer({
    dbPath: path.join(dir, 'vo.db'),
    env: { HERMES_BASE: mock.url, VO_ALLOW_OFFLINE_LOGIN: '1', VO_HERMES_PROXY_TIMEOUT_MS: '150' },
  });
  try {
    const { sid } = await login(srv.url, 'admin', 'admin');
    const r = await req(srv.url, '/api/kanban/stats', { cookie: `vo_sid=${sid}` });
    assert.equal(r.status, 200);
    assert.equal(r.data.source, undefined, 'harus dari fallback, bukan Hermes');
    assert.equal(typeof r.data.total_tasks, 'number');
  } finally {
    await srv.stop();
    await mock.close();
  }
});

test('P1(g): security headers + cookie Secure saat HTTPS', async () => {
  const dir = tmpDir('sec');
  const srv = await startServer({ dbPath: path.join(dir, 'vo.db'), env: { VO_ALLOW_OFFLINE_LOGIN: '1' } });
  try {
    const me = await req(srv.url, '/api/me');
    assert.equal(me.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(me.headers.get('x-frame-options'), 'DENY');
    assert.match(me.headers.get('referrer-policy') || '', /strict-origin-when-cross-origin/);
    assert.ok(me.headers.get('content-security-policy'));

    const httpLogin = await login(srv.url, 'admin', 'admin');
    assert.ok(!/;\s*Secure/i.test(httpLogin.setCookie), 'HTTP biasa: cookie tanpa Secure');

    const httpsLogin = await req(srv.url, '/api/login', {
      method: 'POST',
      body: { username: 'admin', password: 'admin' },
      headers: { 'x-forwarded-proto': 'https' },
    });
    assert.equal(httpsLogin.status, 200);
    assert.ok(/;\s*Secure/i.test(httpsLogin.setCookie), 'di balik proxy HTTPS: cookie wajib Secure');
  } finally {
    await srv.stop();
  }
});

test('chat: validasi agent & pesan kosong', async () => {
  const dir = tmpDir('chat-val');
  const srv = await startServer({ dbPath: path.join(dir, 'vo.db'), env: { VO_ALLOW_OFFLINE_LOGIN: '1' } });
  try {
    const { sid } = await login(srv.url, 'admin', 'admin');
    const cookie = `vo_sid=${sid}`;
    assert.equal((await req(srv.url, '/api/chat/unknown-agent', { cookie })).status, 404);
    const empty = await req(srv.url, '/api/chat/dev', { method: 'POST', cookie, body: { text: '   ' } });
    assert.equal(empty.status, 400);
  } finally {
    await srv.stop();
  }
});

test('P0(a): chat concurrency — satu 202, satu 409, pesan user tidak hilang/rusak', async () => {
  const dir = tmpDir('chat-race');
  const dbPath = path.join(dir, 'vo.db');
  const srv = await startServer({
    dbPath,
    env: { VO_ALLOW_OFFLINE_LOGIN: '1', HERMES_BIN: '/bin/true' },
  });
  try {
    const { sid } = await login(srv.url, 'admin', 'admin');
    const cookie = `vo_sid=${sid}`;

    const [a, b] = await Promise.all([
      req(srv.url, '/api/chat/dev', { method: 'POST', cookie, body: { text: 'pesan-A' } }),
      req(srv.url, '/api/chat/dev', { method: 'POST', cookie, body: { text: 'pesan-B' } }),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [202, 409], `harus 202 + 409, dapat ${statuses}`);

    const done = await waitFor(async () => {
      const r = await req(srv.url, '/api/chat/dev', { cookie });
      return r.data && r.data.busy === false ? r : null;
    });
    assert.ok(done, 'agen harus kembali tidak sibuk');

    const messages = done.data.messages;
    const userMsgs = messages.filter((m) => m.sender === 'user');
    assert.equal(userMsgs.length, 1, 'hanya pesan dari request 202 yang boleh tersimpan');
    assert.ok(['pesan-A', 'pesan-B'].includes(userMsgs[0].text));
    assert.equal(messages.filter((m) => m.sender === 'ai').length, 1, 'agen /bin/true harus memberi balasan');

    // Persistensi: riwayat ada di SQLite.
    const reader = new Store(dbPath).open();
    const rows = reader.getMessages('dev');
    assert.equal(rows.length, 2);
    reader.close();
  } finally {
    await srv.stop();
  }
});

test('P1(f): graceful shutdown SIGTERM + child agent dihentikan', async () => {
  const dir = tmpDir('shutdown');
  const pidFile = path.join(dir, 'agent.pid');
  const fakeAgent = path.join(dir, 'fake-hermes.js');
  fs.writeFileSync(fakeAgent, `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`);
  fs.chmodSync(fakeAgent, 0o755);

  const srv = await startServer({
    dbPath: path.join(dir, 'vo.db'),
    env: { VO_ALLOW_OFFLINE_LOGIN: '1', HERMES_BIN: fakeAgent, PIDFILE: pidFile },
  });
  try {
    const { sid } = await login(srv.url, 'admin', 'admin');
    const sent = await req(srv.url, '/api/chat/dev', {
      method: 'POST', cookie: `vo_sid=${sid}`, body: { text: 'halo' },
    });
    assert.equal(sent.status, 202);

    const pid = await waitFor(async () => {
      if (!fs.existsSync(pidFile)) return null;
      const n = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
      return Number.isFinite(n) ? n : null;
    }, 4000);
    assert.ok(pid, 'child agent harus berjalan');
    assert.doesNotThrow(() => process.kill(pid, 0), 'child agent harus hidup sebelum shutdown');
  } finally {
    const code = await srv.stop();
    assert.equal(code, 0, 'SIGTERM harus exit code 0');
  }

  await sleep(600);
  assert.throws(() => process.kill(parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10), 0), /ESRCH/,
    'child agent harus ikut mati saat shutdown');
});
