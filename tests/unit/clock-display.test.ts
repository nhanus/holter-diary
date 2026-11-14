import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayClockDifference, basis } from '../../src/format.ts';
import { calibrate, newSession } from '../../src/time.ts';

test('clock differences use readable whole units and explicit direction in DE/EN', () => {
  for (const [offset, de, en] of [
    [0, 'keine Abweichung', 'no difference'],
    [1, 'weniger als 1 Sek. voraus', 'less than 1 s ahead'],
    [-999, 'weniger als 1 Sek. zurück', 'less than 1 s behind'],
    [1000, '1 Sek. voraus', '1 s ahead'],
    [-2700000, '45 Min. zurück', '45 min behind'],
    [3899544, '1 Std. 5 Min. voraus', '1 h 5 min ahead'],
    [-3723123, '1 Std. 2 Min. 3 Sek. zurück', '1 h 2 min 3 s behind'],
    [90061000, '25 Std. 1 Min. 1 Sek. voraus', '25 h 1 min 1 s ahead'],
  ] as const) {
    assert.equal(displayClockDifference(offset, 'de'), de);
    assert.equal(displayClockDifference(offset, 'en'), en);
  }
});

test('rounding carries into minutes and hours before splitting units', () => {
  assert.equal(displayClockDifference(59499, 'en'), '59 s ahead');
  assert.equal(displayClockDifference(59500, 'en'), '1 min ahead');
  assert.equal(displayClockDifference(-3599500, 'de'), '1 Std. zurück');
});

test('fixed phone basis does not repeat fractional calibration seconds or change the session', () => {
  const session = newSession(Date.parse('2028-01-10T12:00:00.456Z'), { timeZone: 'Europe/Berlin', utcOffsetMinutes: 60 });
  session.calibration = calibrate(session.startedAtMs, '2028-01-10T14:05:00', session.clock);
  const before = structuredClone(session);
  assert.equal(basis(session), 'UTC+01:00');
  assert.equal(displayClockDifference(session.calibration.offsetMs, 'de'), '1 Std. 5 Min. voraus');
  assert.deepEqual(session, before);
});
