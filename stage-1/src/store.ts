/**
 * The service state and the fixture/import builders that replace it.
 *
 * All state lives in memory. Correctness under concurrency does not depend on a
 * database here: every mutating path runs to completion synchronously inside the
 * single-threaded request handler, so the read-then-write window cannot interleave.
 * A snapshot for `/_test/export` is an exact JSON projection, and import replaces
 * the whole state object in one assignment.
 */

import { randomBytes } from 'node:crypto';
import { ApiError } from './errors.ts';
import { hashPassword, newToken, newUserId } from './auth.ts';
import {
  WEEKDAYS,
  isRealDate,
  resolveLocalFirst,
  weekdayOf,
  zoneExists,
  type Weekday,
} from './timezone.ts';

export const MAX_ID_LENGTH = 64;
export const REFERENCE_RE = /^[A-Z0-9]{6,12}$/;
const REFERENCE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export type OpeningHour = { weekday: Weekday; opens: string; closes: string };
export type TableInfo = { id: string; label: string; capacity: number };

export type Restaurant = {
  id: string;
  name: string;
  timezone: string;
  slot_minutes: number;
  reservation_duration_minutes: number;
  cancellation_cutoff_minutes: number;
  opening_hours: OpeningHour[];
  tables: TableInfo[];
};

export type User = {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
};

export type Reservation = {
  id: string;
  reference: string;
  user_id: string;
  restaurant_id: string;
  table_id: string;
  party_size: number;
  start_ms: number;
  duration_minutes: number;
  status: 'confirmed' | 'cancelled';
  created_ms: number;
};

export type IdempotencyRecord = {
  body_canonical: string;
  status: number;
  response: unknown;
};

export type State = {
  users: Map<string, User>;
  emails: Map<string, string>;
  tokens: Map<string, string>;
  restaurants: Map<string, Restaurant>;
  restaurantOrder: string[];
  reservations: Map<string, Reservation>;
  references: Map<string, string>;
  idempotency: Map<string, IdempotencyRecord>;
};

export type Store = { current: State };

export function emptyState(): State {
  return {
    users: new Map(),
    emails: new Map(),
    tokens: new Map(),
    restaurants: new Map(),
    restaurantOrder: [],
    reservations: new Map(),
    references: new Map(),
    idempotency: new Map(),
  };
}

export function newStore(): Store {
  return { current: emptyState() };
}

export function idempotencyKey(userId: string, path: string, key: string): string {
  return `${userId}\u0000${path}\u0000${key}`;
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

export function isReference(value: unknown): value is string {
  return typeof value === 'string' && REFERENCE_RE.test(value);
}

export function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= MAX_ID_LENGTH;
}

export function newReservationId(): string {
  return `res_${randomBytes(8).toString('hex')}`;
}

export function newReference(references: Map<string, string>): string {
  for (;;) {
    let reference = '';
    const bytes = randomBytes(6);
    for (let index = 0; index < 6; index += 1) {
      const byte = bytes[index] as number;
      reference += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length] as string;
    }
    if (!references.has(reference)) return reference;
  }
}

