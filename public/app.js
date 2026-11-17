/* Virtual Office — Jasvero Digital */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const state = {
  view: 'dashboard',
  board: null,
  workflow: null,
  profiles: [],
  stats: null,
  projects: [],
  hasilId: null,
  hasilDetail: null,
};

const COL_ICON = { triage: '◇', todo: '◻', scheduled: '⏱', ready: '▶', running: '●', blocked: '⊘', review: '◎', done: '✓' };
const COL_LABEL = { triage: 'Triage', todo: 'Todo', scheduled: 'Scheduled', ready: 'Ready', running: 'Running', blocked: 'Blocked', review: 'Review', done: 'Done' };
const PRIO = { 0: '', 1: 'Penting', 2: 'Mendesak' };

const TITLES = {
  dashboard: ['Dashboard', 'Ringkasan kantor & aktivitas tim'],
  kantor: ['Kantor', 'Denah kantor virtual — tap orangnya buat lihat aktivitas'],
  tim: ['Tim', 'Siapa saja yang di kantor virtual ini'],
  board: ['Board', 'Seret card ke kolom lain buat ubah status'],
  proyek: ['Proyek', 'Proyek yang sedang digarap Jasvero Digital'],
  monitor: ['Monitor', 'Pantau tugas & hasil kerja agen secara live'],
  hasil: ['Hasil', 'Hasil kerja agen — deliverable yang sudah selesai'],
};

/* Dudukan agen di denah (koordinat SVG 1200x760) */
const SEATS = {
  pm:        { x: 215, y: 190, room: 'Lobby',       w: { dx: -55, dy: -15 } },
  sales:     { x: 180, y: 318, room: 'Lobby',       w: { dx:  70, dy: -18 } },
  dev:       { x: 520, y: 150, room: 'Ruang Dev',   w: { dx:  55, dy:  55 } },
  qa:        { x: 1000,y: 150, room: 'Ruang Dev',   w: { dx: -55, dy:  55 } },
  marketing: { x: 140, y: 470, room: 'Ruang Kreatif', w: { dx: 75, dy:   0 } },
  default:   { x: 700, y: 150, room: 'Ruang Dev',   w: { dx: -55, dy:  55 } },
};

/* ---------------- helpers ---------------- */
function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return s + ' dtk lalu';
  if (s < 3600) return Math.floor(s / 60) + ' mnt lalu';
  if (s < 86400) return Math.floor(s / 3600) + ' jam lalu';
  return Math.floor(s / 86400) + ' hari lalu';
}
function fmtDate(ts) {
  if (!ts) return '-';
  return new Date(ts * 1000).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function initials(n) {
  const p = String(n || '?').split(/[\s_-]+/).filter(Boolean);
  return ((p[0] ? p[0][0] : '?') + (p[1] ? p[1][0] : '')).toUpperCase();
}

/* warna avatar per agen — biar gak ada yang kebetulan sama */
const AV_GRAD = {
  pm: ['#22d3ee', '#0ea5e9'],
  sales: ['#fbbf24', '#f97316'],
  dev: ['#8b5cf6', '#6366f1'],
  qa: ['#34d399', '#10b981'],
  marketing: ['#f472b6', '#ec4899'],
  default: ['#94a3b8', '#64748b'],
};
function avatarColors(name) { return AV_GRAD[name] || ['#22d3ee', '#6366f1']; }
function avatarBg(name) { const [a, b] = avatarColors(name); return `linear-gradient(135deg,${a},${b})`; }

let toastTimer;
function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3200);
}

async function api(path, opts = {}) {
  const res = await fetch('/api/kanban' + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  let data = null;
  try { data = await res.json(); } catch {}
  if (res.status === 401) { showLogin(); throw new Error('Sesi habis, login lagi.'); }
  if (!res.ok) {
    const msg = (data && (data.error || (Array.isArray(data.detail) ? data.detail[0]?.msg : data.detail))) || ('HTTP ' + res.status);
    throw new Error(msg);
  }
  return data;
}

/* ---------------- data ---------------- */
async function load() {
  try {
    const [board, workflow, profiles, stats, projects] = await Promise.all([
      api('/board'), api('/workflow'), api('/profiles'), api('/stats'), api('/projects'),
    ]);
    state.board = board;
    state.workflow = workflow;
    state.profiles = profiles.profiles || [];
    state.stats = stats;
    state.projects = projects.projects || [];
    render();
  } catch (e) {
    toast(e.message, 'bad');
  }
}

function boardColumns() {
  const wf = (state.workflow && state.workflow.columns) || [];
  const cols = (state.board && state.board.columns) || [];
  const byName = Object.fromEntries(cols.map((c) => [c.name, c.tasks || []]));
  if (wf.length) {
    return wf.map((w) => ({ key: w.key, label: w.label || COL_LABEL[w.key] || w.key, icon: w.icon || COL_ICON[w.key] || '•', tasks: byName[w.key] || [] }));
  }
  return cols.map((c) => ({ key: c.name, label: COL_LABEL[c.name] || c.name, icon: COL_ICON[c.name] || '•', tasks: c.tasks || [] }));
}
function allTasks() {
  return boardColumns().flatMap((c) => c.tasks);
}
function presenceFor(name) {
  const cols = boardColumns();
  if (cols.some((c) => c.key === 'running' && c.tasks.some((t) => t.assignee === name))) return 'busy';
  if (cols.some((c) => ['ready', 'review'].includes(c.key) && c.tasks.some((t) => t.assignee === name))) return 'on';
  return 'off';
}
function currentTask(name) {
  const order = { running: 0, blocked: 1, review: 2, ready: 3, scheduled: 4, todo: 5, triage: 6 };
  const list = allTasks().filter((t) => t.assignee === name && t.status !== 'done');
  if (!list.length) return null;
  return list.slice().sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9))[0];
}

