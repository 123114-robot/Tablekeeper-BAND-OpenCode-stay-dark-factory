/**
 * Stage 2 acceptance tests: the combined-table contract and the browser surface.
 *
 * The combination tests drive the real HTTP service, so they assert the wire shapes
 * `available_options`, `table_ids`/`table_id`, and the new error codes, not internals.
 * The UI tests only assert that the four screen routes answer with HTML — the browser
 * behaviour itself is exercised by the official Playwright suite.
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
    ...over,
  };
}

function fixture(over: Record<string, unknown> = {}) {
  return {
    users: [ADA, BOB],
    restaurants: [restaurant({ combinable: [['t_1', 't_2'], ['t_2', 't_3']] })],
    reservations: [],
    ...over,
  };
}

const DATE = '2030-06-10';

async function reset(body: unknown): Promise<number> {
  return (await call('POST', '/_test/reset', { json: body })).status;
}

async function seed(): Promise<string> {
  await reset(fixture());
  return (await call('POST', '/auth/login', { json: { email: ADA.email, password: ADA.password } })).body.token;
}

let keyCounter = 0;
function newKey(): string {
  keyCounter += 1;
  return `stage2-key-${keyCounter}-${Date.now()}`;
}

function book(over: Record<string, unknown> = {}) {
  return { restaurant_id: 'r_anker', starts_at_local: `${DATE}T19:00`, party_size: 6, ...over };
}

// ---- model ------------------------------------------------------------------

test('reset accepts combinable and detail echoes it', async () => {
  await reset(fixture());
  const body = (await call('GET', '/restaurants/r_anker')).body;
  assert.deepEqual(body.combinable, [['t_1', 't_2'], ['t_2', 't_3']]);
});

test('reset rejects a combinable entry that is not a pair of existing tables', async () => {
  for (const combinable of [[['t_1', 't_2', 't_3']], [['t_1', 't_1']], [['t_1', 't_nope']], [['t_1']]]) {
    const status = await reset(fixture({ restaurants: [restaurant({ combinable })] }));
    assert.equal(status, 422, JSON.stringify(combinable));
  }
});

test('reset rejects a duplicate combinable pair', async () => {
  const status = await reset(fixture({
    restaurants: [restaurant({ combinable: [['t_1', 't_2'], ['t_2', 't_1']] })],
  }));
  assert.equal(status, 422);
});

// ---- availability options ---------------------------------------------------

test('available_options lists singles in fixture order then pairs in combinable order', async () => {
  await reset(fixture());
  const slot = (await call('GET', `/availability?restaurant_id=r_anker&date=${DATE}&party_size=6`)).body.slots[0];
  assert.deepEqual(slot.available_table_ids, ['t_3'], 'singles only');
  assert.deepEqual(slot.available_options, [
    { table_ids: ['t_3'], capacity: 6 },
    { table_ids: ['t_1', 't_2'], capacity: 6 },
    { table_ids: ['t_2', 't_3'], capacity: 10 },
  ]);
});

test('a pair whose members are too small as singles still appears as a combination', async () => {
  await reset(fixture());
  const slot = (await call('GET', `/availability?restaurant_id=r_anker&date=${DATE}&party_size=6`)).body.slots[0];
  assert.ok(!slot.available_table_ids.includes('t_1'));
  assert.deepEqual(slot.available_options[1].table_ids, ['t_1', 't_2']);
});

// ---- create -----------------------------------------------------------------

test('a combination booking occupies both tables and reports table_ids', async () => {
  const ada = await seed();
  const created = await call('POST', '/reservations', {
    token: ada, key: newKey(), json: book({ table_ids: ['t_1', 't_2'] }),
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.table_ids, ['t_1', 't_2']);
  assert.equal(created.body.table_id, undefined, 'a combined set omits table_id');
});

test('table_ids is canonicalised to combinable order', async () => {
  const ada = await seed();
  const created = await call('POST', '/reservations', {
    token: ada, key: newKey(), json: book({ table_ids: ['t_2', 't_3'] }),
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.table_ids, ['t_2', 't_3']);
});

test('a single-element set carries both table_ids and table_id', async () => {
  const ada = await seed();
  const created = await call('POST', '/reservations', {
    token: ada, key: newKey(), json: book({ table_ids: ['t_3'], party_size: 6 }),
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.table_ids, ['t_3']);
  assert.equal(created.body.table_id, 't_3');
});

test('the legacy table_id still means a set of one', async () => {
  const ada = await seed();
  const created = await call('POST', '/reservations', {
    token: ada, key: newKey(), json: book({ table_id: 't_3', party_size: 6 }),
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.table_ids, ['t_3']);
  assert.equal(created.body.table_id, 't_3');
});

test('sending both table_id and table_ids is validation_failed', async () => {
  const ada = await seed();
  const response = await call('POST', '/reservations', {
    token: ada, key: newKey(), json: book({ table_id: 't_1', table_ids: ['t_1', 't_2'] }),
  });
  assert.deepEqual([response.status, response.body.error.code], [422, 'validation_failed']);
});

test('a duplicate table id is validation_failed', async () => {
  const ada = await seed();
  const response = await call('POST', '/reservations', {
    token: ada, key: newKey(), json: book({ table_ids: ['t_2', 't_2'] }),
  });
  assert.deepEqual([response.status, response.body.error.code], [422, 'validation_failed']);
});

test('an undeclared pair is combination_not_allowed', async () => {
  const ada = await seed();
  const response = await call('POST', '/reservations', {
    token: ada, key: newKey(), json: book({ table_ids: ['t_1', 't_3'] }),
  });
  assert.deepEqual([response.status, response.body.error.code], [422, 'combination_not_allowed']);
});

test('more than two tables is combination_not_allowed', async () => {
  const ada = await seed();
  const response = await call('POST', '/reservations', {
    token: ada, key: newKey(), json: book({ table_ids: ['t_1', 't_2', 't_3'] }),
  });
  assert.deepEqual([response.status, response.body.error.code], [422, 'combination_not_allowed']);
});

test('party above the combined capacity is party_exceeds_capacity', async () => {
  const ada = await seed();
  const response = await call('POST', '/reservations', {
    token: ada, key: newKey(), json: book({ table_ids: ['t_1', 't_2'], party_size: 7 }),
  });
  assert.deepEqual([response.status, response.body.error.code], [422, 'party_exceeds_capacity']);
});

test('a taken member makes the combination table_unavailable, and cancel frees both', async () => {
  const ada = await seed();
  await call('POST', '/reservations', {
    token: ada, key: newKey(), json: book({ table_id: 't_1', party_size: 2 }),
  });
  const clash = await call('POST', '/reservations', {
    token: ada, key: newKey(), json: book({ table_ids: ['t_1', 't_2'] }),
  });
  assert.deepEqual([clash.status, clash.body.error.code], [409, 'table_unavailable']);

  const ref = (await call('GET', '/reservations', { token: ada })).body.reservations[0].reference;
  await call('POST', `/reservations/${ref}/cancel`, { token: ada });
  const retry = await call('POST', '/reservations', {
    token: ada, key: newKey(), json: book({ table_ids: ['t_1', 't_2'] }),
  });
  assert.equal(retry.status, 201);
});

// ---- patch and moves --------------------------------------------------------

test('patch moves a single booking into a combination and frees the single', async () => {
  const ada = await seed();
  const created = (await call('POST', '/reservations', {
    token: ada, key: newKey(), json: book({ table_id: 't_1', party_size: 2 }),
  })).body;
  const patched = await call('PATCH', `/reservations/${created.reference}`, {
    token: ada, json: { table_ids: ['t_1', 't_2'], party_size: 6 },
  });
  assert.equal(patched.status, 200);
  assert.deepEqual(patched.body.table_ids, ['t_1', 't_2']);
  assert.equal(patched.body.table_id, undefined);
  assert.equal(patched.body.reference, created.reference);
});

test('a move accepts table_ids and keeps table_ids atomic', async () => {
  const ada = await seed();
  const booking = (await call('POST', '/reservations', {
    token: ada, key: newKey(), json: book({ table_id: 't_3', party_size: 4 }),
  })).body;
  const result = await call('POST', '/reservation-moves', {
    token: ada, key: newKey(),
    json: { moves: [{ reference: booking.reference, table_ids: ['t_1', 't_2'], party_size: 6 }] },
  });
  assert.equal(result.status, 201);
  assert.deepEqual(result.body.reservations[0].table_ids, ['t_1', 't_2']);
});

// ---- browser screen routes --------------------------------------------------

test('the four screen routes answer with HTML', async () => {
  await reset(fixture());
  for (const path of ['/', '/signup', '/login', '/lookup']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/, path);
    const html = await response.text();
    assert.match(html, /data-testid=/, path);
  }
  const search = await (await fetch(`${base}/`)).text();
  assert.match(search, /data-testid="search-button"/);
  assert.match(search, /data-testid="restaurant-select"/);
  assert.match(search, /Zum Anker/);
});