/** JSON with object keys in sorted order, so JSON-value equality ignores key order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const ordered: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) ordered[key] = sortValue(source[key]);
    return ordered;
  }
  return value;
}

// ---- fixture / import -------------------------------------------------------

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function fail(): never {
  throw new ApiError('validation_failed');
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

function readOpeningHour(raw: unknown): OpeningHour {
  if (raw === null || typeof raw !== 'object') fail();
  const record = raw as Record<string, unknown>;
  const weekday = record.weekday;
  if (typeof weekday !== 'string' || !(WEEKDAYS as readonly string[]).includes(weekday)) fail();
  const opens = record.opens;
  const closes = record.closes;
  if (typeof opens !== 'string' || !HHMM_RE.test(opens)) fail();
  if (typeof closes !== 'string' || !HHMM_RE.test(closes)) fail();
  if (minutes(closes) <= minutes(opens)) fail();
  return { weekday: weekday as Weekday, opens, closes };
}

function readTable(raw: unknown): TableInfo {
  if (raw === null || typeof raw !== 'object') fail();
  const record = raw as Record<string, unknown>;
  if (!isId(record.id)) fail();
  if (typeof record.label !== 'string') fail();
  if (!isInteger(record.capacity) || record.capacity <= 0) fail();
  return { id: record.id, label: record.label, capacity: record.capacity };
}

function readRestaurant(raw: unknown): Restaurant {
  if (raw === null || typeof raw !== 'object') fail();
  const record = raw as Record<string, unknown>;
  if (!isId(record.id)) fail();
  if (typeof record.name !== 'string') fail();
  if (typeof record.timezone !== 'string' || !zoneExists(record.timezone)) fail();
  if (!isInteger(record.slot_minutes) || record.slot_minutes <= 0) fail();
  if (!isInteger(record.reservation_duration_minutes) || record.reservation_duration_minutes <= 0) fail();
  if (!isInteger(record.cancellation_cutoff_minutes) || record.cancellation_cutoff_minutes < 0) fail();
  if (!Array.isArray(record.opening_hours)) fail();
  if (!Array.isArray(record.tables)) fail();
  const openingHours = record.opening_hours.map(readOpeningHour);
  const tables = record.tables.map(readTable);
  return {
    id: record.id,
    name: record.name,
    timezone: record.timezone,
    slot_minutes: record.slot_minutes,
    reservation_duration_minutes: record.reservation_duration_minutes,
    cancellation_cutoff_minutes: record.cancellation_cutoff_minutes,
    opening_hours: openingHours,
    tables,
  };
}

function readUser(raw: unknown): User {
  if (raw === null || typeof raw !== 'object') fail();
  const record = raw as Record<string, unknown>;
  if (!isId(record.id)) fail();
  if (typeof record.email !== 'string') fail();
  if (typeof record.password !== 'string') fail();
  if (typeof record.display_name !== 'string') fail();
  return {
    id: record.id,
    email: record.email,
    password_hash: hashPassword(record.password),
    display_name: record.display_name,
  };
}

function readSeededReservation(
  raw: unknown,
  restaurants: Map<string, Restaurant>,
): Reservation {
  if (raw === null || typeof raw !== 'object') fail();
  const record = raw as Record<string, unknown>;
  if (!isId(record.id)) fail();
  if (!isReference(record.reference)) fail();
  if (!isNonEmptyString(record.user_id) || record.user_id.length > MAX_ID_LENGTH) fail();
  if (!isNonEmptyString(record.restaurant_id) || record.restaurant_id.length > MAX_ID_LENGTH) fail();
  if (!isNonEmptyString(record.table_id) || record.table_id.length > MAX_ID_LENGTH) fail();
  if (!isInteger(record.party_size) || record.party_size < 1) fail();
  if (typeof record.starts_at_local !== 'string') fail();
  const restaurant = restaurants.get(record.restaurant_id as string);
  if (restaurant === undefined) fail();
  const stamp = record.starts_at_local;
  if (stamp.length < 16) fail();
  const date = stamp.slice(0, 10);
  const hhmm = stamp.slice(11, 16);
  if (!isRealDateStringLocal(date)) fail();
  const start = resolveLocalFirst(date, hhmm, restaurant.timezone);
  if (start === null) fail();
  return {
    id: record.id,
    reference: record.reference,
    user_id: record.user_id,
    restaurant_id: record.restaurant_id,
    table_id: record.table_id,
    party_size: record.party_size,
    start_ms: start,
    duration_minutes: restaurant.reservation_duration_minutes,
    status: 'confirmed',
    created_ms: Date.now(),
  };
}

function isRealDateStringLocal(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  return isRealDate(y, mo, d);
}

/** Build a fresh state from a reset/import fixture body. Throws 422 on anything invalid. */
export function stateFromFixture(raw: unknown): State {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail();
  const record = raw as Record<string, unknown>;
  const rawUsers = record.users ?? [];
  const rawRestaurants = record.restaurants ?? [];
  const rawReservations = record.reservations ?? [];
  if (!Array.isArray(rawUsers) || !Array.isArray(rawRestaurants) || !Array.isArray(rawReservations)) {
    fail();
  }

  const state = emptyState();
  for (const rawUser of rawUsers) {
    const user = readUser(rawUser);
    if (state.users.has(user.id)) fail();
    state.users.set(user.id, user);
    state.emails.set(user.email.toLowerCase(), user.id);
  }
  for (const rawRestaurant of rawRestaurants) {
    const restaurant = readRestaurant(rawRestaurant);
    if (state.restaurants.has(restaurant.id)) fail();
    state.restaurants.set(restaurant.id, restaurant);
    state.restaurantOrder.push(restaurant.id);
  }
  for (const rawReservation of rawReservations) {
    const reservation = readSeededReservation(rawReservation, state.restaurants);
    if (state.reservations.has(reservation.id)) fail();
    if (state.references.has(reservation.reference)) fail();
    state.reservations.set(reservation.id, reservation);
    state.references.set(reservation.reference, reservation.id);
  }
  return state;
}

