'use strict';
const $ = (s, r = document) => r.querySelector(s);
const state = { rooms: [], guests: [], reservations: [] };
const money = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt = (d) => d.split('-').reverse().join('/');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const roomName = (id) => state.rooms.find((r) => r.id === id)?.name ?? '?';
const guestName = (id) => state.guests.find((g) => g.id === id)?.name ?? '?';

let toastT;
function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg; t.className = err ? 'err' : ''; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 4500);
}

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erro');
  return data;
}
async function act(fn, ok) {
  try { await fn(); if (ok) toast(ok); await refresh(); } catch (e) { toast(e.message, true); }
}
async function refresh() {
  [state.rooms, state.guests, state.reservations] = await Promise.all([api('GET', '/api/rooms'), api('GET', '/api/guests'), api('GET', '/api/reservations')]);
  render();
}

// ---- Abas ----
document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('main > section').forEach((s) => (s.hidden = s.id !== b.dataset.tab));
  render();
}));

function formData(form) { return Object.fromEntries(new FormData(form)); }

// ---- Painel ----
function renderPainel() {
  const t = today();
  const act_ = state.reservations.filter((r) => r.status === 'confirmada' || r.status === 'hospedado');
  const occupied = act_.filter((r) => r.checkIn <= t && t < r.checkOut);
  const usable = state.rooms.filter((r) => r.status !== 'manutencao').length;
  const arrivals = act_.filter((r) => r.checkIn === t);
  const departures = act_.filter((r) => r.checkOut === t);
  const revenue = act_.reduce((s, r) => s + r.total, 0);
  const list = (arr, label) => arr.length
    ? `<ul>${arr.map((r) => `<li>${esc(guestName(r.guestId))} — ${esc(roomName(r.roomId))} (${r.people} pessoa(s))</li>`).join('')}</ul>`
    : `<p class="muted">Nenhum ${label} hoje.</p>`;
  $('#painel').innerHTML = `
    <div class="stats">
      <div class="stat"><b>${occupied.length}/${usable}</b>Quartos ocupados hoje</div>
      <div class="stat"><b>${usable ? Math.round((occupied.length / usable) * 100) : 0}%</b>Taxa de ocupação</div>
      <div class="stat"><b>${act_.filter((r) => r.checkOut >= t).length}</b>Reservas futuras/atuais</div>
      <div class="stat"><b>${money(revenue)}</b>Receita prevista (ativas)</div>
    </div>
    <div class="card"><h2>Chegadas hoje</h2>${list(arrivals, 'check-in')}</div>
    <div class="card"><h2>Saídas hoje</h2>${list(departures, 'check-out')}</div>`;
}

// ---- Calendário ----
const DAYS = 21;
function renderCal() {
  const input = $('#calStart');
  if (!input.value) input.value = today();
  const start = input.value;
  const days = Array.from({ length: DAYS }, (_, i) => addDays(start, i));
  const t = today();
  let h = '<table class="cal"><tr><th></th>' + days.map((d) => {
    const wd = new Date(d + 'T00:00:00Z').getUTCDay();
    return `<th class="${d === t ? 'today' : ''} ${wd === 0 || wd === 6 ? 'we' : ''}">${d.slice(8)}/${d.slice(5, 7)}</th>`;
  }).join('') + '</tr>';
  for (const room of state.rooms) {
    h += `<tr><td class="room">${esc(room.name)}</td>`;
    for (let i = 0; i < DAYS;) {
      const d = days[i];
      const r = state.reservations.find((x) => x.roomId === room.id && (x.status === 'confirmada' || x.status === 'hospedado') && x.checkIn <= d && d < x.checkOut);
      if (r) {
        let span = 1;
        while (i + span < DAYS && days[i + span] < r.checkOut) span++;
        h += `<td class="res ${r.status}" colspan="${span}" title="${esc(guestName(r.guestId))}: ${fmt(r.checkIn)} → ${fmt(r.checkOut)}">${esc(guestName(r.guestId))}</td>`;
        i += span;
      } else {
        h += `<td class="${room.status === 'manutencao' ? 'maint' : ''}"></td>`;
        i++;
      }
    }
    h += '</tr>';
  }
  $('#calGrid').innerHTML = h + '</table>';
}
$('#prev').onclick = () => { $('#calStart').value = addDays($('#calStart').value, -7); renderCal(); };
$('#next').onclick = () => { $('#calStart').value = addDays($('#calStart').value, 7); renderCal(); };
$('#calStart').onchange = renderCal;

