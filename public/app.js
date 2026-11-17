/**
 * Virtual Office Jasvero — Modern Retro 2D & AI Fleet
 * Complete Engine: Stardew Valley 2D Office, Autonomous AI Waypoint Walking,
 * Dedicated AI Chat Tabs, Kanban Board, and Cozy 8-Bit Web Audio Synthesizer.
 */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ============================================================
   GLOBAL APPLICATION STATE
   ============================================================ */
const state = {
  view: 'dashboard',
  board: null,
  workflow: null,
  profiles: [],
  stats: null,
  projects: [],
  hasilId: null,
  hasilDetail: null,

  /* Chat System (riwayat dari server) */
  chatAgent: 'dev',
  chatHistory: {},
  chatBusy: {},

  /* Audio Synthesizer */
  bgmActive: false,
  sfxActive: true,

  /* 2D Office & Simulation */
  timeOfDay: 'day', // 'morning' | 'day' | 'sunset' | 'night'
  partyMode: false,
  meetingMode: false,
  agentsSim: {}, // name -> { x, y, targetX, targetY, path: [], state, room, facing, bubble, bubbleTimer, walking: bool }
};

const TITLES = {
  dashboard: ['Dashboard', 'Ringkasan kantor virtual & aktivitas tim agen AI'],
  kantor: ['Kantor 2D', 'Jasvero HQ · Ruang kerja tim AI'],
  chat: ['Chat AI', 'Ruang diskusi langsung dengan setiap agen AI spesialis'],
  tim: ['Tim Agen', 'Daftar agen AI, keahlian spesifik, dan status kehadiran'],
  board: ['Board Kanban', 'Manajemen tugas tim — seret kartu antar kolom'],
  proyek: ['Proyek', 'Daftar proyek & inisiatif digital yang sedang berjalan'],
  monitor: ['Monitor Live', 'Pantau eksekusi tugas agen secara real-time (auto-refresh 5s)'],
  hasil: ['Hasil Kerja', 'Deliverable, laporan riset, dan output selesai dari para agen'],
};

const COL_ICON = { triage: '◇', todo: '◻', scheduled: '⏱', ready: '▶', running: '●', blocked: '⊘', review: '◎', done: '✓' };
const COL_LABEL = { triage: 'Triage', todo: 'Todo', scheduled: 'Scheduled', ready: 'Ready', running: 'Running', blocked: 'Blocked', review: 'Review', done: 'Done' };
const PRIO = { 0: 'Normal', 1: 'Penting', 2: 'Mendesak' };

/* Lokasi meja kerja bawaan di kanvas SVG (1200 x 760) */
const DESK_SPOTS = {
  pm: { x: 150, y: 257, room: 'Studio Lead' },
  sales: { x: 300, y: 257, room: 'Studio Lead' },
  dev: { x: 545, y: 257, room: 'Workspace' },
  marketing: { x: 753, y: 257, room: 'Workspace' },
  qa: { x: 965, y: 257, room: 'Workspace' },
  default: { x: 1100, y: 300, room: 'Workspace' },
};
const MEETING_SPOTS = {
  pm: { x: 245, y: 520, room: 'Meeting' },
  dev: { x: 322, y: 520, room: 'Meeting' },
  qa: { x: 400, y: 520, room: 'Meeting' },
  marketing: { x: 477, y: 520, room: 'Meeting' },
  sales: { x: 560, y: 520, room: 'Meeting' },
  default: { x: 140, y: 510, room: 'Meeting' },
};
const PANTRY_SPOTS = {
  pm: { x: 897, y: 535, room: 'Coffee lounge' },
  dev: { x: 990, y: 535, room: 'Coffee lounge' },
  qa: { x: 897, y: 597, room: 'Coffee lounge' },
  sales: { x: 1090, y: 635, room: 'Coffee lounge' },
  marketing: { x: 990, y: 597, room: 'Coffee lounge' },
  default: { x: 860, y: 560, room: 'Coffee lounge' },
};

/* Palet warna avatar & sprite karakter */
const AGENT_THEMES = {
  pm:        { c1: '#06b6d4', c2: '#0284c7', hair: '#1e293b', shirt: '#0ea5e9', pants: '#334155', title: 'Product Lead' },
  dev:       { c1: '#8b5cf6', c2: '#6d28d9', hair: '#312e81', shirt: '#8b5cf6', pants: '#1e1b4b', title: 'Fullstack Dev' },
  qa:        { c1: '#10b981', c2: '#059669', hair: '#064e3b', shirt: '#10b981', pants: '#0f172a', title: 'QA Specialist' },
  sales:     { c1: '#f59e0b', c2: '#d97706', hair: '#78350f', shirt: '#f59e0b', pants: '#451a03', title: 'Sales & Growth' },
  marketing: { c1: '#f43f5e', c2: '#e11d48', hair: '#881337', shirt: '#f43f5e', pants: '#4c0519', title: 'Creative Content' },
  default:   { c1: '#64748b', c2: '#475569', hair: '#334155', shirt: '#94a3b8', pants: '#1e293b', title: 'Support Bot' },
};

/* Helper strings & formatters */
function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return s + ' dtk lalu';
  if (s < 3600) return Math.floor(s / 60) + ' mnt lalu';
  if (s < 86400) return Math.floor(s / 3600) + ' jam lalu';
  return Math.floor(s / 86400) + ' hari lalu';
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function initials(n) {
  const p = String(n || '?').split(/[\s_-]+/).filter(Boolean);
  return ((p[0] ? p[0][0] : '?') + (p[1] ? p[1][0] : '')).toUpperCase();
}
function avatarColors(name) {
  const t = AGENT_THEMES[name] || AGENT_THEMES.default;
  return [t.c1, t.c2];
}
function avatarBg(name) {
  const [a, b] = avatarColors(name);
  return `linear-gradient(135deg, ${a}, ${b})`;
}

let toastTimer;
function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3200);
}

/* ============================================================
   WEB AUDIO API SYNTHESIZER (COZY 8-BIT BGM & RETRO SFX)
   ============================================================ */
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) audioCtx = new AudioContext();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

const SFX = {
  click() {
    if (!state.sfxActive) return;
    try {
      const ctx = getAudioCtx(); if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.06);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.07);
    } catch {}
  },
  sip() {
    if (!state.sfxActive) return;
    try {
      const ctx = getAudioCtx(); if (!ctx) return;
      // Bubble / sip chirp
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(780, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.15);
    } catch {}
  },
  ping() {
    if (!state.sfxActive) return;
    try {
      const ctx = getAudioCtx(); if (!ctx) return;
      const now = ctx.currentTime;
      [587.33, 880].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.08);
        gain.gain.setValueAtTime(0.1, now + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.18);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(now + idx * 0.08); osc.stop(now + idx * 0.08 + 0.2);
      });
    } catch {}
  },
  fanfare() {
    if (!state.sfxActive) return;
    try {
      const ctx = getAudioCtx(); if (!ctx) return;
      const notes = [523.25, 659.25, 783.99, 1046.50];
      const now = ctx.currentTime;
      notes.forEach((n, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(n, now + i * 0.09);
        gain.gain.setValueAtTime(0.15, now + i * 0.09);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.09 + 0.22);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(now + i * 0.09); osc.stop(now + i * 0.09 + 0.25);
      });
    } catch {}
  },
};

