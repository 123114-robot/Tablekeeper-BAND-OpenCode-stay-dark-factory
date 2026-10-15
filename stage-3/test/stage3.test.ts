/**
 * Stage 3 acceptance tests: availability explanations, policies and accepted
 * terms, reservation history and decision, recurring agreements, and moves under
 * policies. Every test drives the real HTTP service, so the assertions are the
 * wire shapes the spec names, not internals.
 *
 * The spec always books an explicit table (stage 1 §`POST /reservations`), so the
 * `book` helper injects a default table when the caller names neither `table_id`
 * nor `table_ids`.
 */

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, type StartedServer } from '../src/server.ts';

let started: StartedServer;
let base: string;

before(async () => {
  started = await startServer();
  base = `http://127.0.0.1:${started.port}`;
});
after(async () => {
  await started.close();
});

async function call(
  method: string,
  path: string,
  options: { token?: string; key?: string; json?: unknown } = {},
): Promise<{ status: number; body: any; text: string }> {
  const headers: Record<string, string> = {};
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
  if (options.key !== undefined) headers['idempotency-key'] = options.key;
  let body: string | undefined;
  if (options.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.json);
  }
  const response = await fetch(`${base}${path}`, { method, headers, body });
  const text = await response.text();
  let parsed: any = undefined;
  try {
    parsed = text === '' ? undefined : JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed, text };
}

const ADA = { id: 'u_ada', email: 'ada@example.com', password: 'correct horse', display_name: 'Ada' };
const BOB = { id: 'u_bob', email: 'bob@example.com', password: 'correct horse', display_name: 'Bob' };
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function allWeek(opens = '18:00', closes = '23:00') {
  return WEEKDAYS.map((weekday) => ({ weekday, opens, closes }));
}

function restaurant(over: Record<string, unknown> = {}) {
  return {
    id: 'r_anker',
    name: 'Zum Anker',
    timezone: 'Europe/Berlin',
    slot_minutes: 30,
    reservation_duration_minutes: 90,
    cancellation_cutoff_minutes: 120,
    opening_hours: allWeek(),
    tables: [
      { id: 't_1', label: '1', capacity: 2 },
      { id: 't_2', label: '2', capacity: 4 },
      { id: 't_3', label: '3', capacity: 6 },
    ],
    combinable: [['t_1', 't_2'], ['t_2', 't_3']],
    manager_user_ids: ['u_ada'],
    ...over,
  };
}

function fixture(over: Record<string, unknown> = {}) {
  return {
    users: [ADA, BOB],
    restaurants: [restaurant()],
    reservations: [],
    ...over,
  };
}

const DATE = '2030-06-10';

async function reset(body: unknown): Promise<number> {
  return (await call('POST', '/_test/reset', { json: body })).status;
}

async function tokenFor(user: { email: string; password: string }): Promise<string> {
  return (await call('POST', '/auth/login', { json: { email: user.email, password: user.password } })).body.token;
}

async function seed(): Promise<string> {
  await reset(fixture());
  return tokenFor(ADA);
}

let keyCounter = 0;
function newKey(): string {
  keyCounter += 1;
  return `stage3-key-${keyCounter}-${Date.now()}`;
}

/** A booking body. The spec always names a table, so pick t_2 unless told otherwise. */
function book(over: Record<string, unknown> = {}) {
  const body: Record<string, unknown> = {
    restaurant_id: 'r_anker',
    starts_at_local: `${DATE}T19:00`,
    party_size: 2,
    ...over,
  };
  if (body.table_id === undefined && body.table_ids === undefined) body.table_id = 't_2';
  return body;
}

async function createBooking(token: string, over: Record<string, unknown> = {}) {
  return call('POST', '/reservations', { token, key: newKey(), json: book(over) });
}

function policy(over: Record<string, unknown> = {}) {
  return {
    effective_from: '2030-07-01',
    slot_minutes: 30,
    reservation_duration_minutes: 90,
    cancellation_cutoff_minutes: 120,
    opening_hours: allWeek(),
    capacities: { t_1: 2, t_2: 4, t_3: 6 },
    ...over,
  };
}

async function publish(token: string, over: Record<string, unknown> = {}, key = newKey()) {
  return call('POST', '/restaurants/r_anker/policies', { token, key, json: policy(over) });
}

// ---- availability explanations ---------------------------------------------

test('without explain the availability slot keeps stage 1 shape', async () => {
  await seed();
  const slot = (await call('GET', `/availability?restaurant_id=r_anker&date=${DATE}&party_size=2`)).body.slots[0];
  assert.equal('explain' in slot, false);
  assert.ok(Array.isArray(slot.available_options));
});

