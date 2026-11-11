'use strict';
// Servidor HTTP sem dependências externas. Persistência em data/db.json.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const L = require('./src/logic');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'db.json');
const PUBLIC = path.join(__dirname, 'public');

const uid = () => crypto.randomUUID();
const ROOM_STATUS = ['ativo', 'manutencao'];
const RES_STATUS = ['confirmada', 'hospedado', 'finalizada', 'cancelada'];

function load() {
  if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  const db = {
    rooms: [
      { id: uid(), name: 'Quarto 101', capacity: 2, price: 180, status: 'ativo' },
      { id: uid(), name: 'Quarto 102', capacity: 3, price: 240, status: 'ativo' },
      { id: uid(), name: 'Suíte Família', capacity: 5, price: 420, status: 'ativo' },
    ],
    guests: [],
    reservations: [],
  };
  save(db);
  return db;
}
function save(db) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
const DEFAULT_CHANNELS = ['Reserva direta', 'Booking', 'Agência'];
const db = load();
// Migração: garante os métodos padrão e associa reservas antigas à 'Reserva direta'.
{
  let dirty = false;
  if (!Array.isArray(db.channels) || !db.channels.length) {
    db.channels = DEFAULT_CHANNELS.map((name) => ({ id: uid(), name }));
    dirty = true;
  }
  for (const r of db.reservations) {
    if (!db.channels.some((c) => c.id === r.channelId)) { r.channelId = db.channels[0].id; dirty = true; }
  }
  if (dirty) save(db);
}

const need = (v, msg) => {
  if (typeof v !== 'string' || !v.trim()) throw new L.ValidationError(msg);
  return v.trim();
};
const num = (v, msg, min) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) throw new L.ValidationError(msg);
  return n;
};
const find = (list, id, what) => {
  const x = list.find((i) => i.id === id);
  if (!x) throw new L.ValidationError(`${what} não encontrado(a).`, 404);
  return x;
};

// ---- Handlers ----
const routes = [];
const route = (method, pattern, fn) =>
  routes.push({ method, re: new RegExp('^' + pattern.replace(/:\w+/g, '([^/]+)') + '$'), fn });

// Quartos
route('GET', '/api/rooms', () => db.rooms);
route('POST', '/api/rooms', ({ body }) => {
  let skyExpiration = null;
  if (body.skyExpiration) {
    L.parseDate(body.skyExpiration);
    skyExpiration = body.skyExpiration;
  }
  const room = {
    id: uid(),
    name: need(body.name, 'Nome do quarto é obrigatório.'),
    capacity: Math.floor(num(body.capacity, 'Capacidade inválida.', 1)),
    price: num(body.price, 'Diária inválida.', 0),
    status: 'ativo',
    skyExpiration,
  };
  if (db.rooms.some((r) => r.name.toLowerCase() === room.name.toLowerCase())) throw new L.ValidationError('Já existe um quarto com esse nome.', 409);
  db.rooms.push(room);
  save(db);
  return [201, room];
});
route('PUT', '/api/rooms/:id', ({ params, body }) => {
  const room = find(db.rooms, params[0], 'Quarto');
  if (body.name !== undefined) room.name = need(body.name, 'Nome inválido.');
  if (body.capacity !== undefined) room.capacity = Math.floor(num(body.capacity, 'Capacidade inválida.', 1));
  if (body.price !== undefined) room.price = num(body.price, 'Diária inválida.', 0);
  if (body.status !== undefined) {
    if (!ROOM_STATUS.includes(body.status)) throw new L.ValidationError('Status inválido.');
    room.status = body.status;
  }
  if (body.skyExpiration !== undefined) {
    if (body.skyExpiration === null || body.skyExpiration === '') {
      room.skyExpiration = null;
    } else {
      L.parseDate(body.skyExpiration);
      room.skyExpiration = body.skyExpiration;
    }
  }
  save(db);
  return room;
});
route('DELETE', '/api/rooms/:id', ({ params }) => {
  const room = find(db.rooms, params[0], 'Quarto');
  if (db.reservations.some((r) => r.roomId === room.id && L.isActive(r))) throw new L.ValidationError('Quarto possui reservas ativas.', 409);
  db.rooms = db.rooms.filter((r) => r.id !== room.id);
  db.reservations = db.reservations.filter((r) => r.roomId !== room.id);
  save(db);
  return { ok: true };
});

// Métodos de reserva (canais)
route('GET', '/api/channels', () => db.channels);
route('POST', '/api/channels', ({ body }) => {
  const name = need(body.name, 'Nome do método é obrigatório.');
  if (db.channels.some((c) => c.name.toLowerCase() === name.toLowerCase())) throw new L.ValidationError('Já existe um método com esse nome.', 409);
  const c = { id: uid(), name };
  db.channels.push(c);
  save(db);
  return [201, c];
});
route('PUT', '/api/channels/:id', ({ params, body }) => {
  const c = find(db.channels, params[0], 'Método');
  const name = need(body.name, 'Nome inválido.');
  if (db.channels.some((x) => x.id !== c.id && x.name.toLowerCase() === name.toLowerCase())) throw new L.ValidationError('Já existe um método com esse nome.', 409);
  c.name = name;
  save(db);
  return c;
});
route('DELETE', '/api/channels/:id', ({ params }) => {
  const c = find(db.channels, params[0], 'Método');
  if (db.reservations.some((r) => r.channelId === c.id)) throw new L.ValidationError('Método possui reservas associadas.', 409);
  if (db.channels.length <= 1) throw new L.ValidationError('Mantenha ao menos um método.', 409);
  db.channels = db.channels.filter((x) => x.id !== c.id);
  save(db);
  return { ok: true };
});

