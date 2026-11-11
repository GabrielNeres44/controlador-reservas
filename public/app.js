'use strict';
const $ = (s, r = document) => r.querySelector(s);
const state = { rooms: [], guests: [], reservations: [], channels: [] };
const money = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmt = (d) => d.split('-').reverse().join('/');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const roomName = (id) => state.rooms.find((r) => r.id === id)?.name ?? '?';
const guestName = (id) => state.guests.find((g) => g.id === id)?.name ?? '?';
const channelName = (id) => state.channels.find((c) => c.id === id)?.name ?? '?';

function skyStatus(dateStr) {
  if (!dateStr) return { status: 'none', label: 'Não definida', cls: 'muted' };
  const t = today();
  if (dateStr < t) {
    return { status: 'expired', label: `⚠️ Vencida (${fmt(dateStr)})`, cls: 'cancelada' };
  }
  if (dateStr === t) {
    return { status: 'due_today', label: '⚠️ Vence hoje!', cls: 'manutencao' };
  }
  const diff = Math.round((new Date(dateStr + 'T00:00:00Z') - new Date(t + 'T00:00:00Z')) / 86400000);
  if (diff <= 7) {
    return { status: 'expiring', label: `⏳ Vence em ${diff}d (${fmt(dateStr)})`, cls: 'manutencao' };
  }
  return { status: 'active', label: `✓ Ativa até ${fmt(dateStr)}`, cls: 'ativo' };
}

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
  [state.rooms, state.guests, state.reservations, state.channels] = await Promise.all([api('GET', '/api/rooms'), api('GET', '/api/guests'), api('GET', '/api/reservations'), api('GET', '/api/channels')]);
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
    <div class="card"><h2>Saídas hoje</h2>${list(departures, 'check-out')}</div>
    <div class="card">
      <h2>📡 Assinaturas SKY dos Quartos</h2>
      ${state.rooms.length ? `
        <ul class="sky-list">
          ${state.rooms.map((r) => {
            const s = skyStatus(r.skyExpiration);
            return `<li class="sky-item">
              <div>
                <b>${esc(r.name)}</b>
                ${r.skyExpiration ? `<span class="muted" style="margin-left:8px;">(Vencimento: ${fmt(r.skyExpiration)})</span>` : ''}
              </div>
              <div class="sky-actions">
                <span class="badge ${s.cls}">${s.label}</span>
                <button class="small" data-act="renew-sky" data-id="${r.id}" title="Renovar +30 dias">+30d</button>
              </div>
            </li>`;
          }).join('')}
        </ul>` : '<p class="muted">Nenhum quarto cadastrado.</p>'}
    </div>`;
}

$('#painel').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.act === 'renew-sky') {
    const r = state.rooms.find((x) => x.id === b.dataset.id);
    if (!r) return;
    const baseDate = r.skyExpiration && r.skyExpiration >= today() ? r.skyExpiration : today();
    const nextDate = addDays(baseDate, 30);
    act(() => api('PUT', `/api/rooms/${r.id}`, { skyExpiration: nextDate }), `SKY (${r.name}) renovada até ${fmt(nextDate)} (+30 dias)!`);
  }
});

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
  resForm.channelId.value = r.channelId;
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

let priceEditId = null;
function savePrice(id) {
  const raw = String($('#priceInput').value).replace(',', '.').trim();
  const val = Number(raw);
  if (raw === '' || !Number.isFinite(val) || val < 0) return toast('Valor inválido. Digite um número maior ou igual a zero.', true);
  act(async () => { await api('PUT', `/api/reservations/${id}`, { total: val }); priceEditId = null; }, 'Valor da reserva atualizado!');
}
$('#resTable').addEventListener('keydown', (e) => {
  if (e.target.id !== 'priceInput') return;
  if (e.key === 'Enter') { e.preventDefault(); savePrice(priceEditId); }
  if (e.key === 'Escape') { priceEditId = null; renderResTable(); }
});
function renderResTable() {
  const f = $('#resFilter').value;
  const rows = state.reservations
    .filter((r) => f === 'todas' ? true : f === 'ativas' ? r.status === 'confirmada' || r.status === 'hospedado' : r.status === f)
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  const btn = (id, st, label, cls = '') => `<button class="small ${cls}" data-act="status" data-id="${id}" data-st="${st}">${label}</button>`;
  $('#resTable').innerHTML = '<tr><th>Hóspede</th><th>Método</th><th>Quarto</th><th>Entrada</th><th>Saída</th><th>Pessoas</th><th>Total</th><th>Status</th><th></th></tr>' +
    (rows.map((r) => `<tr>
      <td>${esc(guestName(r.guestId))}${r.notes ? ` <span class="muted" title="${esc(r.notes)}">📝</span>` : ''}</td>
      <td>${esc(channelName(r.channelId))}</td><td>${esc(roomName(r.roomId))}</td><td>${fmt(r.checkIn)}</td><td>${fmt(r.checkOut)}</td>
      <td>${r.people}</td>
      <td>${r.id === priceEditId ? `<input type="number" class="price-input" id="priceInput" min="0" step="0.01" value="${r.total}" style="width:110px"> <button class="small" data-act="price-save" data-id="${r.id}">Salvar</button><button class="small" data-act="price-cancel">✕</button>` : `${money(r.total)} <button class="small" data-act="change-price" data-id="${r.id}" title="Alterar valor da reserva (descontos, promoções)">✏️ Alterar valor</button>`}</td>
      <td><span class="badge ${r.status}">${r.status}</span></td>
      <td>${r.status === 'confirmada' ? btn(r.id, 'hospedado', 'Check-in') + btn(r.id, 'cancelada', 'Cancelar', 'danger') : ''}
          ${r.status === 'hospedado' ? btn(r.id, 'finalizada', 'Check-out') : ''}
          ${r.status === 'cancelada' ? btn(r.id, 'confirmada', 'Reativar') : ''}
          ${r.status === 'confirmada' || r.status === 'hospedado' ? `<button class="small" data-act="edit" data-id="${r.id}">Editar</button>` : ''}
          <button class="small danger" data-act="del" data-id="${r.id}">Excluir</button></td></tr>`).join('') ||
      '<tr><td colspan="9" class="muted">Nenhuma reserva.</td></tr>');
}
$('#resTable').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.act === 'status') act(() => api('PUT', `/api/reservations/${b.dataset.id}`, { status: b.dataset.st }), 'Reserva atualizada.');
  if (b.dataset.act === 'edit') startEdit(b.dataset.id);
  if (b.dataset.act === 'change-price') { priceEditId = b.dataset.id; renderResTable(); const i = $('#priceInput'); i.focus(); i.select(); }
  if (b.dataset.act === 'price-cancel') { priceEditId = null; renderResTable(); }
  if (b.dataset.act === 'price-save') savePrice(b.dataset.id);
  if (b.dataset.act === 'del' && confirm('Excluir esta reserva?')) act(() => api('DELETE', `/api/reservations/${b.dataset.id}`), 'Reserva excluída.');
});

// ---- Quartos ----
$('#roomForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = formData(e.target);
  const payload = { ...f };
  if (!payload.skyExpiration) delete payload.skyExpiration;
  act(async () => {
    await api('POST', '/api/rooms', payload);
    e.target.reset();
  }, 'Quarto cadastrado!');
});

function renderRooms() {
  $('#roomTable').innerHTML = '<tr><th>Nome</th><th>Capacidade</th><th>Diária</th><th>Status</th><th>Assinatura SKY (Vencimento)</th><th></th></tr>' +
    (state.rooms.map((r) => {
      const s = skyStatus(r.skyExpiration);
      return `<tr>
        <td><b>${esc(r.name)}</b></td>
        <td>${r.capacity} pessoa(s)</td>
        <td>${money(r.price)}</td>
        <td><span class="badge ${r.status}">${r.status === 'ativo' ? 'disponível' : 'manutenção'}</span></td>
        <td>
          <div class="sky-cell">
            <input type="date" class="sky-input" data-id="${r.id}" value="${r.skyExpiration || ''}" title="Selecione no calendário o vencimento da assinatura SKY">
            <span class="badge ${s.cls}">${s.label}</span>
            <button class="small" data-act="renew-sky" data-id="${r.id}" title="Renovar +30 dias">+30d</button>
            ${r.skyExpiration ? `<button class="small danger" data-act="clear-sky" data-id="${r.id}" title="Limpar data da SKY">✕</button>` : ''}
          </div>
        </td>
        <td>
          <button class="small" data-act="toggle" data-id="${r.id}" data-st="${r.status === 'ativo' ? 'manutencao' : 'ativo'}">${r.status === 'ativo' ? 'Pôr em manutenção' : 'Reativar'}</button>
          <button class="small danger" data-act="del" data-id="${r.id}">Excluir</button>
        </td>
      </tr>`;
    }).join('') || '<tr><td colspan="6" class="muted">Nenhum quarto cadastrado.</td></tr>');
}

$('#roomTable').addEventListener('change', (e) => {
  if (e.target.classList.contains('sky-input')) {
    const id = e.target.dataset.id;
    const r = state.rooms.find((x) => x.id === id);
    const val = e.target.value ? e.target.value : null;
    act(
      () => api('PUT', `/api/rooms/${id}`, { skyExpiration: val }),
      val ? `Assinatura SKY (${r?.name}) atualizada para ${fmt(val)}!` : `Assinatura SKY (${r?.name}) removida.`
    );
  }
});

$('#roomTable').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.act === 'renew-sky') {
    const r = state.rooms.find((x) => x.id === b.dataset.id);
    if (!r) return;
    const baseDate = r.skyExpiration && r.skyExpiration >= today() ? r.skyExpiration : today();
    const nextDate = addDays(baseDate, 30);
    act(() => api('PUT', `/api/rooms/${r.id}`, { skyExpiration: nextDate }), `SKY (${r.name}) renovada até ${fmt(nextDate)} (+30 dias)!`);
  }
  if (b.dataset.act === 'clear-sky') {
    const r = state.rooms.find((x) => x.id === b.dataset.id);
    if (!r) return;
    act(() => api('PUT', `/api/rooms/${r.id}`, { skyExpiration: null }), `Assinatura SKY (${r.name}) removida.`);
  }
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
  const csel = resForm.channelId, cprev = csel.value;
  csel.innerHTML = state.channels.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  if (state.channels.some((c) => c.id === cprev)) csel.value = cprev;
  const sel = resForm.guestId, prev = sel.value;
  sel.innerHTML = state.guests.length
    ? state.guests.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('')
    : '<option value="">Cadastre um hóspede primeiro</option>';
  if (state.guests.some((g) => g.id === prev)) sel.value = prev;
}

// ---- Métodos de reserva ----
$('#channelForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = formData(e.target);
  act(async () => { await api('POST', '/api/channels', f); e.target.reset(); }, 'Método adicionado!');
});
function renderChannels() {
  const rows = state.channels.map((c) => {
    const rs = state.reservations.filter((r) => r.channelId === c.id);
    const sum = (st) => rs.filter((r) => st.includes(r.status)).reduce((s, r) => s + (r.total || 0), 0);
    const received = sum(['finalizada']), expected = sum(['confirmada', 'hospedado']);
    return { c, count: rs.length, canceled: rs.filter((r) => r.status === 'cancelada').length, received, expected, total: received + expected, used: rs.length > 0 };
  });
  const grand = rows.reduce((s, x) => s + x.total, 0);
  const tot = (k) => rows.reduce((s, x) => s + x[k], 0);
  $('#channelTable').innerHTML = '<tr><th>Método</th><th>Reservas</th><th>Canceladas</th><th>Recebido</th><th>Previsto</th><th>Total</th><th>% do faturamento</th><th></th></tr>' +
    rows.map((x) => `<tr><td>${esc(x.c.name)}</td><td>${x.count}</td><td>${x.canceled}</td><td>${money(x.received)}</td><td>${money(x.expected)}</td>
      <td><b>${money(x.total)}</b></td><td>${grand ? Math.round((x.total / grand) * 100) : 0}%</td>
      <td><button class="small" data-act="rename" data-id="${x.c.id}">Renomear</button>
      <button class="small danger" data-act="del" data-id="${x.c.id}" ${x.used ? 'disabled title="Possui reservas"' : ''}>Excluir</button></td></tr>`).join('') +
    `<tr><td><b>Total</b></td><td>${tot('count')}</td><td>${tot('canceled')}</td><td><b>${money(tot('received'))}</b></td><td><b>${money(tot('expected'))}</b></td><td><b>${money(grand)}</b></td><td>100%</td><td></td></tr>`;
}
$('#channelTable').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.act === 'rename') {
    const name = prompt('Novo nome do método:', channelName(b.dataset.id));
    if (name && name.trim()) act(() => api('PUT', `/api/channels/${b.dataset.id}`, { name }), 'Método renomeado.');
  }
  if (b.dataset.act === 'del' && confirm('Excluir este método?')) act(() => api('DELETE', `/api/channels/${b.dataset.id}`), 'Método excluído.');
});

function render() {
  renderChannels();   renderPainel(); renderCal(); renderResTable(); renderRooms(); renderGuests(); renderGuestSelect(); updateAvailable();
}

resForm.checkIn.value = today();
resForm.checkOut.value = addDays(today(), 1);
refresh().catch((e) => toast(e.message, true));