test('explain=true lists every table once in fixture order with both rules', async () => {
  await seed();
  const slot = (await call('GET', `/availability?restaurant_id=r_anker&date=${DATE}&party_size=4&explain=true`)).body.slots[0];
  assert.deepEqual(slot.explain.map((entry: any) => entry.table_id), ['t_1', 't_2', 't_3']);
  for (const entry of slot.explain) {
    assert.deepEqual(entry.rules.map((rule: any) => rule.rule), ['capacity', 'no_overlap']);
    assert.equal(entry.rules.every((rule: any) => typeof rule.holds === 'boolean'), true);
    assert.equal(entry.available, entry.rules[0].holds && entry.rules[1].holds);
    assert.equal(entry.policy_version, 0);
  }
  assert.equal(slot.explain.find((entry: any) => entry.table_id === 't_1').available, false);
  assert.deepEqual(
    slot.explain.filter((entry: any) => entry.available).map((entry: any) => entry.table_id),
    slot.available_table_ids,
  );
});

test('explain reports a table excluded by the no_overlap rule', async () => {
  await seed();
  const token = await tokenFor(ADA);
  await createBooking(token, { table_id: 't_2', party_size: 4 });
  await createBooking(token, { table_id: 't_3', party_size: 6 });
  const slot = (await call('GET', `/availability?restaurant_id=r_anker&date=${DATE}&party_size=6&explain=true`)).body.slots
    .find((entry: any) => entry.starts_at_local === `${DATE}T19:00`);
  const t3 = slot.explain.find((entry: any) => entry.table_id === 't_3');
  assert.equal(t3.available, false);
  assert.deepEqual(t3.rules, [
    { rule: 'capacity', holds: true },
    { rule: 'no_overlap', holds: false },
  ]);
});

test('explain rejects any value but true, and a closed day still has no slots', async () => {
  await seed();
  for (const value of ['false', '1', '', 'yes', 'TRUE']) {
    const response = await call('GET', `/availability?restaurant_id=r_anker&date=${DATE}&party_size=2&explain=${encodeURIComponent(value)}`);
    assert.equal(response.status, 422, value);
    assert.equal(response.body.error.code, 'validation_failed');
  }
  // Open only on DATE's weekday; the very next day is therefore closed.
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' })
    .format(new Date(`${DATE}T12:00:00Z`))
    .toLowerCase()
    .slice(0, 3);
  const closedDate = '2030-06-11';
  await reset(fixture({ restaurants: [restaurant({ opening_hours: [{ weekday, opens: '18:00', closes: '23:00' }] })] }));
  const body = (await call('GET', `/availability?restaurant_id=r_anker&date=${closedDate}&party_size=2&explain=true`)).body;
  assert.deepEqual(body.slots, []);
});

// ---- policy publication -----------------------------------------------------

test('publishing requires a token, a key, a manager and a known restaurant', async () => {
  await seed();
  const token = await tokenFor(ADA);
  assert.equal((await call('POST', '/restaurants/r_anker/policies', { key: newKey(), json: policy() })).status, 401);
  assert.equal((await call('POST', '/restaurants/r_anker/policies', { token, json: policy() })).status, 400);
  const bob = await tokenFor(BOB);
  assert.equal((await call('POST', '/restaurants/r_anker/policies', { token: bob, key: newKey(), json: policy() })).status, 403);
  assert.equal((await call('POST', '/restaurants/r_nope/policies', { token, key: newKey(), json: policy() })).status, 404);
});

test('a published policy is echoed with an ascending version and readable publicly', async () => {
  await seed();
  const token = await tokenFor(ADA);
  const first = await publish(token);
  assert.equal(first.status, 201);
  assert.equal(first.body.policy_version, 1);
  assert.equal(first.body.effective_from, '2030-07-01');
  assert.deepEqual(first.body.capacities, { t_1: 2, t_2: 4, t_3: 6 });
  const second = await publish(token, { effective_from: '2030-08-01' });
  assert.equal(second.body.policy_version, 2);
  const list = (await call('GET', '/restaurants/r_anker/policies')).body.policies;
  assert.deepEqual(list.map((entry: any) => entry.policy_version), [1, 2]);
  const detail = (await call('GET', '/restaurants/r_anker')).body;
  assert.equal('policies' in detail, false);
  assert.equal(detail.slot_minutes, 30);
  assert.equal(detail.reservation_duration_minutes, 90);
});