// Hóspedes
route('GET', '/api/guests', () => db.guests);
route('POST', '/api/guests', ({ body }) => {
  const g = {
    id: uid(),
    name: need(body.name, 'Nome do hóspede é obrigatório.'),
    phone: String(body.phone || '').trim(),
    email: String(body.email || '').trim(),
    document: String(body.document || '').trim(),
  };
  db.guests.push(g);
  save(db);
  return [201, g];
});
route('PUT', '/api/guests/:id', ({ params, body }) => {
  const g = find(db.guests, params[0], 'Hóspede');
  if (body.name !== undefined) g.name = need(body.name, 'Nome inválido.');
  for (const k of ['phone', 'email', 'document']) if (body[k] !== undefined) g[k] = String(body[k]).trim();
  save(db);
  return g;
});
route('DELETE', '/api/guests/:id', ({ params }) => {
  const g = find(db.guests, params[0], 'Hóspede');
  if (db.reservations.some((r) => r.guestId === g.id && L.isActive(r))) throw new L.ValidationError('Hóspede possui reservas ativas.', 409);
  db.guests = db.guests.filter((x) => x.id !== g.id);
  db.reservations = db.reservations.filter((r) => r.guestId !== g.id);
  save(db);
  return { ok: true };
});

// Reservas
route('GET', '/api/reservations', () => db.reservations);
route('POST', '/api/reservations', ({ body }) => {
  const { people, total } = L.validateReservation(db, body);
  if (body.channelId) find(db.channels, body.channelId, 'Método');
  const r = {
    id: uid(),
    roomId: body.roomId,
    guestId: body.guestId,
    checkIn: body.checkIn,
    checkOut: body.checkOut,
    channelId: body.channelId || db.channels[0].id,
    people,
    total,
    notes: String(body.notes || '').trim(),
    status: 'confirmada',
    createdAt: new Date().toISOString(),
  };
  db.reservations.push(r);
  save(db);
  return [201, r];
});
route('PUT', '/api/reservations/:id', ({ params, body }) => {
  const r = find(db.reservations, params[0], 'Reserva');
  if (body.channelId !== undefined) find(db.channels, body.channelId, 'Método');
  if (body.status !== undefined && !RES_STATUS.includes(body.status)) throw new L.ValidationError('Status inválido.');
  const allowed = ['roomId', 'guestId', 'checkIn', 'checkOut', 'people', 'total', 'notes', 'status', 'channelId'];
  const next = { ...r };
  for (const k of allowed) if (body[k] !== undefined) next[k] = body[k];

  if (body.total === '' || body.total === null) {
    delete next.total;
  }

  if (L.isActive(next)) {
    const datesOrRoomChanged =
      (body.roomId !== undefined && body.roomId !== r.roomId) ||
      (body.checkIn !== undefined && body.checkIn !== r.checkIn) ||
      (body.checkOut !== undefined && body.checkOut !== r.checkOut);

    if (body.total === undefined && datesOrRoomChanged) {
      delete next.total;
    }
    const { people, total } = L.validateReservation(db, next, r.id);
    next.people = people;
    next.total = total;
  } else if (body.total !== undefined && body.total !== '' && body.total !== null) {
    const customTotal = Number(body.total);
    if (!Number.isFinite(customTotal) || customTotal < 0) throw new L.ValidationError('Valor total da reserva inválido.');
    next.total = customTotal;
  }
  Object.assign(r, next);
  save(db);
  return r;
});
route('DELETE', '/api/reservations/:id', ({ params }) => {
  find(db.reservations, params[0], 'Reserva');
  db.reservations = db.reservations.filter((r) => r.id !== params[0]);
  save(db);
  return { ok: true };
});

// Disponibilidade
route('GET', '/api/availability', ({ query }) =>
  L.availableRooms(db, query.get('checkIn'), query.get('checkOut'), Number(query.get('people')) || 1, query.get('ignore'))
);

// ---- Servidor ----
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (status, data, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, { 'Content-Type': type });
    res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
  };

  if (!url.pathname.startsWith('/api/')) {
    const file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(404, 'Não encontrado', 'text/plain');
    return send(200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
  }

  let raw = '';
  req.on('data', (c) => {
    raw += c;
    if (raw.length > 1e6) req.destroy();
  });
  req.on('end', () => {
    try {
      for (const r of routes) {
        const m = url.pathname.match(r.re);
        if (r.method === req.method && m) {
          let body = {};
          if (raw) {
            try {
              body = JSON.parse(raw);
            } catch {
              throw new L.ValidationError('JSON inválido.');
            }
          }
          const out = r.fn({ params: m.slice(1), body, query: url.searchParams });
          return Array.isArray(out) && typeof out[0] === 'number' ? send(out[0], out[1]) : send(200, out);
        }
      }
      send(404, { error: 'Rota não encontrada.' });
    } catch (e) {
      if (e instanceof L.ValidationError) return send(e.status, { error: e.message });
      console.error(e);
      send(500, { error: 'Erro interno.' });
    }
  });
});

if (require.main === module) server.listen(PORT, () => console.log(`Pousada rodando em http://localhost:${PORT}`));
module.exports = server;

