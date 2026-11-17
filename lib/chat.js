/**
 * lib/chat.js — Layanan chat agen berbasis SQLite (zero npm dep).
 *
 * Menggantikan chat-state.json + fs.writeFileSync yang rentan lost-update
 * saat dua agen membalas bersamaan. Semua read/append lewat Store (SQLite,
 * WAL + busy_timeout), dan operasi DB sinkron di event loop tunggal Node,
 * sehingga tidak ada interleaving read-modify-write.
 *
 * CHAT_BUSY adalah lock in-memory per agen: mencegah dua pesan user
 * diproses bersamaan oleh agen yang sama.
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function chatNow() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/** Bersihkan noise stdout hermes (session_id, spinner, dsb). */
function cleanAgentOutput(raw) {
  return String(raw || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^session_id:\s*/i.test(l))
    .filter((l) => !/^[↻⟳]/.test(l))
    .filter((l) => !/^Model restored from session/i.test(l))
    .join('\n')
    .trim();
}

class ChatService {
  /**
   * @param {import('./store').Store} store
   * @param {object} config
   * @param {object} [log]
   */
  constructor(store, config, log = console) {
    this.store = store;
    this.config = config;
    this.log = log;
    this.agents = new Set(config.chatAgents || []);
    this.busy = new Set();
    /** @type {Map<string, import('child_process').ChildProcess>} */
    this.children = new Map();
    this.closed = false;
  }

  isAgent(name) {
    return this.agents.has(name);
  }

  isBusy(name) {
    return this.busy.has(name);
  }

  history(name, limit = 200) {
    return this.store.getMessages(name, limit);
  }

  /** Log aktivitas lintas agen (percakapan tugas) — urut lama -> baru. */
  logActivity(agent = null, limit = 120) {
    return this.store.listChatLog(agent, limit);
  }

  session(name) {
    return this.store.getChatSession(name);
  }

  /**
   * Saat boot: pesan user terakhir yang belum dibalas diberi catatan,
   * supaya user tahu sesi sebelumnya terputus (server restart).
   */
  bootstrap() {
    for (const row of this.store.listUnansweredAgents()) {
      if (row && row.sender === 'user') {
        this.store.appendMessage(row.agent, 'ai', 'Sesi chat terputus (server restart). Silakan kirim ulang pesanmu.', chatNow());
        this.store.pruneMessages(row.agent, 200);
      }
    }
  }

  /**
   * Antre pesan user ke agen.
   * @returns {{queued: boolean, busy: boolean, reason?: string}}
   */
  send(name, text) {
    if (this.closed) return { queued: false, busy: false, reason: 'closed' };
    if (this.busy.has(name)) return { queued: false, busy: true, reason: 'busy' };
    if (!this.agents.has(name)) return { queued: false, busy: false, reason: 'unknown-agent' };

    this.store.appendMessage(name, 'user', text, chatNow());
    this.store.pruneMessages(name, 200);
    this.busy.add(name);
    // fire-and-forget: handler HTTP langsung bisa membalas 202.
    this._spawn(name, text);
    return { queued: true, busy: true };
  }

  _spawn(name, text) {
    const st = { session: this.store.getChatSession(name) };
    const workspace = path.join(this.config.chatWorkspaces, name);
    fs.mkdirSync(workspace, { recursive: true });

    const args = ['-p', name, 'chat', '-q', text, '-Q', '--in', workspace];
    if (st.session) args.push('--resume', st.session);

    const env = {
      ...process.env,
      HERMES_PROFILE: name,
      HERMES_SCRATCH_DIR: process.env.HERMES_SCRATCH_DIR || '/home/ubuntu/.hermes/cache/scratch',
      HERMES_REAL_HOME: process.env.HERMES_REAL_HOME || '/home/ubuntu',
    };
    delete env.HERMES_TUI;
    delete env.HERMES_SESSION_SOURCE;

    let out = '';
    let err = '';
    let finished = false;
    let timer = null;
    const self = this;

    const finish = (reply) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      self.store.appendMessage(name, 'ai', reply, chatNow());
      self.store.pruneMessages(name, 200);
      self.busy.delete(name);
      self.children.delete(name);
    };

    let child;
    try {
      child = spawn(this.config.hermesBin, args, { cwd: workspace, env });
    } catch (e) {
      finish('Gagal menjalankan agen: ' + (e.message || e));
      return;
    }
    this.children.set(name, child);

    timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* abaikan */ }
      finish('Agen membutuhkan waktu terlalu lama dan dihentikan. Coba lagi.');
    }, this.config.chatTimeoutMs);

    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => finish('Gagal menjalankan agen: ' + (e.message || e)));
    child.on('close', (code) => {
      const raw = out + '\n' + err;
      const m = raw.match(/session_id:\s*([^\s]+)/i);
      if (m) {
        st.session = m[1];
        self.store.setChatSession(name, m[1]);
      }
      let reply = cleanAgentOutput(out);
      if (!reply) {
        reply = code === 0
          ? 'Agen tidak mengembalikan jawaban.'
          : `Agen berhenti (kode ${code}). ${cleanAgentOutput(err) || 'Coba lagi.'}`;
      }
      finish(reply);
    });
  }

  /** Hentikan semua child agent (dipakai saat graceful shutdown). */
  close(timeoutMs = 4000) {
    this.closed = true;
    const kids = Array.from(this.children.entries());
    if (!kids.length) return Promise.resolve();
    for (const [, child] of kids) {
      try { child.kill('SIGTERM'); } catch { /* abaikan */ }
    }
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve) => {
      const tick = setInterval(() => {
        const alive = Array.from(this.children.values()).filter((c) => c.exitCode === null && c.signalCode === null);
        if (!alive.length || Date.now() >= deadline) {
          clearInterval(tick);
          for (const c of alive) {
            try { c.kill('SIGKILL'); } catch { /* abaikan */ }
          }
          resolve();
        }
      }, 100);
    });
  }
}

module.exports = { ChatService, chatNow, cleanAgentOutput };
