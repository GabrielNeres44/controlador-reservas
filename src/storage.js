'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const uid = () => crypto.randomUUID();
const DEFAULT_CHANNELS = ['Reserva direta', 'Booking', 'Agência'];
const DEFAULT_SUPABASE_URL = 'https://umnnoanezyuhpwhhxguz.supabase.co';
const DEFAULT_PUBLISHABLE_KEY = 'sb_publishable_iRMTYBANS1LUz6bD-MFZPQ_WmY-3TXg';

function getSupabaseConfig() {
  if (process.env.SUPABASE_URL === 'false' || process.env.SUPABASE_DISABLED === '1') return null;
  // Quando DB_FILE é definido explicitamente (ex: testes automatizados) e SUPABASE_URL não foi forçada, usa arquivo local
  if (process.env.DB_FILE && !process.env.SUPABASE_URL) return null;

  const rawUrl = (process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).trim().replace(/\/+$/, '');
  const key = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    DEFAULT_PUBLISHABLE_KEY
  ).trim();
  if (!rawUrl) return null;
  return { url: rawUrl, key };
}

function defaultSeed() {
  const channels = DEFAULT_CHANNELS.map((name) => ({ id: uid(), name }));
  return {
    rooms: [
      { id: uid(), name: 'Quarto 101', capacity: 2, price: 180, status: 'ativo', skyExpiration: null },
      { id: uid(), name: 'Quarto 102', capacity: 3, price: 240, status: 'ativo', skyExpiration: null },
      { id: uid(), name: 'Suíte Família', capacity: 5, price: 420, status: 'ativo', skyExpiration: null },
    ],
    channels,
    guests: [],
    reservations: [],
  };
}

function normalizeDb(db) {
  let dirty = false;
  if (!Array.isArray(db.rooms)) { db.rooms = []; dirty = true; }
  if (!Array.isArray(db.guests)) { db.guests = []; dirty = true; }
  if (!Array.isArray(db.reservations)) { db.reservations = []; dirty = true; }
  if (!Array.isArray(db.channels) || !db.channels.length) {
    db.channels = DEFAULT_CHANNELS.map((name) => ({ id: uid(), name }));
    dirty = true;
  }
  for (const r of db.rooms) {
    if (r.skyExpiration === undefined) r.skyExpiration = null;
    r.capacity = Number(r.capacity);
    r.price = Number(r.price);
  }
  for (const r of db.reservations) {
    if (!db.channels.some((c) => c.id === r.channelId)) {
      r.channelId = db.channels[0].id;
      dirty = true;
    }
    r.people = Number(r.people);
    r.total = Number(r.total);
  }
  return dirty;
}

function loadFromFile(dbFile) {
  if (fs.existsSync(dbFile)) {
    const data = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    const dirty = normalizeDb(data);
    if (dirty) saveToFile(dbFile, data);
    return data;
  }
  const db = defaultSeed();
  saveToFile(dbFile, db);
  return db;
}

function saveToFile(dbFile, db) {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const tmp = dbFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, dbFile);
}

function supabaseHeaders(key, extra = {}) {
  const headers = {
    apikey: key,
    'Content-Type': 'application/json',
    ...extra,
  };
  // Chaves JWT ou legado usam Authorization Bearer; chaves sb_publishable_/sb_secret_ também aceitam apikey + Authorization
  headers.Authorization = `Bearer ${key}`;
  return headers;
}

async function fetchFromSupabaseTables(cfg) {
  const headers = supabaseHeaders(cfg.key);
  const [roomsRes, channelsRes, guestsRes, reservationsRes] = await Promise.all([
    fetch(`${cfg.url}/rest/v1/rooms?select=*&order=position.asc,name.asc`, { headers }),
    fetch(`${cfg.url}/rest/v1/channels?select=*&order=position.asc,name.asc`, { headers }),
    fetch(`${cfg.url}/rest/v1/guests?select=*&order=position.asc,name.asc`, { headers }),
    fetch(`${cfg.url}/rest/v1/reservations?select=*&order=position.asc,created_at.asc`, { headers }),
  ]);

  if (!roomsRes.ok) {
    const errText = await roomsRes.text();
    throw new Error(`Erro ao ler tabela rooms no Supabase (${roomsRes.status}): ${errText}`);
  }

  const [rooms, channels, guests, reservations] = await Promise.all([
    roomsRes.json(),
    channelsRes.ok ? channelsRes.json() : [],
    guestsRes.ok ? guestsRes.json() : [],
    reservationsRes.ok ? reservationsRes.json() : [],
  ]);

  return {
    rooms: rooms.map((r) => ({
      id: r.id,
      name: r.name,
      capacity: Number(r.capacity),
      price: Number(r.price),
      status: r.status || 'ativo',
      skyExpiration: r.sky_expiration ?? null,
    })),
    channels: channels.map((c) => ({
      id: c.id,
      name: c.name,
    })),
    guests: guests.map((g) => ({
      id: g.id,
      name: g.name,
      phone: g.phone || '',
      email: g.email || '',
      document: g.document || '',
    })),
    reservations: reservations.map((rv) => ({
      id: rv.id,
      roomId: rv.room_id,
      guestId: rv.guest_id,
      channelId: rv.channel_id,
      checkIn: rv.check_in,
      checkOut: rv.check_out,
      people: Number(rv.people),
      total: Number(rv.total),
      notes: rv.notes || '',
      status: rv.status || 'confirmada',
      createdAt: rv.created_at,
    })),
  };
}