test('every invalid policy field is 422 and unknown fields are ignored', async () => {
  await seed();
  const token = await tokenFor(ADA);
  const bad = [
    { effective_from: '2030-13-01' },
    { effective_from: 'soon' },
    { slot_minutes: 0 },
    { slot_minutes: 1441 },
    { slot_minutes: true },
    { reservation_duration_minutes: -1 },
    { cancellation_cutoff_minutes: -1 },
    { cancellation_cutoff_minutes: 10081 },
    { opening_hours: [{ weekday: 'mon', opens: '18:00', closes: '17:00' }] },
    { opening_hours: [{ weekday: 'mon', opens: '18:00', closes: '23:00' }, { weekday: 'mon', opens: '10:00', closes: '12:00' }] },
    { opening_hours: [{ weekday: 'funday', opens: '18:00', closes: '23:00' }] },
    { capacities: { t_1: 2, t_2: 4 } },
    { capacities: { t_1: 2, t_2: 4, t_3: 6, t_9: 1 } },
    { capacities: { t_1: 2, t_2: 4, t_3: 101 } },
    { capacities: { t_1: 2, t_2: 4, t_3: 0 } },
    { capacities: { t_1: 2, t_2: 4, t_3: 'many' } },
    { effective_from: undefined },
  ];
  for (const over of bad) {
    const body: Record<string, unknown> = policy(over);
    if ('effective_from' in over && over.effective_from === undefined) delete body.effective_from;
    const response = await call('POST', '/restaurants/r_anker/policies', { token, key: newKey(), json: body });
    assert.equal(response.status, 422, JSON.stringify(over));
  }
  const ok = await publish(token, { flavour: 'ignored' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.policy_version, 1);
});

test('policy publication replays its original response and never allocates twice', async () => {
  await seed();
  const token = await tokenFor(ADA);
  const key = newKey();
  const first = await publish(token, {}, key);
  const replay = await publish(token, {}, key);
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, first.body);
  const reused = await publish(token, { effective_from: '2031-01-01' }, key);
  assert.equal(reused.status, 409);
  assert.equal((await call('GET', '/restaurants/r_anker/policies')).body.policies.length, 1);
});

// ---- selection and accepted terms ------------------------------------------

test('policies apply by effective date and are snapshotted onto the booking', async () => {
  await seed();
  const token = await tokenFor(ADA);
  await publish(token, {
    effective_from: '2030-07-01',
    slot_minutes: 60,
    capacities: { t_1: 1, t_2: 1, t_3: 2 },
  });
  const before = await createBooking(token, { starts_at_local: '2030-06-30T19:30', party_size: 2 });
  assert.equal(before.status, 201);
  assert.equal(before.body.accepted_terms.policy_version, 0);
  assert.equal(before.body.revision, 1);
  assert.equal('effective_from' in before.body.accepted_terms, false);
  const offGrid = await createBooking(token, { starts_at_local: '2030-07-01T19:30', party_size: 2 });
  assert.equal(offGrid.body.error.code, 'not_on_slot_grid');
  const tooBig = await createBooking(token, { starts_at_local: '2030-07-01T19:00', party_size: 3 });
  assert.equal(tooBig.body.error.code, 'party_exceeds_capacity');
  const ok = await createBooking(token, { starts_at_local: '2030-07-01T19:00', party_size: 1 });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.accepted_terms.policy_version, 1);
  assert.equal(ok.body.accepted_terms.slot_minutes, 60);
  assert.deepEqual(ok.body.accepted_terms.capacities, { t_1: 1, t_2: 1, t_3: 2 });
});

test('a later same-date policy supersedes for new decisions but not for accepted bookings', async () => {
  await seed();
  const token = await tokenFor(ADA);
  await publish(token, { effective_from: '2030-07-01', cancellation_cutoff_minutes: 60 });
  const booking = await createBooking(token, { starts_at_local: '2030-07-01T19:00' });
  assert.equal(booking.body.accepted_terms.policy_version, 1);
  await publish(token, { effective_from: '2030-07-01', cancellation_cutoff_minutes: 300 });
  const decision = (await call('GET', `/reservations/${booking.body.reference}/decision`, { token })).body;
  assert.equal(decision.accepted_terms.policy_version, 1);
  const second = await createBooking(token, { starts_at_local: '2030-07-01T19:30', table_id: 't_1' });
  assert.equal(second.body.accepted_terms.policy_version, 2);
  assert.equal(second.body.accepted_terms.cancellation_cutoff_minutes, 300);
});

