/**
 * Recurring agreements: `POST /series` adopts a confirmed booking as occurrence
 * zero and generates the remaining occurrences as ordinary reservations.
 *
 * Occurrence zero is the anchor itself — reference, identity, revision, terms,
 * history, timestamps and original idempotent response are untouched. Occurrence i
 * starts on the anchor's local calendar date plus i × interval_weeks × 7 days at the
 * same local clock time; each generated occurrence independently selects its date's
 * policy (duration and capacity) and obeys the ordinary opening, DST and occupancy
 * rules. A nonexistent local time rejects the whole adoption; the first failing
 * occurrence in index order decides the error, and no partial series, reservation,
 * history, counter or idempotency claim survives a failure.
 */

import { randomBytes } from 'node:crypto';
import { ApiError } from './errors.ts';
import {
  anyOverlap,
  cutoffReached,
  reservationView,
  resolveReservationStart,
  restaurantOf,
  type Body,
} from './domain.ts';
import { appendEntry, createdChanges } from './history.ts';
import { selectPolicy, termsOf } from './policies.ts';
import {
  isInteger,
  newReference,
  newReservationId,
  type Reservation,
  type Series,
  type State,
} from './store.ts';
import { localStampOf } from './timezone.ts';

function newSeriesId(): string {
  return `ser_${randomBytes(8).toString('hex')}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** `date` plus `days` calendar days, computed in UTC so it is zone-independent. */
function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

/** The POST/GET series shape: current reservation states, occurrence index order. */
export function seriesView(state: State, series: Series): Record<string, unknown> {
  return {
    series_id: series.id,
    revision: series.revision,
    interval_weeks: series.interval_weeks,
    occurrences: series.occurrences.map((occurrence) => {
      const id = state.references.get(occurrence.reference);
      const reservation = id === undefined ? undefined : state.reservations.get(id);
      if (reservation === undefined) throw new ApiError('not_found');
      return {
        index: occurrence.index,
        reference: occurrence.reference,
        exception: occurrence.exception,
        reservation: reservationView(state, reservation),
      };
    }),
  };
}

/** Only the owner may read a series; anyone else, signed in or not, gets 404. */
export function getSeries(state: State, userId: string, seriesId: string): Record<string, unknown> {
  const series = state.series.get(seriesId);
  if (series === undefined || series.user_id !== userId) throw new ApiError('not_found');
  return seriesView(state, series);
}

export function adoptSeries(
  state: State,
  userId: string,
  body: Body,
): { status: number; body: Record<string, unknown> } {
  const anchorReference = body.anchor_reference;
  if (anchorReference === undefined) throw new ApiError('validation_failed');
  if (typeof anchorReference !== 'string') throw new ApiError('malformed_request');
  const count = body.count;
  if (!isInteger(count) || count < 2 || count > 12) throw new ApiError('validation_failed');
  const intervalWeeks = body.interval_weeks;
  if (!isInteger(intervalWeeks) || intervalWeeks < 1 || intervalWeeks > 4) {
    throw new ApiError('validation_failed');
  }

  const anchorId = state.references.get(anchorReference);
  const anchor = anchorId === undefined ? undefined : state.reservations.get(anchorId);
  if (anchor === undefined || anchor.user_id !== userId) throw new ApiError('not_found');
  if (anchor.status === 'cancelled') throw new ApiError('reservation_cancelled');
  if (anchor.series_id !== undefined) throw new ApiError('already_in_series');
  if (cutoffReached(anchor)) throw new ApiError('cutoff_passed');

  const restaurant = restaurantOf(state, anchor.restaurant_id);
  const anchorLocal = localStampOf(anchor.start_ms, restaurant.timezone);
  const anchorDate = anchorLocal.slice(0, 10);
  const anchorHhmm = anchorLocal.slice(11, 16);
  const seriesId = newSeriesId();
  const createdMs = Date.now();

  // Plan every occurrence before touching state: a failure leaves no trace.
  const taken = new Map(state.references);
  const planned: Reservation[] = [];
  const plannedIntervals: { start: number; end: number }[] = [];
  for (let index = 1; index < count; index += 1) {
    const date = addDays(anchorDate, index * intervalWeeks * 7);
    const policy = selectPolicy(restaurant, date);
    const start = resolveReservationStart(restaurant, date, anchorHhmm, policy);
    const capacity = anchor.table_ids.reduce(
      (total, id) => total + (policy.capacities[id] ?? 0),
      0,
    );
    if (anchor.party_size > capacity) throw new ApiError('party_exceeds_capacity');
    const end = start + policy.reservation_duration_minutes * 60000;
    const clash =
      anyOverlap(state, restaurant.id, anchor.table_ids, start, end) ||
      plannedIntervals.some((planned) => planned.start < end && start < planned.end);
    if (clash) throw new ApiError('table_unavailable');

    const terms = termsOf(policy);
    const reservation: Reservation = {
      id: newReservationId(),
      reference: newReference(taken),
      user_id: userId,
      restaurant_id: restaurant.id,
      table_ids: [...anchor.table_ids],
      party_size: anchor.party_size,
      start_ms: start,
      duration_minutes: policy.reservation_duration_minutes,
      status: 'confirmed',
      created_ms: createdMs,
      revision: 1,
      accepted_terms: terms,
      history: [],
    };
    taken.set(reservation.reference, reservation.id);
    appendEntry(
      reservation.history,
      'created',
      createdChanges(`${date}T${anchorHhmm}`, reservation.table_ids, reservation.party_size),
      1,
      terms,
      createdMs,
    );
    planned.push(reservation);
    plannedIntervals.push({ start, end });
  }

  const series: Series = {
    id: seriesId,
    user_id: userId,
    restaurant_id: restaurant.id,
    anchor_reference: anchor.reference,
    count,
    interval_weeks: intervalWeeks,
    revision: 1,
    occurrences: [
      { index: 0, reference: anchor.reference, exception: false },
      ...planned.map((reservation, position) => ({
        index: position + 1,
        reference: reservation.reference,
        exception: false,
      })),
    ],
  };

  for (const reservation of planned) {
    reservation.series_id = seriesId;
    state.reservations.set(reservation.id, reservation);
    state.references.set(reservation.reference, reservation.id);
  }
  anchor.series_id = seriesId;
  state.series.set(seriesId, series);
  // Adoption increments the restaurant revision once for the whole operation.
  restaurant.revision += 1;
  return { status: 201, body: seriesView(state, series) };
}
