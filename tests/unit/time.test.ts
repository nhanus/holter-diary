import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { newEntry } from '../../src/domain.ts';
import { calibrate, newSession, monitorTime, eventTimeFromMonitor, parseWallTime, assertConsistentCalibration } from '../../src/time.ts';

const clock = { timeZone: 'Europe/Berlin', utcOffsetMinutes: 60 };
const captured = Date.parse('2028-01-10T12:30:00Z');

test('zero, negative and positive monitor offsets use a fixed measurement basis', () => {
  const session = newSession(captured, clock);
  assert.equal(monitorTime(captured, session), '2028-01-10T13:30:00');
  for (const [reading, expected, next] of [
    ['2028-01-10T13:28:00', -120000, '2028-01-10T13:29:00'],
    ['2028-01-10T13:32:00', 120000, '2028-01-10T13:33:00'],
  ] as const) {
    session.calibration = calibrate(captured, reading, clock);
    assert.equal(session.calibration.offsetMs, expected);
    assert.equal(monitorTime(captured + 60000, session), next);
    assert.equal(eventTimeFromMonitor(reading, session), captured);
  }
});

test('monitor time crosses midnight and year boundaries in both directions', () => {
  const phone = Date.parse('2028-12-31T23:59:30Z');
  const session = newSession(phone, { timeZone: 'UTC', utcOffsetMinutes: 0 });
  session.calibration = calibrate(phone, '2029-01-01T00:01:30', session.clock);
  assert.equal(monitorTime(phone, session), '2029-01-01T00:01:30');
  assert.equal(eventTimeFromMonitor('2028-12-31T23:59:00', session), Date.parse('2028-12-31T23:57:00Z'));
});

test('backdated correction and recalibration retain the original captured instant', () => {
  const session = newSession(captured, clock);
  const entry = newEntry(session.id, captured, 'symptom', 'Synthetic note');
  entry.eventAtMs = eventTimeFromMonitor('2028-01-10T13:25:00', session);
  assert.equal(entry.capturedAtMs, captured);
  session.calibration = calibrate(captured, '2028-01-10T13:28:00', clock);
  assert.equal(monitorTime(entry.eventAtMs, session), '2028-01-10T13:23:00');
  assert.equal(entry.capturedAtMs, captured);
});

test('calibration uses the supplied captured instant, not the later form submission', () => {
  const now = mock.method(Date, 'now', () => captured + 45_000);
  try { assert.equal(calibrate(captured, '2028-01-10T13:30:00', clock).offsetMs, 0); }
  finally { now.mock.restore(); }
});

test('wall-clock parsing rejects impossible dates and ambiguous formats', () => {
  for (const value of ['2028-02-30T12:00', '2028-13-01T12:00', '2028-01-00T12:00',
    '2028-01-10T24:00', '2028-01-10T12:60', '2028-01-10T12:00:60',
    '10/01/2028 13:30', '2028-01-10T12:00Z', '0000-01-01T00:00']) {
    assert.throws(() => parseWallTime(value));
  }
  assert.equal(parseWallTime('2028-02-29T12:00'), Date.parse('2028-02-29T12:00:00Z'));
});

test('DST changes do not silently change a measurement fixed offset', () => {
  const before = Date.parse('2028-03-26T00:30:00Z');
  const session = newSession(before, clock);
  assert.equal(monitorTime(before, session), '2028-03-26T01:30:00');
  assert.equal(monitorTime(before + 3600000, session), '2028-03-26T02:30:00');
});

test('malformed timestamps, timezone and inconsistent calibration are rejected', () => {
  assert.throws(() => newSession(NaN, clock));
  assert.throws(() => newSession(captured, { ...clock, utcOffsetMinutes: 1000 }));
  assert.throws(() => newSession(captured, { ...clock, timeZone: 'Invalid/Zone' }));
  const session = newSession(captured, clock);
  session.calibration.offsetMs = 10;
  assert.throws(() => assertConsistentCalibration(session));
});