test('explain names the policy version and reads that policy capacity', async () => {
  await seed();
  const token = await tokenFor(ADA);
  await publish(token, { effective_from: '2030-07-01', capacities: { t_1: 1, t_2: 5, t_3: 5 } });
  const slot = (await call('GET', `/availability?restaurant_id=r_anker&date=2030-07-01&party_size=4&explain=true`)).body.slots[0];
  assert.equal(slot.explain.every((entry: any) => entry.policy_version === 1), true);
  assert.equal(slot.explain.find((entry: any) => entry.table_id === 't_1').rules[0].holds, false);
  assert.equal(slot.explain.find((entry: any) => entry.table_id === 't_2').rules[0].holds, true);
});

test('seeded bookings start at revision 1 under policy 0', async () => {
  await reset(fixture({
    reservations: [{
      id: 'res_seed',
      reference: 'SEED01',
      user_id: 'u_ada',
      restaurant_id: 'r_anker',
      table_id: 't_2',
      party_size: 2,
      starts_at_local: `${DATE}T19:00`,
      status: 'confirmed',
    }],
  }));
  const token = await tokenFor(ADA);
  const view = (await call('GET', '/reservations/SEED01', { token })).body;
  assert.equal(view.revision, 1);
  assert.equal(view.accepted_terms.policy_version, 0);
});

// ---- amendments, history and decision --------------------------------------

test('a no-op amendment keeps revision, terms and history; a real one bumps all three', async () => {
  await seed();
  const token = await tokenFor(ADA);
  const booking = await createBooking(token);
  const reference = booking.body.reference;
  const noop = await call('PATCH', `/reservations/${reference}`, {
    token,
    json: { table_id: 't_2', starts_at_local: `${DATE}T19:00`, party_size: 2 },
  });
  assert.equal(noop.status, 200);
  assert.equal(noop.body.revision, 1);
  const afterNoop = (await call('GET', `/reservations/${reference}/history`, { token })).body;
  assert.equal(afterNoop.entries.length, 1);

  await publish(token, { effective_from: '2030-01-01', reservation_duration_minutes: 60 });
  const changed = await call('PATCH', `/reservations/${reference}`, { token, json: { table_id: 't_3' } });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.revision, 2);
  assert.equal(changed.body.accepted_terms.policy_version, 1);
  const history = (await call('GET', `/reservations/${reference}/history`, { token })).body;
  assert.equal(history.entries.length, 2);
  assert.deepEqual(history.entries[1].changes, [{ field: 'table_id', from: 't_2', to: 't_3' }]);
  assert.equal(history.entries[1].revision, 2);
  assert.equal(history.entries[1].accepted_terms.policy_version, 1);
});

