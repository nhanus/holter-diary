import './style.css';
import type { Entry, Language, Session } from './domain.ts';
import { newEntry } from './domain.ts';
import { openDiaryStore } from './storage.ts';
import type { DiaryStore } from './storage.ts';
import { calibrate, captureClock, eventTimeFromMonitor, monitorTime, newSession } from './time.ts';
import { detectLanguage, translate } from './i18n.ts';
import type { TextKey } from './i18n.ts';
import { basis, displayDate, displayTime } from './format.ts';
import { persistenceStatus } from './persistence.ts';
import type { PersistenceStatus } from './persistence.ts';
import { OfflineApp } from './offline.ts';
import { buildPdf, reportText, UnsupportedCharactersError } from './report.ts';

const root = document.querySelector<HTMLElement>('#app')!;
const esc = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const pulse = '<svg viewBox="0 0 40 32" fill="none" aria-hidden="true"><path d="M2 17h9l4-11 8 22 5-14 3 3h7" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const arrow = '<span aria-hidden="true">↗</span>';
let lang: Language = detectLanguage(navigator.languages);
let store: DiaryStore, session: Session | undefined, draft: Entry | undefined;
let entries: Entry[] = [];
let draftSessionRevision = 1;
let draftTimeInput: string | undefined;
let dirty = false, editing = false, invalidTime = false, busy = false, conflict = false;
let pendingMarker: { entry: Entry; revision: number; display: string } | undefined;
let setupDateOfBirth = '', settingsDateOfBirth = '';
let setupName = '', settingsName = '', sampleAt: number | null = null, reading = '';
let modal: 'settings' | 'export' | null = null;
let reportLanguage: Language = lang, reportFile: File | undefined;
let persistence: PersistenceStatus = 'not-granted';
let message: { key: TextKey; params?: Record<string, string | number>; error?: boolean } | undefined;
let messageTimer: number | undefined;
let loadError = false, applyingUpdate = false;
const offline = new OfflineApp(refreshStatus);
const t = (key: TextKey, params?: Record<string, string | number>) => translate(lang, key, params);
const text = (key: TextKey, params?: Record<string, string | number>) => esc(t(key, params));