/* Cozy 8-Bit Lo-fi BGM Loop (Stardew-inspired acoustic pentatonic synth) */
let bgmTimer = null;
let bgmStep = 0;
const BGM_NOTES = [
  // C major / A minor cozy pentatonic melody
  261.63, 329.63, 392.00, 523.25,
  293.66, 349.23, 440.00, 587.33,
  329.63, 392.00, 493.88, 659.25,
  261.63, 392.00, 523.25, 659.25,
];

function toggleBGM() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  state.bgmActive = !state.bgmActive;
  $('#bgmState').textContent = state.bgmActive ? 'On' : 'Off';
  $('#bgmBtn').classList.toggle('active', state.bgmActive);

  if (!state.bgmActive) {
    if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; }
    return;
  }

  bgmStep = 0;
  bgmTimer = setInterval(() => {
    if (!state.bgmActive) return;
    try {
      const freq = BGM_NOTES[bgmStep % BGM_NOTES.length];
      bgmStep++;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(0.035, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.38);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch {}
  }, 420);
}

function toggleSFX() {
  state.sfxActive = !state.sfxActive;
  $('#sfxState').textContent = state.sfxActive ? 'On' : 'Off';
  $('#sfxBtn').classList.toggle('active', state.sfxActive);
  SFX.click();
}

/* ============================================================
   API & DATA LAYER
   ============================================================ */
async function api(p, opts = {}) {
  const res = await fetch('/api/kanban' + p, { headers: { 'Content-Type': 'application/json' }, ...opts });
  let data = null;
  try { data = await res.json(); } catch {}
  if (res.status === 401) { showLogin(); throw new Error('Sesi habis, login lagi.'); }
  if (!res.ok) {
    const msg = (data && (data.error || (Array.isArray(data.detail) ? data.detail[0]?.msg : data.detail))) || ('HTTP ' + res.status);
    throw new Error(msg);
  }
  return data;
}

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

    recordOfficeTaskChanges();

    // Inisialisasi posisi simulasi agen jika belum ada
    initAgentSimulations();

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
  if (state.chatBusy && state.chatBusy[name]) return 'busy';
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

/* ============================================================
   2D OFFICE AUTONOMOUS AGENT SIMULATION & WAYPOINT ENGINE
   ============================================================ */
function initAgentSimulations() {
  state.profiles.forEach((p) => {
    if (!state.agentsSim[p.name]) {
      const desk = DESK_SPOTS[p.name] || DESK_SPOTS.default;
      state.agentsSim[p.name] = {
        name: p.name,
        x: desk.x,
        y: desk.y,
        targetX: desk.x,
        targetY: desk.y,
        state: 'desk', // 'desk' | 'pantry' | 'meeting' | 'walking'
        room: desk.room,
        facing: 1, // 1: right, -1: left
        bubble: '⚡ Siap bekerja',
        bubbleTimer: 0,
        walking: false,
        path: [],
      };
    }
  });
}

/**
 * Pathfinding waypoint koridor kantor virtual:
 * Membantu karakter jalan lewat pintu dan koridor tanpa tembus dinding sembarangan
 */
function buildPath(startX, startY, targetX, targetY) {
  // Door centers and approach lanes match the generated floor map.
  const roomRoute = (x, y) => {
    if (y < 320) return [{ x, y: 292 }, { x: x < 385 ? 235 : 855, y: 292 }, { x: x < 385 ? 235 : 855, y: 370 }];
    if (y > 420 && x >= 780) {
      const lane = x > 950 ? 1035 : 860;
      return [{ x: lane, y }, { x: lane, y: 475 }, { x: 870, y: 475 }, { x: 870, y: 370 }];
    }
    if (y > 420) return [{ x, y: 475 }, { x: x < 780 ? 240 : 870, y: 475 }, { x: x < 780 ? 240 : 870, y: 370 }];
    return [{ x, y: 370 }];
  };
  const exit = roomRoute(startX, startY);
  const entry = roomRoute(targetX, targetY).reverse();
  return [...exit, ...entry, { x: targetX, y: targetY }];
}

function commandAgentTo(name, target, targetState, bubbleText) {
  const sim = state.agentsSim[name];
  if (!sim) return;
  if (!sim.walking && sim.state === targetState && Math.hypot(sim.x - target.x, sim.y - target.y) < 1) return;
  sim.targetX = target.x;
  sim.targetY = target.y;
  sim.state = 'walking';
  sim.targetRoom = target.room || 'Kantor';
  sim.finalState = targetState;
  sim.bubble = bubbleText || 'Otw jalan...';
  sim.path = buildPath(sim.x, sim.y, target.x, target.y);
  sim.walking = true;
  sim.facing = target.x >= sim.x ? 1 : -1;
  syncOfficeAgent(name);
  SFX.click();
}

/* Jalankan loop animasi gerakan karakter */
let simRafId = null;
function runSimLoop() {
  if (simRafId) cancelAnimationFrame(simRafId);

  let previousTime;
  function step(now) {
    const speed = Math.min((now - (previousTime ?? now)) / 1000, 0.05) * 144;
    previousTime = now;

    Object.values(state.agentsSim).forEach((ag) => {
      if (ag.path && ag.path.length > 0) {
        const currentTarget = ag.path[0];
        const dx = currentTarget.x - ag.x;
        const dy = currentTarget.y - ag.y;
        const dist = Math.hypot(dx, dy);

        if (dist <= speed) {
          ag.x = currentTarget.x;
          ag.y = currentTarget.y;
          ag.path.shift();
          if (ag.path.length === 0) {
            // Tiba di tujuan akhir!
            ag.walking = false;
            ag.state = ag.finalState || 'desk';
            ag.room = ag.targetRoom || ag.room;
            syncOfficeAgent(ag.name);

            if (ag.state === 'pantry') {
              ag.bubble = '☕ Mmm kopi latte nikmat!';
              SFX.sip();
            } else if (ag.state === 'meeting') {
              ag.bubble = '📊 Diskusi sprint Q4';
            } else {
              ag.bubble = '💻 Fokus bekerja di meja';
            }
          }
        } else {
          ag.x += (dx / dist) * speed;
          ag.y += (dy / dist) * speed;
          ag.facing = dx >= 0 ? 1 : -1;
        }

        // Update DOM SVG elemen karakter secara langsung agar super-smooth
        const el = $(`#agent-${ag.name}`);
        if (el) {
          el.setAttribute('transform', `translate(${ag.x.toFixed(1)}, ${ag.y.toFixed(1)})`);
          const bodyEl = el.querySelector('.cbody');
          if (bodyEl) {
            bodyEl.setAttribute('transform', `scale(${ag.walking ? ag.facing : 1}, 1)`);
          }
          const bubTxt = el.querySelector('.bub-txt');
          if (bubTxt) bubTxt.textContent = ag.bubble;
        }
      }
    });

    simRafId = requestAnimationFrame(step);
  }

  simRafId = requestAnimationFrame(step);
}

/* Autonomous Idle AI Loop:
   Jika agen lagi nganggur (tidak sibuk task running),
   mereka akan jalan-jalan, ke ruang rapat, atau ngopi di pantry! */
