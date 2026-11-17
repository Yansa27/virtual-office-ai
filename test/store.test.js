/**
 * test/store.test.js — unit test lib/store.js (SQLite).
 * Menekan persistensi, pruning, dan migrasi legacy.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store, migrateLegacy, newTaskId } = require('../lib/store');

function tmpDir(label) {
  return fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), `vo-${label}-`));
}

test('task CRUD + persistensi across reopen', () => {
  const dir = tmpDir('store');
  const dbPath = path.join(dir, 'vo.db');

  let store = new Store(dbPath).open();
  const created = store.createTask({
    id: newTaskId(),
    title: 'Task A',
    body: 'Body A',
    assignee: 'dev',
    priority: 2,
    status: 'triage',
    created_at: 1000,
    updated_at: 1000,
  });
  assert.equal(created.title, 'Task A');
  assert.equal(created.status, 'triage');

  const patched = store.updateTask(created.id, {
    status: 'done',
    updated_at: 2000,
    latest_summary: 'selesai',
  });
  assert.equal(patched.status, 'done');
  assert.equal(patched.completed_at, 2000); // auto-fill dari updated_at saat transisi ke done
  store.close();

  // Buka ulang: data harus masih ada.
  store = new Store(dbPath).open();
  const tasks = store.listTasks();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, 'Task A');
  assert.equal(tasks[0].assignee, 'dev');
  assert.equal(tasks[0].status, 'done');
  store.close();
});

test('status done mengisi completed_at + latest_summary bila belum ada', () => {
  const dir = tmpDir('store-done');
  const store = new Store(path.join(dir, 'vo.db')).open();
  const t = store.createTask({
    id: 't1', title: 'T', status: 'todo', created_at: 1, updated_at: 1,
  });
  assert.equal(t.completed_at, null);

  const done = store.updateTask('t1', { status: 'done', updated_at: 2, latest_summary: 'selesai' });
  assert.equal(done.completed_at, 2);
  assert.equal(done.latest_summary, 'selesai');
  store.close();
});

test('chat messages: urutan, prune, unanswered', () => {
  const dir = tmpDir('chat');
  const store = new Store(path.join(dir, 'vo.db')).open();

  store.appendMessage('dev', 'user', 'halo', '10:00');
  store.appendMessage('dev', 'ai', 'hai', '10:01');
  store.appendMessage('dev', 'user', 'lagi', '10:02');
  store.appendMessage('qa', 'user', 'qa-only', '10:03');

  assert.deepEqual(
    store.getMessages('dev').map((m) => m.text),
    ['halo', 'hai', 'lagi']
  );
  assert.deepEqual(
    store.listUnansweredAgents().map((r) => r.agent).sort(),
    ['dev', 'qa']
  );

  // prune: sisakan 2 terakhir per agen
  store.pruneMessages('dev', 2);
  assert.deepEqual(
    store.getMessages('dev').map((m) => m.text),
    ['hai', 'lagi']
  );
  // qa tidak tersentuh
  assert.deepEqual(store.getMessages('qa').map((m) => m.text), ['qa-only']);
  store.close();
});

test('sessions: buat, baca, update jar, hapus, prune TTL', () => {
  const dir = tmpDir('sessions');
  const store = new Store(path.join(dir, 'vo.db')).open();

  store.createSession('sid1', 'admin', { a: '1' });
  const s = store.getSession('sid1');
  assert.equal(s.username, 'admin');
  assert.equal(s.jar.a, '1');

  store.updateSessionJar('sid1', { a: '2', b: '3' });
  assert.deepEqual(store.getSession('sid1').jar, { a: '2', b: '3' });

  store.deleteSession('sid1');
  assert.equal(store.getSession('sid1'), null);

  // session lama harus di-prune
  store.createSession('old', 'admin', {});
  store.db.prepare('UPDATE sessions SET created = ? WHERE sid = ?').run(Date.now() - 1000 * 60 * 60 * 24, 'old');
  store.pruneSessions(60 * 60 * 1000); // TTL 1 jam
  assert.equal(store.getSession('old'), null);
  store.close();
});

test('seedDefaultProfiles hanya sekali', () => {
  const dir = tmpDir('profiles');
  const store = new Store(path.join(dir, 'vo.db')).open();
  assert.equal(store.seedDefaultProfiles(), true);
  const n = store.listProfiles().length;
  assert.ok(n >= 5);
  assert.equal(store.seedDefaultProfiles(), false);
  assert.equal(store.listProfiles().length, n);
  store.close();
});

test('migrateLegacy: pesan + sesi masuk, idempotent', () => {
  const dir = tmpDir('migrate');
  const dbPath = path.join(dir, 'vo.db');
  const legacyPath = path.join(dir, 'chat-state.json');
  fs.writeFileSync(legacyPath, JSON.stringify({
    agents: {
      dev: {
        session: 'sess-1',
        messages: [
          { sender: 'user', text: 'halo', time: '09:00' },
          { sender: 'ai', text: 'hai', time: '09:01' },
          { sender: 'user', text: '', time: '09:02' }, // teks kosong → dilewati
        ],
      },
      qa: { messages: [{ sender: 'user', text: 'qa', time: '10:00' }] },
    },
  }, null, 2));

  const store = new Store(dbPath).open();
  const r1 = migrateLegacy(store, legacyPath);
  assert.equal(r1.migrated, true);
  assert.equal(r1.messages, 3);
  assert.equal(r1.sessions, 1);
  assert.equal(store.getChatSession('dev'), 'sess-1');
  assert.deepEqual(store.getMessages('dev').map((m) => m.text), ['halo', 'hai']);

  const r2 = migrateLegacy(store, legacyPath);
  assert.equal(r2.migrated, false);
  assert.equal(r2.reason, 'sudah dimigrasi sebelumnya');
  assert.equal(store.getMessages('dev').length, 2);
  store.close();
});

test('migrateLegacy aman bila file tidak ada', () => {
  const dir = tmpDir('migrate-none');
  const store = new Store(path.join(dir, 'vo.db')).open();
  const r = migrateLegacy(store, path.join(dir, 'nope.json'));
  assert.equal(r.migrated, false);
  store.close();
});