test('expected_revision is stale-checked before cutoff and validation', async () => {
  await seed();
  const token = await tokenFor(ADA);
  const booking = await createBooking(token);
  const reference = booking.body.reference;
  const stale = await call('PATCH', `/reservations/${reference}`, { token, json: { expected_revision: 2, table_id: 't_3' } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'stale_revision');
  for (const bad of [0, -1, 1.5, '1', true]) {
    const response = await call('PATCH', `/reservations/${reference}`, { token, json: { expected_revision: bad } });
    assert.equal(response.status, 422, String(bad));
  }
  const ok = await call('PATCH', `/reservations/${reference}`, { token, json: { expected_revision: 1, table_id: 't_3' } });
  assert.equal(ok.status, 200);
  const second = await call('PATCH', `/reservations/${reference}`, { token, json: { expected_revision: 1, table_id: 't_2' } });
  assert.equal(second.status, 409);
});

test('D1 order on a cancelled booking: 422 bad expected_revision beats 409 cancelled beats stale', async () => {
  await seed();
  const token = await tokenFor(ADA);
  const booking = await createBooking(token);
  const reference = booking.body.reference;
  await call('POST', `/reservations/${reference}/cancel`, { token });
  const badType = await call('PATCH', `/reservations/${reference}`, { token, json: { expected_revision: '1' } });
  assert.equal(badType.status, 422);
  assert.equal(badType.body.error.code, 'validation_failed');
  const outOfRange = await call('PATCH', `/reservations/${reference}`, { token, json: { expected_revision: 0 } });
  assert.equal(outOfRange.status, 422);
  const staleOnCancelled = await call('PATCH', `/reservations/${reference}`, { token, json: { expected_revision: 99 } });
  assert.equal(staleOnCancelled.status, 409);
  assert.equal(staleOnCancelled.body.error.code, 'reservation_cancelled');
});

test('restaurant detail is the fixture shape and carries manager_user_ids', async () => {
  await seed();
  const detail = (await call('GET', '/restaurants/r_anker')).body;
  assert.equal(detail.slot_minutes, 30);
  assert.equal(detail.reservation_duration_minutes, 90);
  assert.equal(detail.cancellation_cutoff_minutes, 120);
  assert.deepEqual(detail.combinable, [['t_1', 't_2'], ['t_2', 't_3']]);
  assert.deepEqual(detail.manager_user_ids, ['u_ada']);
  await reset(fixture({ restaurants: [restaurant({ manager_user_ids: undefined })] }));
  const bare = (await call('GET', '/restaurants/r_anker')).body;
  assert.deepEqual(bare.manager_user_ids, []);
});

test('history records created, changed and cancelled entries and nothing after cancel', async () => {
  await seed();
  const token = await tokenFor(ADA);
  const booking = await createBooking(token);
  const reference = booking.body.reference;
  await call('PATCH', `/reservations/${reference}`, { token, json: { party_size: 4, starts_at_local: `${DATE}T19:30` } });
  await call('POST', `/reservations/${reference}/cancel`, { token });
  const history = (await call('GET', `/reservations/${reference}/history`, { token })).body;
  assert.equal(history.reference, reference);
  assert.deepEqual(history.entries.map((entry: any) => entry.seq), [1, 2, 3]);
  assert.deepEqual(history.entries[0].changes.map((change: any) => change.field), ['table_id', 'starts_at_local', 'party_size']);
  assert.equal(history.entries[0].changes.every((change: any) => change.from === null), true);
  assert.deepEqual(history.entries[1].changes.map((change: any) => change.field), ['starts_at_local', 'party_size']);
  assert.deepEqual(history.entries[2].changes, []);
  assert.equal(history.entries[2].event, 'cancelled');
  const afterCancel = await call('PATCH', `/reservations/${reference}`, { token, json: { party_size: 3 } });
  assert.equal(afterCancel.status, 409);
  assert.equal(afterCancel.body.error.code, 'reservation_cancelled');
  assert.equal((await call('GET', `/reservations/${reference}/history`, { token })).body.entries.length, 3);
  const decision = (await call('GET', `/reservations/${reference}/decision`, { token })).body;
  assert.equal(decision.reference, reference);
  assert.equal(decision.revision, 3);
  assert.equal(decision.accepted_terms.policy_version, 0);
});

test('an idempotent create replay records no extra history', async () => {
  await seed();
  const token = await tokenFor(ADA);
  const key = newKey();
  const first = await call('POST', '/reservations', { token, key, json: book() });
  const replay = await call('POST', '/reservations', { token, key, json: book() });
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, first.body);
  const history = (await call('GET', `/reservations/${first.body.reference}/history`, { token })).body;
  assert.equal(history.entries.length, 1);
});

test('history and decision are owner-only 404s, even without a token', async () => {
  await seed();
  const token = await tokenFor(ADA);
  const booking = await createBooking(token);
  assert.equal((await call('GET', `/reservations/${booking.body.reference}/history`)).status, 404);
  assert.equal((await call('GET', `/reservations/${booking.body.reference}/decision`)).status, 404);
  assert.equal((await call('GET', '/reservations/NOPE99/history', { token })).status, 404);
  const bob = await tokenFor(BOB);
  assert.equal((await call('GET', `/reservations/${booking.body.reference}/history`, { token: bob })).status, 404);
});

test('cancel increments the revision once, and repeats are no-ops', async () => {
  await seed();
  const token = await tokenFor(ADA);
  const booking = await createBooking(token);
  const reference = booking.body.reference;
  const first = await call('POST', `/reservations/${reference}/cancel`, { token });
  assert.equal(first.body.status, 'cancelled');
  assert.equal(first.body.revision, 2);
  const second = await call('POST', `/reservations/${reference}/cancel`, { token });
  assert.equal(second.body.revision, 2);
  assert.equal((await call('GET', `/reservations/${reference}/history`, { token })).body.entries.length, 2);
});

// ---- combined-table history -------------------------------------------------

test('combined history uses table_ids for pair creations and pair changes', async () => {
  await seed();
  const token = await tokenFor(ADA);
  const booking = await createBooking(token, { table_ids: ['t_2', 't_3'], party_size: 6 });
  assert.equal(booking.status, 201);
  const reference = booking.body.reference;
  let history = (await call('GET', `/reservations/${reference}/history`, { token })).body;
  assert.deepEqual(history.entries[0].changes[0], { field: 'table_ids', from: null, to: ['t_2', 't_3'] });
  const reversed = await call('PATCH', `/reservations/${reference}`, { token, json: { table_ids: ['t_3', 't_2'] } });
  assert.equal(reversed.status, 200);
  assert.equal(reversed.body.revision, 1);
  history = (await call('GET', `/reservations/${reference}/history`, { token })).body;
  assert.equal(history.entries.length, 1);
  await call('PATCH', `/reservations/${reference}`, { token, json: { table_id: 't_2', party_size: 4 } });
  await call('PATCH', `/reservations/${reference}`, { token, json: { table_ids: ['t_2', 't_3'], party_size: 6 } });
  history = (await call('GET', `/reservations/${reference}/history`, { token })).body;
  assert.deepEqual(history.entries[2].changes[0], { field: 'table_ids', from: ['t_2'], to: ['t_2', 't_3'] });
});