/* ---------------- views ---------------- */
function render() {
  const [title, sub] = TITLES[state.view] || TITLES.dashboard;
  $('#title').textContent = title;
  $('#sub').textContent = sub;
  const v = $('#view');
  if (state.view === 'dashboard') v.innerHTML = viewDashboard();
  else if (state.view === 'kantor') { v.innerHTML = viewKantor(); bindOffice(); }
  else if (state.view === 'tim') v.innerHTML = viewTim();
  else if (state.view === 'board') { v.innerHTML = viewBoard(); bindBoard(); }
  else if (state.view === 'proyek') v.innerHTML = viewProyek();
  else if (state.view === 'hasil') {
    v.innerHTML = state.hasilId ? viewHasilDetail() : viewHasil();
    bindHasil();
  }
  else if (state.view === 'monitor') {
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
  } else if (state.monitorTimer) {
    clearInterval(state.monitorTimer);
    state.monitorTimer = null;
  }
}

/* ---------------- monitor live ---------------- */
function monitorCard(p) {
  const pres = presenceFor(p.name);
  const label = pres === 'busy' ? 'Sibuk' : pres === 'on' ? 'Siap' : 'Santai';
  const active = allTasks().filter((t) => t.assignee === p.name && t.status !== 'done')
    .sort((a, b) => ({ running: 0, blocked: 1, review: 2, ready: 3, scheduled: 4, todo: 5, triage: 6 }[a.status] ?? 9) - ({ running: 0, blocked: 1, review: 2, ready: 3, scheduled: 4, todo: 5, triage: 6 }[b.status] ?? 9));
  const done = allTasks().filter((t) => t.assignee === p.name && t.status === 'done')
    .sort((a, b) => (b.updated_at || b.created_at || 0) - (a.updated_at || a.created_at || 0)).slice(0, 3);
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
              <div>${esc(t.title)}</div>
              <div class="st">${COL_LABEL[t.status] || t.status}${t.project_key ? ' · ' + esc(t.project_key) : ''} · ${timeAgo(t.updated_at || t.created_at)}</div>
            </div>
          </div>`).join('') : '<div class="ap-empty">Lagi kosong, siap disuruh kerja.</div>'}
      </div>
      ${done.length ? `<div class="member-meta"><div style="flex-basis:100%">Baru selesai: <b>${esc(done[0].title)}</b> · ${timeAgo(done[0].updated_at || done[0].created_at)}</div></div>` : ''}
    </div>`;
}

