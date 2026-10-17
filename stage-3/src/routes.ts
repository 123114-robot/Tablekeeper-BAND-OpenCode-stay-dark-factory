/**
 * HTTP routing, parsing and response shaping for the official Stage 3 contract.
 *
 * Failures always leave here as `{"error": {"code", "message"}}`. Success bodies are
 * JSON; `/health`, `/_test/reset` and `/_test/import` are the shapes the spec names.
 *
 * On top of the stage-1 API and stage-2's four HTML screens, stage 3 adds policy
 * publication and reads, availability explanations, reservation history and
 * decision, and recurring agreements. §3.4's JSON convention governs the API.
 */

import { ApiError, toErrorResponse } from './errors.ts';
import { isValidEmail, hashPassword, newToken, newUserId, verifyPassword } from './auth.ts';
import {
  canonicalJson,
  exportState,
  idempotencyKey as idempotencyRecordKey,
  stateFromExported,
  stateFromFixture,
  type Store,
} from './store.ts';
import { isRealDateString } from './timezone.ts';
import {
  applyMoves,
  availability,
  cancelReservation,
  createReservation,
  getDecision,
  getHistory,
  getReservation,
  getRestaurant,
  getRestaurantPolicies,
  listReservations,
  listRestaurants,
  patchReservation,
  publishPolicy,
} from './domain.ts';
import { adoptSeries, getSeries } from './series.ts';
import { renderPage } from './ui.ts';

const MAX_BODY_BYTES = 1024 * 1024;
const DRAIN_LIMIT_BYTES = MAX_BODY_BYTES * 8;

type Body = Record<string, unknown>;

function readBody(req: import('node:http').IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    let settled = false;
    const settle = (run: () => void): void => {
      if (!settled) {
        settled = true;
        run();
      }
    };
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (tooLarge) {
        if (size > DRAIN_LIMIT_BYTES) {
          settle(() => reject(new ApiError('malformed_request', 'request body is too large')));
          req.destroy();
        }
        return;
      }
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) {
        settle(() => reject(new ApiError('malformed_request', 'request body is too large')));
        return;
      }
      settle(() => resolve(Buffer.concat(chunks)));
    });
    req.on('error', (err) => settle(() => reject(err)));
    req.on('aborted', () => settle(() => reject(new ApiError('malformed_request', 'request aborted'))));
  });
}

async function parseJsonObject(req: import('node:http').IncomingMessage): Promise<Body> {
  const raw = await readBody(req);
  const text = raw.toString('utf8').trim();
  if (text === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError('malformed_request');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError('malformed_request');
  }
  return parsed as Body;
}

function sendJson(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendHtml(res: import('node:http').ServerResponse, html: string): void {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
  });
  res.end(html);
}

function sendNoContent(res: import('node:http').ServerResponse): void {
  res.writeHead(204, { 'content-length': 0 });
  res.end();
}