// ---- export / import --------------------------------------------------------

export type ExportedState = {
  users: User[];
  tokens: [string, string][];
  restaurants: Restaurant[];
  reservations: Reservation[];
  idempotency: [string, IdempotencyRecord][];
};

export function exportState(state: State): ExportedState {
  const snapshot: ExportedState = {
    users: [...state.users.values()],
    tokens: [...state.tokens.entries()],
    restaurants: state.restaurantOrder.map((id) => state.restaurants.get(id) as Restaurant),
    reservations: [...state.reservations.values()],
    idempotency: [...state.idempotency.entries()],
  };
  // A genuine deep snapshot: later writes to live state cannot alter a pending export.
  return structuredClone(snapshot);
}

/** Rebuild state from an opaque export. Throws 422 if the payload is not one of ours. */
export function stateFromExported(raw: unknown): State {
  if (raw === null || typeof raw !== 'object') fail();
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.users) || !Array.isArray(record.tokens) ||
      !Array.isArray(record.restaurants) || !Array.isArray(record.reservations) ||
      !Array.isArray(record.idempotency)) {
    fail();
  }
  const state = emptyState();
  for (const rawUser of record.users) {
    const user = rawUser as User;
    if (!isId(user?.id) || typeof user.email !== 'string' ||
        typeof user.password_hash !== 'string' || typeof user.display_name !== 'string') fail();
    state.users.set(user.id, { ...user });
    state.emails.set(user.email.toLowerCase(), user.id);
  }
  for (const pair of record.tokens as unknown[]) {
    if (!Array.isArray(pair) || typeof pair[0] !== 'string' || typeof pair[1] !== 'string') fail();
    state.tokens.set(pair[0] as string, pair[1] as string);
  }
  for (const rawRestaurant of record.restaurants) {
    const restaurant = rawRestaurant as Restaurant;
    if (!isId(restaurant?.id) || typeof restaurant.name !== 'string' ||
        typeof restaurant.timezone !== 'string' || !zoneExists(restaurant.timezone) ||
        !isInteger(restaurant.slot_minutes) || !isInteger(restaurant.reservation_duration_minutes) ||
        !isInteger(restaurant.cancellation_cutoff_minutes) ||
        !Array.isArray(restaurant.opening_hours) || !Array.isArray(restaurant.tables)) fail();
    state.restaurants.set(restaurant.id, restaurant);
    state.restaurantOrder.push(restaurant.id);
  }
  for (const rawReservation of record.reservations) {
    const reservation = rawReservation as Reservation;
    if (!isId(reservation?.id) || !isReference(reservation.reference) ||
        typeof reservation.user_id !== 'string' || typeof reservation.restaurant_id !== 'string' ||
        typeof reservation.table_id !== 'string' || !isInteger(reservation.party_size) ||
        !isInteger(reservation.start_ms) || !isInteger(reservation.duration_minutes) ||
        (reservation.status !== 'confirmed' && reservation.status !== 'cancelled') ||
        !isInteger(reservation.created_ms)) fail();
    state.reservations.set(reservation.id, reservation);
    state.references.set(reservation.reference, reservation.id);
  }
  for (const pair of record.idempotency as unknown[]) {
    if (!Array.isArray(pair) || typeof pair[0] !== 'string') fail();
    const value = pair[1] as IdempotencyRecord;
    if (value === null || typeof value !== 'object' || typeof value.body_canonical !== 'string' ||
        !isInteger(value.status)) fail();
    state.idempotency.set(pair[0] as string, value);
  }
  return state;
}

export { weekdayOf };
