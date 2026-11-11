'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../src/logic');

const mkdb = () => ({
  rooms: [
    { id: 'r1', name: 'Quarto 1', capacity: 2, price: 100, status: 'ativo' },
    { id: 'r2', name: 'Quarto 2', capacity: 4, price: 200, status: 'manutencao' },
  ],
  guests: [{ id: 'g1', name: 'Ana' }, { id: 'g2', name: 'Bia' }],
  reservations: [{ id: 'x', roomId: 'r1', guestId: 'g1', checkIn: '2026-12-10', checkOut: '2026-12-15', status: 'confirmada' }],
});
const base = { roomId: 'r1', guestId: 'g2', people: 2 };

test('bloqueia períodos sobrepostos no mesmo quarto', () => {
  const db = mkdb();
  for (const [i, o] of [['2026-12-12', '2026-12-13'], ['2026-12-08', '2026-12-11'], ['2026-12-14', '2026-12-20'], ['2026-12-01', '2026-12-30']])
    assert.throws(() => L.validateReservation(db, { ...base, checkIn: i, checkOut: o }), /Conflito/);
});

test('permite saída e entrada no mesmo dia', () => {
  const db = mkdb();
  assert.doesNotThrow(() => L.validateReservation(db, { ...base, checkIn: '2026-12-15', checkOut: '2026-12-17' }));
  assert.doesNotThrow(() => L.validateReservation(db, { ...base, checkIn: '2026-12-05', checkOut: '2026-12-10' }));
});

test('reserva cancelada não bloqueia', () => {
  const db = mkdb();
  db.reservations[0].status = 'cancelada';
  assert.doesNotThrow(() => L.validateReservation(db, { ...base, checkIn: '2026-12-11', checkOut: '2026-12-12' }));
});

test('capacidade, manutenção e datas', () => {
  const db = mkdb();
  assert.throws(() => L.validateReservation(db, { ...base, people: 3, checkIn: '2027-01-01', checkOut: '2027-01-02' }), /no máximo/);
  assert.throws(() => L.validateReservation(db, { ...base, roomId: 'r2', checkIn: '2027-01-01', checkOut: '2027-01-02' }), /manutenção/);
  assert.throws(() => L.validateReservation(db, { ...base, checkIn: '2027-01-02', checkOut: '2027-01-02' }), /posterior/);
  assert.throws(() => L.validateReservation(db, { ...base, checkIn: '2027-02-30', checkOut: '2027-03-02' }), /inexistente/);
});

test('editar ignora a própria reserva; total calculado', () => {
  const db = mkdb();
  const r = L.validateReservation(db, { ...base, guestId: 'g1', checkIn: '2026-12-11', checkOut: '2026-12-14' }, 'x');
  assert.strictEqual(r.total, 300);
});

test('availableRooms', () => {
  const db = mkdb();
  assert.strictEqual(L.availableRooms(db, '2026-12-12', '2026-12-13').length, 0);
  assert.strictEqual(L.availableRooms(db, '2026-12-15', '2026-12-16').length, 1);
});