function viewMonitor() {
  const tasks = allTasks();
  const running = tasks.filter((t) => t.status === 'running').length;
  const active = tasks.filter((t) => ['ready', 'review'].includes(t.status)).length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const busyAgents = state.profiles.filter((p) => presenceFor(p.name) === 'busy').length;

  const stats = [
    { n: tasks.length, l: 'Total Task', ic: '📋', c: 'bg-acc' },
    { n: running, l: 'Lagi Dikerjakan', ic: '⚡', c: 'bg-warn' },
    { n: busyAgents + '/' + state.profiles.length, l: 'Agen Sibuk', ic: '👥', c: 'bg-bad' },
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
    <p class="muted small" style="margin:-6px 0 14px">Auto-refresh tiap 5 detik · kartu agen menampilkan task yang lagi dikerjakan dan yang baru selesai.</p>
    <div class="grid team">
      ${state.profiles.map((p) => monitorCard(p)).join('') || '<div class="empty">Belum ada profil.</div>'}
    </div>
  `;
}

/* ---------------- hasil kerja ---------------- */
function mdText(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/^#{1,3}\s+(.*)$/gm, '<strong>$1</strong>')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\n/g, '<br>');
}

function viewHasil() {
  const tasks = allTasks().filter((t) => t.status === 'done')
    .sort((a, b) => (b.completed_at || b.updated_at || b.created_at || 0) - (a.completed_at || a.updated_at || a.created_at || 0));
  if (!tasks.length) {
    return '<div class="empty">Belum ada hasil. Kasih task dulu, nanti muncul di sini.</div>';
  }
  return `
    <p class="muted small" style="margin:-6px 0 14px">Klik kartu buat baca isi hasil kerjanya.</p>
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
          <div class="hasil-snippet">${esc((t.latest_summary || t.result || '').slice(0, 180))}</div>
        </button>`).join('')}
    </div>
  `;
}

function viewHasilDetail() {
  const t = allTasks().find((x) => x.id === state.hasilId);
  if (!t) return '<div class="empty">Hasil tidak ditemukan.</div>';
  const d = state.hasilDetail || t;
  const body = d.latest_summary || d.result || t.body || '';
  const meta = [
    esc(d.assignee || t.assignee || '-'),
    'selesai ' + timeAgo(d.completed_at || d.updated_at || t.completed_at || t.updated_at || t.created_at),
    COL_LABEL[d.status || t.status] || d.status || t.status,
  ];
  return `
    <button class="ghost" data-back style="align-self:flex-start">← Kembali ke daftar hasil</button>
    <div class="card">
      <div class="hasil-top">
        <div class="member-av" style="background:${avatarBg(t.assignee || 'default')}">${esc(initials(t.assignee || '?'))}</div>
        <div>
          <h2 style="font-size:19px">${esc(t.title)}</h2>
          <div class="member-role">${meta.join(' · ')}</div>
        </div>
      </div>
      <div class="hasil-body">${body ? mdText(body) : '<span class="muted">Memuat hasil lengkap…</span>'}</div>
      ${d.result ? `<div class="member-meta"><div>Result: ${esc(d.result)}</div></div>` : ''}
    </div>
  `;
}

async function openHasil(id) {
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

function viewDashboard() {
  const tasks = allTasks();
  const done = tasks.filter((t) => t.status === 'done').length;
  const active = tasks.filter((t) => ['ready', 'running', 'review'].includes(t.status)).length;
  const blocked = tasks.filter((t) => t.status === 'blocked').length;
  const online = state.profiles.filter((p) => presenceFor(p.name) !== 'off').length;

  const stats = [
    { n: tasks.length, l: 'Total Task', ic: '📋', c: 'bg-acc' },
    { n: done, l: 'Selesai', ic: '✅', c: 'bg-ok' },
    { n: active, l: 'Aktif', ic: '⚡', c: 'bg-warn' },
    { n: blocked, l: 'Blocked', ic: '⊘', c: 'bg-bad' },
    { n: online + '/' + state.profiles.length, l: 'Tim di Kantor', ic: '👥', c: 'bg-idle' },
  ];

  const recent = tasks.slice().sort((a, b) => (b.created_at || 0) - (a.created_at || 0)).slice(0, 6);

  return `
    <div class="grid stat">
      ${stats.map((s) => `
        <div class="card">
          <div class="stat-ic ${s.c}">${s.ic}</div>
          <div class="stat-num">${s.n}</div>
          <div class="stat-lbl">${s.l}</div>
        </div>`).join('')}
    </div>

    <div class="section-title"><h2>Tim</h2><button class="ghost" data-go="kantor">Buka kantor →</button></div>
    <div class="grid team">
      ${state.profiles.map((p) => memberCard(p)).join('') || '<div class="empty">Belum ada profil.</div>'}
    </div>

    <div class="section-title"><h2>Aktivitas Terbaru</h2><button class="ghost" data-go="board">Buka board →</button></div>
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

function memberCard(p) {
  const pres = presenceFor(p.name);
  const label = pres === 'busy' ? 'Sibuk' : pres === 'on' ? 'Siap' : 'Santai';
  const count = allTasks().filter((t) => t.assignee === p.name && t.status !== 'done').length;
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
        <div>Task aktif<br><b>${count}</b></div>
        <div>Model<br><b>${esc(p.model || '-')}</b></div>
        <div>Skills<br><b>${p.skill_count != null ? p.skill_count : '-'}</b></div>
      </div>
    </div>`;
}

function viewTim() {
  return `
    <div class="grid team">
      ${state.profiles.map((p) => memberCard(p)).join('') || '<div class="empty">Belum ada profil.</div>'}
    </div>
    <p class="muted small" style="margin-top:18px">Status diambil dari board: <b>Sibuk</b> = lagi ngerjain task, <b>Siap</b> = ada task ready/review, <b>Santai</b> = lagi kosong.</p>
  `;
}

function viewBoard() {
  const cols = boardColumns();
  return `
    <div class="section-title" style="margin-top:0">
      <h2>Papan Kanban</h2>
      <button class="btn primary" id="newTask">＋ Task Baru</button>
    </div>
    <div class="board">
      ${cols.map((c) => `
        <div class="col" data-status="${c.key}">
          <div class="col-head"><span>${c.icon}</span> ${esc(c.label)} <span class="cnt">${c.tasks.length}</span></div>
          ${c.tasks.map((t) => taskCard(t)).join('') || '<div class="col-empty">Kosong</div>'}
        </div>`).join('')}
    </div>
  `;
}

function taskCard(t) {
  const p = PRIO[t.priority] ? `<span class="pill p${t.priority}">${PRIO[t.priority]}</span>` : '';
  return `
    <div class="task" draggable="true" data-id="${esc(t.id)}">
      <div class="task-title">${esc(t.title)}</div>
      ${t.body ? `<div class="task-body">${esc(t.body)}</div>` : ''}
      <div class="task-meta">
        ${p}
        <span class="task-assignee">${esc(t.assignee || '—')}</span>
      </div>
    </div>`;
}

function viewProyek() {
  const list = state.projects || [];
  if (!list.length) {
    return `<div class="empty">Belum ada proyek. Proyek bisa dibuat lewat board kanban Hermes.</div>`;
  }
  return `
    <div class="grid proj">
      ${list.map((p) => `
        <div class="card">
          <div class="member-top">
            <div class="member-av" style="background:${avatarBg(p.name)}">${esc(initials(p.name))}</div>
            <div><div class="member-name">${esc(p.name)}</div><div class="member-role">${esc(p.key || '')}</div></div>
          </div>
        </div>`).join('')}
    </div>`;
}

/* ---------------- kantor 2D (Stardew Valley theme) ---------------- */

function groundG() {
  return `<defs>
    <pattern id="grass" width="34" height="34" patternUnits="userSpaceOnUse">
      <rect width="34" height="34" fill="#4d8a38"/>
      <rect width="17" height="17" fill="#579741"/>
      <rect x="17" y="17" width="17" height="17" fill="#579741"/>
      <rect x="0" y="17" width="17" height="17" fill="#4d8a38" opacity=".5"/>
      <rect x="17" y="0" width="17" height="17" fill="#4d8a38" opacity=".5"/>
      <circle cx="7" cy="9" r="1.2" fill="#68b450"/>
      <circle cx="24" cy="26" r="1.2" fill="#68b450"/>
      <circle cx="28" cy="7" r="1" fill="#f4d35e"/>
    </pattern>
    <pattern id="plank" width="48" height="22" patternUnits="userSpaceOnUse">
      <rect width="48" height="22" fill="#d9a05f"/>
      <rect y="0" width="48" height="2" fill="#c18a4e"/>
      <rect x="0" y="21" width="48" height="1" fill="#b97f45"/>
      <rect x="23" y="0" width="2" height="22" fill="#c18a4e"/>
    </pattern>
  </defs>
  <!-- rumput luar -->
  <rect x="0" y="0" width="1200" height="760" fill="url(#grass)"/>
  <!-- jalan horizontal (koridor tengah) -->
  <rect x="60" y="344" width="1080" height="34" fill="#c8b898"/>
  <g fill="#b09c7a">${[...Array(42)].map((_,i)=>`<ellipse cx="${70+i*26}" cy="${352+(i%3)*3}" rx="8" ry="5"/>`).join('')}</g>
  <!-- jalan vertikal kiri & kanan -->
  <rect x="404" y="60" width="32" height="640" fill="#c8b898"/>
  <rect x="804" y="60" width="32" height="640" fill="#c8b898"/>
  <g fill="#b09c7a">${[...Array(25)].map((_,i)=>`<ellipse cx="412" cy="${70+i*26}" rx="5" ry="8"/><ellipse cx="812" cy="${70+i*26}" rx="5" ry="8"/>`).join('')}</g>
  <!-- pagar sekeliling -->
  <g stroke="#7c5330" stroke-width="6" stroke-linecap="round" fill="none">
    ${[...Array(19)].map((_,i)=>`<line x1="${24+i*64}" y1="14" x2="${24+i*64}" y2="30"/><line x1="${24+i*64}" y1="730" x2="${24+i*64}" y2="746"/>`).join('')}
    ${[...Array(16)].map((_,i)=>`<line x1="14" y1="${24+i*48}" x2="30" y2="${24+i*48}"/><line x1="1170" y1="${24+i*48}" x2="1186" y2="${24+i*48}"/>`).join('')}
  </g>
  <!-- pohon di luar area -->
  ${treeG(40, 80)}${treeG(1080, 90)}${treeG(60, 660)}${treeG(1120, 650)}
  <!-- bunga kecil -->
  ${flowerG(90, 120, '#f4d35e')}${flowerG(180, 90, '#e86c8e')}${flowerG(1020, 130, '#f4d35e')}${flowerG(1100, 100, '#e86c8e')}${flowerG(80, 690, '#f4d35e')}${flowerG(1140, 680, '#e86c8e')}
`;
}

function treeG(x, y, s=1) {
  return `<g transform="translate(${x},${y}) scale(${s})" stroke="#7c5330" stroke-width="4" fill="none" stroke-linecap="round">
    <line x1="0" y1="0" x2="0" y2="-36"/>
    <circle cx="0" cy="-22" r="18" fill="#3a6b2c"/>
    <circle cx="-14" cy="-30" r="14" fill="#3a6b2c"/>
    <circle cx="14" cy="-30" r="14" fill="#3a6b2c"/>
    <circle cx="0" cy="-42" r="16" fill="#3a6b2c"/>
  </g>`;
}

function flowerG(x, y, c) {
  return `<g transform="translate(${x},${y})">
    <line x1="0" y1="0" x2="0" y2="8" stroke="#3a6b2c" stroke-width="1.5"/>
    <circle cx="0" cy="-1" r="4" fill="${c}"/>
    <circle cx="-4" cy="-4" r="2.5" fill="${c}"/>
    <circle cx="4" cy="-4" r="2.5" fill="${c}"/>
  </g>`;
}

function roomG(x, y, w, h, label, sub) {
  return `<g>
    <rect class="room-floor" x="${x}" y="${y}" width="${w}" height="${h}"/>
    <rect class="room-frame" x="${x-6}" y="${y-6}" width="${w+12}" height="${h+12}" rx="16"/>
    <rect class="room-wall" x="${x+7}" y="${y+7}" width="${w-14}" height="${h-14}" rx="8"/>
    ${labelG(x+18, y+30, label, sub)}
  </g>`;
}

function labelG(x, y, label, sub) {
  const lw = Math.max(120, label.length * 9.2 + 24);
  return `<g>
    <rect class="sign" x="${x-8}" y="${y-17}" width="${lw}" height="22" rx="4"/>
    <text class="room-label" x="${x}" y="${y-1}">${esc(label)}</text>
    ${sub ? `<text class="room-sub" x="${x}" y="${y+16}">${esc(sub)}</text>` : ''}
  </g>`;
}

function tableG(x, y, w, h) {
  return `<g>
    <rect class="desk" x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/>
    <rect class="desk-top" x="${x+3}" y="${y+3}" width="${w-6}" height="${h-6}" rx="2"/>
  </g>`;
}

function chairG(x, y) {
  return `<g transform="translate(${x},${y})" fill="#a97142" stroke="#6d431f" stroke-width="2">
    <rect x="-10" y="-8" width="20" height="6" rx="2"/>
    <rect x="-8" y="-18" width="16" height="12" rx="2"/>
    <rect x="-12" y="-4" width="4" height="8" rx="1"/>
    <rect x="8" y="-4" width="4" height="8" rx="1"/>
  </g>`;
}

const rugG = (cx, cy, rx, ry) => `<ellipse class="rug" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#c9ab7f" opacity=".35" stroke="#b5793f" stroke-width="1.5"/>`;

function shelfG(x, y, w, h) {
  return `<g fill="#b5793f" stroke="#6d431f" stroke-width="2">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/>
    ${[0.2, 0.4, 0.6, 0.8].map((f) => `<rect x="${x + w * f - 1}" y="${y + 4}" width="2" height="${h - 8}" fill="#4a3b2a"/>`).join('')}
  </g>`;
}

function plantG(x, y, s=1) {
  return `<g transform="translate(${x},${y}) scale(${s})" fill="#3a6b2c">
    <ellipse cx="0" cy="6" rx="18" ry="10"/>
    <ellipse cx="-6" cy="0" rx="14" ry="8"/>
    <ellipse cx="8" cy="2" rx="10" ry="6"/>
  </g>`;
}

function windowG(x, y, w) {
  return `<g>
    <rect x="${x-4}" y="${y-4}" width="${w+8}" height="23" rx="5" fill="#6d431f"/>
    <rect x="${x}" y="${y}" width="${w}" height="15" rx="3" fill="#8fe3ff" opacity=".9"/>
    <line x1="${x+w/2}" y1="${y}" x2="${x+w/2}" y2="${y+15}" stroke="#6d431f" stroke-width="2"/>
    <line x1="${x}" y1="${y+7.5}" x2="${x+w}" y2="${y+7.5}" stroke="#6d431f" stroke-width="2"/>
  </g>`;
}

function stationG(a) {
  if (!a || !a.seat) return '';
  const s = a.seat;
  const pres = presenceFor(a.name);
  const busy = pres === 'busy';
  return `<g class="station ${busy ? 'on' : ''}" transform="translate(${s.x},${s.y})">
    <circle class="stool" cx="0" cy="16" r="10" fill="#a97142" stroke="#6d431f" stroke-width="2"/>
    <rect class="desk" x="-36" y="-72" width="72" height="26" rx="3" fill="#b5793f" stroke="#6d431f" stroke-width="2"/>
    <rect class="desk-top" x="-34" y="-70" width="68" height="4" rx="2" fill="#d9a05f"/>
    <g class="monitor ${busy ? 'mon-on' : ''}">
      <rect class="mon-frame" x="-22" y="-98" width="44" height="24" rx="2" fill="#4a3b2a" stroke="#6d431f" stroke-width="1.5"/>
      <rect class="mon-screen" x="-18" y="-94" width="36" height="16" rx="1" fill="#20313f"/>
      ${busy ? `<rect class="scan" x="-18" y="-94" width="36" height="3" fill="#e6fbff"/>` : ''}
      <rect class="mon-stand" x="-3" y="-74" width="6" height="3" fill="#4a3b2a"/>
    </g>
  </g>`;
}

function charG(a) {
  const s = a.seat;
  const pres = presenceFor(a.name);
  const task = currentTask(a.name);
  const [c1, c2] = avatarColors(a.name);
  const hair = c1, shirt = c2, pants = '#3f4a63', skin = '#f2c79b';
  const dx = s.w?.dx || 0, dy = s.w?.dy || 0;
  const dur = 9 + (a.name.length % 6);
  let label;
  if (pres === 'busy' && task) label = '⚡ ' + task.title.slice(0, 16);
  else if (pres === 'on') label = 'siap kerja';
  else label = 'santai';
  return `<g class="agent" data-name="${esc(a.name)}" transform="translate(${s.x},${s.y})">
    <g class="char ${pres === 'busy' ? 'sit' : pres === 'on' ? 'idle' : 'stroll'}" style="--dx:${dx}px;--dy:${dy}px;--dur:${dur}s">
      <ellipse class="cshadow" cx="0" cy="2" rx="11" ry="3.5" fill="#0004" />
      <g class="cbody">
        <rect class="leg la" x="-6.5" y="-9" width="5" height="9" fill="${pants}" />
        <rect class="leg lb" x="1.5" y="-9" width="5" height="9" fill="${pants}" />
        <rect class="torso" x="-9" y="-26" width="18" height="18" rx="2" fill="${shirt}" />
        <rect class="torso-hl" x="-9" y="-26" width="18" height="4" rx="2" fill="rgba(255,255,255,.12)" />
        <rect class="arm la" x="-12" y="-24" width="3.5" height="11" rx="1.5" fill="${shirt}" />
        <rect class="arm lb" x="8.5" y="-24" width="3.5" height="11" rx="1.5" fill="${shirt}" />
        <rect class="head" x="-8" y="-41" width="16" height="15" rx="3" fill="${skin}" />
        <rect class="hair" x="-9" y="-44" width="18" height="7" rx="3" fill="${hair}" />
        <rect class="eye" x="-5" y="-35" width="2.4" height="2.4" fill="#33241a" />
        <rect class="eye" x="3" y="-35" width="2.4" height="2.4" fill="#33241a" />
      </g>
      ${pres === 'busy' ? bubbleG(label) : ''}
    </g>
    <g class="tag" transform="translate(0,26)">
      <rect class="tag-bg" x="-33" y="-9" width="66" height="17" rx="3" />
      <text class="tag-txt" y="3" text-anchor="middle">${esc(a.name)}</text>
    </g>
    <title>${esc(a.name)} · ${s.room}${task ? ' · ' + esc(task.title) : ' · lagi santai'}</title>
  </g>`;
}

function bubbleG(txt) {
  const w = Math.max(100, txt.length * 7.2 + 24);
  return `<g class="bubble" transform="translate(${-w/2},-132)">
    <rect width="${w}" height="26" rx="6" class="bub-bg" />
    <rect x="8" y="8" width="12" height="10" rx="1.5" class="bub-ic" />
    <rect x="10" y="10" width="8" height="4" class="bub-ic2" />
    <text class="bub-txt" x="26" y="17">${esc(txt)}</text>
  </g>`;
}

function officeSvg() {
  const agents = state.profiles.map((p) => ({ ...p, seat: SEATS[p.name] })).filter((a) => a.seat);
  return `
  <svg id="officeSvg" viewBox="0 0 1200 760" width="1200" height="760" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Denah kantor virtual Jasvero">
    ${groundG()}
    <text x="600" y="22" text-anchor="middle" class="room-sub" style="letter-spacing:.34em;font-size:11px">JASVERO DIGITAL · LANTAI 1</text>

    <!-- ============ LOBBY ============ -->
    ${roomG(40, 40, 360, 300, 'Lobby', 'resepsionis & tamu')}
    ${windowG(90, 44, 120)}
    <text x="378" y="68" text-anchor="end" class="room-sub" style="letter-spacing:.22em;font-size:10px;fill:#c9ab7f">JASVERO</text>
    ${tableG(60, 95, 115, 58)}
    ${tableG(270, 60, 120, 150)}
    ${tableG(60, 225, 170, 56)}
    ${plantG(372, 308, 1)}
    ${stationG(agents.find(a=>a.name==='pm'))}
    ${stationG(agents.find(a=>a.name==='sales'))}

    <!-- ============ RUANG DEV ============ -->
    ${roomG(440, 40, 720, 300, 'Ruang Dev', 'engineering & qa')}
    ${windowG(470, 44, 170)}
    <rect class="board-wb" x="460" y="42" width="180" height="10" rx="2" fill="#8a5a2b" stroke="#6d431f" stroke-width="2"/>
    ${plantG(1132, 306, 1)}
    ${tableG(700, 230, 160, 56)}
    ${tableG(900, 262, 100, 48)}
    ${shelfG(452, 258, 92, 34)}
    ${rugG(910, 288, 130, 44)}
    ${stationG(agents.find(a=>a.name==='dev'))}
    ${stationG(agents.find(a=>a.name==='default'))}
    ${stationG(agents.find(a=>a.name==='qa'))}

    <!-- ============ RUANG KREATIF ============ -->
    ${roomG(40, 380, 360, 340, 'Ruang Kreatif', 'konten & desain')}
    ${windowG(220, 380, 140)}
    ${shelfG(285, 402, 95, 32)}
    ${tableG(88, 560, 165, 58)}
    ${tableG(268, 575, 84, 105)}
    <ellipse class="table" cx="320" cy="500" rx="52" ry="42" fill="#b5793f" stroke="#6d431f" stroke-width="2"/>
    ${chairG(320, 452)}${chairG(320, 548)}
    <g transform="translate(372,690)" stroke="#4a3b2a" stroke-width="2.5" fill="none" stroke-linecap="round">
      <line x1="0" y1="0" x2="-11" y2="20"/><line x1="0" y1="0" x2="11" y2="20"/><line x1="0" y1="0" x2="0" y2="20"/>
      <circle cx="0" cy="0" r="7" fill="#4a3b2a"/>
    </g>
    ${plantG(70, 692, 1)}
    ${stationG(agents.find(a=>a.name==='marketing'))}

    <!-- ============ RUANG MEETING ============ -->
    ${roomG(440, 380, 360, 340, 'Ruang Meeting', 'rapat & war plan')}
    <rect class="board-wb" x="470" y="384" width="200" height="10" rx="2" fill="#8a5a2b" stroke="#6d431f" stroke-width="2"/>
    <circle cx="768" cy="398" r="11" fill="#20160e" stroke="#5a3f27" stroke-width="2"/>
    <line x1="768" y1="398" x2="768" y2="390" stroke="#c9ab7f" stroke-width="2" stroke-linecap="round"/>
    <line x1="768" y1="398" x2="774" y2="401" stroke="#c9ab7f" stroke-width="2" stroke-linecap="round"/>
    <rect class="shelf" x="448" y="460" width="16" height="190" rx="4" fill="#b5793f" stroke="#6d431f" stroke-width="2"/>
    <line x1="448" y1="510" x2="464" y2="510" stroke="#4a3b2a" stroke-width="2"/>
    <line x1="448" y1="560" x2="464" y2="560" stroke="#4a3b2a" stroke-width="2"/>
    <line x1="448" y1="610" x2="464" y2="610" stroke="#4a3b2a" stroke-width="2"/>
    ${rugG(630, 525, 165, 98)}
    <rect class="table" x="520" y="470" width="220" height="110" rx="26" fill="#b5793f" stroke="#6d431f" stroke-width="2"/>
    <rect class="monitor" x="585" y="505" width="90" height="44" rx="6" fill="#4a3b2a" stroke="#6d431f" stroke-width="2"/>
    ${chairG(560, 452)}${chairG(630, 452)}${chairG(700, 452)}
    ${chairG(560, 600)}${chairG(630, 600)}${chairG(700, 600)}
    ${tableG(540, 662, 200, 46)}
    ${plantG(775, 690, 1)}

    <!-- ============ PANTRY ============ -->
    ${roomG(840, 380, 320, 340, 'Pantry', 'kopi & santai')}
    <circle cx="990" cy="398" r="11" fill="#20160e" stroke="#5a3f27" stroke-width="2"/>
    <line x1="990" y1="398" x2="990" y2="390" stroke="#c9ab7f" stroke-width="2" stroke-linecap="round"/>
    <line x1="990" y1="398" x2="996" y2="401" stroke="#c9ab7f" stroke-width="2" stroke-linecap="round"/>
    <rect class="cnt-top" x="870" y="436" width="260" height="48" rx="10" fill="#b5793f" stroke="#6d431f" stroke-width="2"/>
    <rect x="890" y="448" width="60" height="26" rx="6" fill="#20313f" stroke="#5a3f27" stroke-width="2"/>
    <rect class="fridge" x="1000" y="444" width="44" height="34" rx="6" fill="#b5793f" stroke="#6d431f" stroke-width="2"/>
    <circle class="steam" cx="1008" cy="434" r="2.6" fill="#f7e7c6"/>
    <circle class="steam s2" cx="1018" cy="432" r="2.6" fill="#f7e7c6"/>
    <circle class="steam s3" cx="1028" cy="434" r="2.6" fill="#f7e7c6"/>
    <rect class="fridge" x="1090" y="434" width="56" height="92" rx="8" fill="#b5793f" stroke="#6d431f" stroke-width="2"/>
    ${[930, 1000, 1070].map((x) => chairG(x, 505)).join('')}
    ${rugG(990, 565, 105, 26)}
    <ellipse class="table" cx="990" cy="640" rx="95" ry="58" fill="#b5793f" stroke="#6d431f" stroke-width="2"/>
    ${chairG(930, 596)}${chairG(1050, 596)}${chairG(990, 700)}
    ${plantG(878, 692, 1)}
    <g transform="translate(1122,692)">
      <ellipse cx="0" cy="0" rx="18" ry="9" fill="#20160e"/>
      <circle cx="14" cy="-6" r="7" fill="#20160e"/>
      <path d="M10,-12 l3,-6 3,6 z" fill="#20160e"/><path d="M17,-13 l3,-5 2,6 z" fill="#20160e"/>
      <path d="M-16,2 q-12,2 -10,-8" stroke="#20160e" stroke-width="4" fill="none" stroke-linecap="round"/>
    </g>

    <!-- ============ AGEN ============ -->
    ${agents.map(charG).join('')}
  </svg>`;
}

function viewKantor() {
  const online = state.profiles.filter((p) => presenceFor(p.name) !== 'off').length;
  return `
    <div class="office-tools">
      <div class="legend">
        <span><span class="dot busy"></span>Sibuk ngerjain</span>
        <span><span class="dot on"></span>Siap / ada antrian</span>
        <span><span class="dot off"></span>Santai</span>
        <span class="muted">· ${online}/${state.profiles.length} orang di kantor</span>
      </div>
      <div class="zoom">
        <button id="zOut" title="Perkecil">−</button>
        <span class="zlvl" id="zLvl">100%</span>
        <button id="zIn" title="Perbesar">＋</button>
        <button id="zFit" class="fit">Pas</button>
      </div>
    </div>
    <div class="office-scroll">${officeSvg()}</div>
    <p class="muted small" style="margin-top:12px">Tap / klik orang di denah buat lihat task-nya. Geser buat jelajahi, tombol ＋ buat zoom.</p>
  `;
}

let zoom = window.innerWidth < 860 ? 1.7 : 1;
function setZoom(z) {
  zoom = Math.min(3, Math.max(0.5, Math.round(z * 100) / 100));
  const sc = $('.office-scroll');
  if (sc) sc.style.setProperty('--z', zoom);
  const l = $('#zLvl');
  if (l) l.textContent = Math.round(zoom * 100) + '%';
}
function bindOffice() {
  setZoom(zoom);
  /* di HP, mulai dari agen yang lagi sibuk biar gak mulai di pojok kosong */
  const sc = $('.office-scroll');
  if (sc && window.innerWidth < 860) {
    const seats = state.profiles.map((p) => ({ n: p.name, s: SEATS[p.name] })).filter((x) => x.s);
    const pick = seats.find((x) => presenceFor(x.n) === 'busy') || seats[0];
    if (pick) {
      sc.scrollLeft = Math.max(0, pick.s.x * zoom - sc.clientWidth * 0.35);
      sc.scrollTop = Math.max(0, pick.s.y * zoom - sc.clientHeight * 0.4);
    }
  }
  $$('#officeSvg .agent').forEach((g) => g.addEventListener('click', () => showAgent(g.dataset.name)));
  const zin = $('#zIn'), zout = $('#zOut'), zfit = $('#zFit');
  if (zin) zin.onclick = () => setZoom(zoom + 0.2);
  if (zout) zout.onclick = () => setZoom(zoom - 0.2);
  if (zfit) zfit.onclick = () => {
    setZoom(1);
    const sc = $('.office-scroll');
    if (sc) sc.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
  };
  bindPinch($('.office-scroll'));
}

/* pinch-to-zoom buat HP — dua jari, halus */
function bindPinch(el) {
  if (!el) return;
  let startDist = 0, startZoom = 0;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      startDist = dist(e.touches);
      startZoom = zoom;
    }
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && startDist > 0) {
      e.preventDefault();
      setZoom(startZoom * (dist(e.touches) / startDist));
    }
  }, { passive: false });
  const reset = () => { startDist = 0; };
  el.addEventListener('touchend', reset);
  el.addEventListener('touchcancel', reset);
}

