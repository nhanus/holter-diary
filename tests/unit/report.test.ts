import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { newEntry } from '../../src/domain.ts';
import { APP_URL, REPOSITORY_URL, buildPdf, reportText, UnsupportedCharactersError } from '../../src/report.ts';
import { calibrate, newSession } from '../../src/time.ts';

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
  assert.ok(strings.includes('Messbeginn: 31. Dez. 2030, 23:58:00'));
  assert.ok(strings.includes('Letzter Eintrag: 01. Jan. 2031, 00:00:00'));
  assert.ok(strings.includes('Bericht erstellt (EKG-Zeit): 01. Jan. 2031, 00:02:00'));
  assert.ok(strings.some(text => text.endsWith('UTC+01:00; +120 s')));
  assert.deepEqual(strings.slice(strings.indexOf('31.12.2030'), strings.findIndex(text => text.startsWith('Holter Diary |'))), [
    '31.12.2030', '23:59:00', 'Notiz', note.note,
    '01.01.2031', '00:00:00', 'BESCHWERDEN', 'Beschwerdezeit markiert; keine Details eingetragen.',
  ]);
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
    assert.ok(strings.includes('Date'));
    assert.ok(strings.includes('Monitor time'));
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
  assert.ok(fallback.endsWith(`2030-12-31 23:59:00 | BESCHWERDEN\n${note}\n`));
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
        const dateHeading = text.find(item => item.str === (language === 'de' ? 'Datum' : 'Date'))!;
        const timeHeading = text.find(item => item.str === (language === 'de' ? 'EKG-Zeit' : 'Monitor time'))!;
        assert.ok(dateHeading && timeHeading);
        for (const note of text.filter(item => /^Synthetic observation \d{3}$/.test(item.str))) {
          const index = Number(note.str.slice(-3));
          // Independent reference arithmetic, without monitorTime() or renderer helpers.
          const expected = new Date(at + index * 30 * 60_000 + 63 * 60_000).toISOString();
          const date = text.find(item => item.transform[4] === dateHeading.transform[4] && item.transform[5] === note.transform[5])!;
          const time = text.find(item => item.transform[4] === timeHeading.transform[4] && item.transform[5] === note.transform[5])!;
          assert.equal(date.str, language === 'de' ? `${expected.slice(8, 10)}.${expected.slice(5, 7)}.${expected.slice(0, 4)}` : expected.slice(0, 10));
          assert.equal(time.str, expected.slice(11, 19));
          assert.ok(note.height >= 9.9 && time.height >= 9.9, 'body text remains at least 10pt');
          assert.ok(note.transform[5] > 82 && note.transform[5] + note.height < dateHeading.transform[5]);
          observed.push(note.str);
        }
      }
      assert.deepEqual(observed, entries.map(entry => entry.note));
    }
  }
});
