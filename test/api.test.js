'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');

process.env.DB_FILE = path.join(os.tmpdir(), `pousada-test-${process.pid}.json`);
const server = require('../server');

test('API: conflito de reserva e edição', async (t) => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const j = async (m, u, b) => {
    const r = await fetch(base + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b && JSON.stringify(b) });
    return { status: r.status, data: await r.json() };
  };

  const room = (await j('POST', '/api/rooms', { name: 'T1', capacity: 2, price: 100 })).data;
  const a = (await j('POST', '/api/guests', { name: 'A' })).data;
  const b = (await j('POST', '/api/guests', { name: 'B' })).data;
  const mk = (g, checkIn, checkOut) => j('POST', '/api/reservations', { roomId: room.id, guestId: g.id, people: 2, checkIn, checkOut });

  const first = await mk(a, '2030-01-10', '2030-01-12');
  assert.strictEqual(first.status, 201);
  assert.strictEqual((await mk(b, '2030-01-11', '2030-01-13')).status, 409);
  const ok = await mk(b, '2030-01-12', '2030-01-13');
  assert.strictEqual(ok.status, 201);

  // editar a primeira para invadir a segunda deve falhar; para encurtar deve passar
  assert.strictEqual((await j('PUT', `/api/reservations/${first.data.id}`, { checkOut: '2030-01-13' })).status, 409);
  assert.strictEqual((await j('PUT', `/api/reservations/${first.data.id}`, { checkOut: '2030-01-11' })).status, 200);

  // cancelar libera o período
  await j('PUT', `/api/reservations/${ok.data.id}`, { status: 'cancelada' });
  assert.strictEqual((await mk(a, '2030-01-12', '2030-01-13')).status, 201);
});