async function fetchFromSupabase(cfg) {
  const rpcRes = await fetch(`${cfg.url}/rest/v1/rpc/get_pousada_state`, {
    method: 'POST',
    headers: supabaseHeaders(cfg.key),
    body: '{}',
  });
  if (rpcRes.ok) {
    const data = await rpcRes.json();
    if (data && typeof data === 'object') return data;
  }
  return fetchFromSupabaseTables(cfg);
}

async function syncTablesDirectly(cfg, db) {
  const headers = supabaseHeaders(cfg.key, { Prefer: 'resolution=merge-duplicates,return=minimal' });

  const upsert = async (table, rows) => {
    if (!rows.length) return;
    const res = await fetch(`${cfg.url}/rest/v1/${table}?on_conflict=id`, {
      method: 'POST',
      headers,
      body: JSON.stringify(rows),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Falha ao salvar ${table} no Supabase (${res.status}): ${txt}`);
    }
  };

  const deleteRemoved = async (table, currentIds) => {
    const listRes = await fetch(`${cfg.url}/rest/v1/${table}?select=id`, {
      headers: supabaseHeaders(cfg.key),
    });
    if (!listRes.ok) return;
    const existing = await listRes.json();
    const keep = new Set(currentIds);
    const toRemove = existing.map((x) => x.id).filter((id) => !keep.has(id));
    for (const id of toRemove) {
      await fetch(`${cfg.url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: supabaseHeaders(cfg.key),
      });
    }
  };

  // 1. Remove reservas excluídas antes de remover quartos/hóspedes/canais
  await deleteRemoved('reservations', db.reservations.map((r) => r.id));
  await deleteRemoved('rooms', db.rooms.map((r) => r.id));
  await deleteRemoved('guests', db.guests.map((g) => g.id));
  await deleteRemoved('channels', db.channels.map((c) => c.id));

  // 2. Upsert nas tabelas pai primeiro e depois em reservations
  await upsert(
    'rooms',
    db.rooms.map((r, i) => ({
      id: r.id,
      name: r.name,
      capacity: Number(r.capacity),
      price: Number(r.price),
      status: r.status || 'ativo',
      sky_expiration: r.skyExpiration || null,
      position: i + 1,
    }))
  );
  await upsert(
    'channels',
    db.channels.map((c, i) => ({
      id: c.id,
      name: c.name,
      position: i + 1,
    }))
  );
  await upsert(
    'guests',
    db.guests.map((g, i) => ({
      id: g.id,
      name: g.name,
      phone: g.phone || '',
      email: g.email || '',
      document: g.document || '',
      position: i + 1,
    }))
  );
  await upsert(
    'reservations',
    db.reservations.map((rv, i) => ({
      id: rv.id,
      room_id: rv.roomId,
      guest_id: rv.guestId,
      channel_id: rv.channelId,
      check_in: rv.checkIn,
      check_out: rv.checkOut,
      people: Number(rv.people),
      total: Number(rv.total),
      notes: rv.notes || '',
      status: rv.status || 'confirmada',
      created_at: rv.createdAt || new Date().toISOString(),
      position: i + 1,
    }))
  );
}

async function saveToSupabase(cfg, db) {
  const rpcRes = await fetch(`${cfg.url}/rest/v1/rpc/sync_pousada_state`, {
    method: 'POST',
    headers: supabaseHeaders(cfg.key),
    body: JSON.stringify({ payload: db }),
  });
  if (rpcRes.ok) return;
  await syncTablesDirectly(cfg, db);
}

module.exports = {
  getSupabaseConfig,
  loadFromFile,
  saveToFile,
  fetchFromSupabase,
  saveToSupabase,
  normalizeDb,
};

