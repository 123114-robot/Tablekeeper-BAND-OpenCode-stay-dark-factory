/**
 * The service state and the fixture/import builders that replace it.
 *
 * All state lives in memory. Correctness under concurrency does not depend on a
 * database here: every mutating path runs to completion synchronously inside the
 * single-threaded request handler, so the read-then-write window cannot interleave.
 * A snapshot for `/_test/export` is an exact JSON projection, and import replaces
 * the whole state object in one assignment.
 *
 * Stage 2 added `Restaurant.combinable` and `Reservation.table_ids` (a legacy
 * stage-1 export upgrades on import). Stage 3 adds:
 *   - `Restaurant.manager_user_ids` (who may publish), `Restaurant.policies`
 *     (immutable, publication-ordered) and an internal `Restaurant.revision`
 *     counter that increments once per adoption or move batch;
 *   - `Reservation.revision`, `accepted_terms` (the policy snapshot the booking
 *     froze at creation or its last real amendment), `history` (append-only) and
 *     `series_id` when the booking is an occurrence of a recurring agreement;
 *   - `State.series`: the agreements themselves.
 *
 * A stage-1 or stage-2 export — reservations without revision/terms/history and
 * restaurants without managers/policies — is accepted and upgraded on import, so
 * a session, confirmation link, original booking retry and the adoption path all
 * survive the stage boundary. Seeded and legacy-imported bookings start at
 * revision 1 under policy 0 with a synthesized `created` entry.
 */

import { randomBytes } from 'node:crypto';
import { ApiError } from './errors.ts';
import { hashPassword, newToken, newUserId } from './auth.ts';
import { appendEntry, createdChanges, type HistoryEntry, type HistoryField } from './history.ts';
import {
  policyZero,
  readStoredPolicy,
  termsOf,
  type AcceptedTerms,
  type Policy,
} from './policies.ts';
import {
  WEEKDAYS,
  isRealDate,
  localStampOf,
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
  combinable: string[][];
  /** Fixture-declared users allowed to publish policies (default []). */
  manager_user_ids: string[];
  /** Published policies in publication order; policy 0 is never stored here. */
  policies: Policy[];
  /** Internal counter: +1 once per successful adoption or move batch. */
  revision: number;
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
  table_ids: string[];
  party_size: number;
  start_ms: number;
  duration_minutes: number;
  status: 'confirmed' | 'cancelled';
  created_ms: number;
  /** 1 at creation; +1 per real amendment and on cancellation, never on a no-op. */
  revision: number;
  /** The policy snapshot frozen at creation or the last real amendment. */
  accepted_terms: AcceptedTerms;
  /** Append-only, oldest first; seq starts at 1. */
  history: HistoryEntry[];
  /** Set when the reservation is an occurrence of a recurring agreement. */
  series_id?: string;
};

export type SeriesOccurrence = { index: number; reference: string; exception: boolean };