setInterval(() => {
  if (state.partyMode || state.meetingMode) return;

  state.profiles.forEach((p) => {
    const pres = presenceFor(p.name);
    const sim = state.agentsSim[p.name];
    if (!sim || sim.walking) return;
    if (sim.holdUntil && Date.now() < sim.holdUntil) return;

    // Sedang menjawab chat: agen harus di meja, bukan ngopi/jalan-jalan
    if (state.chatBusy && state.chatBusy[p.name]) {
      if (sim.state !== 'desk') {
        const desk = DESK_SPOTS[p.name] || DESK_SPOTS.default;
        commandAgentTo(p.name, desk, 'desk', '⚡ Sedang mengerjakan pesananmu');
      }
      return;
    }

    if (pres === 'off') {
      // Agen lagi nganggur! Berikan perilaku acak yang hidup
      const rand = Math.random();

      if (sim.state === 'desk' && rand < 0.45) {
        // Jalan ke Pantry ngopi!
        const spot = PANTRY_SPOTS[p.name] || PANTRY_SPOTS.default;
        commandAgentTo(p.name, spot, 'pantry', '☕ Lagi santai, mau ngopi di pantry!');
      } else if (sim.state === 'desk' && rand < 0.75) {
        // Jalan ke Ruang Rapat
        const spot = MEETING_SPOTS[p.name] || MEETING_SPOTS.default;
        commandAgentTo(p.name, spot, 'meeting', '🏃 Ikut nimbrung di ruang rapat');
      } else if (sim.state !== 'desk' && rand < 0.35) {
        // Balik ke meja kerja
        const desk = DESK_SPOTS[p.name] || DESK_SPOTS.default;
        commandAgentTo(p.name, desk, 'desk', '💻 Balik ke meja dulu');
      }
    } else if (pres === 'busy' && sim.state !== 'desk') {
      // Ada task running! Otomatis jalan balik ke meja untuk kerja
      const desk = DESK_SPOTS[p.name] || DESK_SPOTS.default;
      commandAgentTo(p.name, desk, 'desk', '⚡ Ada task! Otw meja');
    }
  });
}, 8000);

/* Event: Party & Coffee Break All */
function triggerPartyAll() {
  state.partyMode = true;
  state.meetingMode = false;
  SFX.fanfare();
  toast('🎉 Semua agen santai meluncur ke Pantry Cafe!', 'ok');

  state.profiles.forEach((p) => {
    const spot = PANTRY_SPOTS[p.name] || PANTRY_SPOTS.default;
    commandAgentTo(p.name, spot, 'pantry', '☕ Party Time! Ngopi bareng');
  });

  setTimeout(() => { state.partyMode = false; }, 25000);
}

/* Event: Panggil Rapat All-Hands */
function triggerMeetingAll() {
  state.meetingMode = true;
  state.partyMode = false;
  SFX.fanfare();
  toast('📢 Seluruh tim berkumpul di Ruang Rapat!', 'ok');

  state.profiles.forEach((p) => {
    const spot = MEETING_SPOTS[p.name] || MEETING_SPOTS.default;
    commandAgentTo(p.name, spot, 'meeting', '📢 Panggilan Rapat All-Hands!');
  });

  setTimeout(() => { state.meetingMode = false; }, 30000);
}

/* Event: Kembalikan Semua Agen ke Meja */
function triggerBackToDeskAll() {
  state.partyMode = false;
  state.meetingMode = false;
  SFX.click();
  toast('💻 Semua agen kembali ke meja kerja.', 'ok');

  state.profiles.forEach((p) => {
    const desk = DESK_SPOTS[p.name] || DESK_SPOTS.default;
    commandAgentTo(p.name, desk, 'desk', '💻 Balik fokus di meja');
  });
}

/* ============================================================
   VIEWS & RENDERING
   ============================================================ */
function render() {
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
  } else if (state.monitorTimer) {
    clearInterval(state.monitorTimer);
    state.monitorTimer = null;
  }
}

