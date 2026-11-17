/**
 * api.js — lapisan API & data kanban.
 * Semua request lewat prefix /api/kanban (server memproxy ke Hermes / fallback SQLite).
 * Resp 401 memancarkan event 'vo:session-expired' (ditangani ui.js → showLogin).
 */
import { state, COL_ICON, COL_LABEL } from './core.js';

export async function api(p, opts = {}) {
  const res = await fetch('/api/kanban' + p, { headers: { 'Content-Type': 'application/json' }, ...opts });
  let data = null;
  try { data = await res.json(); } catch {}
  if (res.status === 401) { window.dispatchEvent(new Event('vo:session-expired')); throw new Error('Sesi habis, login lagi.'); }
  if (!res.ok) {
    const msg = (data && (data.error || (Array.isArray(data.detail) ? data.detail[0]?.msg : data.detail))) || ('HTTP ' + res.status);
    throw new Error(msg);
  }
  return data;
}

export async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  let data = null;
  try { data = await res.json(); } catch {}
  if (res.status === 401) { window.dispatchEvent(new Event('vo:session-expired')); throw new Error('Sesi habis, login lagi.'); }
  if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
  return data;
}

export function boardColumns() {
  const wf = (state.workflow && state.workflow.columns) || [];
  const cols = (state.board && state.board.columns) || [];
  const byName = Object.fromEntries(cols.map((c) => [c.name, c.tasks || []]));
  if (wf.length) {
    return wf.map((w) => ({ key: w.key, label: w.label || COL_LABEL[w.key] || w.key, icon: w.icon || COL_ICON[w.key] || '•', tasks: byName[w.key] || [] }));
  }
  return cols.map((c) => ({ key: c.name, label: COL_LABEL[c.name] || c.name, icon: COL_ICON[c.name] || '•', tasks: c.tasks || [] }));
}
export function allTasks() {
  return boardColumns().flatMap((c) => c.tasks);
}
export function presenceFor(name) {
  if (state.chatBusy && state.chatBusy[name]) return 'busy';
  const cols = boardColumns();
  if (cols.some((c) => c.key === 'running' && c.tasks.some((t) => t.assignee === name))) return 'busy';
  if (cols.some((c) => ['ready', 'review'].includes(c.key) && c.tasks.some((t) => t.assignee === name))) return 'on';
  return 'off';
}
export function currentTask(name) {
  const order = { running: 0, blocked: 1, review: 2, ready: 3, scheduled: 4, todo: 5, triage: 6 };
  const list = allTasks().filter((t) => t.assignee === name && t.status !== 'done');
  if (!list.length) return null;
  return list.slice().sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9))[0];
}
