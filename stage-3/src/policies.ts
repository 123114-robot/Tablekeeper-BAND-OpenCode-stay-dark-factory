/**
 * Stage 3 booking policies: the fixture baseline (policy 0), publication parsing,
 * date-based selection, and the accepted-terms snapshot every reservation keeps.
 *
 * A policy is immutable once published; a restaurant's policies are ordered by
 * publication (`policy_version` 1, 2, 3, ...), and publication order may differ
 * from effective-date order. Selection is by the booking's local start date: the
 * greatest `effective_from` not later than that date, ties broken by the greatest
 * `policy_version`. With no qualifying publication the fixture rules (policy 0)
 * apply — exactly the stage-1/2 behaviour, unchanged.
 *
 * Policy 0 itself is derived from the restaurant fixture on demand and never
 * appears in `restaurant.policies`, so `GET /policies` omits it by construction
 * and seeded/imported bookings snapshot it as `policy_version: 0`.
 */

import { ApiError } from './errors.ts';
import { WEEKDAYS, isRealDateString, type Weekday } from './timezone.ts';
import type { OpeningHour, Restaurant } from './store.ts';

export type Policy = {
  policy_version: number;
  effective_from: string;
  slot_minutes: number;
  reservation_duration_minutes: number;
  cancellation_cutoff_minutes: number;
  opening_hours: OpeningHour[];
  capacities: Record<string, number>;
};

/** The accepted terms: the entire selected policy excluding `effective_from`. */
export type AcceptedTerms = {
  policy_version: number;
  slot_minutes: number;
  reservation_duration_minutes: number;
  cancellation_cutoff_minutes: number;
  opening_hours: OpeningHour[];
  capacities: Record<string, number>;
};

export type NewPolicy = Omit<Policy, 'policy_version'>;

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function invalid(): never {
  throw new ApiError('validation_failed', 'invalid policy');
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** The fixture's own rules as policy 0: capacities named exactly per table. */
export function policyZero(restaurant: Restaurant): Policy {
  const capacities: Record<string, number> = {};
  for (const table of restaurant.tables) capacities[table.id] = table.capacity;
  return {
    policy_version: 0,
    effective_from: '',
    slot_minutes: restaurant.slot_minutes,
    reservation_duration_minutes: restaurant.reservation_duration_minutes,
    cancellation_cutoff_minutes: restaurant.cancellation_cutoff_minutes,
    opening_hours: restaurant.opening_hours.map((hour) => ({ ...hour })),
    capacities,
  };
}

/**
 * The policy governing a booking's local start `date`: the greatest
 * `effective_from` not later than `date`, ties to the greatest `policy_version`;
 * fixture rules (policy 0) when no publication qualifies.
 */
export function selectPolicy(restaurant: Restaurant, date: string): Policy {
  let best: Policy | undefined;
  for (const policy of restaurant.policies) {
    if (policy.effective_from > date) continue;
    if (
      best === undefined ||
      policy.effective_from > best.effective_from ||
      (policy.effective_from === best.effective_from && policy.policy_version > best.policy_version)
    ) {
      best = policy;
    }
  }
  return best ?? policyZero(restaurant);
}

/** A deep snapshot of a policy minus `effective_from`, frozen onto a booking. */
export function termsOf(policy: Policy): AcceptedTerms {
  return {
    policy_version: policy.policy_version,
    slot_minutes: policy.slot_minutes,
    reservation_duration_minutes: policy.reservation_duration_minutes,
    cancellation_cutoff_minutes: policy.cancellation_cutoff_minutes,
    opening_hours: policy.opening_hours.map((hour) => ({ ...hour })),
    capacities: { ...policy.capacities },
  };
}

/**
 * Validate a complete policy body against the restaurant. All fields are
 * required; unknown fields are ignored; every failure — missing, wrong type,
 * out of range, duplicate weekday, capacities not naming exactly the restaurant's
 * tables — is `422 validation_failed`. Booleans are not integers.
 */
export function parseNewPolicy(raw: unknown, restaurant: Restaurant): NewPolicy {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) invalid();
  const body = raw as Record<string, unknown>;

  const effectiveFrom = body.effective_from;
  if (typeof effectiveFrom !== 'string' || !isRealDateString(effectiveFrom)) invalid();

  const slotMinutes = body.slot_minutes;
  if (!isInteger(slotMinutes) || slotMinutes < 1 || slotMinutes > 1440) invalid();

  const duration = body.reservation_duration_minutes;
  if (!isInteger(duration) || duration < 1 || duration > 1440) invalid();

  const cutoff = body.cancellation_cutoff_minutes;
  if (!isInteger(cutoff) || cutoff < 0 || cutoff > 10080) invalid();

  const openingHours = readPolicyHours(body.opening_hours);
  const capacities = readPolicyCapacities(body.capacities, restaurant);

  return {
    effective_from: effectiveFrom,
    slot_minutes: slotMinutes,
    reservation_duration_minutes: duration,
    cancellation_cutoff_minutes: cutoff,
    opening_hours: openingHours,
    capacities,
  };
}

/** A stored (already published) policy from an export: same field rules plus an allocated version. */
export function readStoredPolicy(raw: unknown, restaurant: Restaurant): Policy {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) invalid();
  const record = raw as Record<string, unknown>;
  const version = record.policy_version;
  if (!isInteger(version) || version < 1) invalid();
  return { ...parseNewPolicy(record, restaurant), policy_version: version };
}

function readPolicyHours(raw: unknown): OpeningHour[] {
  if (!Array.isArray(raw)) invalid();
  const hours: OpeningHour[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) invalid();
    const record = entry as Record<string, unknown>;
    const weekday = record.weekday;
    if (typeof weekday !== 'string' || !(WEEKDAYS as readonly string[]).includes(weekday)) invalid();
    if (seen.has(weekday)) invalid();
    const opens = record.opens;
    const closes = record.closes;
    if (typeof opens !== 'string' || !HHMM_RE.test(opens)) invalid();
    if (typeof closes !== 'string' || !HHMM_RE.test(closes)) invalid();
    if (minutesOf(closes) <= minutesOf(opens)) invalid();
    seen.add(weekday);
    hours.push({ weekday: weekday as Weekday, opens, closes });
  }
  return hours;
}

function readPolicyCapacities(raw: unknown, restaurant: Restaurant): Record<string, number> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) invalid();
  const record = raw as Record<string, unknown>;
  const capacities: Record<string, number> = {};
  for (const table of restaurant.tables) {
    const value = record[table.id];
    if (!isInteger(value) || value < 1 || value > 100) invalid();
    capacities[table.id] = value;
  }
  if (Object.keys(record).length !== restaurant.tables.length) invalid();
  return capacities;
}