/* ---------------- 1. DASHBOARD VIEW ---------------- */
function viewDashboard() {
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

/* ---------------- 2. KANTOR 2D VIEW (STARDEW VALLEY) ---------------- */
function viewKantor() {
  const busy = state.profiles.filter(p => presenceFor(p.name) === 'busy').length;
  const tasks = allTasks().filter(t => t.status !== 'done');
  return `<div class="office-wrap office-studio">
    <div class="studio-heading"><div><span class="studio-eyebrow">THE WORKPLACE / 01</span><h2>Ruang untuk ide besar.</h2><p>Tim, pekerjaan, dan satu tempat untuk berkolaborasi.</p></div><span class="studio-mode">● Simulasi visual</span></div>
    <div class="studio-layout">
      <section class="studio-floor" aria-label="Denah kantor interaktif">
        <div class="studio-floor-head"><div><b>Jasvero HQ</b><span>Lantai 01 · Creative office</span></div><div class="zoom-group"><button id="zOut" aria-label="Perkecil denah">−</button><span class="zlvl" id="zLvl">100%</span><button id="zIn" aria-label="Perbesar denah">+</button><button id="zFit" aria-label="Sesuaikan denah">Fit</button></div></div>
        <div class="office-viewport">${renderOfficeSvg()}</div>
        <div class="studio-map-foot"><span><i class="dot busy"></i> Bekerja <i class="dot on"></i> Siap <i class="dot off"></i> Istirahat</span><span>Klik monitor untuk melihat pekerjaan ↗</span></div>
      </section>
      <aside class="studio-command" aria-label="Pusat kontrol kantor">
        <div class="studio-command-title"><span class="studio-eyebrow">COMMAND CENTER</span><h3>Hari ini di kantor</h3></div>
        <div class="studio-counts"><div><strong>${state.profiles.length}</strong><span>Anggota tim</span></div><div><strong>${busy}</strong><span>Sedang bekerja</span></div></div>
        <div class="studio-controls"><span class="studio-eyebrow">ARAHKAN TIM</span><button id="btnMeetingAll"><span>◎</span><div><b>Kumpulkan tim</b><small>Menuju ruang rapat</small></div><span>↗</span></button><button id="btnPantryAll"><span>♧</span><div><b>Coffee break</b><small>Istirahat bersama di pantry</small></div><span>↗</span></button><button id="btnDeskAll"><span>▤</span><div><b>Waktunya fokus</b><small>Kembali ke meja kerja</small></div><span>↗</span></button></div>
        <div class="studio-task-head"><span class="studio-eyebrow">PEKERJAAN AKTIF</span><button data-go="board">Lihat board ↗</button></div>
        <div class="studio-tasks">${tasks.slice(0,3).map(t => `<div><span class="studio-task-state">${esc(COL_LABEL[t.status] || t.status)} · ${esc(t.assignee || 'Belum ditugaskan')}</span><p>${esc(t.title)}</p></div>`).join('') || '<p class="studio-empty">Belum ada pekerjaan aktif. Buat tugas pertama untuk tim.</p>'}</div>
        <div id="officeNotifications" class="office-notifications" aria-live="polite">${officeNotificationsHtml()}</div>
        <p id="officeSyncStatus" class="office-sync-status">Tugas diperbarui tiap 5 detik</p>
        <button id="officeNewTask" class="studio-new-task">＋ Buat tugas baru</button>
      </aside>
    </div>
    <div class="studio-team-head"><div><span class="studio-eyebrow">THE PEOPLE</span><h3>Kenali tim kamu</h3></div><span>${state.profiles.length} agen di workspace</span></div>
    <div class="studio-roster">${state.profiles.map(p => { const pres=presenceFor(p.name); const task=currentTask(p.name); return `<button class="studio-person" data-office-agent="${esc(p.name)}"><span class="studio-portrait"><svg viewBox="-25 -60 50 75" aria-hidden="true">${officePixelPerson(p.name)}</svg></span><span class="studio-person-info"><b>${esc(p.name)}</b><small>${esc((AGENT_THEMES[p.name] || AGENT_THEMES.default).title)}</small><span class="studio-person-task">${esc(task ? task.title : 'Siap untuk ide berikutnya')}</span></span><span class="studio-presence ${pres}" title="${pres === 'busy' ? 'Bekerja' : pres === 'on' ? 'Siap' : 'Istirahat'}"></span></button>`; }).join('')}</div>
  </div>`;
}

function officePixelPerson(name) {
  const t = AGENT_THEMES[name] || AGENT_THEMES.default;
  return `<g shape-rendering="crispEdges"><ellipse cy="10" rx="16" ry="4" fill="#263b3330"/><path d="M-10-6h8v17h-10v-5h2zM3-6h8v12h2v5H3z" fill="#303b45"/><path d="M-12-28h24v24h-24zM-17-24h5v18h-5zM12-24h5v18h-5z" fill="${t.shirt}"/><path d="M-4-28h8v9h-8z" fill="#f5efdd"/><path d="M-17-8h5v6h-5zM12-8h5v6h-5zM-11-48h22v21h-22z" fill="#dfae86"/><path d="M-11-51h22v7h4v13h-5v-10H-6v5h-8v-12h3z" fill="${t.hair}"/><path d="M-7-37h3v3h-3zM5-37h3v3H5z" fill="#28342e"/><path d="M-3-29h7v2h-7z" fill="#a66e56"/></g>`;
}

function officeActivity(name) {
  const sim = state.agentsSim[name];
  if (!sim || sim.walking) return 'walking';
  if (sim.state === 'desk') return presenceFor(name) === 'busy' ? 'typing' : 'seated';
  if (sim.state === 'pantry') return name === 'sales' ? 'smoking' : 'coffee';
  return 'meeting';
}

function officeSeatedPerson(name, activity) {
  const t = AGENT_THEMES[name] || AGENT_THEMES.default;
  const desk = activity === 'typing' || activity === 'seated';
  return `<g class="office-pose ${activity}" shape-rendering="crispEdges">
    <ellipse cy="12" rx="19" ry="5" fill="#263b3325"/>
    <path d="M-13-5h10v15h-12v-5h2zM3-5h10v10h2v5H3z" fill="${t.pants}"/>
    <g class="office-upper"><path d="M-13-34h26v30h-26z" fill="${t.shirt}"/>
    <path d="M-11-54h22v22h-22z" fill="#dfae86"/>
    <path d="M-12-56h24v9h3v14h-5v-11H-7v8h-7v-17h2z" fill="${t.hair}"/>
    ${desk ? `<path d="M-11-49h22v16h-22z" fill="${t.hair}"/><g class="typing-hand hand-left"><path d="M-13-32h-7v-14h7" fill="${t.shirt}"/><rect x="-20" y="-49" width="8" height="6" fill="#dfae86"/></g><g class="typing-hand hand-right"><path d="M13-32h7v-14h-7" fill="${t.shirt}"/><rect x="12" y="-49" width="8" height="6" fill="#dfae86"/></g>` : `<path d="M-7-43h3v3h-3zM5-43h3v3H5z" fill="#28342e"/><path d="M-3-35h7v2h-7z" fill="#a66e56"/><path d="M-17-29h6v19h-6z" fill="${t.shirt}"/><g class="sip-arm"><path d="M10-29h6v16H4v-6h6z" fill="${t.shirt}"/><rect x="1" y="-20" width="7" height="6" fill="#dfae86"/>${activity === 'smoking' ? '<rect x="-7" y="-21" width="13" height="3" fill="#fff8e8"/><rect x="-9" y="-21" width="3" height="3" fill="#dc7d40"/>' : '<path d="M-4-28h12v13H-4zM8-26h5v8H8" fill="#fff8e8" stroke="#8a7860" stroke-width="2"/><rect x="-2" y="-27" width="8" height="3" fill="#76523b"/>'}</g>`}
    </g>
    ${desk ? '<path d="M-17-16h34v15h-34z" fill="#96553e" stroke="#603e33" stroke-width="2"/><path d="M-14-14h28v4h-28z" fill="#c17b56"/>' : ''}
    ${activity === 'coffee' ? '<g class="coffee-steam"><path d="M0-36q-6-5 0-10t0-10M7-33q-5-5 0-10" fill="none" stroke="#fff9e9" stroke-width="2"/></g>' : ''}
    ${activity === 'smoking' ? '<g class="cigarette-smoke"><path d="M-10-30q-12-8-5-17t-9-17" fill="none" stroke="#e1e5db" stroke-width="3"/><circle cx="-22" cy="-67" r="5" fill="#e1e5db"/></g>' : ''}
  </g>`;
}

function officeAgentBody(name) {
  const activity = officeActivity(name);
  return activity === 'walking' ? officePixelPerson(name) : officeSeatedPerson(name, activity);
}

function officeMonitor(name) {
  const desk = DESK_SPOTS[name];
  if (!desk || name === 'default') return '';
  const active = presenceFor(name) === 'busy';
  return `<g data-monitor="${esc(name)}" class="office-monitor ${active ? 'is-on' : ''}" transform="translate(${desk.x - 22},155)" role="button" tabindex="0" aria-label="Buka pekerjaan ${esc(name)}">
    <title>Lihat pekerjaan ${esc(name)}</title><rect x="-7" y="-6" width="58" height="38" fill="transparent"/>
    <rect width="44" height="26" fill="#293231"/>
    <g class="monitor-live"><rect width="44" height="26" fill="#203b43"/><rect x="2" y="2" width="40" height="3" fill="#4f8990"/><g class="monitor-code" fill="#9dd9ba"><rect x="4" y="8" width="22" height="2"/><rect x="8" y="12" width="28" height="2"/><rect x="8" y="16" width="18" height="2"/><rect x="4" y="20" width="25" height="2"/></g><rect class="monitor-cursor" x="31" y="20" width="4" height="2" fill="#f1d08d"/></g>
  </g>`;
}

function syncOfficeAgent(name) {
  const group = document.getElementById('agent-' + name);
  if (!group) return;
  const activity = officeActivity(name);
  const changed = group.dataset.activity !== activity;
  group.dataset.activity = activity;
  group.classList.toggle('walking', activity === 'walking');
  group.querySelector('.cbody').innerHTML = officeAgentBody(name);
  group.querySelector('.cbody').setAttribute('transform', 'scale(1,1)');
  group.querySelector('.agent-activity-title').textContent = officeActivityLabel(activity);
  if (changed) showOfficeBubble(name, officeActivityLabel(activity));
}

function officeActivityLabel(activity) {
  return ({typing:'Sedang mengetik', seated:'Duduk · siap bekerja', coffee:'Menikmati kopi', smoking:'Istirahat merokok', meeting:'Duduk di ruang rapat', walking:'Berjalan'})[activity];
}

function renderOfficeSvg() {
  return `<svg id="officeSvg" viewBox="0 0 1200 760" xmlns="http://www.w3.org/2000/svg" aria-label="Kantor pixel art dengan ruang kerja, ruang rapat, dan pantry">
    <image href="/assets/office-floor.png" width="1200" height="760" preserveAspectRatio="none"/>
    ${state.profiles.map(p => officeMonitor(p.name)).join('')}
    ${[[80,115,'01 / STUDIO LEAD'],[445,115,'02 / WORKSPACE'],[80,450,'03 / MEETING ROOM'],[850,450,'04 / COFFEE LOUNGE']].map(([x,y,label])=>`<g transform="translate(${x},${y})" class="studio-room-label"><rect width="184" height="26" rx="3"/><text x="10" y="17">${label}</text></g>`).join('')}
    ${state.profiles.map(p => {const sim=state.agentsSim[p.name] || DESK_SPOTS.default;const pres=presenceFor(p.name);return `<g id="agent-${esc(p.name)}" class="agent-group ${sim.walking ? 'walking' : ''}" data-activity="${officeActivity(p.name)}" data-agent="${esc(p.name)}" role="button" tabindex="0" aria-label="Buka profil ${esc(p.name)}" transform="translate(${sim.x},${sim.y})"><title class="agent-activity-title">${officeActivityLabel(officeActivity(p.name))}</title><g class="cbody">${officeAgentBody(p.name)}</g><g class="office-bubble-slot"></g><g class="studio-agent-label"><rect x="-40" y="18" width="80" height="23" rx="3"/><circle cx="-26" cy="29" r="3" fill="${pres==='busy'?'#c08c35':pres==='on'?'#408064':'#858c85'}"/><text x="5" y="33" text-anchor="middle">${esc(p.name)}</text></g></g>`;}).join('')}
  </svg>`;
}

const officeTaskSnapshot = new Map();
const officeNotices = [];
let officeSnapshotReady = false;
let officePollBusy = false;
let officeInspectorRequest = 0;
let officeInspectorTrigger;

function officeTaskNoticeKey(task) {
  return `${task.id}:${task.status}:${task.updated_at || task.completed_at || ''}`;
}

function recordOfficeTaskChanges() {
  const tasks = allTasks();
  for (const task of tasks) {
    const previous = officeTaskSnapshot.get(task.id);
    if (['done', 'blocked'].includes(task.status) && previous !== task.status) {
      const key = officeTaskNoticeKey(task);
      if (!officeNotices.some(n => n.key === key)) officeNotices.unshift({
        key, id: task.id, status: task.status, assignee: task.assignee || '',
        title: task.title, read: false, existing: !officeSnapshotReady,
      });
    }
    if (officeSnapshotReady && previous !== task.status && task.assignee) {
      showOfficeBubble(task.assignee, task.status === 'blocked' ? 'Butuh bantuan' : task.status === 'done' ? 'Tugas selesai' : COL_LABEL[task.status] || task.status);
    }
    officeTaskSnapshot.set(task.id, task.status);
  }
  // Remove resolved blockers; completion history remains available for review.
  for (let i = officeNotices.length - 1; i >= 0; i--) {
    const task = tasks.find(t => t.id === officeNotices[i].id);
    if (!task || (officeNotices[i].status === 'blocked' && task.status !== 'blocked')) officeNotices.splice(i, 1);
  }
  officeNotices.splice(20);
  officeSnapshotReady = true;
}

function officeNotificationsHtml() {
  const unread = officeNotices.filter(n => !n.read).length;
  return `<div class="office-notice-heading"><span class="studio-eyebrow">PERHATIAN TIM</span><span>${unread} belum dibaca</span></div>${officeNotices.slice(0,4).map(n => `<button class="office-notice ${n.status} ${n.read ? 'is-read' : ''}" data-office-notice="${esc(n.key)}"><span class="office-notice-icon">${n.status === 'blocked' ? '!' : '✓'}</span><span><b>${n.status === 'blocked' ? 'Butuh bantuan' : 'Tugas selesai'}${n.existing ? ' · Riwayat' : ''}</b><small>${esc(n.title)}</small><em>${esc(n.assignee || 'Belum ditugaskan')} · ${n.read ? 'Sudah dibaca' : 'Buka detail'}</em></span></button>`).join('') || '<p class="office-notice-empty">Tidak ada tugas terhambat atau selesai untuk ditinjau.</p>'}`;
}

function showOfficeBubble(name, text) {
  const slot = document.getElementById('agent-' + name)?.querySelector('.office-bubble-slot');
  if (!slot) return;
  slot.innerHTML = `<g class="office-status-bubble" transform="translate(0,-78)"><rect x="-72" y="-13" width="144" height="25" rx="4"/><path d="M-4 12L0 17L4 12"/><text text-anchor="middle" y="4">${esc(text.slice(0,24))}</text></g>`;
}

function ensureOfficeInspector() {
  let dialog = $('#officeInspector');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'officeInspector';
  dialog.className = 'office-inspector';
  dialog.setAttribute('aria-labelledby', 'officeInspectorTitle');
  dialog.innerHTML = `<div class="office-inspector-head"><div><span class="studio-eyebrow">AGENT WORKSTATION</span><h2 id="officeInspectorTitle">Pekerjaan agen</h2></div><button class="office-inspector-close" aria-label="Tutup detail pekerjaan">✕</button></div><div id="officeInspectorBody" aria-live="polite"></div>`;
  document.body.append(dialog);
  dialog.querySelector('.office-inspector-close').onclick = () => dialog.close();
  dialog.addEventListener('click', e => { if (e.target === dialog) { const r=dialog.getBoundingClientRect(); if(e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom) dialog.close(); } });
  dialog.addEventListener('close', () => { officeInspectorRequest++; if (officeInspectorTrigger?.isConnected) officeInspectorTrigger.focus(); });
  dialog.addEventListener('click', e => {
    const task = e.target.closest('[data-inspect-task]');
    if (task) openOfficeInspector(task.dataset.assignee, task.dataset.inspectTask);
    if (e.target.closest('[data-inspect-retry]')) openOfficeInspector(dialog.dataset.agent, dialog.dataset.task);
  });
  return dialog;
}

async function openOfficeInspector(name, taskId) {
  const dialog = ensureOfficeInspector();
  const request = ++officeInspectorRequest;
  const tasks = allTasks().filter(t => t.assignee === name);
  const selected = taskId ? allTasks().find(t => t.id === taskId) : currentTask(name) || tasks.find(t => t.status === 'done');
  dialog.dataset.agent = name || '';
  dialog.dataset.task = selected?.id || '';
  $('#officeInspectorTitle').textContent = name ? `Meja ${name.toUpperCase()}` : 'Detail pekerjaan';
  if (!dialog.open) { officeInspectorTrigger = document.activeElement; dialog.showModal(); }
  const body = $('#officeInspectorBody');
  const list = tasks.length ? `<div class="office-inspector-tasklist"><span class="studio-eyebrow">TUGAS AGEN</span>${tasks.map(t => `<button data-inspect-task="${esc(t.id)}" data-assignee="${esc(name)}" aria-pressed="${selected?.id === t.id}"><span>${esc(t.title)}</span><small>${esc(COL_LABEL[t.status] || t.status)}</small></button>`).join('')}</div>` : '';
  if (!selected) { body.innerHTML = '<div class="office-inspector-empty"><h3>Siap untuk tugas berikutnya</h3><p>Belum ada tugas yang ditugaskan ke agen ini.</p></div>'; return; }
  const summary = `<div class="office-inspector-summary"><span class="office-task-badge ${esc(selected.status)}">${esc(COL_LABEL[selected.status] || selected.status)}</span><h3>${esc(selected.title)}</h3><p>${esc(selected.body || 'Belum ada deskripsi tugas.')}</p></div>`;
  body.innerHTML = summary + '<div class="office-inspector-result" role="status">Memuat pembaruan pekerjaan…</div>' + list;
  try {
    const response = await api('/tasks/' + encodeURIComponent(selected.id));
    if (request !== officeInspectorRequest || !dialog.open) return;
    const detail = response?.task || response || selected;
    const update = detail.latest_summary;
    const result = detail.result;
    body.innerHTML = summary + `<div class="office-inspector-result"><span class="studio-eyebrow">PEMBARUAN TERAKHIR</span><p>${esc(update || 'Agen belum mengirim laporan langkah terakhir.')}</p><span class="studio-eyebrow">HASIL PEKERJAAN</span><p>${esc(typeof result === 'string' ? result : result ? JSON.stringify(result, null, 2) : 'Belum ada hasil yang tersedia.')}</p><small>Data dari board tugas. Animasi kantor merupakan simulasi visual.</small></div>` + list;
  } catch {
    if (request !== officeInspectorRequest || !dialog.open) return;
    body.innerHTML = summary + '<div class="office-inspector-error" role="alert">Detail belum berhasil dimuat. <button data-inspect-retry>Coba lagi</button></div>' + list;
  }
}

setInterval(async () => {
  if (state.view !== 'kantor' || document.hidden || officePollBusy || $('#app').classList.contains('hidden')) return;
  officePollBusy = true;
  try {
    const board = await api('/board');
    if (state.view !== 'kantor') return;
    state.board = board;
    recordOfficeTaskChanges();
    for (const p of state.profiles) {
      const group = document.getElementById('agent-' + p.name);
      if (group && group.dataset.activity !== officeActivity(p.name)) syncOfficeAgent(p.name);
      const monitor = $$('#officeSvg [data-monitor]').find(m => m.dataset.monitor === p.name);
      monitor?.classList.toggle('is-on', presenceFor(p.name) === 'busy');
    }
    const notices = $('#officeNotifications');
    const html = officeNotificationsHtml();
    if (notices && notices.innerHTML !== html) notices.innerHTML = html;
    if ($('#officeSyncStatus')) $('#officeSyncStatus').textContent = 'Tersinkron · ' + new Date().toLocaleTimeString('id-ID', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
  } catch {
    if ($('#officeSyncStatus')) $('#officeSyncStatus').textContent = 'Sinkronisasi tertunda · mencoba lagi otomatis';
  } finally { officePollBusy = false; }
}, 5000);

let currentZoom = 1;
function setOfficeZoom(z) {
  currentZoom = Math.min(2.8, Math.max(0.6, Math.round(z * 100) / 100));
  const el = $('.office-viewport');
  if (el) el.style.setProperty('--z', currentZoom);
  const l = $('#zLvl');
  if (l) l.textContent = Math.round(currentZoom * 100) + '%';
}

function bindOffice() {
  setOfficeZoom(currentZoom);

  $$('#officeSvg [data-monitor]').forEach(m => {
    m.addEventListener('click', () => openOfficeInspector(m.dataset.monitor));
    m.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openOfficeInspector(m.dataset.monitor); } });
  });
  $('#officeNotifications')?.addEventListener('click', e => {
    const button = e.target.closest('[data-office-notice]');
    if (!button) return;
    const notice = officeNotices.find(n => n.key === button.dataset.officeNotice);
    if (!notice) return;
    notice.read = true;
    $('#officeNotifications').innerHTML = officeNotificationsHtml();
    openOfficeInspector(notice.assignee, notice.id);
  });
  // Zoom controls
  $('#zIn')?.addEventListener('click', () => setOfficeZoom(currentZoom + 0.2));
  $('#zOut')?.addEventListener('click', () => setOfficeZoom(currentZoom - 0.2));
  $('#zFit')?.addEventListener('click', () => {
    setOfficeZoom(1);
    $('.office-viewport')?.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
  });

  $('#officeNewTask')?.addEventListener('click', openModal);
  $$('[data-office-agent]').forEach(b => b.addEventListener('click', () => openAgentDrawer(b.dataset.officeAgent)));

  // Toolbar events
  $('#btnPantryAll')?.addEventListener('click', triggerPartyAll);
  $('#btnMeetingAll')?.addEventListener('click', triggerMeetingAll);
  $('#btnDeskAll')?.addEventListener('click', triggerBackToDeskAll);

  // Klik agen di denah
  $$('#officeSvg .agent-group').forEach((g) => {
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAgentDrawer(g.dataset.agent); } });
    g.addEventListener('click', (e) => {
      e.stopPropagation();
      openAgentDrawer(g.dataset.agent);
    });
  });
}

