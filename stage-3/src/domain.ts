/**
 * The official domain: restaurants, availability and reservations, plus Stage 2's
 * combined tables and Stage 3's policies, history and recurring agreements.
 *
 * Every mutating function validates completely before it changes anything, so a
 * rejected request leaves the state untouched. The overlap invariant is the
 * half-open interval `[start, start + duration)`; a booking at 19:00 for 90 minutes
 * and one at 20:30 do not overlap. A combined booking holds every table in its set
 * for the full interval, and the invariant is checked per member.
 *
 * Stage 3: the policy selected for a booking's local start date supplies the grid,
 * duration and capacities (fixture rules as policy 0 when nothing is published),
 * and every booking freezes that policy as `accepted_terms`. Cutoff checks use the
 * accepted snapshot. A real amendment re-selects the policy of the resulting date,
 * replaces terms and end time, increments the revision once and appends a `changed`
 * entry; a no-op keeps terms, end time, revision and history. Cancel increments the
 * revision once; repeated cancel changes nothing.
 */

import { ApiError } from './errors.ts';
import {
  appendEntry,
  createdChanges,
  sameTableSet,
  tableChange,
  type HistoryChange,
} from './history.ts';
import { parseNewPolicy, selectPolicy, termsOf, type Policy } from './policies.ts';
import {
  formatUtc,
  formatZoned,
  localStampOf,
  parseBareLocal,
  resolveLocalFirst,
  weekdayOf,
} from './timezone.ts';
import {
  isInteger,
  newReference,
  newReservationId,
  type Reservation,
  type Restaurant,
  type State,
  type TableInfo,
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

export function restaurantOf(state: State, id: string): Restaurant {
  const restaurant = state.restaurants.get(id);
  if (restaurant === undefined) throw new ApiError('not_found');
  return restaurant;
}

function timezoneFor(state: State, restaurantId: string): string {
  return state.restaurants.get(restaurantId)?.timezone ?? 'UTC';
}

export function reservationView(state: State, reservation: Reservation): Record<string, unknown> {
  const timezone = timezoneFor(state, reservation.restaurant_id);
  const view: Record<string, unknown> = {
    reservation_id: reservation.id,
    reference: reservation.reference,
    restaurant_id: reservation.restaurant_id,
    table_ids: [...reservation.table_ids],
    party_size: reservation.party_size,
    status: reservation.status,
    starts_at_local: localStampOf(reservation.start_ms, timezone),
    starts_at: formatZoned(reservation.start_ms, timezone),
    ends_at: formatZoned(
      reservation.start_ms + reservation.duration_minutes * 60000,
      timezone,
    ),
    created_at: formatUtc(reservation.created_ms),
    revision: reservation.revision,
    accepted_terms: structuredClone(reservation.accepted_terms),
  };
  // A single-table set also carries `table_id`; a combined booking omits it (§ API).
  if (reservation.table_ids.length === 1) view.table_id = reservation.table_ids[0];
  return view;
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
    if (other.restaurant_id !== restaurantId) continue;
    if (!other.table_ids.includes(tableId)) continue;
    if (excludeId !== undefined && other.id === excludeId) continue;
    if (other.start_ms < end && start < endOf(other)) return true;
  }
  return false;
}

export function anyOverlap(
  state: State,
  restaurantId: string,
  tableIds: string[],
  start: number,
  end: number,
  excludeId?: string,
): boolean {
  return tableIds.some((tableId) =>
    overlapsConfirmed(state, restaurantId, tableId, start, end, excludeId),
  );
}

/** Every local `HH:MM` slot start of `policy` on `date`, stepping from its `opens`. */
export function slotLocalTimes(policy: Policy, date: string): string[] {
  const hour = policy.opening_hours.find((entry) => entry.weekday === weekdayOf(date));
  if (hour === undefined) return [];
  const opens = minutes(hour.opens);
  const closes = minutes(hour.closes);
  const slots: string[] = [];
  for (
    let slot = opens;
    slot + policy.reservation_duration_minutes <= closes;
    slot += policy.slot_minutes
  ) {
    slots.push(formatHM(slot));
  }
  return slots;
}

