import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont, PDFPage } from 'pdf-lib';
import type { Entry, Language, Session } from './domain.ts';
import { assertEntry, requireValue } from './domain.ts';
import { assertConsistentCalibration, monitorTime } from './time.ts';
import { basis, displayDate } from './format.ts';

const labels = {
  en: { title: 'Holter monitoring diary', name: 'Name', start: 'Measurement start', last: 'Last entry', created: 'Report created (monitor time)',
    basis: 'Time basis: fixed UTC offset; monitor correction', time: 'Date / monitor time', kind: 'Event', note: 'Activity / symptoms / notes',
    symptom: 'SYMPTOMS', activity: 'Note', marker: 'Symptom time marked; no details recorded.', continued: '(continued)', page: 'Page',
    observation: 'Patient observations. Notes are reproduced without translation or medical interpretation.', empty: 'No entries recorded.' },
  de: { title: 'Langzeit-EKG-Tagebuch', name: 'Name', start: 'Messbeginn', last: 'Letzter Eintrag', created: 'Bericht erstellt (EKG-Zeit)',
    basis: 'Zeitbasis: fester UTC-Abstand; EKG-Korrektur', time: 'Datum / EKG-Zeit', kind: 'Ereignis', note: 'Tätigkeit / Beschwerden / Notizen',
    symptom: 'BESCHWERDEN', activity: 'Notiz', marker: 'Beschwerdezeit markiert; keine Details eingetragen.', continued: '(Fortsetzung)', page: 'Seite',
    observation: 'Persönliche Beobachtungen. Notizen werden ohne Übersetzung oder medizinische Bewertung wiedergegeben.', empty: 'Keine Einträge vorhanden.' },
};

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
  const stamp = (at: number) => monitorTime(at, session).replace('T', ' ');
  const lines = [l.title, session.name ? `${l.name}: ${session.name}` : '', `${l.start}: ${stamp(session.startedAtMs)}`,
    sorted.length ? `${l.last}: ${stamp(sorted.at(-1)!.eventAtMs)}` : '', `${l.created}: ${stamp(generatedAt)}`,
    `${l.basis}: ${basis(session)}`, l.observation, ''];
  for (const entry of sorted) lines.push(`${stamp(entry.eventAtMs)} | ${entry.kind === 'symptom' ? l.symptom : l.activity}`, entry.note || l.marker, '');
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

  const pageWidth = 595.28, pageHeight = 841.89, left = 40, bottom = 55, lineHeight = 14;
  const columns = [left, 166, 262];
  const textWidth = pageWidth - left - columns[2];
  let page!: PDFPage;
  let y = 0;
  const draw = (text: string, x: number, at: number, strong = false, size = 10) =>
    page.drawText(text, { x, y: at, font: strong ? bold : font, size, color: rgb(0.08, 0.1, 0.1) });
  function header(table: boolean) {
    page = pdf.addPage([pageWidth, pageHeight]);
    y = pageHeight - 45;
    draw(l.title, left, y, true, 17);
    y -= 25;
    if (table) tableHead();
  }
  function tableHead() {
    page.drawRectangle({ x: left - 4, y: y - 7, width: pageWidth - 2 * left + 8, height: 24, color: rgb(0.92, 0.94, 0.94) });
    draw(l.time, columns[0], y, true, 9);
    draw(l.kind, columns[1], y, true, 9);
    draw(l.note, columns[2], y, true, 9);
    y -= 29;
  }
  function metadata(text: string) {
    for (const line of wrap(text, font, pageWidth - 2 * left, 10)) {
      if (y < bottom + 25) header(false);
      draw(line, left, y); y -= lineHeight;
    }
  }
  header(false);
  if (session.name) metadata(`${l.name}: ${session.name}`);
  const stamp = (at: number) => { const wall = monitorTime(at, session); return `${displayDate(wall, language)}, ${wall.slice(11)}`; };
  metadata(`${l.start}: ${stamp(session.startedAtMs)}`);
  if (sorted.length) metadata(`${l.last}: ${stamp(sorted.at(-1)!.eventAtMs)}`);
  metadata(`${l.created}: ${stamp(generatedAt)}`);
  metadata(`${l.basis}: ${basis(session)}`);
  y -= 7; metadata(l.observation); y -= 12;
  if (y < bottom + 70) header(false);
  tableHead();
  if (!sorted.length) draw(l.empty, left, y);
  for (const entry of sorted) {
    const wall = monitorTime(entry.eventAtMs, session);
    const lines = wrap(entry.note || l.marker, font, textWidth - 5, 10);
    let offset = 0;
    while (offset < lines.length) {
      if (y < bottom + 3 * lineHeight) header(true);
      const available = Math.max(1, Math.floor((y - bottom - 15) / lineHeight));
      const chunk = lines.slice(offset, offset + available);
      draw(displayDate(wall, language), columns[0], y, false, 9);
      draw(wall.slice(11), columns[0], y - lineHeight, true, 10);
      draw(entry.kind === 'symptom' ? l.symptom : l.activity, columns[1], y, entry.kind === 'symptom', 9);
      if (offset) draw(l.continued, columns[1], y - lineHeight, false, 8);
      for (const [i, line] of chunk.entries()) draw(line, columns[2], y - i * lineHeight);
      y -= Math.max(chunk.length, 2) * lineHeight + 12;
      page.drawLine({ start: { x: left, y: y + 13 }, end: { x: pageWidth - left, y: y + 13 }, thickness: 0.4, color: rgb(0.72, 0.75, 0.75) });
      offset += chunk.length;
    }
  }
  const pages = pdf.getPages();
  pages.forEach((item, i) => {
    item.drawText(`Holter Diary  |  ${l.page} ${i + 1} / ${pages.length}`, { x: left, y: 27, size: 8, font, color: rgb(0.35, 0.38, 0.38) });
  });
  return pdf.save();
}
