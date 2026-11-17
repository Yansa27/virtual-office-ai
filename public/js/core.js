/**
 * core.js — fondasi frontend Virtual Office.
 * State global, konstanta tampilan, helper DOM/format, dan toast.
 * Semua modul di public/js/* berbagi state yang sama lewat modul ini.
 */

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* ============================================================
   GLOBAL APPLICATION STATE
   ============================================================ */
export const state = {
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
  chatLog: [],
  logFilter: 'all',
  logSig: null,
  logTimer: null,

  /* Audio Synthesizer */
  bgmActive: false,
  sfxActive: true,

  /* 2D Office & Simulation */
  timeOfDay: 'day', // 'morning' | 'day' | 'sunset' | 'night'
  partyMode: false,
  meetingMode: false,
  agentsSim: {}, // name -> { x, y, targetX, targetY, path: [], state, room, facing, bubble, bubbleTimer, walking: bool }
};

export const TITLES = {
  dashboard: ['Dashboard', 'Ringkasan kantor virtual & aktivitas tim agen AI'],
  kantor: ['Kantor 2D', 'Jasvero HQ · Ruang kerja tim AI'],
  chat: ['Chat AI', 'Ruang diskusi langsung dengan setiap agen AI spesialis'],
  log: ['Log Aktivitas', 'Riwayat tugas & percakapan yang kamu berikan ke para agen'],
  tim: ['Tim Agen', 'Daftar agen AI, keahlian spesifik, dan status kehadiran'],
  board: ['Board Kanban', 'Manajemen tugas tim — seret kartu antar kolom'],
  proyek: ['Proyek', 'Daftar proyek & inisiatif digital yang sedang berjalan'],
  monitor: ['Monitor Live', 'Pantau eksekusi tugas agen secara real-time (auto-refresh 5s)'],
  hasil: ['Hasil Kerja', 'Deliverable, laporan riset, dan output selesai dari para agen'],
};

export const COL_ICON = { triage: '◇', todo: '◻', scheduled: '⏱', ready: '▶', running: '●', blocked: '⊘', review: '◎', done: '✓' };
export const COL_LABEL = { triage: 'Triage', todo: 'Todo', scheduled: 'Scheduled', ready: 'Ready', running: 'Running', blocked: 'Blocked', review: 'Review', done: 'Done' };
export const PRIO = { 0: 'Normal', 1: 'Penting', 2: 'Mendesak' };

/* Lokasi meja kerja bawaan di kanvas SVG (1200 x 760) */
export const DESK_SPOTS = {
  pm: { x: 150, y: 257, room: 'Studio Lead' },
  sales: { x: 300, y: 257, room: 'Studio Lead' },
  dev: { x: 512, y: 257, room: 'Workspace' },
  fe: { x: 684, y: 257, room: 'Workspace' },
  marketing: { x: 858, y: 257, room: 'Workspace' },
  qa: { x: 990, y: 257, room: 'Workspace' },
  default: { x: 1100, y: 300, room: 'Workspace' },
};
export const MEETING_SPOTS = {
  pm: { x: 245, y: 520, room: 'Meeting' },
  dev: { x: 322, y: 520, room: 'Meeting' },
  fe: { x: 280, y: 520, room: 'Meeting' },
  qa: { x: 400, y: 520, room: 'Meeting' },
  marketing: { x: 477, y: 520, room: 'Meeting' },
  sales: { x: 560, y: 520, room: 'Meeting' },
  default: { x: 140, y: 510, room: 'Meeting' },
};
export const PANTRY_SPOTS = {
  pm: { x: 897, y: 535, room: 'Coffee lounge' },
  dev: { x: 990, y: 535, room: 'Coffee lounge' },
  fe: { x: 1040, y: 535, room: 'Coffee lounge' },
  qa: { x: 897, y: 597, room: 'Coffee lounge' },
  sales: { x: 1090, y: 635, room: 'Coffee lounge' },
  marketing: { x: 990, y: 597, room: 'Coffee lounge' },
  default: { x: 860, y: 560, room: 'Coffee lounge' },
};

/* Palet warna avatar & sprite karakter */
export const AGENT_THEMES = {
  pm:        { c1: '#06b6d4', c2: '#0284c7', hair: '#1e293b', shirt: '#0ea5e9', pants: '#334155', title: 'Product Lead' },
  dev:       { c1: '#8b5cf6', c2: '#6d28d9', hair: '#312e81', shirt: '#8b5cf6', pants: '#1e1b4b', title: 'Fullstack Dev' },
  fe:        { c1: '#38bdf8', c2: '#2563eb', hair: '#1e3a8a', shirt: '#3b82f6', pants: '#172554', title: 'Frontend & UI/UX' },
  qa:        { c1: '#10b981', c2: '#059669', hair: '#064e3b', shirt: '#10b981', pants: '#0f172a', title: 'QA Specialist' },
  sales:     { c1: '#f59e0b', c2: '#d97706', hair: '#78350f', shirt: '#f59e0b', pants: '#451a03', title: 'Sales & Growth' },
  marketing: { c1: '#f43f5e', c2: '#e11d48', hair: '#881337', shirt: '#f43f5e', pants: '#4c0519', title: 'Creative Content' },
  default:   { c1: '#64748b', c2: '#475569', hair: '#334155', shirt: '#94a3b8', pants: '#1e293b', title: 'Support Bot' },
};

/* Helper strings & formatters */
export function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return s + ' dtk lalu';
  if (s < 3600) return Math.floor(s / 60) + ' mnt lalu';
  if (s < 86400) return Math.floor(s / 3600) + ' jam lalu';
  return Math.floor(s / 86400) + ' hari lalu';
}
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function initials(n) {
  const p = String(n || '?').split(/[\s_-]+/).filter(Boolean);
  return ((p[0] ? p[0][0] : '?') + (p[1] ? p[1][0] : '')).toUpperCase();
}
export function avatarColors(name) {
  const t = AGENT_THEMES[name] || AGENT_THEMES.default;
  return [t.c1, t.c2];
}
export function avatarBg(name) {
  const [a, b] = avatarColors(name);
  return `linear-gradient(135deg, ${a}, ${b})`;
}

let toastTimer;
export function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3200);
}