// ---- recurring agreements ---------------------------------------------------

async function adopt(token: string, body: Record<string, unknown>, key = newKey()) {
  return call('POST', '/series', { token, key, json: body });
}

test('adoption returns occurrence zero unchanged and generates the following dates', async () => {
  await seed();
  const token = await tokenFor(ADA);
  const booking = await createBooking(token);
  const anchor = booking.body;
  const response = await adopt(token, { anchor_reference: anchor.reference, count: 3, interval_weeks: 2 });
  assert.equal(response.status, 201);
  assert.equal(response.body.revision, 1);
  assert.equal(response.body.interval_weeks, 2);
  assert.deepEqual(response.body.occurrences.map((entry: any) => entry.index), [0, 1, 2]);
  assert.equal(response.body.occurrences.every((entry: any) => entry.exception === false), true);
  const zero = response.body.occurrences[0];
  assert.equal(zero.reference, anchor.reference);
  assert.equal(zero.reservation.revision, anchor.revision);
  assert.deepEqual(zero.reservation.accepted_terms, anchor.accepted_terms);
  assert.deepEqual(zero.reservation.starts_at_local, anchor.starts_at_local);
  assert.deepEqual(
    response.body.occurrences.map((entry: any) => entry.reservation.starts_at_local),
    [`${DATE}T19:00`, '2030-06-24T19:00', '2030-07-08T19:00'],
  );
  assert.equal(new Set(response.body.occurrences.map((entry: any) => entry.reference)).size, 3);
  const list = (await call('GET', '/reservations', { token })).body.reservations.map((entry: any) => entry.reference);
  for (const entry of response.body.occurrences) assert.ok(list.includes(entry.reference));
});

test('series reads are owner-only and adoption errors follow the spec', async () => {
  await seed();
  const token = await tokenFor(ADA);
  const bob = await tokenFor(BOB);
  const anchor = (await createBooking(token)).body;
  const created = await adopt(token, { anchor_reference: anchor.reference, count: 2, interval_weeks: 1 });
  const seriesId = created.body.series_id;
  assert.equal((await call('GET', `/series/${seriesId}`)).status, 404);
  assert.equal((await call('GET', `/series/${seriesId}`, { token: bob })).status, 404);
  assert.equal((await call('GET', `/series/${seriesId}`, { token })).status, 200);

  assert.equal((await call('POST', '/series', { key: newKey(), json: { anchor_reference: anchor.reference, count: 2, interval_weeks: 1 } })).status, 401);
  assert.equal((await call('POST', '/series', { token, json: { anchor_reference: anchor.reference, count: 2, interval_weeks: 1 } })).status, 400);
  for (const bad of [{ count: 1 }, { count: 13 }, { count: true }, { interval_weeks: 0 }, { interval_weeks: 5 }, { interval_weeks: 1.5 }]) {
    const response = await adopt(token, { anchor_reference: anchor.reference, count: 3, interval_weeks: 1, ...bad });
    assert.equal(response.status, 422, JSON.stringify(bad));
  }
  assert.equal((await adopt(token, { anchor_reference: 'MISSING', count: 2, interval_weeks: 1 })).status, 404);
  const bobBooking = (await call('POST', '/reservations', { token: bob, key: newKey(), json: book({ starts_at_local: '2030-06-11T19:00' }) })).body;
  assert.equal((await adopt(token, { anchor_reference: bobBooking.reference, count: 2, interval_weeks: 1 })).status, 404);
  const alreadyAdopted = await adopt(token, { anchor_reference: anchor.reference, count: 2, interval_weeks: 1 });
  assert.equal(alreadyAdopted.status, 409);
  assert.equal(alreadyAdopted.body.error.code, 'already_in_series');
  const sibling = created.body.occurrences[1].reference;
  const siblingAgain = await adopt(token, { anchor_reference: sibling, count: 2, interval_weeks: 1 });
  assert.equal(siblingAgain.body.error.code, 'already_in_series');
});

