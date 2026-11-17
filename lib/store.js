/**
 * lib/store.js — Storage persisten berbasis SQLite (node:sqlite, zero npm dep).
 *
 * Menggantikan chat-state.json + fallbackDB in-memory yang sebelumnya:
 *  - rentan lost-update saat agen membalas bersamaan (read-modify-write)
 *  - hilang total saat server restart
 *
 * Trade-off: node:sqlite masih experimental di Node 22 (memunculkan warning
 * sekali saat modul dimuat). Kita sengaja menahan warning itu dan tetap
 * meneruskan warning lain. Butuh Node >= 22.5.
 *
 * WAL + busy_timeout dipakai agar write konkuren dari child agent aman.
 */
'use strict';

// Tahan ExperimentalWarning dari node:sqlite, teruskan warning lain.
process.on('warning', (warning) => {
  if (warning && warning.name === 'ExperimentalWarning') return;
   
  console.warn(`[warn] ${warning.name}: ${warning.message}`);
});

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  jar TEXT NOT NULL DEFAULT '{}',
  created INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  agent TEXT NOT NULL,
  seq INTEGER NOT NULL,
  sender TEXT NOT NULL,
  text TEXT NOT NULL,
  time TEXT NOT NULL,
  PRIMARY KEY (agent, seq)
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  agent TEXT PRIMARY KEY,
  session_id TEXT
);

CREATE TABLE IF NOT EXISTS profiles (
  name TEXT PRIMARY KEY,
  description TEXT,
  model TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT,
  assignee TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_at INTEGER,
  updated_at INTEGER,
  completed_at INTEGER,
  latest_summary TEXT,
  result TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee);
