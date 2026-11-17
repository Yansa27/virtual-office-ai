/**
 * views.js — registry view + render pipeline (dipecah dari app.js monolit).
 * Isi tiap fungsi dijaga identik dengan versi monolit agar perilaku UI tidak berubah.
 */
import { $, $$, state, TITLES, COL_ICON, COL_LABEL, esc, timeAgo, initials, avatarBg, toast } from './core.js';
import { api, fetchJson, allTasks, presenceFor } from './api.js';
import { viewKantor, bindOffice, recordOfficeTaskChanges } from './engine.js';
import { initAgentSimulations, runSimLoop } from './waypoint.js';
import { viewChat, bindChat } from './chat.js';
import { viewBoard, bindBoard } from './board.js';

function memberCard(p) {
  const pres = presenceFor(p.name);
  const label = pres === 'busy' ? 'Sibuk' : pres === 'on' ? 'Siap' : 'Santai';
  const taskCount = allTasks().filter((t) => t.assignee === p.name && t.status !== 'done').length;
  const sim = state.agentsSim[p.name];
  const loc = sim ? sim.room : 'Kantor';

  return `
    <div class="card member">
      <div class="member-top">
        <div class="member-av" style="background:${avatarBg(p.name)}">${esc(initials(p.name))}</div>
        <div>
          <div class="member-name">${esc(p.name)}</div>
          <div class="member-role">${esc(p.description || p.model || '')}</div>
        </div>
        <div class="presence"><span class="dot ${pres}"></span>${label}</div>
      </div>
      <div class="member-meta">
        <div>Lokasi<br><b style="color:var(--warm)">📍 ${esc(loc)}</b></div>
        <div>Task Aktif<br><b>${taskCount}</b></div>
        <div>Model<br><b>${esc(p.model ? p.model.split('/')[0].trim() : '-')}</b></div>
      </div>
      <div class="member-foot">
        <button class="btn primary block" data-chat-agent="${esc(p.name)}">
          <span>💬 Chat Agen</span>
        </button>
      </div>
    </div>`;
}

export function viewDashboard() {
  const tasks = allTasks();
  const done = tasks.filter((t) => t.status === 'done').length;
  const active = tasks.filter((t) => ['ready', 'running', 'review'].includes(t.status)).length;
  const running = tasks.filter((t) => t.status === 'running').length;
  const online = state.profiles.filter((p) => presenceFor(p.name) !== 'off').length;

  const stats = [
    { n: tasks.length, l: 'Total Task', ic: '📋', c: 'bg-acc' },
    { n: running, l: 'Lagi Dikerjakan', ic: '⚡', c: 'bg-warn' },
    { n: active, l: 'Antrian Aktif', ic: '▶', c: 'bg-idle' },
    { n: done, l: 'Selesai', ic: '✅', c: 'bg-ok' },
    { n: `${online}/${state.profiles.length}`, l: 'Agen Aktif', ic: '👥', c: 'bg-acc' },
  ];

  const recent = tasks.slice().sort((a, b) => (b.created_at || 0) - (a.created_at || 0)).slice(0, 5);

  return `
    <!-- Quick Action Banner -->
    <div class="action-banner">
      <div>
        <div class="ab-title">Selamat datang di Jasvero Virtual Office 2.0 ✨</div>
        <div class="ab-sub">Kantor AI 2D retro dengan autonomous agents yang bisa kerja, rapat, dan ngopi di pantry.</div>
      </div>
      <div class="ab-btns">
        <button class="btn primary" data-go="kantor">
          <span>Buka Kantor 2D</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </button>
        <button class="btn warm-btn" data-go="chat">
          <span>💬 Buka Chat AI</span>
        </button>
      </div>
    </div>

    <!-- Stat Grid -->
    <div class="grid stat">
      ${stats.map((s) => `
        <div class="card">
          <div class="stat-ic ${s.c}">${s.ic}</div>
          <div class="stat-num">${s.n}</div>
          <div class="stat-lbl">${s.l}</div>
        </div>`).join('')}
    </div>

    <!-- Tim Overview -->
    <div class="section-title">
      <h2>Tim Agen AI</h2>
      <button class="ghost" data-go="tim">Lihat semua tim →</button>
    </div>
    <div class="grid team">
      ${state.profiles.slice(0, 4).map((p) => memberCard(p)).join('') || '<div class="empty">Belum ada agen.</div>'}
    </div>

    <!-- Recent Activity -->
    <div class="section-title">
      <h2>Aktivitas Terbaru</h2>
      <button class="ghost" data-go="board">Buka Board Kanban →</button>
    </div>
    <div class="act">
      ${recent.map((t) => `
        <div class="act-item">
          <div class="act-ic">${COL_ICON[t.status] || '•'}</div>
          <div>
            <div class="act-txt">${esc(t.title)}</div>
            <div class="act-time">${esc(t.assignee || 'belum di-assign')} · ${COL_LABEL[t.status] || t.status} · ${timeAgo(t.created_at)}</div>
          </div>
        </div>`).join('') || '<div class="empty">Belum ada task.</div>'}
    </div>
  `;
}

