'use strict';
// Regras de negócio puras (sem I/O), fáceis de testar.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class ValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function parseDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) throw new ValidationError('Data inválida (use AAAA-MM-DD).');
  const d = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new ValidationError(`Data inexistente: ${s}`);
  return d;
}

function nights(checkIn, checkOut) {
  return Math.round((parseDate(checkOut) - parseDate(checkIn)) / 86400000);
}

// Intervalos [checkIn, checkOut): o dia de saída está livre para a entrada de outro hóspede.
function overlaps(aIn, aOut, bIn, bOut) {
  return aIn < bOut && bIn < aOut;
}

// Reservas canceladas ou já finalizadas (check-out) não bloqueiam o quarto.
function isActive(r) {
  return r.status === 'confirmada' || r.status === 'hospedado';
}

function findConflict(reservations, roomId, checkIn, checkOut, ignoreId = null) {
  return (
    reservations.find(
      (r) => r.roomId === roomId && r.id !== ignoreId && isActive(r) && overlaps(checkIn, checkOut, r.checkIn, r.checkOut)
    ) || null
  );
}

function validateReservation(db, input, ignoreId = null) {
  const { roomId, guestId, checkIn, checkOut } = input;
  const people = Number(input.people);
  parseDate(checkIn);
  parseDate(checkOut);
  if (checkOut <= checkIn) throw new ValidationError('A saída deve ser posterior à entrada.');
  if (!Number.isInteger(people) || people < 1) throw new ValidationError('Informe a quantidade de pessoas (mínimo 1).');

  const room = db.rooms.find((r) => r.id === roomId);
  if (!room) throw new ValidationError('Quarto não encontrado.', 404);
  if (!db.guests.find((g) => g.id === guestId)) throw new ValidationError('Hóspede não encontrado.', 404);
  if (room.status === 'manutencao') throw new ValidationError('Quarto em manutenção.', 409);
  if (people > room.capacity) throw new ValidationError(`O quarto "${room.name}" comporta no máximo ${room.capacity} pessoa(s).`);

  const c = findConflict(db.reservations, roomId, checkIn, checkOut, ignoreId);
  if (c) {
    const g = db.guests.find((x) => x.id === c.guestId);
    throw new ValidationError(
      `Conflito: "${room.name}" já está reservado de ${c.checkIn} a ${c.checkOut}${g ? ' para ' + g.name : ''}.`,
      409
    );
  }
  return { room, people, total: nights(checkIn, checkOut) * room.price };
}

function availableRooms(db, checkIn, checkOut, people = 1, ignoreId = null) {
  parseDate(checkIn);
  parseDate(checkOut);
  if (checkOut <= checkIn) throw new ValidationError('A saída deve ser posterior à entrada.');
  return db.rooms.filter(
    (r) => r.status !== 'manutencao' && r.capacity >= people && !findConflict(db.reservations, r.id, checkIn, checkOut, ignoreId)
  );
}

module.exports = { ValidationError, parseDate, nights, overlaps, isActive, findConflict, validateReservation, availableRooms };

