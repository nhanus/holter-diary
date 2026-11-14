import { assertClock, assertInstant, assertSession, requireValue, uniqueId } from './domain.ts';
import type { Calibration, MeasurementClock, Session } from './domain.ts';

const MINUTE = 60_000;

// Parse a wall-clock reading without using the browser's current timezone.
export function parseWallTime(text: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  requireValue(match, 'INVALID_MONITOR_TIME');
  const [year, month, day, hour, minute, second] = match.slice(1).map(x => Number(x ?? 0));
  requireValue(year >= 1 && hour <= 23 && minute <= 59 && second <= 59, 'INVALID_MONITOR_TIME');
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  requireValue(date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day, 'INVALID_MONITOR_TIME');
  return date.getTime();
}

function wallString(wallMs: number): string {
  assertInstant(wallMs);
  const iso = new Date(wallMs).toISOString();
  requireValue(/^\d{4}-/.test(iso) && !iso.startsWith('0000-'), 'INVALID_MONITOR_TIME');
  return iso.slice(0, 19);
}

export function captureClock(atMs: number): MeasurementClock {
  assertInstant(atMs);
  return {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    utcOffsetMinutes: -new Date(atMs).getTimezoneOffset(),
  };
}

export function calibrate(capturedAtMs: number, monitorReading: string, clock: MeasurementClock): Calibration {
  assertInstant(capturedAtMs);
  assertClock(clock);
  return {
    capturedAtMs, monitorReading,
    offsetMs: parseWallTime(monitorReading) - (capturedAtMs + clock.utcOffsetMinutes * MINUTE),
  };
}

export function newSession(startedAtMs: number, clock: MeasurementClock, name = ''): Session {
  const session: Session = {
    schemaVersion: 1, id: uniqueId(), revision: 1, startedAtMs, name,
    clock: { ...clock },
    calibration: { capturedAtMs: startedAtMs, monitorReading: null, offsetMs: 0 },
  };
  assertSession(session);
  return session;
}

export function monitorTime(eventAtMs: number, session: Session): string {
  assertInstant(eventAtMs);
  assertSession(session);
  return wallString(eventAtMs + session.clock.utcOffsetMinutes * MINUTE + session.calibration.offsetMs);
}

// Convert a manual monitor-time correction back into the phone time basis.
export function eventTimeFromMonitor(monitorReading: string, session: Session): number {
  assertSession(session);
  const instant = parseWallTime(monitorReading) - session.clock.utcOffsetMinutes * MINUTE - session.calibration.offsetMs;
  assertInstant(instant);
  return instant;
}

export function assertConsistentCalibration(session: unknown): asserts session is Session {
  assertSession(session);
  const { calibration, clock } = session;
  requireValue(calibration.monitorReading === null
    ? calibration.offsetMs === 0
    : calibrate(calibration.capturedAtMs, calibration.monitorReading, clock).offsetMs === calibration.offsetMs,
  'INVALID_CALIBRATION');
  monitorTime(session.startedAtMs, session);
}