function openAgentDrawer(name) {
  const p = state.profiles.find((x) => x.name === name);
  if (!p) return;
  const pres = presenceFor(name);
  const sim = state.agentsSim[name] || {};

  $('#apAv').textContent = initials(name);
  $('#apAv').style.background = avatarBg(name);
  $('#apName').textContent = name;
  $('#apRole').textContent = `${p.description || p.model || ''} · ${pres === 'busy' ? '⚡ Sedang Sibuk' : '☕ Santai'}`;

  // Binding Action Drawer
  $('#apActionChat').onclick = () => {
    $('#agentPop').classList.add('hidden');
    state.chatAgent = name;
    state.view = 'chat';
    $$('#nav button').forEach((x) => x.classList.toggle('active', x.dataset.view === 'chat'));
    render();
  };

  $('#apActionCoffee').onclick = () => {
    const spot = PANTRY_SPOTS[name] || PANTRY_SPOTS.default;
    commandAgentTo(name, spot, 'pantry', '☕ Otw ngopi di pantry!');
    toast(`${name} berjalan ke Pantry untuk ngopi ☕`, 'ok');
    $('#agentPop').classList.add('hidden');
  };

  $('#apActionMeeting').onclick = () => {
    const spot = MEETING_SPOTS[name] || MEETING_SPOTS.default;
    commandAgentTo(name, spot, 'meeting', '🏃 Otw ruang rapat!');
    toast(`${name} berjalan ke Ruang Rapat 📢`, 'ok');
    $('#agentPop').classList.add('hidden');
  };

  $('#apActionDesk').onclick = () => {
    const desk = DESK_SPOTS[name] || DESK_SPOTS.default;
    commandAgentTo(name, desk, 'desk', '💻 Balik kerja di meja');
    toast(`${name} kembali ke meja kerja.`, 'ok');
    $('#agentPop').classList.add('hidden');
  };

  // Tampilkan Task Agen
  const tasks = allTasks().filter((t) => t.assignee === name);
  $('#apBody').innerHTML = tasks.length
    ? tasks.map((t) => `
        <div class="ap-task">
          <span class="dot ${t.status === 'running' ? 'busy' : 'on'}"></span>
          <div>
            <div style="font-weight:600">${esc(t.title)}</div>
            <div class="st">${COL_LABEL[t.status] || t.status} · ${timeAgo(t.updated_at || t.created_at)}</div>
          </div>
        </div>`).join('')
    : '<div class="ap-empty">Belum ada task yang dipegang.<br>Sedang santai ngopi atau standby.</div>';

  $('#agentPop').classList.remove('hidden');
  SFX.click();
}

