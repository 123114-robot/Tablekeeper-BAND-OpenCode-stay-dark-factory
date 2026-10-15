/**
 * Reservation history: the append-only record of one reservation's real events.
 *
 * `seq` starts at 1 and increases by exactly 1 per entry, so the order is total
 * even when two writes land in the same second. Every entry carries the
 * reservation's resulting `revision` and its complete `accepted_terms` as of that
 * moment — old entries never acquire newer terms. A `created` entry names all
 * three fields (each `from: null`), a `changed` entry names only the fields that
 * actually changed in the order table, starts_at_local, party_size, and a
 * `cancelled` entry carries an empty `changes` with nothing after it.
 *
 * The table field is `table_id` for a single-to-single operation and `table_ids`
 * with complete before/after lists whenever a pair is involved — for a creation
 * of a pair, `from: null` to the pair in declared combination order.
 */

import type { AcceptedTerms } from './policies.ts';

export type HistoryField = 'table_id' | 'table_ids' | 'starts_at_local' | 'party_size';

export type HistoryChange = {
  field: HistoryField;
  from: unknown;
  to: unknown;
};

export type HistoryEvent = 'created' | 'changed' | 'cancelled';

export type HistoryEntry = {
  seq: number;
  at_ms: number;
  event: HistoryEvent;
  changes: HistoryChange[];
  revision: number;
  accepted_terms: AcceptedTerms;
};

/** True when both sets name the same tables regardless of order. */
export function sameTableSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

/**
 * The table change between two resolved sets, or null when the set did not
 * change: a reversed input pair names the same set and is not an amendment on
 * its own. Single-to-single uses `table_id`; any pair involvement uses
 * `table_ids` with the complete lists.
 */
export function tableChange(from: string[], to: string[]): HistoryChange | null {
  if (from.length === 1 && to.length === 1) {
    if (from[0] === to[0]) return null;
    return { field: 'table_id', from: from[0], to: to[0] };
  }
  if (sameTableSet(from, to)) return null;
  return { field: 'table_ids', from: [...from], to: [...to] };
}

/** The `created` entry's three fields: table set, start and party, each from null. */
export function createdChanges(stamp: string, tableIds: string[], partySize: number): HistoryChange[] {
  const table: HistoryChange =
    tableIds.length === 1
      ? { field: 'table_id', from: null, to: tableIds[0] as string }
      : { field: 'table_ids', from: null, to: [...tableIds] };
  return [
    table,
    { field: 'starts_at_local', from: null, to: stamp },
    { field: 'party_size', from: null, to: partySize },
  ];
}

export function appendEntry(
  history: HistoryEntry[],
  event: HistoryEvent,
  changes: HistoryChange[],
  revision: number,
  terms: AcceptedTerms,
  atMs: number,
): void {
  history.push({
    seq: history.length + 1,
    at_ms: atMs,
    event,
    changes,
    revision,
    accepted_terms: terms,
  });
}
