import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertDateOfBirth, assertSession } from '../../src/domain.ts';
import { newSession } from '../../src/time.ts';

test('birth dates accept legacy absence and valid civil dates without timezone normalization', () => {
  const session = newSession(Date.parse('2030-01-01T00:00:00Z'), { timeZone: 'UTC', utcOffsetMinutes: 0 });
  assertSession(session);
  for (const value of [undefined, '', '1980-02-29', '2000-02-29', '0001-01-01', '9999-12-31']) {
    assertDateOfBirth(value);
    assertSession({ ...session, dateOfBirth: value });
  }
  for (const value of [null, 19800101, '1900-02-29', '2025-02-29', '2000-02-30', '1980-04-31', '0000-01-01', '1980-00-01', '1980-13-01', '1980-01-00', '29.02.1980', '1980-2-29', '1980-02-29T00:00:00Z']) {
    assert.throws(() => assertSession({ ...session, dateOfBirth: value }), /INVALID_BIRTH_DATE/);
  }
});
