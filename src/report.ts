import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont, PDFPage } from 'pdf-lib';
import type { Entry, Language, Session } from './domain.ts';
import { assertEntry, requireValue } from './domain.ts';
import { assertConsistentCalibration, monitorTime, phoneTime } from './time.ts';

export const APP_URL = 'https://nhanus.github.io/holter-diary/';
export const REPOSITORY_URL = 'https://github.com/nhanus/holter-diary';

const labels = {
  en: { entries: 'Recorded entries', symptoms: 'Symptom markers', title: 'Holter monitoring diary', name: 'Name', start: 'Measurement start (reference)', last: 'Last entry (reference)', created: 'Report created (reference)',
    reference: 'Reference: event time based on the phone/computer clock, without clock adjustment.', fixedOffset: 'Fixed UTC offset for this measurement',
    missing: 'No clock comparison with the recorder entered.', equal: 'Recorded clock comparison: difference 0 s; one time column.',
    calculated: 'Calculated from the recorded clock comparison.', equation: 'Recorder time = reference time',
    phone: 'Reference time', time: 'Recorder time', kind: 'Event', note: 'Activity / symptoms / notes',
    symptom: 'SYMPTOMS', activity: 'Note', marker: 'Symptom time marked; no details recorded.', continued: '(continued)', page: 'Page',
    observation: 'Patient observations. Notes are reproduced without translation or medical interpretation.', empty: 'No entries recorded.' },
  de: { entries: 'Erfasste Einträge', symptoms: 'Beschwerdemarkierungen', title: 'Langzeit-EKG-Tagebuch', name: 'Name', start: 'Messbeginn (Referenz)', last: 'Letzter Eintrag (Referenz)', created: 'Bericht erstellt (Referenz)',
    reference: 'Referenz: Ereigniszeit auf Basis der Smartphone-/Computeruhr, ohne Zeitkorrektur.', fixedOffset: 'Fester UTC-Abstand dieser Messung',
    missing: 'Kein Zeitvergleich mit dem EKG-Gerät eingetragen.', equal: 'Eingetragener Zeitvergleich: Abweichung 0 s; eine Zeitspalte.',
    calculated: 'Aus dem eingetragenen Zeitvergleich berechnet.', equation: 'EKG-Gerätezeit = Referenzzeit',
    phone: 'Uhrzeit (Referenz)', time: 'EKG-Gerätezeit', kind: 'Ereignis', note: 'Tätigkeit / Beschwerden / Notizen',
    symptom: 'BESCHWERDEN', activity: 'Notiz', marker: 'Beschwerdezeit markiert; keine Details eingetragen.', continued: '(Fortsetzung)', page: 'Seite',
    observation: 'Persönliche Beobachtungen. Notizen werden ohne Übersetzung oder medizinische Bewertung wiedergegeben.', empty: 'Keine Einträge vorhanden.' },
};

function reportClock(session: Session, language: Language) {
  const l = labels[language];
  const { offsetMs, monitorReading } = session.calibration;
  const dual = offsetMs !== 0;
  const seconds = Math.abs(offsetMs / 1000);
  const delta = `${offsetMs < 0 ? '-' : '+'}${new Intl.NumberFormat(language, { maximumFractionDigits: 3, useGrouping: false }).format(seconds)} s`;
  const minutes = session.clock.utcOffsetMinutes;
  const utc = `UTC${minutes < 0 ? '-' : '+'}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, '0')}:${String(Math.abs(minutes) % 60).padStart(2, '0')}`;
  return { dual, reference: `${l.reference} ${l.fixedOffset}: ${utc}.`,
    status: dual ? `${l.equation} ${delta}. ${l.calculated}` : monitorReading === null ? l.missing : l.equal };
}

function dateTime(value: string, language: Language): string {
  const [isoDate, time] = value.split('T');
  const parts = /^([+-]?\d+)-(\d{2})-(\d{2})$/.exec(isoDate)!;
  const date = language === 'de' ? `${parts[3]}.${parts[2]}.${parts[1]}` : isoDate;
  return `${date} ${time}`;
}

export class UnsupportedCharactersError extends Error {
  readonly characters: string[];
  constructor(characters: string[]) {
    super('UNSUPPORTED_PDF_CHARACTERS');
    this.characters = characters;
  }
}

function sortedEntries(session: Session, entries: readonly Entry[]): Entry[] {
  assertConsistentCalibration(session);
  entries.forEach(x => { assertEntry(x); requireValue(x.sessionId === session.id); });
  return [...entries].sort((a, b) => a.eventAtMs - b.eventAtMs || a.id.localeCompare(b.id));
}

