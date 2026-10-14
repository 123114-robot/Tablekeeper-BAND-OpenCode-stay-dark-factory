/**
 * Stage 1 acceptance tests against the official Tablekeeper contract.
 *
 * These drive the real HTTP service on an ephemeral port, so they fail against a
 * broken implementation of the public surface rather than against an internal API.
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

type CallOptions = {
  token?: string;
  key?: string;
  json?: unknown;
  content?: string;
};

async function call(
  method: string,
  path: string,
  options: CallOptions = {},
): Promise<{ status: number; body: any; text: string }> {
  const headers: Record<string, string> = {};
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
  if (options.key !== undefined) headers['idempotency-key'] = options.key;
  let body: string | undefined;
  if (options.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.json);
  } else if (options.content !== undefined) {
    headers['content-type'] = 'application/json';
    body = options.content;
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
    ...over,
  };
}

function fixture(over: Record<string, unknown> = {}) {
  return { users: [ADA, BOB], restaurants: [restaurant()], reservations: [], ...over };
}

const DATE = '2030-06-10';

async function reset(body: unknown): Promise<number> {
  const response = await call('POST', '/_test/reset', { json: body });
  return response.status;
}

async function seed(over: Record<string, unknown> = {}): Promise<{ ada: string; bob: string }> {
  await reset(fixture(over));
  const ada = (await call('POST', '/auth/login', { json: { email: ADA.email, password: ADA.password } })).body.token;
  const bob = (await call('POST', '/auth/login', { json: { email: BOB.email, password: BOB.password } })).body.token;
  return { ada, bob };
}

let keyCounter = 0;
function newKey(): string {
  keyCounter += 1;
  return `key-${keyCounter}-${Date.now()}`;
}

function bookBody(over: Record<string, unknown> = {}) {
  return { restaurant_id: 'r_anker', table_id: 't_2', starts_at_local: `${DATE}T19:00`, party_size: 4, ...over };
}

// ---- health / reset ---------------------------------------------------------

test('GET /health returns 200 {"status":"ok"}', async () => {
  const response = await call('GET', '/health');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: 'ok' });
});

test('reset is synchronous and replaces all state', async () => {
  await reset(fixture({ restaurants: [restaurant({ id: 'r_one', name: 'One' })] }));
  let list = await call('GET', '/restaurants');
  assert.deepEqual(list.body.restaurants.map((r: any) => r.id), ['r_one']);
  await reset(fixture({ restaurants: [restaurant({ id: 'r_two', name: 'Two' })] }));
  list = await call('GET', '/restaurants');
  assert.deepEqual(list.body.restaurants.map((r: any) => r.id), ['r_two']);
});

test('reset rejects ids longer than 64 characters', async () => {
  const status = await reset(fixture({ users: [{ ...ADA, id: 'u'.repeat(65) }] }));
  assert.equal(status, 422);
});

test('reset rejects invalid reservation references', async () => {
  for (const reference of ['x', 'lower01', 'TOO-LONG-WITH-DASH']) {
    const status = await reset(fixture({
      reservations: [{
        id: 'res_seed', reference, user_id: 'u_ada', restaurant_id: 'r_anker',
        table_id: 't_2', starts_at_local: `${DATE}T19:00`, party_size: 4,
      }],
    }));
    assert.equal(status, 422, reference);
  }
});

// ---- auth -------------------------------------------------------------------

test('seeded user can log in and the token works', async () => {
  await reset(fixture());
  const login = await call('POST', '/auth/login', { json: { email: ADA.email, password: ADA.password } });
  assert.equal(login.status, 200);
  assert.equal(typeof login.body.token, 'string');
  const list = await call('GET', '/reservations', { token: login.body.token });
  assert.equal(list.status, 200);
});

test('signup returns a usable token', async () => {
  await reset(fixture());
  const response = await call('POST', '/auth/signup', {
    json: { email: 'new@example.com', password: 'correct horse', display_name: 'New' },
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.display_name, 'New');
  const list = await call('GET', '/reservations', { token: response.body.token });
  assert.equal(list.status, 200);
});

test('signup rejections', async () => {
  await reset(fixture());
  const taken = await call('POST', '/auth/signup', {
    json: { email: ADA.email, password: 'correct horse', display_name: 'X' },
  });
  assert.deepEqual([taken.status, taken.body.error.code], [409, 'email_taken']);
  const short = await call('POST', '/auth/signup', {
    json: { email: 'short@example.com', password: '1234567', display_name: 'X' },
  });
  assert.deepEqual([short.status, short.body.error.code], [422, 'validation_failed']);
  const bad = await call('POST', '/auth/signup', {
    json: { email: 'not-an-email', password: 'correct horse', display_name: 'X' },
  });
  assert.deepEqual([bad.status, bad.body.error.code], [422, 'validation_failed']);
});

test('signup with a wrong JSON type is malformed', async () => {
  await reset(fixture());
  const response = await call('POST', '/auth/signup', {
    json: { email: 17, password: 'correct horse', display_name: 'X' },
  });
  assert.deepEqual([response.status, response.body.error.code], [400, 'malformed_request']);
});

test('login failures are 401', async () => {
  await reset(fixture());
  for (const payload of [
    { email: ADA.email, password: 'wrong password' },
    { email: 'nobody@example.com', password: 'correct horse' },
  ]) {
    const response = await call('POST', '/auth/login', { json: payload });
    assert.deepEqual([response.status, response.body.error.code], [401, 'unauthenticated']);
  }
});

test('protected endpoints reject a missing or unknown token', async () => {
  await reset(fixture());
  for (const path of ['/reservations', '/reservations/ABC123']) {
    const missing = await call('GET', path);
    assert.deepEqual([missing.status, missing.body.error.code], [401, 'unauthenticated']);
  }
  const unknown = await call('GET', '/reservations', { token: 'not-a-real-token' });
  assert.deepEqual([unknown.status, unknown.body.error.code], [401, 'unauthenticated']);
});

// ---- restaurants / availability ---------------------------------------------

test('public endpoints need no token', async () => {
  await reset(fixture());
  assert.equal((await call('GET', '/restaurants')).status, 200);
  assert.equal((await call('GET', '/restaurants/r_anker')).status, 200);
  assert.equal((await call('GET', `/availability?restaurant_id=r_anker&date=${DATE}&party_size=2`)).status, 200);
});

test('restaurant detail carries the fixture shape', async () => {
  await reset(fixture());
  const body = (await call('GET', '/restaurants/r_anker')).body;
  assert.equal(body.slot_minutes, 30);
  assert.equal(body.reservation_duration_minutes, 90);
  assert.equal(body.cancellation_cutoff_minutes, 120);
  assert.deepEqual(body.tables.map((t: any) => t.id), ['t_1', 't_2', 't_3']);
  assert.equal(body.opening_hours.length, 7);
});

test('unknown restaurant is 404', async () => {
  await reset(fixture());
  const response = await call('GET', '/restaurants/r_nope');
  assert.deepEqual([response.status, response.body.error.code], [404, 'not_found']);
});

test('availability slot grid steps from opens while slot + duration <= closes', async () => {
  await reset(fixture());
  const body = (await call('GET', `/availability?restaurant_id=r_anker&date=${DATE}&party_size=2`)).body;
  const times = body.slots.map((s: any) => s.starts_at_local.slice(11));
  assert.deepEqual(times, ['18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30']);
  assert.equal(body.slots[0].starts_at_local, `${DATE}T18:00`);
});

test('available tables filter by capacity in fixture order', async () => {
  await reset(fixture());
  const four = (await call('GET', `/availability?restaurant_id=r_anker&date=${DATE}&party_size=4`)).body.slots[0];
  assert.deepEqual(four.available_table_ids, ['t_2', 't_3']);
  const six = (await call('GET', `/availability?restaurant_id=r_anker&date=${DATE}&party_size=6`)).body.slots[0];
  assert.deepEqual(six.available_table_ids, ['t_3']);
});

test('a booking removes every overlapping slot for its table', async () => {
  const { ada } = await seed();
  await call('POST', '/reservations', { token: ada, key: newKey(), json: bookBody({ table_id: 't_2', starts_at_local: `${DATE}T19:00` }) });
  const slots = (await call('GET', `/availability?restaurant_id=r_anker&date=${DATE}&party_size=4`)).body.slots;
  const byTime = new Map(slots.map((s: any) => [s.starts_at_local.slice(11), s.available_table_ids]));
  for (const overlapping of ['18:00', '18:30', '19:00', '19:30', '20:00']) {
    assert.ok(!(byTime.get(overlapping) as string[]).includes('t_2'), `t_2 offered at ${overlapping}`);
  }
  assert.ok((byTime.get('20:30') as string[]).includes('t_2'), '20:30 must not overlap');
});

test('closed day returns no slots', async () => {
  const [y, m, d] = DATE.split('-').map(Number) as [number, number, number];
  const weekday = WEEKDAYS[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7];
  const closed = allWeek().filter((hour) => hour.weekday !== weekday);
  await reset(fixture({ restaurants: [restaurant({ opening_hours: closed })] }));
  const body = (await call('GET', `/availability?restaurant_id=r_anker&date=${DATE}&party_size=2`)).body;
  assert.deepEqual(body.slots, []);
});

test('availability requires all three parameters and rejects bad values', async () => {
  await reset(fixture());
  assert.equal((await call('GET', '/availability?restaurant_id=r_anker&date=' + DATE)).status, 422);
  for (const party of ['0', '-1', 'abc', '1e9', '4.0', '+4', ' 4']) {
    const response = await call('GET', `/availability?restaurant_id=r_anker&date=${DATE}&party_size=${encodeURIComponent(party)}`);
    assert.deepEqual([response.status, response.body.error.code], [422, 'validation_failed'], party);
  }
  for (const date of ['2026-02-30', 'not-a-date', '24-09-2026']) {
    const response = await call('GET', `/availability?restaurant_id=r_anker&date=${date}&party_size=2`);
    assert.deepEqual([response.status, response.body.error.code], [422, 'validation_failed'], date);
  }
  const unknown = await call('GET', `/availability?restaurant_id=r_nope&date=${DATE}&party_size=2`);
  assert.equal(unknown.status, 404);
  const ignored = await call('GET', `/availability?restaurant_id=r_anker&date=${DATE}&party_size=2&sort=x&page=3`);
  assert.equal(ignored.status, 200);
});

// ---- reservations -----------------------------------------------------------

test('create returns the documented shape', async () => {
  const { ada } = await seed();
  const created = await call('POST', '/reservations', { token: ada, key: newKey(), json: bookBody() });
  assert.equal(created.status, 201);
  assert.equal(created.body.restaurant_id, 'r_anker');
  assert.equal(created.body.table_id, 't_2');
  assert.equal(created.body.party_size, 4);
  assert.equal(created.body.status, 'confirmed');
  assert.equal(created.body.starts_at_local, `${DATE}T19:00`);
  assert.match(created.body.reference, /^[A-Z0-9]{6,12}$/);
  assert.equal(created.body.starts_at, `${DATE}T19:00:00+02:00`);
  assert.equal(created.body.ends_at, `${DATE}T20:30:00+02:00`);
  assert.match(created.body.created_at, /([+-]\d{2}:\d{2}|Z)$/);
});

test('overlap is 409 and adjacency is allowed', async () => {
  const { ada } = await seed();
  assert.equal((await call('POST', '/reservations', { token: ada, key: newKey(), json: bookBody({ starts_at_local: `${DATE}T19:00` }) })).status, 201);
  const overlap = await call('POST', '/reservations', { token: ada, key: newKey(), json: bookBody({ starts_at_local: `${DATE}T20:00` }) });
  assert.deepEqual([overlap.status, overlap.body.error.code], [409, 'table_unavailable']);
  assert.equal((await call('POST', '/reservations', { token: ada, key: newKey(), json: bookBody({ starts_at_local: `${DATE}T20:30` }) })).status, 201);
});

test('create validation matrix', async () => {
  const { ada } = await seed();
  const offGrid = await call('POST', '/reservations', { token: ada, key: newKey(), json: bookBody({ starts_at_local: `${DATE}T19:15` }) });
  assert.deepEqual([offGrid.status, offGrid.body.error.code], [422, 'not_on_slot_grid']);
  for (const at of ['17:00', '23:30', '22:00']) {
    const response = await call('POST', '/reservations', { token: ada, key: newKey(), json: bookBody({ starts_at_local: `${DATE}T${at}` }) });
    assert.deepEqual([response.status, response.body.error.code], [422, 'outside_opening_hours'], at);
  }
  const capacity = await call('POST', '/reservations', { token: ada, key: newKey(), json: bookBody({ table_id: 't_1' }) });
  assert.deepEqual([capacity.status, capacity.body.error.code], [422, 'party_exceeds_capacity']);
  for (const party of [0, -1, '4', 1.5]) {
    const response = await call('POST', '/reservations', { token: ada, key: newKey(), json: bookBody({ party_size: party }) });
    assert.deepEqual([response.status, response.body.error.code], [422, 'validation_failed'], String(party));
  }
  for (const value of [`${DATE}T19:00:00+02:00`, `${DATE}T19:00Z`, `${DATE}T19:00:00`, 'not-a-time']) {
    const response = await call('POST', '/reservations', { token: ada, key: newKey(), json: bookBody({ starts_at_local: value }) });
    assert.deepEqual([response.status, response.body.error.code], [422, 'validation_failed'], value);
  }
  for (const over of [{ restaurant_id: 'r_nope' }, { table_id: 't_nope' }]) {
    const response = await call('POST', '/reservations', { token: ada, key: newKey(), json: bookBody(over) });
    assert.deepEqual([response.status, response.body.error.code], [404, 'not_found'], JSON.stringify(over));
  }
  const malformed = await call('POST', '/reservations', { token: ada, key: newKey(), content: '{not json' });
  assert.deepEqual([malformed.status, malformed.body.error.code], [400, 'malformed_request']);
  assert.equal((await call('POST', '/reservations', { token: ada, key: newKey(), json: bookBody({ souvenir: 'yes' }) })).status, 201);
});

test('missing idempotency key is 400', async () => {
  const { ada } = await seed();
  const response = await call('POST', '/reservations', { token: ada, json: bookBody() });
  assert.deepEqual([response.status, response.body.error.code], [400, 'missing_idempotency_key']);
});

test('first use is 201, replay is 200 with the identical body', async () => {
  const { ada } = await seed();
  const key = newKey();
  const first = await call('POST', '/reservations', { token: ada, key, json: bookBody() });
  const replay = await call('POST', '/reservations', { token: ada, key, json: bookBody() });
  assert.equal(first.status, 201);
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, first.body);
});

test('same key with a different body is idempotency_key_reuse', async () => {
  const { ada } = await seed();
  const key = newKey();
  await call('POST', '/reservations', { token: ada, key, json: bookBody() });
  const reused = await call('POST', '/reservations', { token: ada, key, json: bookBody({ party_size: 3 }) });
  assert.deepEqual([reused.status, reused.body.error.code], [409, 'idempotency_key_reuse']);
});

test('the same key from another account books normally', async () => {
  const { ada, bob } = await seed();
  const key = 'a-shared-key';
  assert.equal((await call('POST', '/reservations', { token: ada, key, json: bookBody({ table_id: 't_2' }) })).status, 201);
  assert.equal((await call('POST', '/reservations', { token: bob, key, json: bookBody({ table_id: 't_3' }) })).status, 201);
});

test('replay after cancel returns the original confirmed body', async () => {
  const { ada } = await seed();
  const key = newKey();
  const first = await call('POST', '/reservations', { token: ada, key, json: bookBody() });
  await call('POST', `/reservations/${first.body.reference}/cancel`, { token: ada });
  const replay = await call('POST', '/reservations', { token: ada, key, json: bookBody() });
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, first.body);
  assert.equal(replay.body.status, 'confirmed');
});

// ---- reads / cancel / patch -------------------------------------------------

test('list is the caller’s own reservations, starts_at descending, including cancelled', async () => {
  const { ada, bob } = await seed();
  for (const at of ['18:00', '21:00', '19:30']) {
    await call('POST', '/reservations', { token: ada, key: newKey(), json: bookBody({ starts_at_local: `${DATE}T${at}` }) });
  }
  await call('POST', '/reservations', { token: bob, key: newKey(), json: bookBody({ table_id: 't_3', starts_at_local: `${DATE}T20:30` }) });
  const mine = (await call('GET', '/reservations', { token: ada })).body.reservations;
  assert.deepEqual(mine.map((r: any) => r.table_id), ['t_2', 't_2', 't_2']);
  const starts = mine.map((r: any) => r.starts_at);
  assert.deepEqual(starts, [...starts].sort().reverse());
  const ref = mine[0].reference;
  await call('POST', `/reservations/${ref}/cancel`, { token: ada });
  const after = (await call('GET', '/reservations', { token: ada })).body.reservations;
  assert.ok(after.some((r: any) => r.status === 'cancelled'));
});

test('another owner’s reservation is 404', async () => {
  const { ada, bob } = await seed();
  const ref = (await call('POST', '/reservations', { token: ada, key: newKey(), json: bookBody() })).body.reference;
  assert.equal((await call('GET', `/reservations/${ref}`, { token: bob })).status, 404);
  assert.equal((await call('POST', `/reservations/${ref}/cancel`, { token: bob })).status, 404);
  assert.equal((await call('GET', '/reservations/ZZZZZZ', { token: ada })).status, 404);
});

test('cancel frees the table and cancelling twice is not an error', async () => {
  const { ada } = await seed();
  const ref = (await call('POST', '/reservations', { token: ada, key: newKey(), json: bookBody() })).body.reference;
  const first = await call('POST', `/reservations/${ref}/cancel`, { token: ada });
  assert.deepEqual([first.status, first.body.status], [200, 'cancelled']);
  const second = await call('POST', `/reservations/${ref}/cancel`, { token: ada });
  assert.deepEqual([second.status, second.body.status], [200, 'cancelled']);
  const slots = (await call('GET', `/availability?restaurant_id=r_anker&date=${DATE}&party_size=4`)).body.slots;
  const slot = slots.find((s: any) => s.starts_at_local.endsWith('19:00'));
  assert.ok(slot.available_table_ids.includes('t_2'));
});

test('cancel inside the cutoff is 409', async () => {
  const { ada } = await seed({ restaurants: [restaurant({ cancellation_cutoff_minutes: 60 * 24 * 3650 })] });
  const ref = (await call('POST', '/reservations', { token: ada, key: newKey(), json: bookBody() })).body.reference;
  const response = await call('POST', `/reservations/${ref}/cancel`, { token: ada });
  assert.deepEqual([response.status, response.body.error.code], [409, 'cutoff_passed']);
});

test('patch keeps reference and id, moves the table, frees the old one', async () => {
  const { ada } = await seed();
  const created = (await call('POST', '/reservations', { token: ada, key: newKey(), json: bookBody({ table_id: 't_2' }) })).body;
  const patched = await call('PATCH', `/reservations/${created.reference}`, { token: ada, json: { table_id: 't_3' } });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.table_id, 't_3');
  assert.equal(patched.body.reference, created.reference);
  assert.equal(patched.body.reservation_id, created.reservation_id);
  const slot = (await call('GET', `/availability?restaurant_id=r_anker&date=${DATE}&party_size=4`)).body.slots
    .find((s: any) => s.starts_at_local.endsWith('19:00'));
  assert.ok(slot.available_table_ids.includes('t_2'));
  assert.ok(!slot.available_table_ids.includes('t_3'));
});

test('patch validation matches create and a cancelled booking is 409', async () => {
  const { ada } = await seed();
  const ref = (await call('POST', '/reservations', { token: ada, key: newKey(), json: bookBody({ table_id: 't_2' }) })).body.reference;
  assert.deepEqual((await call('PATCH', `/reservations/${ref}`, { token: ada, json: { starts_at_local: `${DATE}T19:15` } })).body.error.code, 'not_on_slot_grid');
  assert.deepEqual((await call('PATCH', `/reservations/${ref}`, { token: ada, json: { table_id: 't_1' } })).body.error.code, 'party_exceeds_capacity');
  assert.deepEqual((await call('PATCH', `/reservations/${ref}`, { token: ada, json: { table_id: 't_nope' } })).body.error.code, 'not_found');
  await call('POST', `/reservations/${ref}/cancel`, { token: ada });
  const cancelled = await call('PATCH', `/reservations/${ref}`, { token: ada, json: { party_size: 2 } });
  assert.deepEqual([cancelled.status, cancelled.body.error.code], [409, 'reservation_cancelled']);
});

// ---- moves ------------------------------------------------------------------

test('a move batch of one moves the booking', async () => {
  const { ada } = await seed();
  const booking = (await call('POST', '/reservations', { token: ada, key: newKey(), json: bookBody({ table_id: 't_1', party_size: 2 }) })).body;
  const result = await call('POST', '/reservation-moves', {
    token: ada, key: newKey(),
    json: { moves: [{ reference: booking.reference, table_id: 't_2' }] },
  });
  assert.equal(result.status, 201);
  assert.deepEqual(result.body.reservations.map((r: any) => r.table_id), ['t_2']);
});

test('a move batch is all-or-nothing', async () => {
  const { ada } = await seed();
  const one = (await call('POST', '/reservations', { token: ada, key: newKey(), json: bookBody({ table_id: 't_1', party_size: 2, starts_at_local: `${DATE}T19:00` }) })).body;
  const two = (await call('POST', '/reservations', { token: ada, key: newKey(), json: bookBody({ table_id: 't_2', party_size: 2, starts_at_local: `${DATE}T20:00` }) })).body;
  const result = await call('POST', '/reservation-moves', {
    token: ada, key: newKey(),
    json: { moves: [{ reference: one.reference, table_id: 't_2' }, { reference: two.reference, table_id: 't_2' }] },
  });
  assert.deepEqual([result.status, result.body.error.code], [409, 'table_unavailable']);
  const reread = (await call('GET', `/reservations/${one.reference}`, { token: ada })).body;
  assert.equal(reread.table_id, 't_1', 'a failed batch must not move anything');
});

test('table ids are scoped to their restaurant', async () => {
  await reset(fixture({
    restaurants: [
      restaurant({ id: 'r_berlin', timezone: 'Europe/Berlin', opening_hours: allWeek('00:00', '23:30') }),
      restaurant({ id: 'r_ny', timezone: 'America/New_York', opening_hours: allWeek('00:00', '23:30') }),
    ],
  }));
  const ada = (await call('POST', '/auth/login', { json: { email: ADA.email, password: ADA.password } })).body.token;
  const berlin = await call('POST', '/reservations', {
    token: ada, key: newKey(),
    json: { restaurant_id: 'r_berlin', table_id: 't_2', starts_at_local: '2026-12-01T18:00', party_size: 4 },
  });
  const newYork = await call('POST', '/reservations', {
    token: ada, key: newKey(),
    json: { restaurant_id: 'r_ny', table_id: 't_2', starts_at_local: '2026-12-01T12:00', party_size: 4 },
  });
  assert.equal(berlin.status, 201, JSON.stringify(berlin.body));
  assert.equal(newYork.status, 201, JSON.stringify(newYork.body));
  assert.equal(
    new Date(berlin.body.starts_at).getTime(),
    new Date(newYork.body.starts_at).getTime(),
    '18:00 CET and 12:00 EST are the same instant',
  );
});

// ---- export / import --------------------------------------------------------

test('export can restore a booking', async () => {
  const { ada } = await seed();
  const receipt = (await call('POST', '/reservations', { token: ada, key: newKey(), json: bookBody() })).body;
  const snapshot = await call('GET', '/_test/export');
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.body.track, 'tablekeeper');
  assert.equal(snapshot.body.format_version, 1);
  await reset(fixture());
  const restored = await call('POST', '/_test/import', { json: snapshot.body });
  assert.equal(restored.status, 204);
  const reread = await call('GET', `/reservations/${receipt.reference}`, { token: ada });
  assert.deepEqual(reread.body, receipt);
});

test('import rejects a bad track or version without changing state', async () => {
  await seed();
  const before = (await call('GET', '/restaurants')).body;
  const bad = await call('POST', '/_test/import', { json: { track: 'nope', format_version: 1, state: {} } });
  assert.deepEqual([bad.status, bad.body.error.code], [422, 'validation_failed']);
  assert.deepEqual((await call('GET', '/restaurants')).body, before);
});

// ---- time / DST -------------------------------------------------------------

const BERLIN_SPRING = '2026-03-29';
const BERLIN_FALL = '2026-10-25';

async function zonedSeed(): Promise<string> {
  await reset(fixture({
    restaurants: [
      restaurant({ id: 'r_berlin', timezone: 'Europe/Berlin', opening_hours: allWeek('00:00', '23:30') }),
    ],
  }));
  return (await call('POST', '/auth/login', { json: { email: ADA.email, password: ADA.password } })).body.token;
}

test('a skipped spring-forward local time is invalid_local_time and never appears', async () => {
  const ada = await zonedSeed();
  const response = await call('POST', '/reservations', {
    token: ada, key: newKey(),
    json: { restaurant_id: 'r_berlin', table_id: 't_2', starts_at_local: `${BERLIN_SPRING}T02:30`, party_size: 4 },
  });
  assert.deepEqual([response.status, response.body.error.code], [422, 'invalid_local_time']);
});

test('a fall-back repeated hour appears once', async () => {
  await zonedSeed();
  const times = (await call('GET', `/availability?restaurant_id=r_berlin&date=${BERLIN_FALL}&party_size=4`)).body.slots
    .map((s: any) => s.starts_at_local.slice(11));
  assert.equal(times.filter((t: string) => t === '02:00').length, 1);
  assert.equal(times.filter((t: string) => t === '02:30').length, 1);
});

test('a fall-back local time resolves to the first occurrence', async () => {
  const ada = await zonedSeed();
  const body = (await call('POST', '/reservations', {
    token: ada, key: newKey(),
    json: { restaurant_id: 'r_berlin', table_id: 't_2', starts_at_local: `${BERLIN_FALL}T02:00`, party_size: 4 },
  })).body;
  assert.ok(body.starts_at.endsWith('+02:00'), body.starts_at);
});

test('duration is absolute time, not wall-clock', async () => {
  const ada = await zonedSeed();
  const body = (await call('POST', '/reservations', {
    token: ada, key: newKey(),
    json: { restaurant_id: 'r_berlin', table_id: 't_2', starts_at_local: `${BERLIN_FALL}T01:30`, party_size: 4 },
  })).body;
  assert.match(body.ends_at, /T02:00/);
});

// ---- concurrency ------------------------------------------------------------

test('ten clients racing one table and slot: exactly one 201', async () => {
  await reset(fixture());
  const tokens: string[] = [];
  for (let index = 0; index < 10; index += 1) {
    const login = await call('POST', '/auth/login', { json: { email: ADA.email, password: ADA.password } });
    tokens.push(login.body.token);
  }
  const results = await Promise.all(tokens.map((token) =>
    call('POST', '/reservations', { token, key: newKey(), json: bookBody() })));
  const statuses = results.map((result) => result.status).sort();
  assert.equal(statuses.filter((status) => status === 201).length, 1, JSON.stringify(statuses));
  assert.equal(statuses.filter((status) => status === 409).length, 9, JSON.stringify(statuses));
  assert.ok(statuses.every((status) => status < 500), JSON.stringify(statuses));
});