export function viewTim() {
  return `
    <div class="grid team">
      ${state.profiles.map((p) => memberCard(p)).join('') || '<div class="empty">Belum ada profil agen.</div>'}
    </div>
    <div class="muted small" style="margin-top:20px;padding:12px;background:var(--panel2);border-radius:10px;border:1px solid var(--line)">
      📌 <b>Status Kerja:</b> <b>Sibuk</b> = sedang running task di komputer meja, <b>Siap</b> = ada antrian task, <b>Santai</b> = lagi kosong & bisa diajak ngopi atau rapat.
    </div>
  `;
}

export function viewProyek() {
  const list = state.projects || [];
  if (!list.length) {
    return `<div class="empty">Belum ada proyek. Proyek otomatis tersinkronisasi dari board.</div>`;
  }
  return `
    <div class="grid proj">
      ${list.map((p) => `
        <div class="card">
          <div class="member-top">
            <div class="member-av" style="background:${avatarBg(p.name)}">${esc(initials(p.name))}</div>
            <div>
              <div class="member-name">${esc(p.name)}</div>
              <div class="member-role">${esc(p.key || 'Inisiatif Aktif')}</div>
            </div>
          </div>
        </div>`).join('')}
    </div>`;
}

/* --- Helper log: kunci baris, filter, dan signature untuk deteksi perubahan --- */
const LOG_ROW_KEY = (m) => `${m.agent}:${m.seq}`;

function filteredLogRows(log, filter = 'all') {
  return (Array.isArray(log) ? log : []).filter(
    (m) => m && m.agent && (filter === 'all' || m.agent === filter),
  );
}

function busySignature(busy) {
  return Object.keys(busy || {}).sort().join(',');
}

function logSignature(log, busy) {
  const rows = Array.isArray(log) ? log.map(LOG_ROW_KEY).join('|') : '';
  return `${rows};${busySignature(busy)}`;
}

/* Snapshot & pemulihan posisi scroll feed agar auto-refresh tidak meloncat ke atas. */
function logScrollSnapshot() {
  const feed = $('#logFeed');
  if (!feed) return null;
  return { top: feed.scrollTop, height: feed.scrollHeight, client: feed.clientHeight };
}

function restoreLogScroll(snap) {
  const feed = $('#logFeed');
  if (!feed || !snap) return;
  const nearBottom = snap.height - snap.top - snap.client < 80;
  if (nearBottom) {
    feed.scrollTop = feed.scrollHeight;
    return;
  }
  // Posisi baca lama dipakai kembali tanpa syarat; clamp hanya kalau konten baru lebih pendek.
  const maxTop = Math.max(0, feed.scrollHeight - feed.clientHeight);
  feed.scrollTop = Math.min(snap.top, maxTop);
}

function updateLogCount(n) {
  const el = $('.log-count');
  if (el) el.textContent = `${n} pesan`;
}

export function viewLog() {
  const agents = (state.profiles.length
    ? state.profiles
    : ['pm', 'sales', 'dev', 'qa', 'marketing'].map((name) => ({ name })))
    .filter((p) => p && p.name && p.name !== 'default');
  const filter = state.logFilter || 'all';
  const rows = filteredLogRows(state.chatLog, filter);

  const chips = [
    `<button class="log-chip ${filter === 'all' ? 'active' : ''}" data-log-filter="all" aria-pressed="${filter === 'all'}">Semua</button>`,
    ...agents.map(
      (p) => `<button class="log-chip ${filter === p.name ? 'active' : ''}" data-log-filter="${esc(p.name)}" aria-pressed="${filter === p.name}">${esc(p.name)}</button>`,
    ),
  ].join('');

  return `
    <div class="log-wrap">
      <div class="log-head">
        <div class="log-head-txt"><span class="live-dot pulse"></span> Log live · auto-refresh 4 detik</div>
        <div class="log-count">${rows.length} pesan</div>
      </div>
      <div class="log-chips" role="group" aria-label="Filter agen">${chips}</div>
      <div id="logFeed" class="log-feed" role="log" aria-live="polite" aria-label="Riwayat log aktivitas">
        ${rows.length
          ? rows.map(logItem).join('')
          : '<div class="log-empty">Belum ada log. Kirim tugas lewat Chat AI, lalu pantau di sini.</div>'}
      </div>
    </div>`;
}