export function localDatesOf(reservation: Reservation, timezone: string): { date: string; hhmm: string } {
  const stamp = localStampOf(reservation.start_ms, timezone);
  return { date: stamp.slice(0, 10), hhmm: stamp.slice(11, 16) };
}

/**
 * Resolve a reservation start against the selected policy, in §8 order: the
 * opening window first (so `17:00` is `outside_opening_hours`), then the grid
 * (so `18:01` is `not_on_slot_grid`), then existence in the zone.
 */
export function resolveReservationStart(
  restaurant: Restaurant,
  date: string,
  hhmm: string,
  policy: Policy,
): number {
  const hour = policy.opening_hours.find((entry) => entry.weekday === weekdayOf(date));
  if (hour === undefined) throw new ApiError('outside_opening_hours');
  const start = minutes(hhmm);
  const opens = minutes(hour.opens);
  const closes = minutes(hour.closes);
  const end = start + policy.reservation_duration_minutes;
  if (start < opens || end > closes) throw new ApiError('outside_opening_hours');
  if ((start - opens) % policy.slot_minutes !== 0) throw new ApiError('not_on_slot_grid');
  const instant = resolveLocalFirst(date, hhmm, restaurant.timezone);
  if (instant === null) throw new ApiError('invalid_local_time');
  return instant;
}

// ---- field readers ----------------------------------------------------------

export type Body = Record<string, unknown>;

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

/**
 * The requested table set from a create/patch/move body: `table_ids` (a non-empty
 * list of distinct ids) or the legacy single `table_id`. Sending both, an empty set,
 * or a repeated id is `422 validation_failed`; a non-string member is a type error.
 * Returns the ids in the order given; canonical ordering happens in `resolveTableSet`.
 */
function requestedTableIds(body: Body): string[] {
  const many = body.table_ids;
  const one = body.table_id;
  if (many !== undefined && one !== undefined) throw new ApiError('validation_failed');
  if (many !== undefined) {
    if (!Array.isArray(many) || many.length === 0) {
      throw new ApiError(Array.isArray(many) ? 'validation_failed' : 'malformed_request');
    }
    const ids = many.map((value) => {
      if (typeof value !== 'string' || value === '') throw new ApiError('malformed_request');
      return value;
    });
    if (new Set(ids).size !== ids.length) throw new ApiError('validation_failed');
    return ids;
  }
  if (one !== undefined) {
    if (typeof one !== 'string' || one === '') throw new ApiError('malformed_request');
    return [one];
  }
  throw new ApiError('validation_failed');
}

/**
 * Resolve a requested table set against a restaurant: every id must exist here, at
 * most two tables may be combined, and a pair must be declared in `combinable`.
 * Returns the resolved tables and the canonical id order (a pair is stored in the
 * order the restaurant declared it).
 */
function resolveTableSet(
  restaurant: Restaurant,
  requested: string[],
): { tables: TableInfo[]; canonical: string[] } {
  const tables = requested.map((id) => {
    const table = restaurant.tables.find((candidate) => candidate.id === id);
    if (table === undefined) throw new ApiError('not_found');
    return table;
  });
  if (requested.length === 1) return { tables, canonical: [...requested] };
  if (requested.length > 2) throw new ApiError('combination_not_allowed');
  const [a, b] = requested as [string, string];
  const pair = restaurant.combinable.find(
    (candidate) =>
      (candidate[0] === a && candidate[1] === b) || (candidate[0] === b && candidate[1] === a),
  );
  if (pair === undefined) throw new ApiError('combination_not_allowed');
  return { tables, canonical: [pair[0] as string, pair[1] as string] };
}

/** Party capacity of a table set under a policy: the sum of its per-table capacities. */
function summedCapacity(tables: TableInfo[], policy: Policy): number {
  return tables.reduce((total, table) => total + (policy.capacities[table.id] ?? 0), 0);
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
    combinable: restaurant.combinable.map((pair) => [...pair]),
    manager_user_ids: [...restaurant.manager_user_ids],
  };
}

// ---- policies ---------------------------------------------------------------

function policyBodyOf(policy: Policy): Record<string, unknown> {
  return {
    effective_from: policy.effective_from,
    slot_minutes: policy.slot_minutes,
    reservation_duration_minutes: policy.reservation_duration_minutes,
    cancellation_cutoff_minutes: policy.cancellation_cutoff_minutes,
    opening_hours: policy.opening_hours.map((hour) => ({ ...hour })),
    capacities: { ...policy.capacities },
    policy_version: policy.policy_version,
  };
}