export function reportText(session: Session, entries: readonly Entry[], language: Language, generatedAt = Date.now()): string {
  const l = labels[language];
  const sorted = sortedEntries(session, entries);
  const clock = reportClock(session, language);
  const stamp = (at: number) => phoneTime(at, session).replace('T', ' ');
  const lines = [l.title, session.name ? `${l.name}: ${session.name}` : '', `${l.start}: ${stamp(session.startedAtMs)}`,
    sorted.length ? `${l.last}: ${stamp(sorted.at(-1)!.eventAtMs)}` : '', `${l.created}: ${stamp(generatedAt)}`,
    clock.reference, clock.status, l.observation, ''];
  for (const entry of sorted) lines.push(`${l.phone}: ${stamp(entry.eventAtMs)}${clock.dual ? ` | ${l.time}: ${monitorTime(entry.eventAtMs, session).replace('T', ' ')}` : ''} | ${entry.kind === 'symptom' ? l.symptom : l.activity}`, entry.note || l.marker, '');
  if (!sorted.length) lines.push(l.empty);
  return lines.join('\n');
}

function wrap(text: string, font: PDFFont, width: number, size: number): string[] {
  const result: string[] = [];
  for (const paragraph of text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').replaceAll('\t', '    ').split('\n')) {
    let line = '';
    // Prefer word boundaries; split oversized tokens without dropping characters.
    for (const token of paragraph.match(/\s+|\S+/g) ?? []) {
      if (line && !/^\s+$/.test(token) && font.widthOfTextAtSize(line + token, size) > width) {
        result.push(line); line = '';
      }
      for (const character of token) {
        if (line && font.widthOfTextAtSize(line + character, size) > width) { result.push(line); line = ''; }
        line += character;
      }
    }
    result.push(line);
  }
  return result;
}