function freshDraft(): void {
  if (!session) { draft = undefined; return; }
  draft = newEntry(session.id, Date.now(), 'note'); draftSessionRevision = session.revision;
  dirty = false; editing = false; invalidTime = false; draftTimeInput = undefined;
}
async function refreshData(): Promise<void> {
  session = (await store.sessions())[0];
  if (session) { const snapshot = await store.reportSnapshot(session.id); session = snapshot.session; entries = snapshot.entries; }
  else entries = [];
}
function notify(key: TextKey, error = false, params?: Record<string, string | number>): void {
  clearTimeout(messageTimer);
  const shown = { key, error, params };
  message = shown;
  refreshFeedback();
  if (!error) messageTimer = window.setTimeout(() => {
    if (message === shown) { message = undefined; refreshFeedback(); }
  }, 4000);
}
function refreshFeedback(): void {
  for (const [id, isError] of [['feedback', false], ['error', true], ['dialog-feedback', false], ['dialog-error', true]] as const) {
    const node = document.getElementById(id);
    if (node) { node.textContent = message && !!message.error === isError ? t(message.key, message.params) : ''; node.hidden = !node.textContent; }
  }
}
const persistenceKey = (): TextKey => ({ granted: 'grant', 'not-granted': 'notGranted', denied: 'denied', unavailable: 'unavailable', failed: 'failed' })[persistence] as TextKey;
const offlineKey = (): TextKey => ({ ready: 'offlineReady', checking: 'offlineChecking', failed: 'offlineFailed', unavailable: 'offlineUnavailable' })[offline.status] as TextKey;
function refreshStatus(): void {
  for (const node of document.querySelectorAll('[data-storage-status]')) node.textContent = t(persistenceKey());
  for (const node of document.querySelectorAll('[data-offline-status]')) node.textContent = t(offlineKey());
  const badge = document.querySelector('#offline-badge');
  if (badge) badge.textContent = !navigator.onLine ? t('connection') : offline.status === 'ready' ? t('offlineReady') : t('device');
  const update = document.querySelector<HTMLButtonElement>('#apply-update');
  if (update) update.hidden = !offline.registration?.waiting;
}
function problem(error: unknown, fallback: TextKey = 'writeFailed'): void {
  const code = error instanceof Error ? error.message : '';
  if (['EDIT_CONFLICT', 'SESSION_CHANGED', 'ENTRY_NOT_FOUND', 'SESSION_NOT_FOUND', 'SESSION_EXISTS'].includes(code)) { conflict = true; notify('conflict', true); }
  else if (['INVALID_MONITOR_TIME', 'INVALID_TIME', 'INVALID_CALIBRATION'].includes(code)) notify('invalidTime', true);
  else if (code === 'INVALID_BIRTH_DATE') notify('invalidBirthDate', true);
  else if (code === 'REPORT_IDENTITY_TOO_LONG') notify('identityTooLong', true);
  else if (error instanceof UnsupportedCharactersError) notify('pdfUnsupported', true, { characters: error.characters.slice(0, 16).join(' ') });
  else notify(fallback, true);
}
async function task(action: () => Promise<void>, fallback: TextKey = 'writeFailed'): Promise<void> {
  if (busy) return;
  busy = true;
  const focusTarget = document.activeElement?.id;
  document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('button,input,textarea,select').forEach(node => { node.disabled = true; });
  try { await action(); } catch (error) { problem(error, fallback); }
  finally { busy = false; render(focusTarget); }
}
function touchDraft(): void {
  if (!dirty && !editing) {
    draft!.eventAtMs = Date.now(); draft!.capturedAtMs = draft!.eventAtMs;
    const stamp = document.querySelector('.time-stamp');
    if (stamp) stamp.textContent = displayTime(draft!.eventAtMs, session!);
    const input = document.querySelector<HTMLInputElement>('#entry-time');
    if (input) input.value = monitorTime(draft!.eventAtMs, session!);
  }
  dirty = true;
  const actions = document.querySelector<HTMLElement>('.edit-actions');
  if (actions) actions.hidden = false;
}
function remember(entry: Entry): void {
  entries = [...entries.filter(x => x.id !== entry.id), entry].sort((a, b) => a.eventAtMs - b.eventAtMs || a.id.localeCompare(b.id));
}
function discardAllowed(): boolean { return !dirty || confirm(t('discardConfirm')); }
function birthDateField(id: string, value: string): string {
  return `<label for="${id}">${text('dateOfBirth')}</label><input id="${id}" type="date" autocomplete="bday" min="0001-01-01" max="9999-12-31" value="${esc(value)}">`;
}
function calibrationFields(): string {
  const clock = session?.clock ?? captureClock(sampleAt ?? Date.now());
  const phoneSession = newSession(sampleAt ?? Date.now(), clock);
  return `<details class="calibration" ${sampleAt !== null ? 'open' : ''}><summary>${text('calibration')}</summary>
    <p class="help">${text('calibrationHelp')}</p><button type="button" id="capture-time" class="secondary">${text('capture')}</button>
    ${sampleAt === null ? '' : `<p class="help sample">${text('captured', { time: monitorTime(sampleAt, phoneSession).replace('T', ' ') })}</p>
    <label for="monitor-reading">${text('monitorReading')}</label><input id="monitor-reading" type="datetime-local" step="1" value="${esc(reading)}" required>
    <p class="help">${text('minuteHint')}</p>`}</details>`;
}
function statusPanel(): string {
  return `<section class="status-panel"><h3>${text('storage')}</h3><p class="status-line" data-storage-status></p><p class="help">${text('storageHelp')}</p>
    <button type="button" class="secondary" id="check-storage">${text('retryStorage')}</button>
    <h3>${text('offline')}</h3><p class="status-line" data-offline-status></p><p class="help">${text('installHelp')}</p>
    <button type="button" class="secondary" id="retry-offline">${text('retryOffline')}</button>
    <button type="button" class="secondary" id="apply-update" hidden>${text('updateAction')}</button></section>`;
}
function renderDialog(): string {
  if (!modal || !session) return '';
  return `<dialog id="dialog" aria-labelledby="dialog-title"><div class="dialog-head"><h2 id="dialog-title">${text(modal === 'settings' ? 'settings' : 'export')}</h2>
    <button type="button" class="icon-button" id="close-dialog" aria-label="${text('close')}">×</button></div>
    <p id="dialog-feedback" class="feedback" role="status" hidden></p><p id="dialog-error" class="error" role="alert" hidden></p>
    ${modal === 'settings' ? `<form id="settings-form"><label for="settings-name">${text('name')}</label>
      <input id="settings-name" autocomplete="name" maxlength="120" value="${esc(settingsName)}">${birthDateField('settings-birth-date', settingsDateOfBirth)}
      <h3>${text('clock')}</h3><p class="help">${text('clockBasis', { basis: basis(session) })}</p><p class="help">${text('clockHelp')}</p>
      ${calibrationFields()}<button type="button" id="reset-clock" class="text-button">${text('resetClock')}</button>
      <button class="primary full" type="submit">${text('saveSettings')}</button></form>${statusPanel()}
      <section class="reset-section"><p class="help">${text('resetHelp')}</p><button class="text-button danger" id="reset-diary" type="button">${text('reset')}</button></section>` :
      `<p class="help">${text('exportHelp')}</p><label for="report-language">${text('reportLanguage')}</label>
      <select id="report-language"><option value="de" ${reportLanguage === 'de' ? 'selected' : ''}>Deutsch</option><option value="en" ${reportLanguage === 'en' ? 'selected' : ''}>English</option></select>
      <div class="export-actions"><button id="download-pdf" class="primary">${text('pdf')} ${arrow}</button>
      ${reportFile && typeof navigator.share === 'function' && navigator.canShare?.({ files: [reportFile] }) ? `<button id="share-pdf" class="secondary">${text('share')}</button>` : ''}
      <button id="download-text" class="secondary">${text('text')}</button></div>`}</dialog>`;
}
function render(focusTarget?: string): void {
  const focused = focusTarget ?? document.activeElement?.id;
  document.documentElement.lang = lang; document.title = 'Holter Diary';
  root.innerHTML = `<header class="topbar"><a class="brand" href="${import.meta.env.BASE_URL}" aria-label="Holter Diary">${pulse}<span>holter<span class="brand-light"> diary</span></span></a>
    <div class="header-controls"><label class="sr-only" for="language">${text('language')}</label><select id="language" class="language-select"><option value="de" ${lang === 'de' ? 'selected' : ''}>DE</option><option value="en" ${lang === 'en' ? 'selected' : ''}>EN</option></select>
    ${session ? `<button type="button" id="settings" class="icon-button" aria-label="${text('settings')}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 17h14M9 4v6m6 4v6"/></svg></button>` : ''}</div></header>
    ${pendingMarker ? `<div id="pending-marker" class="error"><p>${text('markerFailed')} <strong>${esc(pendingMarker.display)}</strong></p><button type="button" class="secondary" id="retry-marker" ${session?.id !== pendingMarker.entry.sessionId ? 'disabled' : ''}>${text('retryMarker')}</button><button type="button" class="text-button danger" id="discard-marker">${text('discardMarker')}</button></div>` : ''}
    ${conflict ? `<button type="button" class="secondary full" id="reload-data">${text('reload')}</button>` : ''}
    ${loadError ? `<main class="card"><h1>${text('loadFailed')}</h1><button class="primary" id="retry-load">${text('reload')}</button></main>` :
    !session ? `<main class="welcome"><span class="eyebrow">HOLTER DIARY</span><h1>${text('welcome')}</h1><p class="intro">${text('welcomeText')}</p>
      <form id="setup" class="card setup-card"><label for="setup-name">${text('name')}</label><input id="setup-name" autocomplete="name" maxlength="120" value="${esc(setupName)}">${birthDateField('setup-birth-date', setupDateOfBirth)}
      ${calibrationFields()}<button class="primary full" id="start-diary" type="submit">${text('start')} <span aria-hidden="true">→</span></button><p class="local-note">${text('localOnly')}</p></form>
      ${!isSecureContext ? `<p class="preview-note">${text('preview')}</p>` : ''}</main>` :
    `<main><section class="page-heading"><div><span class="eyebrow">${text('since', { date: displayDate(monitorTime(session.startedAtMs, session), lang) })}</span><h1>${text('today')}</h1></div>
      <span id="offline-badge" class="badge"></span></section>
    <button type="button" id="export" class="export-button" ${!entries.length ? 'disabled' : ''}>${text('export')} ${arrow}</button>
    <section class="symptom-section"><button class="symptom-button" id="mark-symptom">${pulse}<span>${text('symptoms')}</span><span aria-hidden="true">+</span></button><p>${text('symptomHint')}</p></section>


    <form id="entry-form" class="card composer"><div class="composer-head"><h2>${text(editing ? 'editing' : 'newNote')}</h2><span class="time-stamp">${displayTime(draft!.eventAtMs, session)}</span></div>
      <label class="sr-only" for="note">${text('note')}</label><textarea id="note" rows="4" placeholder="${text('placeholder')}">${esc(draft!.note)}</textarea>
      <details class="time-details" ${invalidTime ? 'open' : ''}><summary>${text('changeTime')}</summary><label for="entry-time">${text('time')}</label>
        <input id="entry-time" type="datetime-local" step="1" value="${esc(draftTimeInput ?? monitorTime(draft!.eventAtMs, session))}" aria-describedby="time-help"><p class="help" id="time-help">${text('timeHelp')}</p></details>
      <div class="composer-actions"><label class="check"><input id="entry-kind" type="checkbox" ${draft!.kind === 'symptom' ? 'checked' : ''}>${text('symptomsLabel')}</label>
        <button type="submit" id="save-entry" class="primary">${text('save')} <span aria-hidden="true">→</span></button></div>
      ${`<div class="edit-actions" ${!editing && !dirty ? 'hidden' : ''}><button type="button" id="cancel-edit" class="text-button">${text('cancel')}</button>${editing ? `<button type="button" id="delete-entry" class="text-button danger">${text('delete')}</button>` : ''}</div>`}</form>
    <section class="history"><div class="section-head"><h2>${text('entries')}</h2><span>${text('count', { count: entries.length })}</span></div>
      ${entries.length ? `<ol class="entries">${[...entries].reverse().map(entry => `<li class="entry ${entry.kind === 'symptom' ? 'is-symptom' : ''}"><button type="button" class="entry-button" data-entry="${esc(entry.id)}"><span class="sr-only">${text('edit')} · </span>
        <span class="entry-time"><strong>${displayTime(entry.eventAtMs, session!)}</strong><span>${esc(displayDate(monitorTime(entry.eventAtMs, session!), lang))}</span></span>
        <span class="entry-content">${entry.kind === 'symptom' ? `<span class="symptom-label">${text('symptomsLabel')}</span>` : ''}<span class="entry-note">${esc(entry.note || t('noDetails'))}</span></span><span class="edit-arrow" aria-hidden="true">↗</span></button></li>`).join('')}</ol>` :
        `<div class="empty-state"><span class="empty-line" aria-hidden="true">${pulse}</span><strong>${text('empty')}</strong><p>${text('emptyHelp')}</p></div>`}</section>
    <p class="footer-note" data-storage-status></p><p class="footer-note">${text('localOnly')}</p>${!isSecureContext ? `<p class="preview-note">${text('preview')}</p>` : ''}</main>`}
    <footer>${text('appInfo')}</footer>${renderDialog()}`;
  bind(); refreshStatus(); refreshFeedback();
  document.querySelector<HTMLDialogElement>('#dialog')?.showModal();
  if (focused && !['entry-time'].includes(focused)) (document.getElementById(focused) ?? document.getElementById(session ? 'settings' : 'setup-name'))?.focus({ preventScroll: true });
}
function on(id: string, action: () => void): void { document.getElementById(id)?.addEventListener('click', action); }
function bind(): void {
  document.querySelector<HTMLSelectElement>('#language')?.addEventListener('change', event => {
    const next = (event.target as HTMLSelectElement).value as Language;
    void task(async () => { await store.setPreferences({ schemaVersion: 1, id: 'preferences', language: next }); lang = next; });
  });
  document.querySelector<HTMLInputElement>('#setup-name')?.addEventListener('input', event => { setupName = (event.target as HTMLInputElement).value; });
  document.querySelector<HTMLInputElement>('#settings-name')?.addEventListener('input', event => { settingsName = (event.target as HTMLInputElement).value; });
  document.querySelector<HTMLInputElement>('#setup-birth-date')?.addEventListener('input', event => { setupDateOfBirth = (event.target as HTMLInputElement).value; });
  document.querySelector<HTMLInputElement>('#settings-birth-date')?.addEventListener('input', event => { settingsDateOfBirth = (event.target as HTMLInputElement).value; });
  document.querySelector<HTMLInputElement>('#monitor-reading')?.addEventListener('input', event => { reading = (event.target as HTMLInputElement).value; });
  on('capture-time', () => { sampleAt = Date.now(); reading = monitorTime(sampleAt, newSession(sampleAt, session?.clock ?? captureClock(sampleAt))); render(); });
  document.querySelector('#setup')?.addEventListener('submit', event => {
    event.preventDefault(); void task(async () => {
      const startedAt = Date.now(); const value = newSession(startedAt, captureClock(startedAt), setupName.trim());
      value.dateOfBirth = setupDateOfBirth;
      if (sampleAt !== null) value.calibration = calibrate(sampleAt, reading, value.clock);
      const permission = persistenceStatus(true);
      session = (await store.startSession(value)).value; entries = []; sampleAt = null; freshDraft();
      persistence = await permission; notify('saved');
    });
  });
  document.querySelector<HTMLTextAreaElement>('#note')?.addEventListener('input', event => { touchDraft(); draft!.note = (event.target as HTMLTextAreaElement).value; message = undefined; refreshFeedback(); });
  document.querySelector<HTMLInputElement>('#entry-kind')?.addEventListener('change', event => { touchDraft(); draft!.kind = (event.target as HTMLInputElement).checked ? 'symptom' : 'note'; });
  document.querySelector<HTMLInputElement>('#entry-time')?.addEventListener('input', event => {
    draftTimeInput = (event.target as HTMLInputElement).value;
    dirty = true;
    const actions = document.querySelector<HTMLElement>('.edit-actions');
    if (actions) actions.hidden = false;
    try {
      draft!.eventAtMs = eventTimeFromMonitor(draftTimeInput, session!); invalidTime = false;
      const stamp = document.querySelector('.time-stamp');
      if (stamp) stamp.textContent = displayTime(draft!.eventAtMs, session!);
    } catch { invalidTime = true; }
  });
  document.querySelector('#entry-form')?.addEventListener('submit', event => {
    event.preventDefault(); if (invalidTime) { notify('invalidTime', true); return; }
    if (!draft!.note.trim() && draft!.kind !== 'symptom') { notify('invalidNote', true); return; }
    void task(async () => {
      const saved = editing ? await store.updateEntry(draft!, draftSessionRevision) : await store.addEntry(draft!, draftSessionRevision);
      remember(saved.value); freshDraft(); conflict = false; notify('saved');
    });
  });
  on('mark-symptom', () => { if (pendingMarker || busy) return; const entry = newEntry(session!.id, Date.now(), 'symptom'); pendingMarker = { entry, revision: session!.revision, display: monitorTime(entry.eventAtMs, session!).replace('T', ' ') }; void saveMarker(); });
  on('retry-marker', () => void saveMarker());
  on('discard-marker', () => { if (confirm(t('discardMarkerConfirm'))) { pendingMarker = undefined; message = undefined; render(); } });
  on('cancel-edit', () => { if (discardAllowed()) { freshDraft(); conflict = false; message = undefined; render(); } });
  on('delete-entry', () => {
    if (!confirm(t('deleteConfirm'))) return;
    void task(async () => { await store.deleteEntry(draft!.id, draft!.revision); entries = entries.filter(x => x.id !== draft!.id); freshDraft(); notify('deleted'); });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-entry]').forEach(button => button.addEventListener('click', () => {
    if (!discardAllowed()) return;
    draft = structuredClone(entries.find(x => x.id === button.dataset.entry)!); draftSessionRevision = session!.revision;
    editing = true; dirty = false; invalidTime = false; draftTimeInput = undefined; message = undefined; render();
    document.querySelector<HTMLTextAreaElement>('#note')?.focus(); document.querySelector('#entry-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
  on('reload-data', () => { if (!discardAllowed()) return; void task(async () => { await refreshData(); freshDraft(); conflict = false; message = undefined; if (pendingMarker && session && pendingMarker.entry.sessionId === session.id) pendingMarker.revision = session.revision; }); });
  on('settings', () => { modal = 'settings'; settingsName = session!.name; settingsDateOfBirth = session!.dateOfBirth ?? ''; sampleAt = null; reading = ''; message = undefined; render(); });
  on('export', () => { modal = 'export'; reportLanguage = lang; reportFile = undefined; message = undefined; render(); });
  on('close-dialog', closeDialog);
  document.querySelector('#dialog')?.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
  on('check-storage', () => void task(async () => { persistence = await persistenceStatus(true); }));
  on('retry-offline', () => void offline.start());
  on('apply-update', () => { if ((dirty || pendingMarker) && !confirm(t('updateConfirm'))) return; applyingUpdate = true; offline.applyUpdate(); });
  on('reset-clock', () => { sampleAt = null; reading = 'reset'; notify('checkTimes'); render(); });
  document.querySelector('#settings-form')?.addEventListener('submit', event => {
    event.preventDefault(); void task(async () => {
      const value = structuredClone(session!); value.name = settingsName.trim(); value.dateOfBirth = settingsDateOfBirth;
      if (sampleAt !== null) value.calibration = calibrate(sampleAt, reading, value.clock);
      else if (reading === 'reset') value.calibration = { capturedAtMs: Date.now(), monitorReading: null, offsetMs: 0 };
      session = (await store.updateSession(value)).value;
      if (!dirty && !editing) freshDraft();
      else draftSessionRevision = session.revision;
      if (!invalidTime) draftTimeInput = undefined;
      if (pendingMarker?.entry.sessionId === session.id) pendingMarker.revision = session.revision;
      modal = null; sampleAt = null; notify('settingsSaved');
    });
  });
  on('reset-diary', () => {
    if (!confirm(t('resetConfirm'))) return;
    void task(async () => { await store.resetSession(session!.id, session!.revision); session = undefined; entries = []; draft = undefined; dirty = false; pendingMarker = undefined; setupName = ''; setupDateOfBirth = ''; settingsDateOfBirth = ''; sampleAt = null; modal = null; message = undefined; conflict = false; });
  });
  document.querySelector<HTMLSelectElement>('#report-language')?.addEventListener('change', event => { reportLanguage = (event.target as HTMLSelectElement).value as Language; reportFile = undefined; message = undefined; render(); });
  on('download-pdf', () => void task(async () => {
    const snapshot = await store.reportSnapshot(session!.id); const bytes = await buildPdf(snapshot.session, snapshot.entries, reportLanguage);
    reportFile = new File([new Uint8Array(bytes)], filename('pdf'), { type: 'application/pdf' }); download(reportFile); notify('exportReady');
  }, 'error'));
  on('download-text', () => void task(async () => {
    const snapshot = await store.reportSnapshot(session!.id);
    download(new File([reportText(snapshot.session, snapshot.entries, reportLanguage)], filename('txt'), { type: 'text/plain;charset=utf-8' }));
  }, 'error'));
  on('share-pdf', () => { if (reportFile) navigator.share({ files: [reportFile], title: 'Holter Diary' }).catch(error => { if (error?.name !== 'AbortError') { problem(error, 'error'); render(); } }); });
  on('retry-load', () => location.reload());
}
function closeDialog(): void { const trigger = modal === 'settings' ? 'settings' : 'export'; modal = null; sampleAt = null; message = undefined; render(trigger); }
async function saveMarker(): Promise<void> {
  if (!pendingMarker) return;
  await task(async () => { const saved = await store.addEntry(pendingMarker!.entry, pendingMarker!.revision); remember(saved.value); pendingMarker = undefined; notify('marked'); }, 'markerFailed');
}
function filename(extension: string): string { return `holter-diary-${monitorTime(session!.startedAtMs, session!).slice(0, 10)}.${extension}`; }
function download(file: File): void {
  const url = URL.createObjectURL(file); const link = document.createElement('a'); link.href = url; link.download = file.name;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
window.addEventListener('beforeunload', event => { if ((dirty || pendingMarker) && !applyingUpdate) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('online', refreshStatus); window.addEventListener('offline', refreshStatus);
document.addEventListener('visibilitychange', () => { if (!document.hidden && session && !dirty && !editing && !busy && !modal) { freshDraft(); render(); } });
async function init(): Promise<void> {
  try { store = await openDiaryStore(); const preferences = await store.preferences(); if (preferences) lang = preferences.language;
    await refreshData(); freshDraft(); persistence = await persistenceStatus(); } catch { loadError = true; }
  render(); void offline.start();
}
void init();
