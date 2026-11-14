import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { newEntry } from '../../src/domain.ts';
import { APP_URL, REPOSITORY_URL, buildPdf, reportText, UnsupportedCharactersError } from '../../src/report.ts';
import { calibrate, newSession, eventTimeFromMonitor } from '../../src/time.ts';

const standardFontDataUrl = fileURLToPath(new URL('./standard_fonts/', import.meta.resolve('pdfjs-dist/package.json')));
const start = Date.parse('2030-12-31T22:56:00Z');
const generatedAt = start + 4 * 60_000;

function sessionWithCalibration(name = '') {
  const session = newSession(start, { timeZone: 'Europe/Berlin', utcOffsetMinutes: 60 }, name);
  session.calibration = calibrate(start, '2030-12-31T23:58:00', session.clock);
  return session;
}

async function extractPages(data: Uint8Array) {
  const task = getDocument({ data, standardFontDataUrl });
  try {
    const pdf = await task.promise;
    const pages = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const { items } = await page.getTextContent();
      pages.push({
        bounds: page.view,
        links: (await page.getAnnotations()).map(link => link.url),
        text: items.flatMap(item => 'str' in item && item.str.trim() ? [item] : []),
      });
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

test('German PDF preserves umlauts and orders corrected monitor times across midnight', async () => {
  const session = sessionWithCalibration('Jörg Weiß');
  const note = newEntry(session.id, start + 3 * 60_000, 'note', 'Über die Brücke: ÄÖÜ äöü ß');
  note.eventAtMs = start + 60_000;
  const marker = newEntry(session.id, start + 2 * 60_000, 'symptom');

  const pages = await extractPages(await buildPdf(session, [marker, note], 'de', generatedAt));
  assert.equal(pages.length, 1);
  const strings = pages[0].text.map(item => item.str);
  assert.ok(strings.includes('Name: Jörg Weiß'));
  assert.equal(strings[strings.indexOf('Erfasste Einträge') - 1], '2');
  assert.equal(strings[strings.indexOf('Beschwerdemarkierungen') - 1], '1');
  assert.ok(strings.includes('Messbeginn (Referenz): 31.12.2030 23:56:00'));
  assert.ok(strings.includes('Letzter Eintrag (Referenz): 31.12.2030 23:58:00'));
  assert.ok(strings.includes('Bericht erstellt (Referenz): 01.01.2031 00:00:00'));
  assert.ok(strings.some(text => text.includes('EKG-Gerätezeit = Referenzzeit +120 s.')));
  const rows = strings.slice(strings.indexOf('31.12.2030 23:57:00'), strings.findIndex(text => text.startsWith('Holter Diary |')));
  assert.deepEqual(rows.slice(0, 7), [
    '31.12.2030 23:57:00', '31.12.2030 23:59:00', 'Notiz', note.note,
    '31.12.2030 23:58:00', '01.01.2031 00:00:00', 'BESCHWERDEN',
  ]);
  assert.equal(rows.slice(7).map(line => line.trim()).join(' '), 'Beschwerdezeit markiert; keine Details eingetragen.');
});

test('long notes fit on A4 pages with repeated headings and all text in order', async () => {
  const session = sessionWithCalibration();
  const lines = Array.from({ length: 130 }, (_, index) => `Synthetic row ${index + 1}`);
  const token = 'UnbrokenToken0123456789'.repeat(12);
  const ending = 'Final note ending';
  const entry = newEntry(session.id, start + 60_000, 'symptom', [...lines, token, ending].join('\n'));
  const pages = await extractPages(await buildPdf(session, [entry], 'en', generatedAt));

  assert.ok(pages.length >= 3);
  const noteText = pages.flatMap(({ bounds, text }, index) => {
    assert.deepEqual(bounds.map(Math.round), [0, 0, 595, 842]);
    const strings = text.map(item => item.str);
    assert.equal(strings[0], 'Holter monitoring diary');
    assert.ok(strings.includes('Reference time'));
    assert.ok(strings.includes('Recorder time'));
    assert.ok(strings.includes('Event'));
    assert.ok(strings.includes('SYMPTOMS'));
    assert.equal(strings.includes('(continued)'), index > 0);
    const footer = text.find(item => item.str.startsWith('Holter Diary |'))!;
    assert.ok(strings.includes(`App: ${APP_URL}`));
    assert.ok(strings.includes(`GitHub: ${REPOSITORY_URL}`));
    assert.deepEqual(pages[index].links, [APP_URL, REPOSITORY_URL]);
    for (const item of text.filter(item => item.transform[5] < 57)) {
      assert.ok(item.transform[4] >= 40 && item.transform[4] + item.width <= bounds[2] - 40);
      assert.ok(item.transform[5] >= 20);
    }
    assert.equal(footer.str, `Holter Diary | Page ${index + 1} / ${pages.length}`);

    const heading = text.find(item => item.str === 'Activity / symptoms / notes');
    assert.ok(heading);
    const notes = text.filter(item => item !== heading && item.transform[4] === heading.transform[4]);
    assert.ok(notes.length > 0);
    const margin = text[0].transform[4];
    for (const { transform: [, , , , x, y], width, height } of notes) {
      assert.ok(x >= margin && x + width <= bounds[2] - margin);
      assert.ok(y - height > footer.transform[5] && y + height < heading.transform[5]);
    }
    return notes.map(item => item.str);
  });

  assert.deepEqual(noteText.slice(0, lines.length), lines);
  assert.equal(noteText.at(-1), ending);
  const tokenLines = noteText.slice(lines.length, -1);
  assert.ok(tokenLines.length > 1);
  assert.equal(tokenLines.join(''), token);
});

test('unsupported PDF characters are reported and the TXT fallback preserves Unicode', async () => {
  const session = sessionWithCalibration('Test 李');
  const note = 'Erste Zeile 🫀\r\nZweite Zeile\t李 🫀';
  const entry = newEntry(session.id, start + 60_000, 'symptom', note);

  await assert.rejects(buildPdf(session, [entry], 'de', generatedAt), error => {
    assert.ok(error instanceof UnsupportedCharactersError);
    assert.deepEqual(new Set(error.characters), new Set(['李', '🫀']));
    assert.equal(error.characters.length, 2);
    return true;
  });
  const fallback = reportText(session, [entry], 'de', generatedAt);
  assert.ok(fallback.includes('Name: Test 李'));
  assert.ok(fallback.endsWith(`Uhrzeit (Referenz): 2030-12-31 23:57:00 | EKG-Gerätezeit: 2030-12-31 23:59:00 | BESCHWERDEN\n${note}\n`));
});

test('24 and 48 hour diaries stay compact and retain every calibrated row across day and page boundaries', async () => {
  const at = Date.parse('2030-12-31T22:58:00Z');
  const session = newSession(at, { timeZone: 'Europe/Berlin', utcOffsetMinutes: 60 }, 'Synthetic example');
  session.calibration = calibrate(at, '2031-01-01T00:01:00', session.clock);
  for (const count of [49, 97]) {
    const entries = Array.from({ length: count }, (_, index) => newEntry(session.id, at + index * 30 * 60_000,
      index % 7 === 0 ? 'symptom' : 'note', `Synthetic observation ${String(index).padStart(3, '0')}`));
    for (const language of ['de', 'en'] as const) {
      const pages = await extractPages(await buildPdf(session, [...entries].reverse(), language, at + 48 * 3600_000));
      assert.equal(pages.length, count === 49 ? 2 : 4);
      const observed: string[] = [];
      for (const { text, links } of pages) {
        assert.deepEqual(links, [APP_URL, REPOSITORY_URL]);
        const phoneHeading = text.find(item => item.str === (language === 'de' ? 'Uhrzeit (Referenz)' : 'Reference time'))!;
        const timeHeading = text.find(item => item.str === (language === 'de' ? 'EKG-Gerätezeit' : 'Recorder time'))!;
        assert.ok(phoneHeading && timeHeading);
        for (const note of text.filter(item => /^Synthetic observation \d{3}$/.test(item.str))) {
          const index = Number(note.str.slice(-3));
          // Independent reference arithmetic, without monitorTime() or renderer helpers.
          const expected = new Date(at + index * 30 * 60_000 + 63 * 60_000).toISOString();
          const expectedPhone = new Date(at + index * 30 * 60_000 + 60 * 60_000).toISOString();
          const phone = text.find(item => item.transform[4] === phoneHeading.transform[4] && item.transform[5] === note.transform[5])!;
          const time = text.find(item => item.transform[4] === timeHeading.transform[4] && item.transform[5] === note.transform[5])!;
          const formatted = (value: string) => `${language === 'de' ? `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}` : value.slice(0, 10)} ${value.slice(11, 19)}`;
          assert.equal(phone.str, formatted(expectedPhone));
          assert.equal(time.str, formatted(expected));
          assert.ok(note.height >= 9.9 && time.height >= 9.9 && phone.height >= 9.9, 'body text remains at least 10pt');
          assert.ok(phone.transform[4] + phone.width < time.transform[4], 'phone timestamp fits before monitor column');
          assert.ok(time.transform[4] + time.width < note.transform[4], 'monitor timestamp fits before notes');
          assert.ok(note.transform[5] > 82 && note.transform[5] + note.height < phoneHeading.transform[5]);
          observed.push(note.str);
        }
      }
      assert.deepEqual(observed, entries.map(entry => entry.note));
    }
  }
});

test('derived phone dates remain printable beyond the monitor input year boundaries', async () => {
  for (const [reading, correction, expectedPhone] of [
    ['0001-01-01T00:00:00', '2030-12-31T23:57:00', '0000-12-31 23:59:00'],
    ['9999-12-31T23:59:00', '2030-12-31T23:55:00', '+010000-01-01 00:00:00'],
  ]) {
    const session = newSession(start, { timeZone: 'Europe/Berlin', utcOffsetMinutes: 60 });
    session.calibration = calibrate(start, correction, session.clock);
    const entry = newEntry(session.id, eventTimeFromMonitor(reading, session), 'note', 'Boundary example');
    const pages = await extractPages(await buildPdf(session, [entry], 'en', generatedAt));
    const strings = pages.flatMap(page => page.text.map(item => item.str));
    assert.ok(strings.includes(expectedPhone));
    assert.ok(strings.includes(reading.replace('T', ' ')));
    assert.ok(reportText(session, [entry], 'en', generatedAt).includes(`Reference time: ${expectedPhone}`));
  }
});


test('missing and zero comparisons use one dated column with distinct explanations in both exports', async () => {
  for (const language of ['de', 'en'] as const) {
    for (const compared of [false, true]) {
      const session = newSession(start, { timeZone: 'Europe/Berlin', utcOffsetMinutes: 60 });
      if (compared) session.calibration = calibrate(start, '2030-12-31T23:56:00', session.clock);
      const note = Array.from({ length: 120 }, (_, i) => `Observation ${String(i).padStart(3, '0')}`).join('\n');
      const entry = newEntry(session.id, start + 5 * 60_000, 'symptom', note);
      entry.eventAtMs = start + 60_000;
      const original = JSON.stringify({ session, entry });
      const heading = language === 'de' ? 'Uhrzeit (Referenz)' : 'Reference time';
      const device = language === 'de' ? 'EKG-Gerätezeit' : 'Recorder time';
      const status = compared ? (language === 'de' ? 'Abweichung 0 s' : 'difference 0 s') :
        (language === 'de' ? 'Kein Zeitvergleich mit dem EKG-Gerät eingetragen.' : 'No clock comparison with the recorder entered.');
      const pages = await extractPages(await buildPdf(session, [entry], language, generatedAt));
      assert.ok(pages.length >= 3);
      assert.ok(pages[0].text.some(item => item.str.includes(status)));
      for (const page of pages) {
        assert.ok(page.text.some(item => item.str === heading));
        assert.ok(!page.text.some(item => item.str === device));
        assert.deepEqual(page.links, [APP_URL, REPOSITORY_URL]);
        const timestamp = page.text.find(item => item.str === (language === 'de' ? '31.12.2030 23:57:00' : '2030-12-31 23:57:00'))!;
        const kind = page.text.find(item => item.str === (language === 'de' ? 'BESCHWERDEN' : 'SYMPTOMS'))!;
        assert.ok(timestamp.transform[4] + timestamp.width < kind.transform[4]);
        const noteHeading = page.text.find(item => item.str === (language === 'de' ? 'Tätigkeit / Beschwerden / Notizen' : 'Activity / symptoms / notes'))!;
        assert.ok(noteHeading.transform[4] < 300, 'single-clock layout gives notes more space');
      }
      assert.deepEqual(pages.flatMap(page => page.text.filter(item => /^Observation \d{3}$/.test(item.str)).map(item => item.str)), note.split('\n'));
      const txt = reportText(session, [entry], language, generatedAt);
      assert.ok(txt.includes(status));
      assert.ok(txt.includes(`${heading}: 2030-12-31 23:57:00 |`));
      assert.ok(!txt.includes(`${device}:`));
      const empty = await extractPages(await buildPdf(session, [], language, generatedAt));
      assert.ok(empty[0].text.some(item => item.str === (language === 'de' ? 'Keine Einträge vorhanden.' : 'No entries recorded.')));
      assert.equal(JSON.stringify({ session, entry }), original);
    }
  }
});

test('fractional nonzero comparisons retain the second column and an exact localized difference', async () => {
  for (const language of ['de', 'en'] as const) {
    for (const [captureOffset, reading, delta] of [[347, '2030-12-31T23:56:00', '-0.347'], [-347, '2030-12-31T23:56:00', '+0.347']] as const) {
      const session = newSession(start, { timeZone: 'Europe/Berlin', utcOffsetMinutes: 60 });
      session.calibration = calibrate(start + captureOffset, reading, session.clock);
      const entry = newEntry(session.id, start, 'note', 'Fractional example');
      const pages = await extractPages(await buildPdf(session, [entry], language, generatedAt));
      const strings = pages.flatMap(page => page.text.map(item => item.str));
      const expectedDelta = (language === 'de' ? delta.replace('.', ',') : delta) + ' s';
      assert.ok(strings.includes(language === 'de' ? 'EKG-Gerätezeit' : 'Recorder time'));
      assert.ok(strings.some(value => value.includes(expectedDelta)));
      const txt = reportText(session, [entry], language, generatedAt);
      assert.ok(txt.includes(expectedDelta));
      assert.ok(txt.includes(language === 'de' ? ' | EKG-Gerätezeit:' : ' | Recorder time:'));
    }
  }
});