// ---- Reservas ----
const resForm = $('#resForm');
function updatePricePlaceholder() {
  const f = formData(resForm);
  if (!f.checkIn || !f.checkOut || f.checkOut <= f.checkIn || !resForm.roomId.value) {
    resForm.total.placeholder = 'Padrão calculado';
    return;
  }
  const room = state.rooms.find((r) => r.id === resForm.roomId.value);
  if (!room) {
    resForm.total.placeholder = 'Padrão calculado';
    return;
  }
  const n = (new Date(f.checkOut) - new Date(f.checkIn)) / 86400000;
  if (n > 0) {
    const def = n * room.price;
    resForm.total.placeholder = `Padrão: ${money(def)} (${n}x ${money(room.price)})`;
  } else {
    resForm.total.placeholder = 'Padrão calculado';
  }
}
async function updateAvailable() {
  const f = formData(resForm);
  const sel = resForm.roomId;
  const prev = sel.value;
  const info = $('#resInfo');
  if (!f.checkIn || !f.checkOut || f.checkOut <= f.checkIn) {
    sel.innerHTML = '<option value="">Informe as datas</option>';
    info.textContent = f.checkIn && f.checkOut ? 'A saída deve ser posterior à entrada.' : '';
    updatePricePlaceholder();
    return;
  }
  try {
    const rooms = await api('GET', `/api/availability?checkIn=${f.checkIn}&checkOut=${f.checkOut}&people=${f.people || 1}${editingId ? '&ignore=' + editingId : ''}`);
    sel.innerHTML = rooms.length
      ? rooms.map((r) => `<option value="${r.id}">${esc(r.name)} · até ${r.capacity} · ${money(r.price)}/noite</option>`).join('')
      : '<option value="">Nenhum quarto disponível</option>';
    if (rooms.some((r) => r.id === prev)) sel.value = prev;
    const n = (new Date(f.checkOut) - new Date(f.checkIn)) / 86400000;
    const selRoom = state.rooms.find((r) => r.id === sel.value);
    const defMsg = selRoom && n > 0 ? ` · Total padrão: ${money(n * selRoom.price)}` : '';
    info.textContent = `${n} noite(s) · ${rooms.length} quarto(s) disponível(is)${defMsg}`;
    updatePricePlaceholder();
  } catch (e) { info.textContent = e.message; }
}
['checkIn', 'checkOut', 'people'].forEach((n) => resForm[n].addEventListener('change', updateAvailable));
resForm.roomId.addEventListener('change', () => {
  const f = formData(resForm);
  const n = (new Date(f.checkOut) - new Date(f.checkIn)) / 86400000;
  const selRoom = state.rooms.find((r) => r.id === resForm.roomId.value);
  const defMsg = selRoom && n > 0 ? ` · Total padrão: ${money(n * selRoom.price)}` : '';
  const baseText = $('#resInfo').textContent.split(' · Total padrão:')[0];
  if (baseText) $('#resInfo').textContent = `${baseText}${defMsg}`;
  updatePricePlaceholder();
});
resForm.checkIn.addEventListener('change', () => {
  if (!resForm.checkOut.value || resForm.checkOut.value <= resForm.checkIn.value) resForm.checkOut.value = addDays(resForm.checkIn.value, 1);
  updateAvailable();
});
resForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = formData(resForm);
  const payload = { ...f, people: Number(f.people) };
  if (f.total !== undefined && f.total !== '') {
    payload.total = Number(f.total);
  } else {
    delete payload.total;
  }
  if (editingId) {
    act(async () => { await api('PUT', `/api/reservations/${editingId}`, payload); stopEdit(); }, 'Reserva atualizada!');
  } else {
    act(async () => { await api('POST', '/api/reservations', payload); resForm.notes.value = ''; resForm.total.value = ''; }, 'Reserva criada!');
  }
});

