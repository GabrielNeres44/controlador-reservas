'use strict';
const test = require('node:test');
const assert = require('node:assert');
const storage = require('../src/storage');

test('storage: fetchFromSupabase e saveToSupabase via RPC', async () => {
  const calls = [];
  const origFetch = global.fetch;
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null, headers: opts.headers });
    if (url.endsWith('/rest/v1/rpc/get_pousada_state')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          rooms: [{ id: 'r1', name: 'Quarto 101', capacity: 2, price: 200, status: 'ativo', skyExpiration: '2026-12-31' }],
          channels: [{ id: 'c1', name: 'Reserva direta' }],
          guests: [{ id: 'g1', name: 'Maria', phone: '11999999999', email: '', document: '' }],
          reservations: [],
        }),
      };
    }
    if (url.endsWith('/rest/v1/rpc/sync_pousada_state')) {
      return { ok: true, status: 204, text: async () => '' };
    }
    throw new Error('Unexpected URL: ' + url);
  };

  try {
    const cfg = { url: 'https://example.supabase.co', key: 'sb_publishable_test' };
    const state = await storage.fetchFromSupabase(cfg);
    assert.strictEqual(state.rooms.length, 1);
    assert.strictEqual(state.rooms[0].name, 'Quarto 101');
    assert.strictEqual(state.rooms[0].skyExpiration, '2026-12-31');

    await storage.saveToSupabase(cfg, state);
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[1].url, 'https://example.supabase.co/rest/v1/rpc/sync_pousada_state');
    assert.strictEqual(calls[1].body.payload.rooms[0].id, 'r1');
  } finally {
    global.fetch = origFetch;
  }
});

test('storage: fallback para tabelas diretas quando RPC não existe', async () => {
  const calls = [];
  const origFetch = global.fetch;
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET' });
    if (url.includes('/rest/v1/rpc/')) {
      return { ok: false, status: 404, text: async () => 'Not found' };
    }
    if (url.includes('/rest/v1/rooms?select=*')) {
      return {
        ok: true,
        status: 200,
        json: async () => [{ id: 'r1', name: 'Suíte 1', capacity: 3, price: 300, status: 'ativo', sky_expiration: null }],
      };
    }
    if (url.includes('/rest/v1/channels?select=*')) {
      return { ok: true, status: 200, json: async () => [{ id: 'c1', name: 'Booking' }] };
    }
    if (url.includes('/rest/v1/guests?select=*') || url.includes('/rest/v1/reservations?select=*')) {
      return { ok: true, status: 200, json: async () => [] };
    }
    if (url.includes('?select=id')) {
      return { ok: true, status: 200, json: async () => [] };
    }
    if (url.includes('?on_conflict=id')) {
      return { ok: true, status: 201, text: async () => '' };
    }
    return { ok: true, status: 200, json: async () => [] };
  };

  try {
    const cfg = { url: 'https://example.supabase.co', key: 'sb_publishable_test' };
    const state = await storage.fetchFromSupabase(cfg);
    assert.strictEqual(state.rooms[0].name, 'Suíte 1');
    assert.strictEqual(state.channels[0].name, 'Booking');

    await storage.saveToSupabase(cfg, state);
    assert.ok(calls.some((c) => c.url.includes('/rest/v1/rooms?on_conflict=id')));
  } finally {
    global.fetch = origFetch;
  }
});
