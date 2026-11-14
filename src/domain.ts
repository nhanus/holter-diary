export type Language = 'de' | 'en';
export type EntryKind = 'note' | 'symptom';

export class DiaryError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = 'DiaryError';
    this.code = code;
  }
}

// A fixed UTC offset, sampled once for the measurement, is intentional.
export interface MeasurementClock {
  timeZone: string;
  utcOffsetMinutes: number;
}

export interface Calibration {
  capturedAtMs: number;
  monitorReading: string | null;
  offsetMs: number;
}

export interface Session {
  schemaVersion: 1;
  id: string;
  revision: number;
  startedAtMs: number;
  name: string;
  clock: MeasurementClock;
  calibration: Calibration;
}

export interface Entry {
  schemaVersion: 1;
  id: string;
  revision: number;
  sessionId: string;
  capturedAtMs: number;
  eventAtMs: number;
  kind: EntryKind;
  note: string;
}

export interface Preferences {
  schemaVersion: 1;
  id: 'preferences';
  language: Language;
}

// getRandomValues also works on ordinary HTTP preview origins.
export function uniqueId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function requireValue(condition: unknown, code = 'INVALID_DATA'): asserts condition {
  if (!condition) throw new DiaryError(code);
}

export function assertInstant(value: unknown): asserts value is number {
  requireValue(typeof value === 'number' && Number.isSafeInteger(value) &&
    Number.isFinite(new Date(value).getTime()), 'INVALID_TIME');
}

function record(value: unknown): asserts value is Record<string, unknown> {
  requireValue(typeof value === 'object' && value !== null && !Array.isArray(value));
}

function base(value: unknown): asserts value is Record<string, unknown> {
  record(value);
  requireValue(value.schemaVersion === 1 && typeof value.id === 'string' && value.id.length > 0);
}

function revision(value: unknown): void {
  requireValue(typeof value === 'number' && Number.isSafeInteger(value) && value >= 1);
}

export function assertClock(value: unknown): asserts value is MeasurementClock {
  record(value);
  requireValue(typeof value.timeZone === 'string' && value.timeZone.length > 0);
  requireValue(typeof value.utcOffsetMinutes === 'number' &&
    Number.isInteger(value.utcOffsetMinutes) && Math.abs(value.utcOffsetMinutes) <= 14 * 60);
  try { new Intl.DateTimeFormat('en', { timeZone: value.timeZone }); }
  catch { throw new DiaryError('INVALID_TIME_ZONE'); }
}

export function assertSession(value: unknown): asserts value is Session {
  base(value);
  revision(value.revision);
  assertInstant(value.startedAtMs);
  requireValue(typeof value.name === 'string');
  assertClock(value.clock);
  record(value.calibration);
  assertInstant(value.calibration.capturedAtMs);
  requireValue(value.calibration.monitorReading === null || typeof value.calibration.monitorReading === 'string');
  requireValue(typeof value.calibration.offsetMs === 'number' && Number.isSafeInteger(value.calibration.offsetMs));
}

export function assertEntry(value: unknown): asserts value is Entry {
  base(value);
  revision(value.revision);
  requireValue(typeof value.sessionId === 'string' && value.sessionId.length > 0);
  assertInstant(value.capturedAtMs);
  assertInstant(value.eventAtMs);
  requireValue(value.kind === 'note' || value.kind === 'symptom');
  requireValue(typeof value.note === 'string');
}

export function assertPreferences(value: unknown): asserts value is Preferences {
  base(value);
  requireValue(value.id === 'preferences' && (value.language === 'de' || value.language === 'en'));
}

export function newEntry(sessionId: string, capturedAtMs: number, kind: EntryKind, note = ''): Entry {
  const value: Entry = {
    schemaVersion: 1, id: uniqueId(), revision: 1,
    sessionId, capturedAtMs, eventAtMs: capturedAtMs, kind, note,
  };
  assertEntry(value);
  return value;
}
