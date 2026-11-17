/**
 * modal.js — modal task baru (dipakai board, kantor, dan aksi global).
 */
import { $, state, esc, toast } from './core.js';
import { api } from './api.js';
import { SFX } from './audio.js';
import { load } from './views.js';

export function openModal() {
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
export function closeModal() { $('#modal').classList.add('hidden'); }

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
