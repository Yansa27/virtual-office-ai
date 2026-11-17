/**
 * engine.js — rendering & interaksi kantor 2D (canvas/engine concern).
 * Sprite pixel art, denah SVG, sinkronisasi status agen, polling board,
 * drawer agen, event party/rapat, dan view Kantor 2D.
 */
import {
  $, $$, state, esc, COL_LABEL, DESK_SPOTS, MEETING_SPOTS, PANTRY_SPOTS,
  AGENT_THEMES, initials, avatarBg, toast, timeAgo,
} from './core.js';
import { SFX } from './audio.js';
import { api, allTasks, presenceFor, currentTask } from './api.js';
import { openModal } from './modal.js';
import { commandAgentTo } from './waypoint.js';
import { render } from './views.js';

/* ---------------- KANTOR 2D VIEW (STARDEW VALLEY) ---------------- */
export function viewKantor() {
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

export function syncOfficeAgent(name) {
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

export function recordOfficeTaskChanges() {
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

export function bindOffice() {
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

export function openAgentDrawer(name) {
  const p = state.profiles.find((x) => x.name === name);
  if (!p) return;
  const pres = presenceFor(name);
  const _sim = state.agentsSim[name] || {};

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

/* Event: Party & Coffee Break All */
export function triggerPartyAll() {
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
export function triggerMeetingAll() {
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
export function triggerBackToDeskAll() {
  state.partyMode = false;
  state.meetingMode = false;
  SFX.click();
  toast('💻 Semua agen kembali ke meja kerja.', 'ok');

  state.profiles.forEach((p) => {
    const desk = DESK_SPOTS[p.name] || DESK_SPOTS.default;
    commandAgentTo(p.name, desk, 'desk', '💻 Balik fokus di meja');
  });
}
