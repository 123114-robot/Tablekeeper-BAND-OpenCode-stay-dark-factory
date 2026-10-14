/**
 * The official error taxonomy (spec §5).
 *
 * Every non-2xx response is `{"error": {"code": "...", "message": "..."}}`. The code
 * carries its HTTP status here and nowhere else, so the whole failure surface is
 * enumerable from one map.
 */

export type ErrorCode =
  | 'malformed_request'
  | 'missing_idempotency_key'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'table_unavailable'
  | 'email_taken'
  | 'idempotency_key_reuse'
  | 'cutoff_passed'
  | 'reservation_cancelled'
  | 'validation_failed'
  | 'not_on_slot_grid'
  | 'outside_opening_hours'
  | 'party_exceeds_capacity'
  | 'invalid_local_time'
  | 'internal';

export const STATUS: Record<ErrorCode, number> = {
  malformed_request: 400,
  missing_idempotency_key: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  table_unavailable: 409,
  email_taken: 409,
  idempotency_key_reuse: 409,
  cutoff_passed: 409,
  reservation_cancelled: 409,
  validation_failed: 422,
  not_on_slot_grid: 422,
  outside_opening_hours: 422,
  party_exceeds_capacity: 422,
  invalid_local_time: 422,
  internal: 500,
};

const DEFAULT_MESSAGE: Record<ErrorCode, string> = {
  malformed_request: 'the request body could not be parsed or a field had the wrong type',
  missing_idempotency_key: 'the Idempotency-Key header is required and must not be empty',
  unauthenticated: 'a valid bearer token is required',
  forbidden: 'not permitted to touch this resource',
  not_found: 'no such resource',
  table_unavailable: 'the table is not available for the requested interval',
  email_taken: 'that email is already registered',
  idempotency_key_reuse: 'the idempotency key was already used with a different request body',
  cutoff_passed: 'the reservation is inside its cancellation cutoff',
  reservation_cancelled: 'the reservation has been cancelled',
  validation_failed: 'a required field is missing or a stated rule was violated',
  not_on_slot_grid: 'the requested start is not on the restaurant booking grid',
  outside_opening_hours: 'the requested start is outside the restaurant opening hours',
  party_exceeds_capacity: 'the party size exceeds the table capacity',
  invalid_local_time: 'the requested local time does not exist in the restaurant time zone',
  internal: 'the request could not be completed',
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGE[code]);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS[code];
  }
}

export type ErrorBody = { error: { code: ErrorCode; message: string } };

export function toErrorResponse(err: unknown): { status: number; body: ErrorBody } {
  if (err instanceof ApiError) {
    return { status: err.status, body: { error: { code: err.code, message: err.message } } };
  }
  const fallback = new ApiError('internal');
  return { status: fallback.status, body: { error: { code: fallback.code, message: fallback.message } } };
}