function logItem(m) {
  const p = state.profiles.find((x) => x.name === m.agent) || { name: m.agent };
  const isUser = m.sender === 'user';
  const senderLabel = isUser ? 'Kamu' : p.name;
  const busy = state.chatBusy && state.chatBusy[m.agent];
  return `
    <article class="log-item ${isUser ? 'from-user' : 'from-agent'}">
      <div class="avatar log-av" style="background:${avatarBg(m.agent)}">${esc(initials(m.agent))}</div>
      <div class="log-body">
        <div class="log-top">
          <span class="log-name">${esc(p.name)}</span>
          <span class="log-badge ${isUser ? 'b-user' : 'b-ai'}">${esc(senderLabel)}</span>
          ${busy ? '<span class="log-badge b-busy">⏳ sibuk</span>' : ''}
          <span class="log-time">${esc(m.time || '')}</span>
        </div>
        <div class="log-text">${isUser ? esc(m.text) : mdText(m.text)}</div>
        <div class="log-actions">
          <button class="log-chat" data-chat-agent="${esc(m.agent)}">💬 Chat ${esc(p.name)}</button>
        </div>
      </div>
    </article>`;
}

export function viewMonitor() {
  const tasks = allTasks();
  const running = tasks.filter((t) => t.status === 'running').length;
  const active = tasks.filter((t) => ['ready', 'review'].includes(t.status)).length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const busyAgents = state.profiles.filter((p) => presenceFor(p.name) === 'busy').length;

  const stats = [
    { n: tasks.length, l: 'Total Task', ic: '📋', c: 'bg-acc' },
    { n: running, l: 'Lagi Dikerjakan', ic: '⚡', c: 'bg-warn' },
    { n: `${busyAgents}/${state.profiles.length}`, l: 'Agen Sibuk', ic: '👥', c: 'bg-bad' },
    { n: active, l: 'Siap / Review', ic: '▶', c: 'bg-idle' },
    { n: done, l: 'Selesai', ic: '✅', c: 'bg-ok' },
  ];

  return `
    <div class="grid stat">
      ${stats.map((s) => `
        <div class="card">
          <div class="stat-ic ${s.c}">${s.ic}</div>
          <div class="stat-num">${s.n}</div>
          <div class="stat-lbl">${s.l}</div>
        </div>`).join('')}
    </div>
    <p class="muted small" style="margin:-6px 0 16px">Auto-refresh tiap 5 detik · Pantau kinerja agen secara live.</p>
    <div class="grid team">
      ${state.profiles.map((p) => monitorCard(p)).join('')}
    </div>
  `;
}

function monitorCard(p) {
  const pres = presenceFor(p.name);
  const label = pres === 'busy' ? 'Sibuk' : pres === 'on' ? 'Siap' : 'Santai';
  const active = allTasks().filter((t) => t.assignee === p.name && t.status !== 'done');
  const done = allTasks().filter((t) => t.assignee === p.name && t.status === 'done').slice(0, 2);

  return `
    <div class="card member">
      <div class="member-top">
        <div class="member-av" style="background:${avatarBg(p.name)}">${esc(initials(p.name))}</div>
        <div>
          <div class="member-name">${esc(p.name)}</div>
          <div class="member-role">${esc(p.description || p.model || '')}</div>
        </div>
        <div class="presence"><span class="dot ${pres}"></span>${label}</div>
      </div>
      <div class="ap-body" style="padding:12px 0 0">
        ${active.length ? active.map((t) => `
          <div class="ap-task">
            <span class="dot ${pres}"></span>
            <div>
              <div style="font-weight:600">${esc(t.title)}</div>
              <div class="st">${COL_LABEL[t.status] || t.status} · ${timeAgo(t.updated_at || t.created_at)}</div>
            </div>
          </div>`).join('') : '<div class="ap-empty">Sedang kosong / siap terima task.</div>'}
      </div>
      ${done.length ? `<div class="member-meta"><div style="flex-basis:100%">Baru selesai: <b>${esc(done[0].title)}</b></div></div>` : ''}
    </div>`;
}