/** Public, publication order, policy 0 omitted (`restaurant.policies` never holds it). */
export function getRestaurantPolicies(state: State, id: string): { policies: Record<string, unknown>[] } {
  const restaurant = restaurantOf(state, id);
  return { policies: restaurant.policies.map(policyBodyOf) };
}

/**
 * Publish one complete policy: unknown restaurant is 404 (in the caller), a
 * non-manager 403, an invalid policy 422 with no version or state change. The
 * version is the publication count + 1, so failed writes and replays allocate none.
 */
export function publishPolicy(
  state: State,
  restaurantId: string,
  userId: string,
  body: Body,
): { status: number; body: Record<string, unknown> } {
  const restaurant = restaurantOf(state, restaurantId);
  if (!restaurant.manager_user_ids.includes(userId)) throw new ApiError('forbidden');
  const parsed = parseNewPolicy(body, restaurant);
  const policy: Policy = { ...parsed, policy_version: restaurant.policies.length + 1 };
  restaurant.policies.push(policy);
  return { status: 201, body: policyBodyOf(policy) };
}

// ---- availability -----------------------------------------------------------

/**
 * Availability under the policy selected for `date`. Two independent rules decide
 * a table: `capacity` (party at most the policy's capacity for it) and
 * `no_overlap` (no confirmed reservation overlaps the slot interval). With
 * `explain=true` every slot carries one further field listing every table of the
 * restaurant exactly once, in fixture order, with both rules reported.
 */
