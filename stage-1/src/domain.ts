/**
 * The official Stage 1 domain: restaurants, availability and reservations.
 *
 * Every mutating function validates completely before it changes anything, so a
 * rejected request leaves the state untouched. The overlap invariant is the
 * half-open interval `[start, start + duration)`; a booking at 19:00 for 90 minutes
 * and one at 20:30 do not overlap.
 */

import { ApiError } from './errors.ts';
import {
  formatUtc,
  formatZoned,
  localStampOf,
  parseBareLocal,
  resolveLocalFirst,
  weekdayOf,
  type Weekday,
} from './timezone.ts';
import {
  isInteger,
  newReference,
  newReservationId,
  type OpeningHour,
  type Reservation,
  type Restaurant,
  type State,
} from './store.ts';

export function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

export function formatHM(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function restaurantOf(state: State, id: string): Restaurant {
  const restaurant = state.restaurants.get(id);
  if (restaurant === undefined) throw new ApiError('not_found');
  return restaurant;
}

function timezoneFor(state: State, restaurantId: string): string {
  return state.restaurants.get(restaurantId)?.timezone ?? 'UTC';
}

export function reservationView(state: State, reservation: Reservation): Record<string, unknown> {
  const timezone = timezoneFor(state, reservation.restaurant_id);
  return {
    reservation_id: reservation.id,
    reference: reservation.reference,
    restaurant_id: reservation.restaurant_id,
    table_id: reservation.table_id,
    party_size: reservation.party_size,
    status: reservation.status,
    starts_at_local: localStampOf(reservation.start_ms, timezone),
    starts_at: formatZoned(reservation.start_ms, timezone),
    ends_at: formatZoned(
      reservation.start_ms + reservation.duration_minutes * 60000,
      timezone,
    ),
    created_at: formatUtc(reservation.created_ms),
  };
}

function endOf(reservation: Reservation): number {
  return reservation.start_ms + reservation.duration_minutes * 60000;
}

function overlapsConfirmed(
  state: State,
  restaurantId: string,
  tableId: string,
  start: number,
  end: number,
  excludeId?: string,
): boolean {
  for (const other of state.reservations.values()) {
    if (other.status !== 'confirmed') continue;
    if (other.restaurant_id !== restaurantId || other.table_id !== tableId) continue;
    if (excludeId !== undefined && other.id === excludeId) continue;
    if (other.start_ms < end && start < endOf(other)) return true;
  }
  return false;
}

function openingHourFor(restaurant: Restaurant, weekday: Weekday): OpeningHour | undefined {
  return restaurant.opening_hours.find((hour) => hour.weekday === weekday);
}

/** Every local `HH:MM` slot start of `restaurant` on `date`, stepping from `opens`. */
export function slotLocalTimes(restaurant: Restaurant, date: string): string[] {
  const hour = openingHourFor(restaurant, weekdayOf(date));
  if (hour === undefined) return [];
  const opens = minutes(hour.opens);
  const closes = minutes(hour.closes);
  const slots: string[] = [];
  for (
    let slot = opens;
    slot + restaurant.reservation_duration_minutes <= closes;
    slot += restaurant.slot_minutes
  ) {
    slots.push(formatHM(slot));
  }
  return slots;
}

function localDatesOf(reservation: Reservation, timezone: string): { date: string; hhmm: string } {
  const stamp = localStampOf(reservation.start_ms, timezone);
  return { date: stamp.slice(0, 10), hhmm: stamp.slice(11, 16) };
}

/**
 * Resolve a reservation start against the restaurant rules, in §8 order: the
 * opening window first (so `17:00` is `outside_opening_hours`), then the grid
 * (so `18:01` is `not_on_slot_grid`), then existence in the zone.
 */
function resolveReservationStart(restaurant: Restaurant, date: string, hhmm: string): number {
  const hour = openingHourFor(restaurant, weekdayOf(date));
  if (hour === undefined) throw new ApiError('outside_opening_hours');
  const start = minutes(hhmm);
  const opens = minutes(hour.opens);
  const closes = minutes(hour.closes);
  const end = start + restaurant.reservation_duration_minutes;
  if (start < opens || end > closes) throw new ApiError('outside_opening_hours');
  if ((start - opens) % restaurant.slot_minutes !== 0) throw new ApiError('not_on_slot_grid');
  const instant = resolveLocalFirst(date, hhmm, restaurant.timezone);
  if (instant === null) throw new ApiError('invalid_local_time');
  return instant;
}

// ---- field readers ----------------------------------------------------------

type Body = Record<string, unknown>;

function requiredString(body: Body, name: string): string {
  const value = body[name];
  if (value === undefined) throw new ApiError('validation_failed');
  if (typeof value !== 'string') throw new ApiError('malformed_request');
  return value;
}

function requiredPartySize(body: Body, name: string): number {
  const value = body[name];
  if (value === undefined) throw new ApiError('validation_failed');
  if (!isInteger(value) || value < 1) throw new ApiError('validation_failed');
  return value;
}

function optionalString(body: Body, name: string): string | undefined {
  const value = body[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new ApiError('malformed_request');
  return value;
}

function optionalPartySize(body: Body, name: string): number | undefined {
  const value = body[name];
  if (value === undefined) return undefined;
  if (!isInteger(value) || value < 1) throw new ApiError('validation_failed');
  return value;
}

function bareLocal(value: string, field: string): { date: string; hhmm: string } {
  const parsed = parseBareLocal(value);
  if (parsed === null) {
    throw new ApiError('validation_failed', `${field} must be a bare local YYYY-MM-DDTHH:MM`);
  }
  return { date: parsed.date, hhmm: parsed.hhmm };
}

// ---- restaurants ------------------------------------------------------------

export function listRestaurants(state: State): { restaurants: Record<string, unknown>[] } {
  const restaurants = state.restaurantOrder.flatMap((id) => {
    const restaurant = state.restaurants.get(id);
    if (restaurant === undefined) return [];
    return [{ id: restaurant.id, name: restaurant.name, timezone: restaurant.timezone }];
  });
  return { restaurants };
}

export function getRestaurant(state: State, id: string): Record<string, unknown> {
  const restaurant = restaurantOf(state, id);
  return {
    id: restaurant.id,
    name: restaurant.name,
    timezone: restaurant.timezone,
    slot_minutes: restaurant.slot_minutes,
    reservation_duration_minutes: restaurant.reservation_duration_minutes,
    cancellation_cutoff_minutes: restaurant.cancellation_cutoff_minutes,
    opening_hours: restaurant.opening_hours.map((hour) => ({
      weekday: hour.weekday,
      opens: hour.opens,
      closes: hour.closes,
    })),
    tables: restaurant.tables.map((table) => ({
      id: table.id,
      label: table.label,
      capacity: table.capacity,
    })),
  };
}

export function availability(
  state: State,
  restaurantId: string,
  date: string,
  partySize: number,
): Record<string, unknown> {
  const restaurant = restaurantOf(state, restaurantId);
  const slots: Record<string, unknown>[] = [];
  for (const hhmm of slotLocalTimes(restaurant, date)) {
    const start = resolveLocalFirst(date, hhmm, restaurant.timezone);
    if (start === null) continue; // a skipped spring-forward local time never appears
    const end = start + restaurant.reservation_duration_minutes * 60000;
    const available = restaurant.tables
      .filter(
        (table) =>
          table.capacity >= partySize &&
          !overlapsConfirmed(state, restaurant.id, table.id, start, end),
      )
      .map((table) => table.id);
    slots.push({
      starts_at_local: `${date}T${hhmm}`,
      starts_at: formatZoned(start, restaurant.timezone),
      available_table_ids: available,
    });
  }
  return { restaurant_id: restaurant.id, date, timezone: restaurant.timezone, slots };
}

// ---- reservations -----------------------------------------------------------

export function createReservation(
  state: State,
  userId: string,
  body: Body,
): { status: number; body: Record<string, unknown> } {
  const restaurantId = requiredString(body, 'restaurant_id');
  const tableId = requiredString(body, 'table_id');
  const partySize = requiredPartySize(body, 'party_size');
  const startsAtLocal = requiredString(body, 'starts_at_local');
  const { date, hhmm } = bareLocal(startsAtLocal, 'starts_at_local');

  const restaurant = restaurantOf(state, restaurantId);
  const table = restaurant.tables.find((candidate) => candidate.id === tableId);
  if (table === undefined) throw new ApiError('not_found');
  const start = resolveReservationStart(restaurant, date, hhmm);
  if (partySize > table.capacity) throw new ApiError('party_exceeds_capacity');
  const end = start + restaurant.reservation_duration_minutes * 60000;
  if (overlapsConfirmed(state, restaurant.id, table.id, start, end)) throw new ApiError('table_unavailable');

  const reservation: Reservation = {
    id: newReservationId(),
    reference: newReference(state.references),
    user_id: userId,
    restaurant_id: restaurant.id,
    table_id: table.id,
    party_size: partySize,
    start_ms: start,
    duration_minutes: restaurant.reservation_duration_minutes,
    status: 'confirmed',
    created_ms: Date.now(),
  };
  state.reservations.set(reservation.id, reservation);
  state.references.set(reservation.reference, reservation.id);
  return { status: 201, body: reservationView(state, reservation) };
}

function ownedReservation(state: State, userId: string, reference: string): Reservation {
  const id = state.references.get(reference);
  if (id === undefined) throw new ApiError('not_found');
  const reservation = state.reservations.get(id);
  if (reservation === undefined || reservation.user_id !== userId) throw new ApiError('not_found');
  return reservation;
}

export function listReservations(state: State, userId: string): { reservations: Record<string, unknown>[] } {
  const mine = [...state.reservations.values()]
    .filter((reservation) => reservation.user_id === userId)
    .sort((a, b) => b.start_ms - a.start_ms);
  return { reservations: mine.map((reservation) => reservationView(state, reservation)) };
}

export function getReservation(
  state: State,
  userId: string,
  reference: string,
): Record<string, unknown> {
  return reservationView(state, ownedReservation(state, userId, reference));
}

function cutoffReached(restaurant: Restaurant, reservation: Reservation): boolean {
  return Date.now() >= reservation.start_ms - restaurant.cancellation_cutoff_minutes * 60000;
}

export function cancelReservation(
  state: State,
  userId: string,
  reference: string,
): Record<string, unknown> {
  const reservation = ownedReservation(state, userId, reference);
  if (reservation.status === 'cancelled') return reservationView(state, reservation);
  const restaurant = restaurantOf(state, reservation.restaurant_id);
  if (cutoffReached(restaurant, reservation)) throw new ApiError('cutoff_passed');
  reservation.status = 'cancelled';
  return reservationView(state, reservation);
}

export function patchReservation(
  state: State,
  userId: string,
  reference: string,
  body: Body,
): Record<string, unknown> {
  const reservation = ownedReservation(state, userId, reference);
  if (reservation.status === 'cancelled') throw new ApiError('reservation_cancelled');
  const restaurant = restaurantOf(state, reservation.restaurant_id);
  if (cutoffReached(restaurant, reservation)) throw new ApiError('cutoff_passed');

  const tableId = optionalString(body, 'table_id') ?? reservation.table_id;
  const partySize = optionalPartySize(body, 'party_size') ?? reservation.party_size;
  const startsAtLocal = optionalString(body, 'starts_at_local');
  const current = localDatesOf(reservation, restaurant.timezone);
  const { date, hhmm } =
    startsAtLocal === undefined ? current : bareLocal(startsAtLocal, 'starts_at_local');

  const table = restaurant.tables.find((candidate) => candidate.id === tableId);
  if (table === undefined) throw new ApiError('not_found');
  const start = resolveReservationStart(restaurant, date, hhmm);
  if (partySize > table.capacity) throw new ApiError('party_exceeds_capacity');
  const end = start + restaurant.reservation_duration_minutes * 60000;
  if (overlapsConfirmed(state, restaurant.id, table.id, start, end, reservation.id)) {
    throw new ApiError('table_unavailable');
  }

  reservation.table_id = table.id;
  reservation.party_size = partySize;
  reservation.start_ms = start;
  reservation.duration_minutes = restaurant.reservation_duration_minutes;
  return reservationView(state, reservation);
}

// ---- atomic moves -----------------------------------------------------------

type PlannedMove = {
  reservation: Reservation;
  tableId: string;
  partySize: number;
  start: number;
  end: number;
};

export function applyMoves(
  state: State,
  userId: string,
  body: Body,
): { status: number; body: Record<string, unknown> } {
  const moves = body.moves;
  if (!Array.isArray(moves) || moves.length < 1 || moves.length > 8) {
    throw new ApiError('validation_failed');
  }
  const items = moves.map((raw) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new ApiError('validation_failed');
    const reference = (raw as Body).reference;
    if (typeof reference !== 'string' || reference === '') throw new ApiError('validation_failed');
    return { raw: raw as Body, reference };
  });
  if (new Set(items.map((item) => item.reference)).size !== items.length) {
    throw new ApiError('validation_failed');
  }

  const targets = items.map((item) => ownedReservation(state, userId, item.reference));
  const restaurantId = (targets[0] as Reservation).restaurant_id;
  if (targets.some((target) => target.restaurant_id !== restaurantId)) {
    throw new ApiError('validation_failed');
  }
  const restaurant = restaurantOf(state, restaurantId);

  const plans: PlannedMove[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const reservation = targets[index] as Reservation;
    const raw = (items[index] as { raw: Body }).raw;
    if (reservation.status === 'cancelled') throw new ApiError('reservation_cancelled');
    if (cutoffReached(restaurant, reservation)) throw new ApiError('cutoff_passed');

    const tableId = optionalString(raw, 'table_id') ?? reservation.table_id;
    const partySize = optionalPartySize(raw, 'party_size') ?? reservation.party_size;
    const startsAtLocal = optionalString(raw, 'starts_at_local');
    const current = localDatesOf(reservation, restaurant.timezone);
    const { date, hhmm } =
      startsAtLocal === undefined ? current : bareLocal(startsAtLocal, 'starts_at_local');

    const table = restaurant.tables.find((candidate) => candidate.id === tableId);
    if (table === undefined) throw new ApiError('not_found');
    const start = resolveReservationStart(restaurant, date, hhmm);
    if (partySize > table.capacity) throw new ApiError('party_exceeds_capacity');
    plans.push({
      reservation,
      tableId: table.id,
      partySize,
      start,
      end: start + restaurant.reservation_duration_minutes * 60000,
    });
  }

  const listedIds = new Set(targets.map((target) => target.id));
  const occupancy: { restaurantId: string; tableId: string; start: number; end: number }[] = [];
  for (const other of state.reservations.values()) {
    if (other.status !== 'confirmed' || listedIds.has(other.id)) continue;
    occupancy.push({
      restaurantId: other.restaurant_id,
      tableId: other.table_id,
      start: other.start_ms,
      end: endOf(other),
    });
  }
  for (const plan of plans) {
    occupancy.push({ restaurantId, tableId: plan.tableId, start: plan.start, end: plan.end });
  }
  for (let a = 0; a < occupancy.length; a += 1) {
    for (let b = a + 1; b < occupancy.length; b += 1) {
      const left = occupancy[a] as { restaurantId: string; tableId: string; start: number; end: number };
      const right = occupancy[b] as { restaurantId: string; tableId: string; start: number; end: number };
      if (
        left.restaurantId === right.restaurantId &&
        left.tableId === right.tableId &&
        left.start < right.end &&
        right.start < left.end
      ) {
        throw new ApiError('table_unavailable');
      }
    }
  }

  const views = plans.map((plan) => {
    plan.reservation.table_id = plan.tableId;
    plan.reservation.party_size = plan.partySize;
    plan.reservation.start_ms = plan.start;
    plan.reservation.duration_minutes = restaurant.reservation_duration_minutes;
    return reservationView(state, plan.reservation);
  });
  return { status: 201, body: { reservations: views } };
}