test('a cancelled anchor is 409 and a booking inside its accepted cutoff is 409', async () => {
  await reset(fixture({
    reservations: [
      { id: 'res_old', reference: 'OLD001', user_id: 'u_ada', restaurant_id: 'r_anker', table_id: 't_2', party_size: 2, starts_at_local: '2020-01-06T19:00', status: 'confirmed' },
      { id: 'res_can', reference: 'CAN001', user_id: 'u_ada', restaurant_id: 'r_anker', table_id: 't_2', party_size: 2, starts_at_local: `${DATE}T19:00`, status: 'cancelled' },
    ],
  }));
  const token = await tokenFor(ADA);
  const cancelled = await adopt(token, { anchor_reference: 'CAN001', count: 2, interval_weeks: 1 });
  assert.equal(cancelled.status, 409);
  assert.equal(cancelled.body.error.code, 'reservation_cancelled');
  const inside = await adopt(token, { anchor_reference: 'OLD001', count: 2, interval_weeks: 1 });
  assert.equal(inside.status, 409);
  assert.equal(inside.body.error.code, 'cutoff_passed');
});

test('adoption fails as a whole when any occurrence cannot be booked', async () => {
  await reset(fixture({
    restaurants: [restaurant({ opening_hours: allWeek('00:00', '23:59'), cancellation_cutoff_minutes: 0 })],
  }));
  const token = await tokenFor(ADA);
  // 2030-03-31 02:30 does not exist in Europe/Berlin (spring forward at 02:00).
  const anchor = await createBooking(token, { starts_at_local: '2030-03-24T02:30', party_size: 2 });
  assert.equal(anchor.status, 201);
  const failed = await adopt(token, { anchor_reference: anchor.body.reference, count: 2, interval_weeks: 1 });
  assert.equal(failed.status, 422);
  assert.equal(failed.body.error.code, 'invalid_local_time');
  const exported = (await call('GET', '/_test/export')).body;
  assert.deepEqual(exported.state.series, []);
  assert.equal(exported.state.reservations.length, 1);
  assert.equal((await call('GET', `/series/x`, { token })).status, 404);
});

test('a per-date policy governs generated occurrences and a permitted one succeeds', async () => {
  await seed();
  const token = await tokenFor(ADA);
  await publish(token, { effective_from: '2030-06-24', capacities: { t_1: 1, t_2: 2, t_3: 6 } });
  const anchor = await createBooking(token, { starts_at_local: `${DATE}T19:00`, party_size: 2 });
  assert.equal(anchor.body.accepted_terms.policy_version, 0);
  const adopted = await adopt(token, { anchor_reference: anchor.body.reference, count: 2, interval_weeks: 2 });
  assert.equal(adopted.status, 201);
  const occurrence = adopted.body.occurrences[1].reservation;
  assert.equal(occurrence.accepted_terms.policy_version, 1);
  assert.equal(occurrence.starts_at_local, '2030-06-24T19:00');
});

test('an occupied generated slot rejects the whole adoption', async () => {
  await seed();
  const token = await tokenFor(ADA);
  const anchor = await createBooking(token, { starts_at_local: `${DATE}T19:00`, party_size: 2 });
  const blocker = await createBooking(token, { starts_at_local: '2030-06-17T19:00', table_id: 't_2', party_size: 2 });
  assert.equal(blocker.status, 201);
  const failed = await adopt(token, { anchor_reference: anchor.body.reference, count: 2, interval_weeks: 1 });
  assert.equal(failed.status, 409);
  assert.equal(failed.body.error.code, 'table_unavailable');
  assert.deepEqual((await call('GET', '/_test/export')).body.state.series, []);
});

test('a real occurrence patch marks the exception and bumps the series revision once', async () => {
  await seed();
  const token = await tokenFor(ADA);
  const anchor = (await createBooking(token)).body;
  const created = await adopt(token, { anchor_reference: anchor.reference, count: 2, interval_weeks: 1 });
  const seriesId = created.body.series_id;
  const sibling = created.body.occurrences[1].reference;
  await call('PATCH', `/reservations/${sibling}`, { token, json: { party_size: 2 } });
  let series = (await call('GET', `/series/${seriesId}`, { token })).body;
  assert.equal(series.revision, 1);
  assert.equal(series.occurrences[1].exception, false);
  await call('PATCH', `/reservations/${sibling}`, { token, json: { party_size: 4 } });
  series = (await call('GET', `/series/${seriesId}`, { token })).body;
  assert.equal(series.revision, 2);
  assert.equal(series.occurrences[1].exception, true);
  assert.equal(series.occurrences[0].exception, false);
  await call('POST', `/reservations/${sibling}/cancel`, { token });
  series = (await call('GET', `/series/${seriesId}`, { token })).body;
  assert.equal(series.revision, 3);
  assert.equal(series.occurrences[1].exception, true);
  assert.equal(series.occurrences[1].reservation.status, 'cancelled');
});