function headerValue(req: import('node:http').IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function requireUser(store: Store, req: import('node:http').IncomingMessage): string {
  const userId = optionalUser(store, req);
  if (userId === undefined) throw new ApiError('unauthenticated');
  return userId;
}

/**
 * The bearer identity when the request carries a valid token, else undefined.
 * History, decision and series reads resolve "not yours / not signed in" to the
 * same 404 before authentication, so they treat a missing or invalid token as
 * no identity rather than 401.
 */
function optionalUser(store: Store, req: import('node:http').IncomingMessage): string | undefined {
  const header = headerValue(req, 'authorization');
  const match = typeof header === 'string' ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  if (match === null) return undefined;
  return store.current.tokens.get(match[1] as string);
}

function runIdempotent(
  store: Store,
  userId: string,
  path: string,
  key: string | undefined,
  body: Body,
  run: () => { status: number; body: unknown },
): { status: number; body: unknown } {
  if (key === undefined || key === '') throw new ApiError('missing_idempotency_key');
  if (key.length > 255) throw new ApiError('validation_failed');
  const recordKey = idempotencyRecordKey(userId, path, key);
  const canonical = canonicalJson(body);
  const existing = store.current.idempotency.get(recordKey);
  if (existing !== undefined) {
    if (existing.body_canonical === canonical) return { status: 200, body: existing.response };
    throw new ApiError('idempotency_key_reuse');
  }
  const result = run();
  store.current.idempotency.set(recordKey, {
    body_canonical: canonical,
    status: result.status,
    response: result.body,
  });
  return result;
}

function signup(store: Store, body: Body): { status: number; body: unknown } {
  const email = body.email;
  const password = body.password;
  const displayName = body.display_name;
  if (email === undefined || password === undefined || displayName === undefined) {
    throw new ApiError('validation_failed');
  }
  if (typeof email !== 'string' || typeof password !== 'string' || typeof displayName !== 'string') {
    throw new ApiError('malformed_request');
  }
  if (!isValidEmail(email)) throw new ApiError('validation_failed');
  if (password.length < 8) throw new ApiError('validation_failed');
  if (store.current.emails.has(email.toLowerCase())) throw new ApiError('email_taken');

  const userId = newUserId();
  store.current.users.set(userId, {
    id: userId,
    email,
    password_hash: hashPassword(password),
    display_name: displayName,
  });
  store.current.emails.set(email.toLowerCase(), userId);
  const token = newToken();
  store.current.tokens.set(token, userId);
  return { status: 201, body: { user_id: userId, display_name: displayName, token } };
}

function login(store: Store, body: Body): { status: number; body: unknown } {
  const email = body.email;
  const password = body.password;
  if (typeof email !== 'string' || typeof password !== 'string') {
    throw new ApiError('malformed_request');
  }
  const userId = store.current.emails.get(email.toLowerCase());
  const user = userId === undefined ? undefined : store.current.users.get(userId);
  if (user === undefined || !verifyPassword(password, user.password_hash)) {
    throw new ApiError('unauthenticated');
  }
  const token = newToken();
  store.current.tokens.set(token, user.id);
  return { status: 200, body: { user_id: user.id, display_name: user.display_name, token } };
}

function availabilityQuery(url: URL): {
  restaurantId: string;
  date: string;
  partySize: number;
  explain: boolean;
} {
  const restaurantId = url.searchParams.get('restaurant_id');
  const date = url.searchParams.get('date');
  const partyRaw = url.searchParams.get('party_size');
  if (restaurantId === null || date === null || partyRaw === null) {
    throw new ApiError('validation_failed');
  }
  if (!/^\d+$/.test(partyRaw)) throw new ApiError('validation_failed');
  const partySize = Number(partyRaw);
  if (!Number.isInteger(partySize) || partySize < 1) throw new ApiError('validation_failed');
  if (!isRealDateString(date)) throw new ApiError('validation_failed');
  // `explain`'s only accepted value is `true`; `false`, `1` and the empty string
  // are all 422, and omitting it keeps stage 1's shape exactly.
  const explainRaw = url.searchParams.get('explain');
  if (explainRaw !== null && explainRaw !== 'true') throw new ApiError('validation_failed');
  return { restaurantId, date, partySize, explain: explainRaw === 'true' };
}

/** The screen route for a GET, or null when the path is not one of the four screens. */
function screenFor(segments: string[]): string | null {
  if (segments.length === 0) return 'search';
  if (segments.length === 1 && (segments[0] === 'signup' || segments[0] === 'login' || segments[0] === 'lookup')) {
    return segments[0];
  }
  return null;
}

async function dispatch(
  store: Store,
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
): Promise<void> {
  const method = req.method ?? 'GET';
  let url: URL;
  try {
    url = new URL(req.url ?? '/', 'http://tablekeeper.invalid');
  } catch {
    throw new ApiError('not_found');
  }
  const segments = url.pathname.split('/').filter((segment) => segment !== '');

  if (method === 'GET') {
    const screen = screenFor(segments);
    if (screen !== null) {
      const html = renderPage(screen, store.current);
      if (html !== null) {
        sendHtml(res, html);
        return;
      }
    }
  }

  if (method === 'GET' && segments.length === 1 && segments[0] === 'health') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  if (method === 'POST' && segments.length === 2 && segments[0] === '_test') {
    if (segments[1] === 'reset') {
      const next = stateFromFixture(await parseJsonObject(req));
      store.current = next;
      sendNoContent(res);
      return;
    }
    if (segments[1] === 'import') {
      const body = await parseJsonObject(req);
      if (body.track !== 'tablekeeper' || body.format_version !== 1 || body.state === undefined) {
        throw new ApiError('validation_failed');
      }
      const next = stateFromExported(body.state);
      store.current = next;
      sendNoContent(res);
      return;
    }
  }

  if (method === 'GET' && segments.length === 2 && segments[0] === '_test' && segments[1] === 'export') {
    sendJson(res, 200, { track: 'tablekeeper', format_version: 1, state: exportState(store.current) });
    return;
  }

  if (method === 'POST' && segments.length === 2 && segments[0] === 'auth') {
    const body = await parseJsonObject(req);
    if (segments[1] === 'signup') {
      const result = signup(store, body);
      sendJson(res, result.status, result.body);
      return;
    }
    if (segments[1] === 'login') {
      const result = login(store, body);
      sendJson(res, result.status, result.body);
      return;
    }
  }

  if (method === 'GET' && segments.length === 1 && segments[0] === 'restaurants') {
    sendJson(res, 200, listRestaurants(store.current));
    return;
  }

  if (method === 'GET' && segments.length === 2 && segments[0] === 'restaurants') {
    sendJson(res, 200, getRestaurant(store.current, segments[1] as string));
    return;
  }

  if (segments.length === 3 && segments[0] === 'restaurants' && segments[2] === 'policies') {
    const restaurantId = segments[1] as string;
    if (method === 'GET') {
      sendJson(res, 200, getRestaurantPolicies(store.current, restaurantId));
      return;
    }
    if (method === 'POST') {
      const userId = requireUser(store, req);
      const body = await parseJsonObject(req);
      const result = runIdempotent(
        store,
        userId,
        `/restaurants/${restaurantId}/policies`,
        headerValue(req, 'idempotency-key'),
        body,
        () => publishPolicy(store.current, restaurantId, userId, body),
      );
      sendJson(res, result.status, result.body);
      return;
    }
  }

  if (method === 'GET' && segments.length === 1 && segments[0] === 'availability') {
    const { restaurantId, date, partySize, explain } = availabilityQuery(url);
    sendJson(res, 200, availability(store.current, restaurantId, date, partySize, explain));
    return;
  }

  if (segments.length >= 1 && segments[0] === 'reservations') {
    // History and decision return the owner-only 404 even without authentication,
    // so they resolve identity optionally and never 401.
    if (method === 'GET' && segments.length === 3 && (segments[2] === 'history' || segments[2] === 'decision')) {
      const viewerId = optionalUser(store, req);
      if (viewerId === undefined) throw new ApiError('not_found');
      const reference = segments[1] as string;
      sendJson(
        res,
        200,
        segments[2] === 'history'
          ? getHistory(store.current, viewerId, reference)
          : getDecision(store.current, viewerId, reference),
      );
      return;
    }

    const userId = requireUser(store, req);

    if (method === 'POST' && segments.length === 1) {
      const body = await parseJsonObject(req);
      const result = runIdempotent(
        store,
        userId,
        '/reservations',
        headerValue(req, 'idempotency-key'),
        body,
        () => createReservation(store.current, userId, body),
      );
      sendJson(res, result.status, result.body);
      return;
    }

    if (method === 'GET' && segments.length === 1) {
      sendJson(res, 200, listReservations(store.current, userId));
      return;
    }

    if (segments.length === 2 && method === 'GET') {
      sendJson(res, 200, getReservation(store.current, userId, segments[1] as string));
      return;
    }

    if (segments.length === 2 && method === 'PATCH') {
      const body = await parseJsonObject(req);
      sendJson(res, 200, patchReservation(store.current, userId, segments[1] as string, body));
      return;
    }

    if (segments.length === 3 && segments[2] === 'cancel' && method === 'POST') {
      sendJson(res, 200, cancelReservation(store.current, userId, segments[1] as string));
      return;
    }
  }

  if (method === 'POST' && segments.length === 1 && segments[0] === 'reservation-moves') {
    const userId = requireUser(store, req);
    const body = await parseJsonObject(req);
    const result = runIdempotent(
      store,
      userId,
      '/reservation-moves',
      headerValue(req, 'idempotency-key'),
      body,
      () => applyMoves(store.current, userId, body),
    );
    sendJson(res, result.status, result.body);
    return;
  }

  if (method === 'POST' && segments.length === 1 && segments[0] === 'series') {
    const userId = requireUser(store, req);
    const body = await parseJsonObject(req);
    const result = runIdempotent(
      store,
      userId,
      '/series',
      headerValue(req, 'idempotency-key'),
      body,
      () => adoptSeries(store.current, userId, body),
    );
    sendJson(res, result.status, result.body);
    return;
  }

  if (method === 'GET' && segments.length === 2 && segments[0] === 'series') {
    const viewerId = optionalUser(store, req);
    if (viewerId === undefined) throw new ApiError('not_found');
    sendJson(res, 200, getSeries(store.current, viewerId, segments[1] as string));
    return;
  }

  throw new ApiError('not_found');
}

export function createRequestListener(store: Store) {
  return function listener(
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ): void {
    void dispatch(store, req, res).catch((err: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const failure = toErrorResponse(err);
      sendJson(res, failure.status, failure.body);
    });
  };
}
