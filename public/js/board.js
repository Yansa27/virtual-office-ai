/**
 * board.js — view Kanban (kanban concern).
 * Render kolom + kartu, drag & drop antar kolom via PATCH /api/kanban/tasks/:id.
 */
import { $, $$, esc, COL_LABEL, PRIO, toast } from './core.js';
import { api, boardColumns } from './api.js';
import { SFX } from './audio.js';
import { load } from './views.js';
import { openModal } from './modal.js';

export function viewBoard() {
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

export function bindBoard() {
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