let editingId = null;
function stopEdit() {
  editingId = null;
  resForm.total.value = '';
  const title = $('#resFormTitle');
  if (title) title.textContent = 'Nova reserva';
  $('#resSubmit').textContent = 'Reservar';
  $('#resCancel').hidden = true;
  updatePricePlaceholder();
}
function startEdit(id) {
  const r = state.reservations.find((x) => x.id === id);
  if (!r) return;
  editingId = id;
  resForm.guestId.value = r.guestId;
  resForm.checkIn.value = r.checkIn;
  resForm.checkOut.value = r.checkOut;
  resForm.people.value = r.people;
  resForm.total.value = r.total != null ? r.total : '';
  resForm.notes.value = r.notes || '';
  const title = $('#resFormTitle');
  if (title) title.textContent = `Editar reserva (${roomName(r.roomId)})`;
  $('#resSubmit').textContent = 'Salvar alterações';
  $('#resCancel').hidden = false;
  updateAvailable().then(() => {
    resForm.roomId.value = r.roomId;
    updatePricePlaceholder();
  });
  resForm.scrollIntoView({ behavior: 'smooth' });
}
$('#resCancel').onclick = () => { stopEdit(); updateAvailable(); };
$('#resFilter').onchange = renderResTable;

function renderResTable() {
  const f = $('#resFilter').value;
  const rows = state.reservations
    .filter((r) => f === 'todas' ? true : f === 'ativas' ? r.status === 'confirmada' || r.status === 'hospedado' : r.status === f)
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  const btn = (id, st, label, cls = '') => `<button class="small ${cls}" data-act="status" data-id="${id}" data-st="${st}">${label}</button>`;
  $('#resTable').innerHTML = '<tr><th>Hóspede</th><th>Quarto</th><th>Entrada</th><th>Saída</th><th>Pessoas</th><th>Total</th><th>Status</th><th></th></tr>' +
    (rows.map((r) => `<tr>
      <td>${esc(guestName(r.guestId))}${r.notes ? ` <span class="muted" title="${esc(r.notes)}">📝</span>` : ''}</td>
      <td>${esc(roomName(r.roomId))}</td><td>${fmt(r.checkIn)}</td><td>${fmt(r.checkOut)}</td>
      <td>${r.people}</td>
      <td>${money(r.total)} <button class="small" data-act="change-price" data-id="${r.id}" title="Alterar valor da reserva (descontos, promoções)">✏️</button></td>
      <td><span class="badge ${r.status}">${r.status}</span></td>
      <td>${r.status === 'confirmada' ? btn(r.id, 'hospedado', 'Check-in') + btn(r.id, 'cancelada', 'Cancelar', 'danger') : ''}
          ${r.status === 'hospedado' ? btn(r.id, 'finalizada', 'Check-out') : ''}
          ${r.status === 'cancelada' ? btn(r.id, 'confirmada', 'Reativar') : ''}
          ${r.status === 'confirmada' || r.status === 'hospedado' ? `<button class="small" data-act="edit" data-id="${r.id}">Editar</button>` : ''}
          <button class="small danger" data-act="del" data-id="${r.id}">Excluir</button></td></tr>`).join('') ||
      '<tr><td colspan="8" class="muted">Nenhuma reserva.</td></tr>');
}
$('#resTable').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.act === 'status') act(() => api('PUT', `/api/reservations/${b.dataset.id}`, { status: b.dataset.st }), 'Reserva atualizada.');
  if (b.dataset.act === 'edit') startEdit(b.dataset.id);
  if (b.dataset.act === 'change-price') {
    const r = state.reservations.find((x) => x.id === b.dataset.id);
    if (!r) return;
    const input = prompt(`Modificar valor da reserva (${guestName(r.guestId)}) - Quarto: ${roomName(r.roomId)}\nValor atual: ${money(r.total)}\nInforme o novo valor total (R$):`, r.total);
    if (input === null) return;
    const clean = input.replace(',', '.').trim();
    const val = Number(clean);
    if (!Number.isFinite(val) || val < 0 || clean === '') {
      toast('Valor inválido. Digite um número maior ou igual a zero.', true);
      return;
    }
    act(() => api('PUT', `/api/reservations/${r.id}`, { total: val }), 'Valor da reserva atualizado!');
  }
  if (b.dataset.act === 'del' && confirm('Excluir esta reserva?')) act(() => api('DELETE', `/api/reservations/${b.dataset.id}`), 'Reserva excluída.');
});