test('a series replay returns the original response even after later changes', async () => {
  await seed();
  const token = await tokenFor(ADA);
  const anchor = (await createBooking(token)).body;
  const key = newKey();
  const first = await adopt(token, { anchor_reference: anchor.reference, count: 3, interval_weeks: 1 }, key);
  const sibling = first.body.occurrences[1].reference;
  await call('PATCH', `/reservations/${sibling}`, { token, json: { party_size: 4 } });
  const replay = await adopt(token, { anchor_reference: anchor.reference, count: 3, interval_weeks: 1 }, key);
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, first.body);
  assert.equal(replay.body.revision, 1);
});

// ---- moves under policies ---------------------------------------------------

test('a move batch adopts policies, keeps no-ops and touches a series once', async () => {
  await seed();
  const token = await tokenFor(ADA);
  const first = (await createBooking(token, { starts_at_local: `${DATE}T19:00` })).body;
  const second = (await createBooking(token, { starts_at_local: `${DATE}T19:00`, table_id: 't_3', party_size: 4 })).body;
  const created = await adopt(token, { anchor_reference: second.reference, count: 2, interval_weeks: 1 });
  const seriesId = created.body.series_id;
  const sibling = created.body.occurrences[1].reference;
  const moved = await call('POST', '/reservation-moves', {
    token,
    key: newKey(),
    json: {
      moves: [
        { reference: first.reference, party_size: 4 },
        { reference: sibling, party_size: 6 },
      ],
    },
  });
  assert.equal(moved.status, 201);
  assert.equal(moved.body.reservations.length, 2);
  assert.equal(moved.body.reservations[0].revision, 2);
  const series = (await call('GET', `/series/${seriesId}`, { token })).body;
  assert.equal(series.revision, 2);
  assert.equal(series.occurrences[1].exception, true);
  const history = (await call('GET', `/reservations/${sibling}/history`, { token })).body;
  assert.deepEqual(history.entries[1].changes, [{ field: 'party_size', from: 4, to: 6 }]);
});

test('a stale expected_revision in a batch leaves every booking unchanged', async () => {
  await seed();
  const token = await tokenFor(ADA);
  const first = (await createBooking(token, { starts_at_local: `${DATE}T19:00` })).body;
  const second = (await createBooking(token, { starts_at_local: `${DATE}T19:00`, table_id: 't_3', party_size: 4 })).body;
  const failed = await call('POST', '/reservation-moves', {
    token,
    key: newKey(),
    json: {
      moves: [
        { reference: first.reference, party_size: 4 },
        { reference: second.reference, expected_revision: 9, party_size: 2 },
      ],
    },
  });
  assert.equal(failed.status, 409);
  assert.equal(failed.body.error.code, 'stale_revision');
  assert.equal((await call('GET', `/reservations/${first.reference}`, { token })).body.revision, 1);
});

// ---- stage-1/2 upgrade and adoption path -----------------------------------

test('a stage-2 export imports, keeps working and can be adopted', async () => {
  const imported = {
    users: [{ id: 'u_imp', email: 'imp@example.com', password_hash: 'not-a-real-hash', display_name: 'Imp' }],
    tokens: [['tok-imp', 'u_imp']],
    restaurants: [restaurant({ manager_user_ids: undefined })],
    reservations: [{
      id: 'res_imp',
      reference: 'IMP001',
      user_id: 'u_imp',
      restaurant_id: 'r_anker',
      table_id: 't_2',
      party_size: 2,
      start_ms: Date.parse('2030-06-10T17:00:00Z'),
      duration_minutes: 90,
      status: 'confirmed',
      created_ms: 1893456000000,
    }],
    idempotency: [],
  };
  await reset({});
  const importedResponse = await call('POST', '/_test/import', {
    json: { track: 'tablekeeper', format_version: 1, state: imported },
  });
  assert.equal(importedResponse.status, 204);
  const history = (await call('GET', '/reservations/IMP001/history', { token: 'tok-imp' })).body;
  assert.equal(history.entries.length, 1);
  assert.equal(history.entries[0].event, 'created');
  assert.deepEqual(history.entries[0].changes.map((change: any) => change.field), ['table_id', 'starts_at_local', 'party_size']);
  const adopted = await adopt('tok-imp', { anchor_reference: 'IMP001', count: 2, interval_weeks: 1 });
  assert.equal(adopted.status, 201);
  assert.equal(adopted.body.occurrences.length, 2);
});