function showAgent(name) {
  const p = state.profiles.find((x) => x.name === name);
  if (!p) return;
  const pres = presenceFor(name);
  $('#apAv').textContent = initials(name);
  $('#apName').textContent = name;
  $('#apRole').textContent = `${p.description || p.model || ''} · ${pres === 'busy' ? 'Sibuk' : pres === 'on' ? 'Siap' : 'Santai'}`;
  const tasks = allTasks().filter((t) => t.assignee === name);
  $('#apBody').innerHTML = tasks.length
    ? tasks.map((t) => `<div class="ap-task"><div><div>${esc(t.title)}</div><div class="st">${COL_LABEL[t.status] || t.status}${t.project_key ? ' · ' + esc(t.project_key) : ''} · ${timeAgo(t.created_at)}</div></div></div>`).join('')
    : '<div class="ap-empty">Lagi gak pegang task.<br>Santai dulu, minum kopi.</div>';
  $('#agentPop').classList.remove('hidden');
}

/* ---------------- board interactions ---------------- */
function bindBoard() {
  const nt = $('#newTask');
  if (nt) nt.addEventListener('click', openModal);

  $$('.task').forEach((t) => {
    t.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', t.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
    });
  });
  $$('.col').forEach((c) => {
    c.addEventListener('dragover', (e) => { e.preventDefault(); c.classList.add('dragover'); });
    c.addEventListener('dragleave', () => c.classList.remove('dragover'));
    c.addEventListener('drop', async (e) => {
      e.preventDefault();
      c.classList.remove('dragover');
      const id = e.dataTransfer.getData('text/plain');
      const status = c.dataset.status;
      if (!id) return;
      try {
        await api(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
        await load();
        toast('Task dipindah ke ' + (COL_LABEL[status] || status), 'ok');
      } catch (err) {
        toast(err.message, 'bad');
      }
    });
  });
}