// ---- Quartos ----
$('#roomForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = formData(e.target);
  act(async () => { await api('POST', '/api/rooms', f); e.target.name.value = ''; }, 'Quarto cadastrado!');
});
function renderRooms() {
  $('#roomTable').innerHTML = '<tr><th>Nome</th><th>Capacidade</th><th>Diária</th><th>Status</th><th></th></tr>' +
    state.rooms.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.capacity}</td><td>${money(r.price)}</td>
      <td><span class="badge ${r.status}">${r.status === 'ativo' ? 'disponível' : 'manutenção'}</span></td>
      <td><button class="small" data-act="toggle" data-id="${r.id}" data-st="${r.status === 'ativo' ? 'manutencao' : 'ativo'}">${r.status === 'ativo' ? 'Pôr em manutenção' : 'Reativar'}</button>
      <button class="small danger" data-act="del" data-id="${r.id}">Excluir</button></td></tr>`).join('');
}
$('#roomTable').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.act === 'toggle') act(() => api('PUT', `/api/rooms/${b.dataset.id}`, { status: b.dataset.st }));
  if (b.dataset.act === 'del' && confirm('Excluir quarto e seu histórico de reservas?')) act(() => api('DELETE', `/api/rooms/${b.dataset.id}`), 'Quarto excluído.');
});

// ---- Hóspedes ----
$('#guestForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = formData(e.target);
  act(async () => { await api('POST', '/api/guests', f); e.target.reset(); }, 'Hóspede cadastrado!');
});
function renderGuests() {
  $('#guestTable').innerHTML = '<tr><th>Nome</th><th>Telefone</th><th>E-mail</th><th>Documento</th><th>Reservas</th><th></th></tr>' +
    (state.guests.map((g) => `<tr><td>${esc(g.name)}</td><td>${esc(g.phone)}</td><td>${esc(g.email)}</td><td>${esc(g.document)}</td>
      <td>${state.reservations.filter((r) => r.guestId === g.id).length}</td>
      <td><button class="small danger" data-id="${g.id}">Excluir</button></td></tr>`).join('') ||
      '<tr><td colspan="6" class="muted">Nenhum hóspede cadastrado.</td></tr>');
}
$('#guestTable').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (confirm('Excluir hóspede e suas reservas?')) act(() => api('DELETE', `/api/guests/${b.dataset.id}`), 'Hóspede excluído.');
});

function renderGuestSelect() {
  const sel = resForm.guestId, prev = sel.value;
  sel.innerHTML = state.guests.length
    ? state.guests.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('')
    : '<option value="">Cadastre um hóspede primeiro</option>';
  if (state.guests.some((g) => g.id === prev)) sel.value = prev;
}

function render() {
  renderPainel(); renderCal(); renderResTable(); renderRooms(); renderGuests(); renderGuestSelect(); updateAvailable();
}

resForm.checkIn.value = today();
resForm.checkOut.value = addDays(today(), 1);
refresh().catch((e) => toast(e.message, true));

