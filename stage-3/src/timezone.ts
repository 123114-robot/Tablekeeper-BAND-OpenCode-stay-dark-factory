/**
 * Local wall time -> UTC instant, and back, for the official model.
 *
 * Every conversion takes an explicit IANA zone. Nothing here reads `process.env.TZ`,
 * the host zone or the host locale.
 *
 * §9 rules:
 *   - spring-forward gap (0 candidates): the local time does not exist;
 *   - fall-back overlap (2 candidates): resolve to the FIRST occurrence — the one
 *     before the clocks change;
 *   - the scan steps at 15 minutes so sub-hour offsets (Asia/Kathmandu +05:45,
 *     Australia/Eucla +08:45, Pacific/Chatham +12:45) still resolve.
 */

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SCAN_WINDOW_MINUTES = 48 * 60;
const SCAN_STEP_MINUTES = 15;

export type ParsedLocal = { date: string; hhmm: string; wallMinutes: number };

/** Strict `YYYY-MM-DDTHH:MM` with no offset and no seconds. Returns null on any deviation. */
export function parseBareLocal(value: string): ParsedLocal | null {
  const match = LOCAL_RE.exec(value);
  if (match === null) return null;
  const [, y, mo, d, h, mi] = match as unknown as [string, string, string, string, string, string];
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  if (!isRealDate(year, month, day) || hour > 23 || minute > 59) return null;
  return {
    date: `${y}-${mo}-${d}`,
    hhmm: `${h}:${mi}`,
    wallMinutes: hour * 60 + minute,
  };
}

export function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const asUtc = new Date(Date.UTC(year, month - 1, day));
  return (
    asUtc.getUTCFullYear() === year &&
    asUtc.getUTCMonth() === month - 1 &&
    asUtc.getUTCDate() === day
  );
}

/** True for a strictly formatted real calendar date `YYYY-MM-DD`. */
export function isRealDateString(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, mo, d] = value.split('-').map(Number) as [number, number, number];
  return isRealDate(y, mo, d);
}

export function weekdayOf(date: string): Weekday {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  // getUTCDay() is Sunday-based; WEEKDAYS is Monday-first, hence the shift.
  return WEEKDAYS[(new Date(Date.UTC(y, mo - 1, d)).getUTCDay() + 6) % 7] as Weekday;
}

export function zoneExists(timezone: string): boolean {
  if (typeof timezone !== 'string' || timezone === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function formatterFor(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
}

type Wall = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function wallAt(ms: number, formatter: Intl.DateTimeFormat): Wall {
  const parts = formatter.formatToParts(new Date(ms));
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part === undefined ? Number.NaN : Number(part.value);
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/**
 * Every UTC instant whose wall time in `timezone` equals `parsed.date`/`parsed.hhmm`,
 * ascending. Zero for a spring-forward gap, two for a fall-back overlap.
 */
export function localCandidates(parsed: ParsedLocal, timezone: string): number[] {
  const formatter = formatterFor(timezone);
  const [y, mo, d] = parsed.date.split('-').map(Number) as [number, number, number];
  const hour = Math.floor(parsed.wallMinutes / 60);
  const minute = parsed.wallMinutes % 60;
  const naiveUtc = Date.UTC(y, mo - 1, d, hour, minute);

  const found = new Set<number>();
  for (let offset = -SCAN_WINDOW_MINUTES; offset <= SCAN_WINDOW_MINUTES; offset += SCAN_STEP_MINUTES) {
    const instant = naiveUtc - offset * 60000;
    const wall = wallAt(instant, formatter);
    if (
      wall.year === y && wall.month === mo && wall.day === d &&
      wall.hour === hour && wall.minute === minute
    ) {
      found.add(instant);
    }
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * The instant a bare local time denotes, per §9: the first occurrence when the time
 * is repeated. Returns null when the local time does not exist at all.
 */
export function resolveLocalFirst(date: string, hhmm: string, timezone: string): number | null {
  const parsed = parseBareLocal(`${date}T${hhmm}`);
  if (parsed === null) return null;
  const candidates = localCandidates(parsed, timezone);
  return candidates.length === 0 ? null : (candidates[0] as number);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** RFC 3339 with the zone's explicit offset, e.g. `2026-09-24T19:00:00+02:00`. */
export function formatZoned(ms: number, timezone: string): string {
  const wall = wallAt(ms, formatterFor(timezone));
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  const offsetMinutes = Math.round((asUtc - ms) / 60000);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const magnitude = Math.abs(offsetMinutes);
  const offset = `${pad2(Math.floor(magnitude / 60))}:${pad2(magnitude % 60)}`;
  return (
    `${wall.year}-${pad2(wall.month)}-${pad2(wall.day)}` +
    `T${pad2(wall.hour)}:${pad2(wall.minute)}:${pad2(wall.second)}${sign}${offset}`
  );
}

/** The bare `YYYY-MM-DDTHH:MM` local start of an instant in `timezone`. */
export function localStampOf(ms: number, timezone: string): string {
  return formatZoned(ms, timezone).slice(0, 16);
}

/** `HH:MM` wall time of an instant in `timezone`. */
export function localHMOf(ms: number, timezone: string): string {
  return formatZoned(ms, timezone).slice(11, 16);
}

export function formatUtc(ms: number): string {
  return formatZoned(ms, 'UTC');
}