/* ---------------- modal ---------------- */
function openModal() {
  $('#tTitle').value = '';
  $('#tBody').value = '';
  $('#taskErr').textContent = '';
  const sel = $('#tAssignee');
  sel.innerHTML = '<option value="">— belum di-assign —</option>' +
    state.profiles.map((p) => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
  $('#modal').classList.remove('hidden');
  setTimeout(() => $('#tTitle').focus(), 50);
}
function closeModal() { $('#modal').classList.add('hidden'); }

$('#taskSave').addEventListener('click', async () => {
  const title = $('#tTitle').value.trim();
  if (!title) { $('#taskErr').textContent = 'Judul wajib diisi.'; return; }
  try {
    await api('/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title,
        body: $('#tBody').value.trim() || null,
        assignee: $('#tAssignee').value || null,
        priority: Number($('#tPriority').value) || 0,
      }),
    });
    closeModal();
    await load();
    toast('Task dibuat', 'ok');
  } catch (e) {
    $('#taskErr').textContent = e.message;
  }
});
$('#taskCancel').addEventListener('click', closeModal);
$('#modalClose').addEventListener('click', closeModal);
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

/* ---------------- nav / misc ---------------- */
$$('#nav button').forEach((b) => b.addEventListener('click', () => {
  state.view = b.dataset.view;
  if (state.view !== 'hasil') { state.hasilId = null; state.hasilDetail = null; }
  $$('#nav button').forEach((x) => x.classList.toggle('active', x === b));
  render();
}));
$$('.bottomnav button').forEach((b) => b.addEventListener('click', () => {
  state.view = b.dataset.view;
  if (state.view !== 'hasil') { state.hasilId = null; state.hasilDetail = null; }
  $$('.bottomnav button').forEach((x) => x.classList.toggle('active', x === b));
  $$('#nav button').forEach((x) => x.classList.toggle('active', x.dataset.view === state.view));
  render();
}));
$('#view').addEventListener('click', (e) => {
  const g = e.target.closest('[data-go]');
  if (!g) return;
  state.view = g.dataset.go;
  $$('#nav button').forEach((x) => x.classList.toggle('active', x.dataset.view === state.view));
  $$('.bottomnav button').forEach((x) => x.classList.toggle('active', x.dataset.view === state.view));
  render();
});
$('#refresh').addEventListener('click', () => { load(); toast('Dimuat ulang', 'ok'); });
$('#logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' }).catch(() => {});
  location.reload();
});

/* popover close */
$('#apClose').addEventListener('click', () => $('#agentPop').classList.add('hidden'));
$('#agentPop').addEventListener('click', (e) => { if (e.target.id === 'agentPop') $('#agentPop').classList.add('hidden'); });

function showLogin() {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginErr').textContent = '';
  const username = $('#lu').value.trim();
  const password = $('#lp').value;
  const res = await fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { $('#loginErr').textContent = data.error || 'Login gagal.'; return; }
  $('#lp').value = '';
  $('#meName').textContent = data.username || username;
  $('#meAvatar').textContent = (data.username || username || '?')[0].toUpperCase();
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  await load();
});

setInterval(() => {
  const d = new Date();
  $('#clock').textContent = d.toLocaleString('id-ID', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}, 1000);

/* ---------------- boot ---------------- */
(async function boot() {
  try {
    const res = await fetch('/api/me');
    const me = await res.json();
    if (res.ok && me.username) {
      $('#meName').textContent = me.username;
      $('#meAvatar').textContent = me.username[0].toUpperCase();
      $('#login').classList.add('hidden');
      $('#app').classList.remove('hidden');
      await load();
      return;
    }
  } catch {}
  showLogin();
})();