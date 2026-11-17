/**
 * chat.js — view Chat AI (chat concern).
 * Tab per agen, suggestion chips, composer, polling balasan agen, dan
 * aksi cepat (ajak ngopi / ke ruang rapat).
 */
import {
  $, $$, state, esc, initials, avatarBg, toast,
  DESK_SPOTS, MEETING_SPOTS, PANTRY_SPOTS,
} from './core.js';
import { SFX } from './audio.js';
import { render } from './views.js';
import { commandAgentTo } from './waypoint.js';

/** Simple markdown → HTML renderer (lightweight, no deps). */
function md(text) {
  if (!text) return '';
  const src = String(text)
    .replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');

  // 1) Angkut code block dulu supaya isinya tak ikut keparse.
  const blocks = [];
  let s = src.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push(`<pre><code class="language-${esc(lang)}">${esc(code.trim())}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });

  // Inline helpers per baris.
  const inline = (t) => t
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // 2) Parse per baris: tabel, list, header, hr, quote, paragraf.
  const lines = s.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trim = line.trim();

    if (!trim) { i++; continue; }
    if (/^\u0000\d+\u0000$/.test(trim)) { out.push(blocks[+trim.slice(1, -1)]); i++; continue; }

    // Tabel: | a | b | ... (baris separator |---| dilewati)
    if (/^\|.*\|$/.test(trim)) {
      const rows = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
        const cells = lines[i].trim().split('|').slice(1, -1).map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const head = rows[0] || [];
      const body = rows.slice(1);
      out.push('<table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead>'
        + '<tbody>' + body.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }

    // List unordered / ordered
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items = [];
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+[.)]\s+/.test(lines[i]))) {
        items.push(lines[i].replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').trim());
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>` + items.map((it) => `<li>${inline(it)}</li>`).join('') + `</${tag}>`);
      continue;
    }

    // Header
    const h = trim.match(/^(#{1,4})\s+(.+)$/);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }

    // HR
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trim)) { out.push('<hr>'); i++; continue; }

    // Blockquote (gabung baris > berurutan)
    if (/^>\s?/.test(trim)) {
      const q = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) { q.push(lines[i].trim().replace(/^>\s?/, '')); i++; }
      out.push(`<blockquote>${q.map(inline).join('<br>')}</blockquote>`);
      continue;
    }

    // Paragraf (gabung sampai baris kosong / blok lain)
    const para = [];
    while (i < lines.length && lines[i].trim()
      && !/^(\|.*\||#{1,4}\s|>\s?|-{3,}$|\u0000\d+\u0000$|^\s*[-*]\s|^\s*\d+[.)]\s)/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
  }

  return out.join('\n');
}

export function getChatHistory(agentName) {
  if (!state.chatHistory[agentName]) state.chatHistory[agentName] = [];
  return state.chatHistory[agentName];
}

function chatApi(agentName, opts = {}) {
  return fetch('/api/chat/' + encodeURIComponent(agentName), {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
}

export async function loadChatHistory(agentName) {
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

export function viewChat() {
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
    fe: ['Rapikan halaman Log Aktivitas di mobile 390px, pastikan tidak ketutup bottom nav', 'Audit tampilan Chat AI: cek kontras, spacing, dan kolom input di desktop', 'Yuk ngopi santai di pantry ☕'],
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
                <div class="chat-bubble">${m.sender === 'ai' ? md(m.text) : esc(m.text)}</div>
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

export function bindChat() {
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