/* ---------------- 3. CHAT AI VIEW (DEDICATED MESSAGING) ---------------- */
const DEFAULT_PRESET_MSGS = {};

function getChatHistory(agentName) {
  if (!state.chatHistory[agentName]) state.chatHistory[agentName] = [];
  return state.chatHistory[agentName];
}

function chatApi(agentName, opts = {}) {
  return fetch('/api/chat/' + encodeURIComponent(agentName), {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
}

async function loadChatHistory(agentName) {
  try {
    const r = await chatApi(agentName);
    if (!r.ok) return;
    const d = await r.json();
    if (d && d.agent === agentName) {
      state.chatHistory[agentName] = Array.isArray(d.messages) ? d.messages : [];
      state.chatBusy[agentName] = !!d.busy;
    }
  } catch {}
}

function preserveChatComposer() {
  const inp = $('#chatInput');
  if (!inp) return null;
  return {
    value: inp.value,
    start: inp.selectionStart,
    end: inp.selectionEnd,
    focused: document.activeElement === inp,
  };
}

function restoreChatComposer(snap) {
  if (!snap) return;
  const inp = $('#chatInput');
  if (!inp) return;
  inp.value = snap.value;
  if (snap.focused) {
    inp.focus({ preventScroll: true });
    try { inp.setSelectionRange(snap.start, snap.end); } catch {}
  }
}

async function chatPoll(agentName, text) {
  try {
    const r = await chatApi(agentName, { method: 'POST', body: JSON.stringify({ text }) });
    if (r.status === 409) {
      state.chatBusy[agentName] = false;
      toast('Agen sedang sibuk menjawab pesan sebelumnya.', 'warn');
      render();
      return;
    }
    if (!r.ok) throw new Error('bad');
  } catch {
    state.chatBusy[agentName] = false;
    const msgs = getChatHistory(agentName);
    msgs.push({ sender: 'ai', text: 'Gagal mengirim pesan ke agen. Coba lagi.', time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) });
    if (state.view === 'chat') render();
    return;
  }

  let tries = 0;
  const poll = setInterval(async () => {
    tries++;
    if (state.view !== 'chat' || tries > 180) {
      clearInterval(poll);
      state.chatBusy[agentName] = false;
      if (state.view === 'chat') render();
      return;
    }
    let d;
    try {
      const rr = await chatApi(agentName);
      d = await rr.json();
    } catch { return; }
    if (!d) return;
    state.chatHistory[agentName] = Array.isArray(d.messages) ? d.messages : [];
    state.chatBusy[agentName] = !!d.busy;
    if (state.view === 'chat' && state.chatAgent === agentName) {
      const feed = $('#chatMessages');
      const nearBottom = feed
        ? feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80
        : true;
      const snap = preserveChatComposer();
      render();
      restoreChatComposer(snap);
      const feedAfter = $('#chatMessages');
      if (feedAfter && nearBottom) feedAfter.scrollTop = feedAfter.scrollHeight;
    }
    if (!d.busy) {
      clearInterval(poll);
      const sim = state.agentsSim[agentName];
      if (sim) sim.holdUntil = Date.now() + 30000;
    }
  }, 2000);
}

function viewChat() {
  if (!state.profiles.length) {
    return `
      <div class="empty" style="padding:60px 20px">
        <h3>Menunggu Koneksi Hermes AI</h3>
        <p class="muted small" style="margin-top:6px">Belum ada agen AI yang terhubung. Jalankan server Hermes di port 9119 untuk memuat agen kamu.</p>
      </div>`;
  }

  const current = state.profiles.find((p) => p.name === state.chatAgent) || state.profiles[0];
  const sim = state.agentsSim[current.name] || {};
  const msgs = getChatHistory(current.name);
  loadChatHistory(current.name);

  // Rekomendasi Prompt Cepat berdasarkan agen
  const suggestions = {
    pm: ['Status sprint saat ini?', 'Jadwalkan rapat evaluasi', 'Prioritas task critical?', 'Yuk ngopi santai di pantry ☕'],
    dev: ['Review endpoint API', 'Status performa WebSocket', 'Bantu perbaiki bug kanban', 'Yuk ngopi santai di pantry ☕'],
    qa: ['Hasil test suite terbaru?', 'Ada bug regression?', 'Jalankan security scan', 'Yuk ngopi santai di pantry ☕'],
    sales: ['Update pipeline prospek klien', 'Siapkan proposal baru', 'Jadwalkan product demo', 'Yuk ngopi santai di pantry ☕'],
    marketing: ['Draft copy postingan LinkedIn', 'Ide campaign launching Q4', 'Cek matriks konversi web', 'Yuk ngopi santai di pantry ☕'],
  }[current.name] || ['Bantu task terbaru', 'Status pekerjaan kamu?'];

  return `
    <div class="chat-container">
      <!-- Sidebar Daftar Agen -->
      <div class="chat-side">
        <div class="chat-side-head">
          <h3>Saluran Chat Agen</h3>
          <span class="live-dot pulse"></span>
        </div>
        <div class="chat-agent-list">
          ${state.profiles.map((p) => {
            const active = p.name === current.name;
            const aSim = state.agentsSim[p.name];
            const loc = aSim ? aSim.room : 'Kantor';
            return `
              <button class="chat-tab-btn ${active ? 'active' : ''}" data-chat-select="${esc(p.name)}">
                <div class="avatar" style="width:34px;height:34px;font-size:13px;background:${avatarBg(p.name)}">${esc(initials(p.name))}</div>
                <div class="chat-tab-info">
                  <div class="chat-tab-name">${esc(p.name)}</div>
                  <div class="chat-tab-role">${esc(p.description || p.model || '')}</div>
                  <div class="chat-tab-loc">📍 ${esc(loc)}</div>
                </div>
              </button>
            `;
          }).join('')}
        </div>
      </div>

      <!-- Ruang Obrolan Aktif -->
      <div class="chat-main">
        <div class="chat-head">
          <div class="chat-head-agent">
            <div class="avatar" style="background:${avatarBg(current.name)}">${esc(initials(current.name))}</div>
            <div>
              <div class="chat-head-title">${esc(current.name)} <span class="tag-badge">${esc(current.model || 'AI')}</span></div>
              <div class="chat-head-sub">${esc(current.description || '')} · <b style="color:var(--warm)">📍 ${esc(sim.room || 'Kantor')}</b></div>
            </div>
          </div>
          <div class="chat-head-actions">
            <button id="chatActionCoffee" class="ghost" title="Ajak agen ini ngopi di pantry">☕ Ajak Ngopi</button>
            <button id="chatActionMeeting" class="ghost" title="Panggil ke ruang rapat">📢 Ke Ruang Rapat</button>
          </div>
        </div>

        <!-- Feed Pesan -->
        <div id="chatMessages" class="chat-messages">
          ${msgs.length ? msgs.map((m) => `
            <div class="chat-msg ${m.sender === 'user' ? 'user' : 'ai'}">
              <div class="chat-msg-av" style="background:${m.sender === 'user' ? 'linear-gradient(135deg,var(--acc),#059669)' : avatarBg(current.name)}">
                ${m.sender === 'user' ? 'U' : esc(initials(current.name))}
              </div>
              <div>
                <div class="chat-bubble">${esc(m.text)}</div>
                <div class="chat-msg-time">${esc(m.time || '')}</div>
              </div>
            </div>
          `).join('') : `
            <div class="empty" style="margin:auto;max-width:360px;border:none">
              <div class="avatar" style="width:48px;height:48px;margin:0 auto 12px;background:${avatarBg(current.name)}">${esc(initials(current.name))}</div>
              <div style="font-weight:700;font-size:15px">Ruang Chat ${esc(current.name)}</div>
              <div class="muted small" style="margin-top:4px">Ketik instruksi atau pilih salah satu saran prompt di bawah untuk mulai berinteraksi dengan agen AI ini.</div>
            </div>
          `}
          ${state.chatBusy[current.name] ? `
            <div class="chat-msg ai">
              <div class="chat-msg-av" style="background:${avatarBg(current.name)}">${esc(initials(current.name))}</div>
              <div><div class="chat-bubble muted">⏳ ${esc(current.name)} sedang mengerjakan…</div></div>
            </div>
          ` : ''}
        </div>

        <!-- Suggestion Prompt Chips -->
        <div class="chat-suggestions">
          ${suggestions.map((s) => `<button class="prompt-chip" data-send-text="${esc(s)}">${esc(s)}</button>`).join('')}
        </div>

        <!-- Input Bar -->
        <form id="chatForm" class="chat-input-bar">
          <input id="chatInput" type="text" placeholder="Ketik pesan atau instruksi untuk ${esc(current.name)}…" autocomplete="off">
          <button type="submit" class="btn primary send-btn">
            <span>Kirim</span>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </form>
      </div>
    </div>
  `;
}

function bindChat() {
  const current = state.chatAgent;

  // Ganti tab agen chat
  $$('[data-chat-select]').forEach((b) => {
    b.addEventListener('click', () => {
      state.chatAgent = b.dataset.chatSelect;
      SFX.click();
      render();
    });
  });

  // Suggestion chips
  $$('[data-send-text]').forEach((b) => {
    b.addEventListener('click', () => {
      $('#chatInput').value = b.dataset.sendText;
      $('#chatForm').dispatchEvent(new Event('submit'));
    });
  });

  // Action Buttons di chat
  $('#chatActionCoffee')?.addEventListener('click', () => {
    const spot = PANTRY_SPOTS[current] || PANTRY_SPOTS.default;
    commandAgentTo(current, spot, 'pantry', '☕ Otw ngopi di pantry!');
    toast(`${current} pamit ke Pantry untuk ngopi santai ☕`, 'ok');
    render();
  });

  $('#chatActionMeeting')?.addEventListener('click', () => {
    const spot = MEETING_SPOTS[current] || MEETING_SPOTS.default;
    commandAgentTo(current, spot, 'meeting', '🏃 Otw ruang rapat!');
    toast(`${current} segera menuju ke Ruang Rapat 📢`, 'ok');
    render();
  });

  // Kirim Pesan ke agen sungguhan
  const form = $('#chatForm');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('#chatInput');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';

      const now = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      const msgs = getChatHistory(current);
      msgs.push({ sender: 'user', text, time: now });
      state.chatBusy[current] = true;
      const desk = DESK_SPOTS[current] || DESK_SPOTS.default;
      commandAgentTo(current, desk, 'desk', '⚡ Siap! Mengerjakan pesanmu…');
      SFX.ping();
      render();
      const feed = $('#chatMessages');
      if (feed) feed.scrollTop = feed.scrollHeight;

      chatPoll(current, text);
    });
  }

  // Auto-scroll ke bawah saat buka chat
  const feed = $('#chatMessages');
  if (feed) feed.scrollTop = feed.scrollHeight;
}