export function viewHasil() {
  const tasks = allTasks().filter((t) => t.status === 'done')
    .sort((a, b) => (b.completed_at || b.updated_at || b.created_at || 0) - (a.completed_at || a.updated_at || a.created_at || 0));

  if (!tasks.length) {
    return '<div class="empty">Belum ada hasil kerja selesai. Buat task di board untuk mulai menghasilkan output.</div>';
  }
  return `
    <p class="muted small" style="margin:-6px 0 16px">Klik kartu di bawah untuk membaca dokumen & deliverable hasil kerja agen.</p>
    <div class="grid hasil-grid">
      ${tasks.map((t) => `
        <button class="card hasil-card" data-hasil="${esc(t.id)}">
          <div class="hasil-top">
            <div class="member-av" style="background:${avatarBg(t.assignee || 'default')}">${esc(initials(t.assignee || '?'))}</div>
            <div>
              <div class="member-name">${esc(t.title)}</div>
              <div class="member-role">${esc(t.assignee || '-')} · ${timeAgo(t.completed_at || t.updated_at || t.created_at)}</div>
            </div>
            <span class="task-assignee">Buka →</span>
          </div>
          <div class="hasil-snippet">${esc((t.latest_summary || t.result || t.body || '').slice(0, 180))}</div>
        </button>`).join('')}
    </div>
  `;
}

export function viewHasilDetail() {
  const t = allTasks().find((x) => x.id === state.hasilId);
  if (!t) return '<div class="empty">Hasil tidak ditemukan.</div>';
  const d = state.hasilDetail || t;
  const body = d.latest_summary || d.result || t.body || '';

  return `
    <button class="ghost" data-back style="margin-bottom:16px">← Kembali ke daftar hasil</button>
    <div class="card">
      <div class="hasil-top">
        <div class="member-av" style="background:${avatarBg(t.assignee || 'default')}">${esc(initials(t.assignee || '?'))}</div>
        <div>
          <h2 style="font-size:20px">${esc(t.title)}</h2>
          <div class="member-role">${esc(d.assignee || t.assignee || '-')} · Selesai ${timeAgo(d.completed_at || d.updated_at || t.completed_at || t.created_at)}</div>
        </div>
      </div>
      <div class="hasil-body">${body ? mdText(body) : '<span class="muted">Memuat konten lengkap…</span>'}</div>
      ${d.result ? `<div class="member-meta" style="margin-top:20px"><div><b>Output:</b> ${esc(d.result)}</div></div>` : ''}
    </div>
  `;
}

export async function openHasil(id) {
  state.hasilId = id;
  state.hasilDetail = null;
  render();
  window.scrollTo(0, 0);
  try {
    const d = await api('/tasks/' + id);
    state.hasilDetail = (d && d.task) || d || null;
    if (state.view === 'hasil') render();
  } catch (e) {
    toast(e.message, 'bad');
  }
}

function bindHasil() {
  $$('[data-hasil]').forEach((b) => b.addEventListener('click', () => openHasil(b.dataset.hasil)));
  $$('[data-back]').forEach((b) => b.addEventListener('click', () => { state.hasilId = null; state.hasilDetail = null; render(); }));
}

function mdText(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/^#{1,3}\s+(.*)$/gm, '<strong>$1</strong>')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\n/g, '<br>');
}

export function render() {
  const [title, sub] = TITLES[state.view] || TITLES.dashboard;
  $('#title').textContent = title;
  $('#sub').textContent = sub;

  // Update Fleet Status
  const busyCount = state.profiles.filter((p) => presenceFor(p.name) === 'busy').length;
  $('#sideFleetStatus').textContent = `${state.profiles.length} Agen (${busyCount} Sibuk)`;

  const v = $('#view');
  if (state.view === 'dashboard') {
    v.innerHTML = viewDashboard();
  } else if (state.view === 'kantor') {
    v.innerHTML = viewKantor();
    bindOffice();
    runSimLoop();
  } else if (state.view === 'chat') {
    v.innerHTML = viewChat();
    bindChat();
  } else if (state.view === 'tim') {
    v.innerHTML = viewTim();
  } else if (state.view === 'board') {
    v.innerHTML = viewBoard();
    bindBoard();
  } else if (state.view === 'proyek') {
    v.innerHTML = viewProyek();
  } else if (state.view === 'hasil') {
    v.innerHTML = state.hasilId ? viewHasilDetail() : viewHasil();
    bindHasil();
  } else if (state.view === 'monitor') {
    v.innerHTML = viewMonitor();
    if (state.monitorTimer) clearInterval(state.monitorTimer);
    state.monitorTimer = setInterval(async () => {
      try {
        const [board, workflow] = await Promise.all([api('/board'), api('/workflow')]);
        state.board = board;
        state.workflow = workflow;
        if (state.view === 'monitor') render();
      } catch {}
    }, 5000);
  } else if (state.view === 'log') {
    v.innerHTML = viewLog();
    if (!state.logTimer) {
      loadChatLog();
      state.logTimer = setInterval(() => loadChatLog(), 4000);
    }
  } else {
    if (state.monitorTimer) { clearInterval(state.monitorTimer); state.monitorTimer = null; }
    if (state.logTimer) { clearInterval(state.logTimer); state.logTimer = null; }
  }
}