export type Series = {
  id: string;
  user_id: string;
  restaurant_id: string;
  anchor_reference: string;
  count: number;
  interval_weeks: number;
  revision: number;
  occurrences: SeriesOccurrence[];
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
  series: Map<string, Series>;
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
    series: new Map(),
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

/**
 * A declared combinable pair: exactly two distinct table ids that both exist in this
 * restaurant. Pairs only — a three-table entry is rejected at reset, not carried as
 * an unusable row.
 */
function readPair(raw: unknown, tableIds: Set<string>): string[] {
  if (!Array.isArray(raw) || raw.length !== 2) fail();
  const [a, b] = raw as unknown[];
  if (typeof a !== 'string' || typeof b !== 'string' || a === b) fail();
  if (!tableIds.has(a) || !tableIds.has(b)) fail();
  return [a, b];
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
  const tableIds = new Set(tables.map((table) => table.id));
  const rawPairs = record.combinable ?? [];
  if (!Array.isArray(rawPairs)) fail();
  const combinable = rawPairs.map((pair) => readPair(pair, tableIds));
  const seen = new Set<string>();
  for (const [a, b] of combinable) {
    const key = [a, b].sort().join('\u0000');
    if (seen.has(key)) fail();
    seen.add(key);
  }
  // Stage 3: fixture-declared managers (default []). Policies are NOT fixture
  // input — they enter the state only through POST /restaurants/{id}/policies —
  // so a stray `policies` field in a reset body is an unknown field, ignored.
  const rawManagers = record.manager_user_ids ?? [];
  if (!Array.isArray(rawManagers)) fail();
  const manager_user_ids = rawManagers.map((value) => {
    if (!isNonEmptyString(value) || value.length > MAX_ID_LENGTH) fail();
    return value;
  });
  return {
    id: record.id,
    name: record.name,
    timezone: record.timezone,
    slot_minutes: record.slot_minutes,
    reservation_duration_minutes: record.reservation_duration_minutes,
    cancellation_cutoff_minutes: record.cancellation_cutoff_minutes,
    opening_hours: openingHours,
    tables,
    combinable,
    manager_user_ids,
    policies: [],
    revision: 0,
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

/**
 * The table set of a seeded or imported reservation: `table_ids` when present, else
 * the legacy single `table_id`. Both forms are accepted so a stage-1 fixture or
 * export loads unchanged.
 */
function readTableIds(record: Record<string, unknown>): string[] {
  const many = record.table_ids;
  const one = record.table_id;
  if (many !== undefined && one !== undefined) fail();
  if (many !== undefined) {
    if (!Array.isArray(many) || many.length === 0) fail();
    const ids = many.map((value) => {
      if (!isNonEmptyString(value) || value.length > MAX_ID_LENGTH) fail();
      return value as string;
    });
    if (new Set(ids).size !== ids.length) fail();
    return ids;
  }
  if (!isNonEmptyString(one) || one.length > MAX_ID_LENGTH) fail();
  return [one];
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
  const tableIds = readTableIds(record);
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
  const status = record.status === 'cancelled' ? 'cancelled' : 'confirmed';
  const reservation: Reservation = {
    id: record.id,
    reference: record.reference,
    user_id: record.user_id,
    restaurant_id: record.restaurant_id,
    table_ids: tableIds,
    party_size: record.party_size,
    start_ms: start,
    duration_minutes: restaurant.reservation_duration_minutes,
    status,
    created_ms: Date.now(),
    revision: 1,
    accepted_terms: termsOf(policyZero(restaurant)),
    history: [],
  };
  // A seeded booking was "created" when the fixture loaded: one `created` entry
  // at revision 1 under policy 0; it acquires no other history until actually used.
  appendEntry(
    reservation.history,
    'created',
    createdChanges(localStampOf(start, restaurant.timezone), tableIds, record.party_size),
    1,
    reservation.accepted_terms,
    reservation.created_ms,
  );
  return reservation;
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
  /** Stage 3: absent (default []) in a stage-1/2 export from the same team. */
  series: Series[];
};

export function exportState(state: State): ExportedState {
  const snapshot: ExportedState = {
    users: [...state.users.values()],
    tokens: [...state.tokens.entries()],
    restaurants: state.restaurantOrder.map((id) => state.restaurants.get(id) as Restaurant),
    reservations: [...state.reservations.values()],
    idempotency: [...state.idempotency.entries()],
    series: [...state.series.values()],
  };
  // A genuine deep snapshot: later writes to live state cannot alter a pending export.
  return structuredClone(snapshot);
}

function readImportedRestaurant(raw: unknown): Restaurant {
  const record = raw as Record<string, unknown>;
  if (!isId(record?.id) || typeof record.name !== 'string' ||
      typeof record.timezone !== 'string' || !zoneExists(record.timezone) ||
      !isInteger(record.slot_minutes) || !isInteger(record.reservation_duration_minutes) ||
      !isInteger(record.cancellation_cutoff_minutes) ||
      !Array.isArray(record.opening_hours) || !Array.isArray(record.tables)) fail();
  const tables = record.tables as TableInfo[];
  const tableIds = new Set(tables.map((table) => table.id));
  const rawPairs = (record.combinable ?? []) as unknown;
  if (!Array.isArray(rawPairs)) fail();
  const combinable = rawPairs.map((pair) => readPair(pair, tableIds));
  // Stage-3 fields default for a stage-1/2 export: no managers, no policies,
  // revision counter 0. A stage-3 export round-trips them exactly.
  const rawManagers = (record.manager_user_ids ?? []) as unknown;
  if (!Array.isArray(rawManagers)) fail();
  const manager_user_ids = rawManagers.map((value) => {
    if (!isNonEmptyString(value) || value.length > MAX_ID_LENGTH) fail();
    return value;
  });
  const rawPolicies = (record.policies ?? []) as unknown;
  if (!Array.isArray(rawPolicies)) fail();
  const revision = (record.revision ?? 0) as unknown;
  if (!isInteger(revision) || revision < 0) fail();
  const restaurant: Restaurant = {
    id: record.id,
    name: record.name,
    timezone: record.timezone,
    slot_minutes: record.slot_minutes,
    reservation_duration_minutes: record.reservation_duration_minutes,
    cancellation_cutoff_minutes: record.cancellation_cutoff_minutes,
    opening_hours: record.opening_hours as OpeningHour[],
    tables,
    combinable,
    manager_user_ids,
    policies: [],
    revision,
  };
  restaurant.policies = rawPolicies.map((rawPolicy) => readStoredPolicy(rawPolicy, restaurant));
  return restaurant;
}

function readImportedTerms(raw: unknown): AcceptedTerms {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail();
  const record = raw as Record<string, unknown>;
  if (!isInteger(record.policy_version) || record.policy_version < 0) fail();
  if (!isInteger(record.slot_minutes) || record.slot_minutes < 1) fail();
  if (!isInteger(record.reservation_duration_minutes) || record.reservation_duration_minutes < 1) fail();
  if (!isInteger(record.cancellation_cutoff_minutes) || record.cancellation_cutoff_minutes < 0) fail();
  if (!Array.isArray(record.opening_hours)) fail();
  const rawCapacities = record.capacities;
  if (rawCapacities === null || typeof rawCapacities !== 'object' || Array.isArray(rawCapacities)) fail();
  const capacities: Record<string, number> = {};
  for (const [key, value] of Object.entries(rawCapacities as Record<string, unknown>)) {
    if (!isInteger(value) || value < 1) fail();
    capacities[key] = value;
  }
  return {
    policy_version: record.policy_version,
    slot_minutes: record.slot_minutes,
    reservation_duration_minutes: record.reservation_duration_minutes,
    cancellation_cutoff_minutes: record.cancellation_cutoff_minutes,
    opening_hours: (record.opening_hours as OpeningHour[]).map((hour) => ({ ...hour })),
    capacities,
  };
}

function readImportedEntry(raw: unknown): HistoryEntry {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail();
  const record = raw as Record<string, unknown>;
  if (!isInteger(record.seq) || record.seq < 1) fail();
  if (!isInteger(record.at_ms)) fail();
  if (record.event !== 'created' && record.event !== 'changed' && record.event !== 'cancelled') fail();
  if (!Array.isArray(record.changes)) fail();
  const changes = record.changes.map((rawChange) => {
    if (rawChange === null || typeof rawChange !== 'object' || Array.isArray(rawChange)) fail();
    const change = rawChange as Record<string, unknown>;
    if (change.field !== 'table_id' && change.field !== 'table_ids' &&
        change.field !== 'starts_at_local' && change.field !== 'party_size') fail();
    return { field: change.field as HistoryField, from: change.from, to: change.to };
  });
  if (!isInteger(record.revision) || record.revision < 1) fail();
  return {
    seq: record.seq,
    at_ms: record.at_ms,
    event: record.event,
    changes,
    revision: record.revision,
    accepted_terms: readImportedTerms(record.accepted_terms),
  };
}

function readImportedReservation(
  raw: unknown,
  restaurants: Map<string, Restaurant>,
): Reservation {
  const record = raw as Record<string, unknown>;
  if (!isId(record?.id) || !isReference(record.reference) ||
      typeof record.user_id !== 'string' || typeof record.restaurant_id !== 'string' ||
      !isInteger(record.party_size) ||
      !isInteger(record.start_ms) || !isInteger(record.duration_minutes) ||
      (record.status !== 'confirmed' && record.status !== 'cancelled') ||
      !isInteger(record.created_ms)) fail();
  const base = {
    id: record.id,
    reference: record.reference,
    user_id: record.user_id,
    restaurant_id: record.restaurant_id,
    table_ids: readTableIds(record),
    party_size: record.party_size,
    start_ms: record.start_ms,
    duration_minutes: record.duration_minutes,
    status: record.status as 'confirmed' | 'cancelled',
    created_ms: record.created_ms,
  };
  const isStage3 =
    record.revision !== undefined || record.accepted_terms !== undefined || record.history !== undefined;
  if (!isStage3) {
    // A stage-1/2 export upgrades exactly like a seeded booking: revision 1 under
    // policy 0 with a synthesized `created` entry, so history and decision work.
    const restaurant = restaurants.get(record.restaurant_id as string);
    if (restaurant === undefined) fail();
    const reservation: Reservation = {
      ...base,
      revision: 1,
      accepted_terms: termsOf(policyZero(restaurant)),
      history: [],
    };
    appendEntry(
      reservation.history,
      'created',
      createdChanges(
        localStampOf(reservation.start_ms, restaurant.timezone),
        reservation.table_ids,
        reservation.party_size,
      ),
      1,
      reservation.accepted_terms,
      reservation.created_ms,
    );
    return reservation;
  }
  if (!isInteger(record.revision) || record.revision < 1) fail();
  if (!Array.isArray(record.history)) fail();
  const history = record.history.map(readImportedEntry);
  history.forEach((entry, index) => {
    if (entry.seq !== index + 1) fail();
  });
  const seriesId = record.series_id;
  if (seriesId !== undefined && (typeof seriesId !== 'string' || seriesId.length === 0)) fail();
  return {
    ...base,
    revision: record.revision,
    accepted_terms: readImportedTerms(record.accepted_terms),
    history,
    ...(seriesId === undefined ? {} : { series_id: seriesId }),
  };
}

function readImportedSeries(raw: unknown): Series {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail();
  const record = raw as Record<string, unknown>;
  if (!isId(record.id)) fail();
  if (!isNonEmptyString(record.user_id) || record.user_id.length > MAX_ID_LENGTH) fail();
  if (!isNonEmptyString(record.restaurant_id) || record.restaurant_id.length > MAX_ID_LENGTH) fail();
  if (!isReference(record.anchor_reference)) fail();
  if (!isInteger(record.count) || record.count < 1) fail();
  if (!isInteger(record.interval_weeks) || record.interval_weeks < 1) fail();
  if (!isInteger(record.revision) || record.revision < 1) fail();
  if (!Array.isArray(record.occurrences)) fail();
  const occurrences = record.occurrences.map((rawOccurrence) => {
    if (rawOccurrence === null || typeof rawOccurrence !== 'object' || Array.isArray(rawOccurrence)) fail();
    const occurrence = rawOccurrence as Record<string, unknown>;
    if (!isInteger(occurrence.index) || occurrence.index < 0) fail();
    if (!isReference(occurrence.reference)) fail();
    if (typeof occurrence.exception !== 'boolean') fail();
    return {
      index: occurrence.index,
      reference: occurrence.reference,
      exception: occurrence.exception,
    };
  });
  occurrences.forEach((occurrence, position) => {
    if (occurrence.index !== position) fail();
  });
  return {
    id: record.id,
    user_id: record.user_id,
    restaurant_id: record.restaurant_id,
    anchor_reference: record.anchor_reference,
    count: record.count,
    interval_weeks: record.interval_weeks,
    revision: record.revision,
    occurrences,
  };
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
    const restaurant = readImportedRestaurant(rawRestaurant);
    state.restaurants.set(restaurant.id, restaurant);
    state.restaurantOrder.push(restaurant.id);
  }
  for (const rawReservation of record.reservations) {
    const reservation = readImportedReservation(rawReservation, state.restaurants);
    state.reservations.set(reservation.id, reservation);
    state.references.set(reservation.reference, reservation.id);
  }
  // Stage 3: absent in a stage-1/2 export from the same team (default []).
  const rawSeries = record.series ?? [];
  if (!Array.isArray(rawSeries)) fail();
  for (const rawOne of rawSeries) {
    const series = readImportedSeries(rawOne);
    if (state.series.has(series.id)) fail();
    state.series.set(series.id, series);
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