export async function buildPdf(session: Session, entries: readonly Entry[], language: Language, generatedAt = Date.now()): Promise<Uint8Array> {
  const sorted = sortedEntries(session, entries);
  const l = labels[language];
  const clock = reportClock(session, language);
  const pdf = await PDFDocument.create();
  pdf.setTitle(l.title);
  pdf.setCreator('Holter Diary');
  pdf.setProducer('Holter Diary / pdf-lib');
  pdf.setCreationDate(new Date(generatedAt));
  pdf.setModificationDate(new Date(generatedAt));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const allowed = new Set(font.getCharacterSet());
  const unsupported = [...new Set([...reportText(session, sorted, language, generatedAt)]
    .filter(ch => !['\n', '\r', '\t'].includes(ch) && !allowed.has(ch.codePointAt(0)!)))];
  if (unsupported.length) throw new UnsupportedCharactersError(unsupported);

  const pageWidth = 595.28, pageHeight = 841.89, left = 40, right = pageWidth - left;
  const bottom = 82, lineHeight = 13;
  const columns = clock.dual ? [left, 155, 270, 360] : [left, 0, 155, 245];
  const textWidth = right - columns[3] - 8;
  const ink = rgb(0.12, 0.19, 0.18), muted = rgb(0.30, 0.37, 0.35);
  const teal = rgb(0.10, 0.30, 0.26), rule = rgb(0.79, 0.83, 0.81);
  let page!: PDFPage;
  let y = 0;
  const draw = (text: string, x: number, at: number, strong = false, size = 10, color = ink) =>
    page.drawText(text, { x, y: at, font: strong ? bold : font, size, color });
  function header(table: boolean) {
    page = pdf.addPage([pageWidth, pageHeight]);
    page.drawLine({ start: { x: left, y: pageHeight - 28 }, end: { x: right, y: pageHeight - 28 }, thickness: 3, color: teal });
    y = pageHeight - 59;
    draw(l.title, left, y, true, table ? 16 : 22, teal);
    draw('HOLTER DIARY', right - bold.widthOfTextAtSize('HOLTER DIARY', 8), pageHeight - 20, true, 8, muted);
    y -= 29;
    if (table) tableHead();
  }
  function tableHead() {
    page.drawRectangle({ x: left - 8, y: y - 8, width: right - left + 16, height: 25, color: teal });
    draw(l.phone, columns[0], y, true, 8.5, rgb(1, 1, 1));
    if (clock.dual) draw(l.time, columns[1], y, true, 8.5, rgb(1, 1, 1));
    draw(l.kind, columns[2], y, true, 8.5, rgb(1, 1, 1));
    draw(l.note, columns[3], y, true, 8.5, rgb(1, 1, 1));
    y -= 32;
  }
  function metadata(text: string, size = 9, strong = false) {
    for (const line of wrap(text, strong ? bold : font, right - left, size)) {
      if (y < bottom + 25) header(false);
      draw(line, left, y, strong, size, muted); y -= lineHeight;
    }
  }
  header(false);
  if (session.name) { metadata(`${l.name}: ${session.name}`, 11, true); y -= 5; }
  const stamp = (at: number) => dateTime(phoneTime(at, session), language);
  metadata(`${l.start}: ${stamp(session.startedAtMs)}`);
  if (sorted.length) metadata(`${l.last}: ${stamp(sorted.at(-1)!.eventAtMs)}`);
  metadata(`${l.created}: ${stamp(generatedAt)}`);
  metadata(clock.reference);
  metadata(clock.status, 9, true);
  y -= 10;
  if (y < bottom + 125) header(false);
  page.drawRectangle({ x: left - 8, y: y - 27, width: right - left + 16, height: 43, color: rgb(0.94, 0.96, 0.95) });
  draw(String(sorted.length), left + 8, y - 2, true, 18, teal);
  draw(l.entries, left + 8, y - 18, false, 9, muted);
  draw(String(sorted.filter(entry => entry.kind === 'symptom').length), 225, y - 2, true, 18, teal);
  draw(l.symptoms, 225, y - 18, false, 9, muted);
  y -= 47;
  metadata(l.observation, 8);
  y -= 15;
  if (y < bottom + 70) header(false);
  tableHead();
  if (!sorted.length) draw(l.empty, left, y);
  for (const entry of sorted) {
    const wall = monitorTime(entry.eventAtMs, session);
    const phoneWall = phoneTime(entry.eventAtMs, session);
    const lines = wrap(entry.note || l.marker, font, textWidth, 10);
    let offset = 0;
    while (offset < lines.length) {
      if (y < bottom + (offset ? 2 : 1) * lineHeight) header(true);
      const available = Math.max(1, Math.floor((y - bottom) / lineHeight));
      const chunk = lines.slice(offset, offset + available);
      const rowHeight = Math.max(chunk.length, offset ? 2 : 1) * lineHeight + 8;
      if (entry.kind === 'symptom') {
        page.drawRectangle({ x: left - 8, y: y - rowHeight + 11, width: right - left + 16, height: rowHeight - 2, color: rgb(0.97, 0.94, 0.90) });
        page.drawRectangle({ x: left - 8, y: y - rowHeight + 11, width: 3, height: rowHeight - 2, color: rgb(0.46, 0.29, 0.19) });
      }
      draw(dateTime(phoneWall, language), columns[0], y, !clock.dual, 10, clock.dual ? muted : ink);
      if (clock.dual) draw(dateTime(wall, language), columns[1], y, true, 10);
      draw(entry.kind === 'symptom' ? l.symptom : l.activity, columns[2], y, entry.kind === 'symptom', 8.5);
      if (offset) draw(l.continued, columns[2], y - lineHeight, false, 8, muted);
      for (const [i, line] of chunk.entries()) draw(line, columns[3], y - i * lineHeight);
      y -= rowHeight;
      page.drawLine({ start: { x: left, y: y + 10 }, end: { x: right, y: y + 10 }, thickness: 0.4, color: rule });
      offset += chunk.length;
    }
  }
  const pages = pdf.getPages();
  pages.forEach((item, i) => {
    item.drawLine({ start: { x: left, y: 57 }, end: { x: right, y: 57 }, thickness: 0.6, color: rule });
    item.drawText(`Holter Diary  |  ${l.page} ${i + 1} / ${pages.length}`, { x: right - 125, y: 32, size: 8, font, color: muted });
    const links = [{ label: 'App', url: APP_URL, y: 37 }, { label: 'GitHub', url: REPOSITORY_URL, y: 23 }];
    const annotations = links.map(({ label, url, y: at }) => {
      const text = `${label}: ${url}`;
      const width = font.widthOfTextAtSize(text, 8);
      item.drawText(text, { x: left, y: at, size: 8, font, color: muted });
      return pdf.context.register(pdf.context.obj({
        Type: 'Annot', Subtype: 'Link', Rect: [left, at - 2, left + width, at + 9], Border: [0, 0, 0],
        A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) },
      }));
    });
    item.node.set(PDFName.of('Annots'), pdf.context.obj(annotations));
  });
  return pdf.save();
}
