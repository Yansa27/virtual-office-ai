/**
 * ui.js — shell aplikasi: navigasi, login/logout, jam, toggle audio, bootstrap.
 * Isi identik dengan bagian bawah app.js monolit (bindNav/showLogin/boot).
 */
import { $, $$, state, toast } from './core.js';
import { SFX, toggleBGM, toggleSFX } from './audio.js';
import { triggerPartyAll } from './engine.js';
import { load, render, applyLogFilter } from './views.js';

export function bindNav() {
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

    const lf = e.target.closest('[data-log-filter]');
    if (lf) {
      if ((state.logFilter || 'all') === lf.dataset.logFilter) return;
      state.logFilter = lf.dataset.logFilter;
      SFX.click();
      // Update in-place: chip tidak dibangun ulang, fokus keyboard tetap di tombol.
      applyLogFilter();
      return;
    }

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
export function showLogin() {
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

/* Sesi habis (api.js memancarkan 'vo:session-expired') */
window.addEventListener('vo:session-expired', () => showLogin());

/* BOOTSTRAP */
export async function boot() {
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
}