export async function load() {
  try {
    const [board, workflow, profiles, stats, projects] = await Promise.all([
      api('/board'), api('/workflow'), api('/profiles'), api('/stats'), api('/projects'),
    ]);
    state.board = board;
    state.workflow = workflow;
    state.profiles = (profiles.profiles || []).filter((p) => !p.is_default);
    state.stats = stats;
    state.projects = projects.projects || [];

    recordOfficeTaskChanges();

    // Inisialisasi posisi simulasi agen jika belum ada
    initAgentSimulations();

    render();
  } catch (e) {
    toast(e.message, 'bad');
  }
}

/**
 * Ganti isi feed log + counter tanpa render() total, jadi fokus pada chip filter
 * tidak hilang dan scroll tidak meloncat. Dipakai saat user memilih filter agen.
 */
export function applyLogFilter() {
  const wrap = $('.log-wrap');
  if (!wrap) return;
  const filter = state.logFilter || 'all';
  $$('.log-chip', wrap).forEach((c) => {
    const on = c.dataset.logFilter === filter;
    c.classList.toggle('active', on);
    c.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const rows = filteredLogRows(state.chatLog, filter);
  const feed = $('#logFeed');
  if (feed) {
    feed.innerHTML = rows.length
      ? rows.map(logItem).join('')
      : '<div class="log-empty">Belum ada log untuk filter ini. Coba agen lain atau kirim tugas baru.</div>';
  }
  updateLogCount(rows.length);
}

async function loadChatLog() {
  let d;
  try {
    d = await fetchJson('/api/chat/log');
  } catch {
    return;
  }

  const nextLog = Array.isArray(d.log) ? d.log : [];
  const nextBusy = d.busy || {};
  const sig = logSignature(nextLog, nextBusy);

  // Tidak ada pesan/status baru → jangan sentuh DOM (feed stabil, scroll aman).
  if (sig === state.logSig) return;

  const firstLoad = state.logSig == null;
  const prevLog = state.chatLog;
  const prevBusy = state.chatBusy;
  const filter = state.logFilter || 'all';
  const prevRows = filteredLogRows(prevLog, filter);
  const snap = logScrollSnapshot();

  state.chatLog = nextLog;
  state.chatBusy = nextBusy;
  state.logSig = sig;

  if (state.view !== 'log') return; // render() berikutnya akan memakai data baru

  const nextRows = filteredLogRows(nextLog, filter);
  const busyChanged = busySignature(prevBusy) !== busySignature(nextBusy);
  const rowsUnchanged = prevRows.length === nextRows.length
    && prevRows.every((m, i) => LOG_ROW_KEY(m) === LOG_ROW_KEY(nextRows[i]));
  const appendOnly = nextRows.length > prevRows.length
    && prevRows.every((m, i) => LOG_ROW_KEY(m) === LOG_ROW_KEY(nextRows[i]));

  if (firstLoad) {
    render();
    return;
  }

  if (!busyChanged && rowsUnchanged) {
    updateLogCount(nextRows.length);
    return;
  }

  if (!busyChanged && appendOnly) {
    // Patch in-place: hanya node item baru yang dibuat, scroll position dipertahankan.
    const feed = $('#logFeed');
    if (feed) {
      if (!prevRows.length) {
        feed.innerHTML = nextRows.map(logItem).join('');
      } else {
        feed.insertAdjacentHTML('beforeend', nextRows.slice(prevRows.length).map(logItem).join(''));
      }
    }
    updateLogCount(nextRows.length);
    restoreLogScroll(snap);
    return;
  }

  // Filter berubah / data berkurang / status sibuk berubah → rebuild penuh,
  // lalu posisi baca lama diterapkan kembali ke feed baru.
  render();
  restoreLogScroll(snap);
}