/* ---------------- 4. TIM VIEW ---------------- */
function viewTim() {
  return `
    <div class="grid team">
      ${state.profiles.map((p) => memberCard(p)).join('') || '<div class="empty">Belum ada profil agen.</div>'}
    </div>
    <div class="muted small" style="margin-top:20px;padding:12px;background:var(--panel2);border-radius:10px;border:1px solid var(--line)">
      📌 <b>Status Kerja:</b> <b>Sibuk</b> = sedang running task di komputer meja, <b>Siap</b> = ada antrian task, <b>Santai</b> = lagi kosong & bisa diajak ngopi atau rapat.
    </div>
  `;
}

/* ---------------- 5. KANBAN BOARD VIEW ---------------- */
function viewBoard() {
  const cols = boardColumns();
  return `
    <div class="section-title" style="margin-top:0">
      <h2>Papan Kanban AI</h2>
      <button class="btn primary" id="newTask">＋ Task Baru</button>
    </div>
    <div class="board">
      ${cols.map((c) => `
        <div class="col" data-status="${c.key}">
          <div class="col-head">
            <span>${c.icon}</span> ${esc(c.label)}
            <span class="cnt">${c.tasks.length}</span>
          </div>
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
        <span class="task-assignee">@${esc(t.assignee || 'belum')}</span>
      </div>
    </div>`;
}

function bindBoard() {
  $('#newTask')?.addEventListener('click', openModal);

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
        SFX.click();
        toast('Task dipindah ke ' + (COL_LABEL[status] || status), 'ok');
      } catch (err) {
        toast(err.message, 'bad');
      }
    });
  });
}

/* ---------------- 6. PROYEK VIEW ---------------- */
function viewProyek() {
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

/* ---------------- 7. MONITOR LIVE VIEW ---------------- */
function viewMonitor() {
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

/* ---------------- 8. HASIL KERJA VIEW ---------------- */
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

function viewHasilDetail() {
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

/* ============================================================
   MODAL TASK BARU
   ============================================================ */
function openModal() {
  $('#tTitle').value = '';
  $('#tBody').value = '';
  $('#taskErr').textContent = '';
  const sel = $('#tAssignee');
  sel.innerHTML = '<option value="">— Belum di-assign (Triage) —</option>' +
    state.profiles.map((p) => `<option value="${esc(p.name)}">${esc(p.name)} (${esc(p.description || '')})</option>`).join('');
  $('#modal').classList.remove('hidden');
  SFX.click();
  setTimeout(() => $('#tTitle').focus(), 50);
}
function closeModal() { $('#modal').classList.add('hidden'); }

$('#taskSave').addEventListener('click', async () => {
  const title = $('#tTitle').value.trim();
  if (!title) { $('#taskErr').textContent = 'Judul task wajib diisi.'; return; }
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
    SFX.fanfare();
    toast('Task berhasil dibuat dan ditugaskan!', 'ok');
  } catch (e) {
    $('#taskErr').textContent = e.message;
  }
});
$('#taskCancel').addEventListener('click', closeModal);
$('#modalClose').addEventListener('click', closeModal);
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

/* ============================================================
   GLOBAL NAVIGATION & EVENT BINDINGS
   ============================================================ */
function bindNav() {
  const switchView = (targetView) => {
    state.view = targetView;
    if (state.view !== 'hasil') { state.hasilId = null; state.hasilDetail = null; }
    $$('#nav button').forEach((x) => x.classList.toggle('active', x.dataset.view === targetView));
    $$('.bottomnav button').forEach((x) => x.classList.toggle('active', x.dataset.view === targetView));
    SFX.click();
    render();
  };

  $$('#nav button').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));
  $$('.bottomnav button').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));

  $('#view').addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]');
    if (g) switchView(g.dataset.go);

    const chatTarget = e.target.closest('[data-chat-agent]');
    if (chatTarget) {
      state.chatAgent = chatTarget.dataset.chatAgent;
      switchView('chat');
    }
  });

  $('#refresh')?.addEventListener('click', () => { load(); SFX.click(); toast('Data kantor dimuat ulang', 'ok'); });
  $('#bgmBtn')?.addEventListener('click', toggleBGM);
  $('#sfxBtn')?.addEventListener('click', toggleSFX);
  $('#quickPartyBtn')?.addEventListener('click', triggerPartyAll);

  $('#logout')?.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    location.reload();
  });

  $('#apClose')?.addEventListener('click', () => $('#agentPop').classList.add('hidden'));
}

/* Clock Timer */
setInterval(() => {
  const d = new Date();
  const c = $('#clock');
  if (c) c.textContent = d.toLocaleString('id-ID', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}, 1000);

/* Login Form */
function showLogin() {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
}

$('#loginForm')?.addEventListener('submit', async (e) => {
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
  SFX.fanfare();
  await load();
});

/* BOOTSTRAP */
(async function boot() {
  bindNav();
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