CREATE INDEX IF NOT EXISTS idx_chat_messages_agent_seq ON chat_messages(agent, seq);
`;

const DEFAULT_PROFILES = [
  { name: 'pm', description: 'Product Lead & Sprint Planning', model: 'hermes/pm' },
  { name: 'sales', description: 'Sales & Growth', model: 'hermes/sales' },
  { name: 'dev', description: 'Fullstack Developer', model: 'hermes/dev' },
  { name: 'fe', description: 'Frontend Engineer & UI/UX Auditor', model: 'hermes/fe' },
  { name: 'qa', description: 'QA Specialist', model: 'hermes/qa' },
  { name: 'marketing', description: 'Creative Content & SEO', model: 'hermes/marketing' },
];

class Store {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  open() {
    let DatabaseSync;
    try {
       
      ({ DatabaseSync } = require('node:sqlite'));
    } catch (err) {
      throw new Error(
        `node:sqlite tidak tersedia (butuh Node >= 22.5). Upgrade Node atau set VO_DB_PATH ke backend lain. Detail: ${err.message}`
      );
    }
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec(SCHEMA);
    return this;
  }

  close() {
    if (this.db) {
      try { this.db.close(); } catch { /* abaikan */ }
      this.db = null;
    }
  }

  /* ---------------- meta ---------------- */
  getMeta(key, def = null) {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    return row ? row.value : def;
  }
  setMeta(key, value) {
    this.db.prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, String(value));
  }

  /* ---------------- sessions ---------------- */
  createSession(sid, username, jar = {}) {
    const created = Date.now();
    this.db.prepare('INSERT INTO sessions(sid, username, jar, created) VALUES(?, ?, ?, ?)')
      .run(sid, username, JSON.stringify(jar || {}), created);
  }
  getSession(sid) {
    const row = this.db.prepare('SELECT sid, username, jar, created FROM sessions WHERE sid = ?').get(sid);
    if (!row) return null;
    let jar = {};
    try { jar = JSON.parse(row.jar); } catch { jar = {}; }
    return { sid: row.sid, username: row.username, jar, created: row.created };
  }
  updateSessionJar(sid, jar) {
    this.db.prepare('UPDATE sessions SET jar = ? WHERE sid = ?').run(JSON.stringify(jar || {}), sid);
  }
  deleteSession(sid) {
    this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
  }
  pruneSessions(ttlMs) {
    const cutoff = Date.now() - ttlMs;
    this.db.prepare('DELETE FROM sessions WHERE created < ?').run(cutoff);
  }

  /* ---------------- chat ---------------- */
  appendMessage(agent, sender, text, time) {
    const next = this.db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM chat_messages WHERE agent = ?').get(agent).seq;
    this.db.prepare('INSERT INTO chat_messages(agent, seq, sender, text, time) VALUES(?, ?, ?, ?, ?)')
      .run(agent, next, sender, text, time);
  }
  getMessages(agent, limit = 200) {
    return this.db.prepare(
      'SELECT sender, text, time FROM chat_messages WHERE agent = ? ORDER BY seq DESC LIMIT ?'
    ).all(agent, limit).reverse();
  }
  /** Log lintas agen: pesan terbaru dulu (untuk aktivitas tugas via chat). */
  listChatLog(agent = null, limit = 120) {
    const rows = agent
      ? this.db.prepare('SELECT agent, sender, text, time, seq FROM chat_messages WHERE agent = ? ORDER BY rowid DESC LIMIT ?').all(agent, limit)
      : this.db.prepare('SELECT agent, sender, text, time, seq FROM chat_messages ORDER BY rowid DESC LIMIT ?').all(limit);
    return rows.reverse();
  }
  setChatSession(agent, sessionId) {
    this.db.prepare('INSERT INTO chat_sessions(agent, session_id) VALUES(?, ?) ON CONFLICT(agent) DO UPDATE SET session_id = excluded.session_id')
      .run(agent, sessionId);
  }
  getChatSession(agent) {
    const row = this.db.prepare('SELECT session_id FROM chat_sessions WHERE agent = ?').get(agent);
    return row ? row.session_id : null;
  }
  /** Buang pesan lama, simpan hanya `keep` pesan terakhir per agen. */
  pruneMessages(agent, keep = 200) {
    this.db.prepare(
      `DELETE FROM chat_messages WHERE agent = ? AND seq <= (
         SELECT COALESCE(MAX(seq), 0) - ? FROM chat_messages WHERE agent = ?
       )`
    ).run(agent, keep, agent);
  }
  /** Agen yang pesan terakhirnya dari user (belum dibalas) — dipakai saat boot. */
  listUnansweredAgents() {
    return this.db.prepare(
      `SELECT agent, sender FROM chat_messages
       WHERE (agent, seq) IN (SELECT agent, MAX(seq) FROM chat_messages GROUP BY agent)`
    ).all();
  }

  /* ---------------- profiles / projects / tasks ---------------- */
  listProfiles() {
    return this.db.prepare('SELECT name, description, model FROM profiles ORDER BY rowid').all();
  }
  upsertProfile(p) {
    this.db.prepare('INSERT INTO profiles(name, description, model, created_at) VALUES(?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET description = excluded.description, model = excluded.model')
      .run(p.name, p.description || null, p.model || null, Math.floor(Date.now() / 1000));
  }
  seedDefaultProfiles() {
    const existing = this.db.prepare('SELECT COUNT(*) AS n FROM profiles').get().n;
    if (existing > 0) return false;
    for (const p of DEFAULT_PROFILES) this.upsertProfile(p);
    return true;
  }

  listProjects() {
    return this.db.prepare('SELECT id, name, key, created_at FROM projects ORDER BY created_at DESC').all();
  }

  listTasks() {
    return this.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all();
  }
  getTask(id) {
    return this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) || null;
  }
  createTask(t) {
    this.db.prepare(
      `INSERT INTO tasks(id, title, body, assignee, priority, status, created_at, updated_at, completed_at, latest_summary, result)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      t.id, t.title, t.body || null, t.assignee || null, t.priority || 0, t.status,
      t.created_at, t.updated_at, t.completed_at || null, t.latest_summary || null, t.result || null
    );
    return this.getTask(t.id);
  }
  updateTask(id, patch) {
    const existing = this.getTask(id);
    if (!existing) return null;

    const fields = [];
    const values = [];
    for (const key of ['title', 'body', 'assignee', 'priority', 'status', 'completed_at', 'latest_summary', 'result', 'updated_at']) {
      if (patch[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(patch[key]);
      }
    }
    // Transisi ke done: isi completed_at bila belum ada (idempotent).
    if (patch.status === 'done' && !existing.completed_at && patch.completed_at === undefined) {
      fields.push('completed_at = ?');
      values.push(patch.updated_at || Math.floor(Date.now() / 1000));
    }
    if (!fields.length) return this.getTask(id);
    values.push(id);
    this.db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getTask(id);
  }
}

/**
 * Migrasi chat-state.json lama (jika ada) ke SQLite.
 * Idempotent: message yang sudah ada (agent, seq) tidak ditimpa.
 */
function migrateLegacy(store, legacyPath) {
  if (!fs.existsSync(legacyPath)) return { migrated: false, reason: 'file tidak ada' };
  if (store.getMeta('legacy_chat_state_migrated') === '1') return { migrated: false, reason: 'sudah dimigrasi sebelumnya' };

  let data;
  try {
    data = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
  } catch (err) {
    return { migrated: false, reason: 'gagal membaca JSON: ' + err.message };
  }

  const agents = (data && data.agents) || {};
  let messages = 0;
  let sessions = 0;

  for (const [agent, st] of Object.entries(agents)) {
    if (!st || typeof st !== 'object') continue;
    if (st.session) {
      store.setChatSession(agent, String(st.session));
      sessions += 1;
    }
    const msgs = Array.isArray(st.messages) ? st.messages : [];
    for (const m of msgs) {
      if (!m || typeof m !== 'object') continue;
      const text = String(m.text == null ? '' : m.text).slice(0, 10000);
      if (!text) continue;
      store.appendMessage(agent, m.sender === 'user' ? 'user' : 'ai', text, m.time || '');
      messages += 1;
    }
  }

  store.setMeta('legacy_chat_state_migrated', '1');
  return { migrated: true, messages, sessions };
}

/** Util id task. */
function newTaskId() {
  return 'tsk-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');
}

module.exports = { Store, migrateLegacy, newTaskId, DEFAULT_PROFILES, SCHEMA };