export function availability(
  state: State,
  restaurantId: string,
  date: string,
  partySize: number,
  explain: boolean,
): Record<string, unknown> {
  const restaurant = restaurantOf(state, restaurantId);
  const policy = selectPolicy(restaurant, date);
  const capacityOf = (tableId: string): number => policy.capacities[tableId] ?? 0;
  const durationMs = policy.reservation_duration_minutes * 60000;
  const slots: Record<string, unknown>[] = [];

  for (const hhmm of slotLocalTimes(policy, date)) {
    const start = resolveLocalFirst(date, hhmm, restaurant.timezone);
    if (start === null) continue; // a skipped spring-forward local time never appears
    const end = start + durationMs;

    const holdsCapacity = (table: TableInfo): boolean => capacityOf(table.id) >= partySize;
    const holdsOverlap = (table: TableInfo): boolean =>
      !overlapsConfirmed(state, restaurant.id, table.id, start, end);

    // Singles first, in fixture order; `available_table_ids` is exactly these.
    const availableSingles = restaurant.tables.filter(
      (table) => holdsCapacity(table) && holdsOverlap(table),
    );
    const availableIds = availableSingles.map((table) => table.id);

    const options: Record<string, unknown>[] = availableSingles.map((table) => ({
      table_ids: [table.id],
      capacity: capacityOf(table.id),
    }));
    // Then declared pairs, in `combinable` order, with their summed policy capacity.
    for (const pair of restaurant.combinable) {
      const capacity = pair.reduce((total, id) => total + capacityOf(id), 0);
      if (capacity < partySize) continue;
      if (anyOverlap(state, restaurant.id, pair, start, end)) continue;
      options.push({ table_ids: [...pair], capacity });
    }

    const slot: Record<string, unknown> = {
      starts_at_local: `${date}T${hhmm}`,
      starts_at: formatZoned(start, restaurant.timezone),
      available_table_ids: availableIds,
      available_options: options,
    };
    if (explain) {
      slot.explain = restaurant.tables.map((table) => {
        const capacityHolds = holdsCapacity(table);
        const overlapHolds = holdsOverlap(table);
        return {
          table_id: table.id,
          policy_version: policy.policy_version,
          available: capacityHolds && overlapHolds,
          rules: [
            { rule: 'capacity', holds: capacityHolds },
            { rule: 'no_overlap', holds: overlapHolds },
          ],
        };
      });
    }
    slots.push(slot);
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
  const partySize = requiredPartySize(body, 'party_size');
  const startsAtLocal = requiredString(body, 'starts_at_local');
  const requested = requestedTableIds(body);
  const { date, hhmm } = bareLocal(startsAtLocal, 'starts_at_local');

  const restaurant = restaurantOf(state, restaurantId);
  const { tables, canonical } = resolveTableSet(restaurant, requested);
  const policy = selectPolicy(restaurant, date);
  const start = resolveReservationStart(restaurant, date, hhmm, policy);
  if (partySize > summedCapacity(tables, policy)) throw new ApiError('party_exceeds_capacity');
  const end = start + policy.reservation_duration_minutes * 60000;
  if (anyOverlap(state, restaurant.id, canonical, start, end)) throw new ApiError('table_unavailable');

  const createdMs = Date.now();
  const terms = termsOf(policy);
  const reservation: Reservation = {
    id: newReservationId(),
    reference: newReference(state.references),
    user_id: userId,
    restaurant_id: restaurant.id,
    table_ids: canonical,
    party_size: partySize,
    start_ms: start,
    duration_minutes: policy.reservation_duration_minutes,
    status: 'confirmed',
    created_ms: createdMs,
    revision: 1,
    accepted_terms: terms,
    history: [],
  };
  appendEntry(
    reservation.history,
    'created',
    createdChanges(`${date}T${hhmm}`, canonical, partySize),
    1,
    terms,
    createdMs,
  );
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

/**
 * The reservation's own record, oldest first. Only its owner may read it — anyone
 * else gets the same 404 as a reservation that is not theirs, cancelled or not.
 * History and decision resolve the 404 before authentication, so routes call this
 * only after establishing an owner.
 */
export function getHistory(
  state: State,
  userId: string,
  reference: string,
): Record<string, unknown> {
  const reservation = ownedReservation(state, userId, reference);
  const timezone = timezoneFor(state, reservation.restaurant_id);
  return {
    reference: reservation.reference,
    entries: reservation.history.map((entry) => ({
      seq: entry.seq,
      at: formatZoned(entry.at_ms, timezone),
      event: entry.event,
      changes: structuredClone(entry.changes),
      revision: entry.revision,
      accepted_terms: structuredClone(entry.accepted_terms),
    })),
  };
}

export function getDecision(
  state: State,
  userId: string,
  reference: string,
): Record<string, unknown> {
  const reservation = ownedReservation(state, userId, reference);
  return {
    reference: reservation.reference,
    revision: reservation.revision,
    accepted_terms: structuredClone(reservation.accepted_terms),
  };
}

/** Cancel checks the accepted cutoff against the current start, not the live policy. */
export function cutoffReached(reservation: Reservation): boolean {
  return (
    Date.now() >=
    reservation.start_ms - reservation.accepted_terms.cancellation_cutoff_minutes * 60000
  );
}

// ---- recurring agreements (hooks; creation lives in series.ts) ---------------

function seriesFor(state: State, reservation: Reservation) {
  if (reservation.series_id === undefined) return undefined;
  return state.series.get(reservation.series_id);
}

/** Mark the occurrence a permanent diner exception; returns its series id, if any. */
function markSeriesException(state: State, reservation: Reservation): string | undefined {
  const series = seriesFor(state, reservation);
  if (series === undefined) return undefined;
  const occurrence = series.occurrences.find((entry) => entry.reference === reservation.reference);
  if (occurrence !== undefined) occurrence.exception = true;
  return series.id;
}

function bumpSeriesRevision(state: State, seriesId: string): void {
  const series = state.series.get(seriesId);
  if (series !== undefined) series.revision += 1;
}

export function cancelReservation(
  state: State,
  userId: string,
  reference: string,
): Record<string, unknown> {
  const reservation = ownedReservation(state, userId, reference);
  if (reservation.status === 'cancelled') return reservationView(state, reservation);
  if (cutoffReached(reservation)) throw new ApiError('cutoff_passed');
  reservation.status = 'cancelled';
  reservation.revision += 1;
  appendEntry(
    reservation.history,
    'cancelled',
    [],
    reservation.revision,
    reservation.accepted_terms,
    Date.now(),
  );
  // A cancellation touches its series (revision only) but is not a diner exception.
  const series = seriesFor(state, reservation);
  if (series !== undefined) series.revision += 1;
  return reservationView(state, reservation);
}

export function patchReservation(
  state: State,
  userId: string,
  reference: string,
  body: Body,
): Record<string, unknown> {
  const reservation = ownedReservation(state, userId, reference);
  // D1 check order: bad `expected_revision` type/range (422) -> cancelled (409) ->
  // stale (409, before cutoff/validation) -> cutoff (409), then field validation
  // and occupancy with stage-1 precedence preserved.
  const hasExpected = Object.prototype.hasOwnProperty.call(body, 'expected_revision');
  const expected = hasExpected ? body.expected_revision : undefined;
  if (hasExpected && (!isInteger(expected) || expected < 1)) throw new ApiError('validation_failed');
  if (reservation.status === 'cancelled') throw new ApiError('reservation_cancelled');
  if (hasExpected && expected !== reservation.revision) throw new ApiError('stale_revision');
  if (cutoffReached(reservation)) throw new ApiError('cutoff_passed');

  const restaurant = restaurantOf(state, reservation.restaurant_id);
  const hasTables = body.table_ids !== undefined || body.table_id !== undefined;
  const requested = hasTables ? requestedTableIds(body) : reservation.table_ids;
  const partySize = optionalPartySize(body, 'party_size') ?? reservation.party_size;
  const startsAtLocal = optionalString(body, 'starts_at_local');
  const current = localDatesOf(reservation, restaurant.timezone);
  const { date, hhmm } =
    startsAtLocal === undefined ? current : bareLocal(startsAtLocal, 'starts_at_local');
  const { tables, canonical } = resolveTableSet(restaurant, requested);

  const sameTime = date === current.date && hhmm === current.hhmm;
  const sameParty = partySize === reservation.party_size;
  const sameTables = sameTableSet(canonical, reservation.table_ids);
  if (sameTime && sameParty && sameTables) {
    // A no-op amendment records no entry and keeps terms, end time and revision.
    return reservationView(state, reservation);
  }

  // Real amendment: the resulting date's policy governs all resulting fields.
  const policy = selectPolicy(restaurant, date);
  const start = resolveReservationStart(restaurant, date, hhmm, policy);
  if (partySize > summedCapacity(tables, policy)) throw new ApiError('party_exceeds_capacity');
  const end = start + policy.reservation_duration_minutes * 60000;
  if (anyOverlap(state, restaurant.id, canonical, start, end, reservation.id)) {
    throw new ApiError('table_unavailable');
  }

  const changes: HistoryChange[] = [];
  const tableField = tableChange(reservation.table_ids, canonical);
  if (tableField !== null) changes.push(tableField);
  if (start !== reservation.start_ms) {
    changes.push({
      field: 'starts_at_local',
      from: localStampOf(reservation.start_ms, restaurant.timezone),
      to: `${date}T${hhmm}`,
    });
  }
  if (partySize !== reservation.party_size) {
    changes.push({ field: 'party_size', from: reservation.party_size, to: partySize });
  }

  const terms = termsOf(policy);
  reservation.table_ids = canonical;
  reservation.party_size = partySize;
  reservation.start_ms = start;
  reservation.duration_minutes = policy.reservation_duration_minutes;
  reservation.accepted_terms = terms;
  reservation.revision += 1;
  appendEntry(reservation.history, 'changed', changes, reservation.revision, terms, Date.now());
  const seriesId = markSeriesException(state, reservation);
  if (seriesId !== undefined) bumpSeriesRevision(state, seriesId);
  return reservationView(state, reservation);
}

// ---- atomic moves -----------------------------------------------------------

type PlannedMove = {
  reservation: Reservation;
  tableIds: string[];
  partySize: number;
  start: number;
  end: number;
  durationMinutes: number;
  policy?: Policy;
  realChange: boolean;
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
    // D1 order applies per move inside the batch (stage-1 occupancy precedence stays global).
    const hasExpected = Object.prototype.hasOwnProperty.call(raw, 'expected_revision');
    const expected = hasExpected ? raw.expected_revision : undefined;
    if (hasExpected && (!isInteger(expected) || expected < 1)) throw new ApiError('validation_failed');
    if (reservation.status === 'cancelled') throw new ApiError('reservation_cancelled');
    if (hasExpected && expected !== reservation.revision) throw new ApiError('stale_revision');
    if (cutoffReached(reservation)) throw new ApiError('cutoff_passed');

    const hasTables = raw.table_ids !== undefined || raw.table_id !== undefined;
    const requested = hasTables ? requestedTableIds(raw) : reservation.table_ids;
    const partySize = optionalPartySize(raw, 'party_size') ?? reservation.party_size;
    const startsAtLocal = optionalString(raw, 'starts_at_local');
    const current = localDatesOf(reservation, restaurant.timezone);
    const { date, hhmm } =
      startsAtLocal === undefined ? current : bareLocal(startsAtLocal, 'starts_at_local');
    const { tables, canonical } = resolveTableSet(restaurant, requested);

    const sameTime = date === current.date && hhmm === current.hhmm;
    const sameParty = partySize === reservation.party_size;
    const sameTables = sameTableSet(canonical, reservation.table_ids);
    if (sameTime && sameParty && sameTables) {
      // A no-op move retains terms and history; it still occupies its current slot.
      plans.push({
        reservation,
        tableIds: [...reservation.table_ids],
        partySize: reservation.party_size,
        start: reservation.start_ms,
        end: endOf(reservation),
        durationMinutes: reservation.duration_minutes,
        realChange: false,
      });
      continue;
    }

    // Real move: the old accepted cutoff was checked above; now the resulting
    // date's policy governs the resulting fields.
    const policy = selectPolicy(restaurant, date);
    const start = resolveReservationStart(restaurant, date, hhmm, policy);
    if (partySize > summedCapacity(tables, policy)) throw new ApiError('party_exceeds_capacity');
    plans.push({
      reservation,
      tableIds: canonical,
      partySize,
      start,
      end: start + policy.reservation_duration_minutes * 60000,
      durationMinutes: policy.reservation_duration_minutes,
      policy,
      realChange: true,
    });
  }

  const listedIds = new Set(targets.map((target) => target.id));
  const occupancy: { restaurantId: string; tableId: string; start: number; end: number }[] = [];
  for (const other of state.reservations.values()) {
    if (other.status !== 'confirmed' || listedIds.has(other.id)) continue;
    for (const tableId of other.table_ids) {
      occupancy.push({
        restaurantId: other.restaurant_id,
        tableId,
        start: other.start_ms,
        end: endOf(other),
      });
    }
  }
  for (const plan of plans) {
    for (const tableId of plan.tableIds) {
      occupancy.push({ restaurantId, tableId, start: plan.start, end: plan.end });
    }
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

  const touchedSeries = new Set<string>();
  const views = plans.map((plan) => {
    if (!plan.realChange) return reservationView(state, plan.reservation);
    const changes: HistoryChange[] = [];
    const tableField = tableChange(plan.reservation.table_ids, plan.tableIds);
    if (tableField !== null) changes.push(tableField);
    if (plan.start !== plan.reservation.start_ms) {
      changes.push({
        field: 'starts_at_local',
        from: localStampOf(plan.reservation.start_ms, restaurant.timezone),
        to: localStampOf(plan.start, restaurant.timezone),
      });
    }
    if (plan.partySize !== plan.reservation.party_size) {
      changes.push({ field: 'party_size', from: plan.reservation.party_size, to: plan.partySize });
    }
    const terms = termsOf(plan.policy as Policy);
    plan.reservation.table_ids = plan.tableIds;
    plan.reservation.party_size = plan.partySize;
    plan.reservation.start_ms = plan.start;
    plan.reservation.duration_minutes = plan.durationMinutes;
    plan.reservation.accepted_terms = terms;
    plan.reservation.revision += 1;
    appendEntry(plan.reservation.history, 'changed', changes, plan.reservation.revision, terms, Date.now());
    const seriesId = markSeriesException(state, plan.reservation);
    if (seriesId !== undefined) touchedSeries.add(seriesId);
    return reservationView(state, plan.reservation);
  });
  // Each affected series revision increases once for the whole batch, and the
  // restaurant revision increases once for the whole batch.
  for (const seriesId of touchedSeries) bumpSeriesRevision(state, seriesId);
  restaurant.revision += 1;
  return { status: 201, body: { reservations: views } };
}
