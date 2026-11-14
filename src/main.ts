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
const updateIcon = '<svg class="update-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 16V8m-3 3 3-3 3 3"/></svg>';
const arrow = '<span aria-hidden="true">↓</span>';
let lang: Language = detectLanguage(navigator.languages);
let store: DiaryStore, session: Session | undefined, draft: Entry | undefined;
let entries: Entry[] = [];
let draftSessionRevision = 1;
let draftTimeInput: string | undefined;
let dirty = false, editing = false, invalidTime = false, busy = false, conflict = false;
let pendingMarker: { entry: Entry; revision: number; display: string } | undefined;
let setupDateOfBirth = '', settingsDateOfBirth = '';
let setupName = '', settingsName = '', sampleAt: number | null = null, reading = '';
let modal: 'settings' | 'export' | 'edit' | 'reset' | null = null;
let dialogTrigger = 'settings';
let suspendedDraft: { draft: Entry; revision: number; timeInput?: string; dirty: boolean; invalid: boolean } | undefined;
let lastMarkerId: string | undefined;
let revealMarker = false;
const openSections = new Set<string>();
let quickObserver: IntersectionObserver | undefined;

let reportLanguage: Language = lang, reportFile: File | undefined;
let persistence: PersistenceStatus = 'not-granted';
let storageCheck: 'idle' | 'checking' | 'done' = 'idle';
let message: { key: TextKey; params?: Record<string, string | number>; error?: boolean; section?: string } | undefined;
let messageTimer: number | undefined;
let loadError = false;
let nextFocus: string | undefined;
let feedbackSection: string | undefined;
let headerObserver: ResizeObserver | undefined;
const offline = new OfflineApp(refreshStatus);
const t = (key: TextKey, params?: Record<string, string | number>) => translate(lang, key, params);
const text = (key: TextKey, params?: Record<string, string | number>) => esc(t(key, params));

function updateDocumentLanguage(): void {
  document.documentElement.lang = lang;
  document.querySelector<HTMLMetaElement>('meta[name="description"]')!.content = t('welcomeText');
}

function freshDraft(): void {
  dirty = false; editing = false; invalidTime = false; draftTimeInput = undefined;
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
  const shown = { key, error, params, section: modal === 'settings' && !error ? feedbackSection : undefined };
  message = shown;
  refreshFeedback();
  requestAnimationFrame(() => {
    if (shown.section && document.activeElement === document.querySelector(`#${shown.section} > summary`)) return;
    if (message === shown) document.getElementById(modal === 'settings' && shown.section ? `${shown.section}-feedback` : `${modal ? 'dialog-' : ''}${shown.error ? 'error' : 'feedback'}`)?.scrollIntoView({ block: 'nearest' });
  });
  if (!error) messageTimer = window.setTimeout(() => {
    if (message === shown) { message = undefined; refreshFeedback(); }
  }, 4000);
}
function refreshFeedback(): void {
  for (const [id, isError] of [['feedback', false], ['error', true], ['dialog-feedback', false], ['dialog-error', true]] as const) {
    const node = document.getElementById(id);
    if (node) { node.textContent = message && !(modal === 'settings' && message.section) && !!message.error === isError ? t(message.key, message.params) : ''; node.hidden = !node.textContent; }
  }
  for (const node of document.querySelectorAll<HTMLElement>('[data-section-feedback]')) {
    node.textContent = message && message.section === node.dataset.sectionFeedback && !message.error ? t(message.key, message.params) : ''; node.hidden = !node.textContent;
  }
}
const persistenceKey = (): TextKey => ({ granted: 'grant', 'not-granted': 'notGranted', denied: 'denied', unavailable: 'unavailable', failed: 'failed' })[persistence] as TextKey;
const offlineKey = (): TextKey => ({ ready: 'offlineReady', checking: 'offlineChecking', failed: 'offlineFailed', unavailable: 'offlineUnavailable' })[offline.status] as TextKey;
function refreshStatus(): void {
  for (const node of document.querySelectorAll('[data-storage-status]')) node.textContent = t(persistenceKey());
  for (const node of document.querySelectorAll<HTMLElement>('[data-storage-check]')) {
    const message = storageCheck === 'checking' ? t('storageChecking') :
      storageCheck === 'done' ? t('storageChecked', { result: t(persistenceKey()) }) : '';
    if (node.textContent !== message) node.textContent = message;
  }
  const storageButton = document.querySelector<HTMLButtonElement>('#check-storage');
  if (storageButton) storageButton.disabled = busy || storageCheck === 'checking';
  for (const node of document.querySelectorAll('[data-offline-status]')) node.textContent = t(offlineKey());
  const badge = document.querySelector('#offline-badge');
  if (badge) badge.textContent = offline.status === 'ready' && !navigator.onLine ? t('offlineDisconnected') : t(offlineKey());
  const offlineAction = document.querySelector<HTMLElement>('#offline-action');
  if (offlineAction) offlineAction.hidden = offline.status !== 'failed';
  const waiting = offline.registration?.waiting?.state === 'installed';
  const applying = offline.updateStatus === 'applying';
  const blocked = hasUnsavedChanges();
  const failed = offline.updateStatus === 'failed';
  const updateState = applying ? 'applying' : failed ? 'failed' : waiting ? 'available' : 'none';
  const updateMessage = t(applying ? 'updateApplying' : failed ? 'updateFailedTitle' : waiting ? 'update' : 'updateNone');
  for (const id of ['update-announcement', 'dialog-update-announcement']) {
    const announcement = document.getElementById(id);
    const active = id === 'dialog-update-announcement' ? modal === 'settings' : !modal;
    const value = active && updateState !== 'none' ? updateMessage : '';
    if (announcement && announcement.textContent !== value) announcement.textContent = value;
  }
  const settingsButton = document.getElementById('settings');
  settingsButton?.setAttribute('aria-label', waiting ? `${t('settings')}, ${t('update')}` : t('settings'));
  const updateSection = document.getElementById('update-settings');
  if (updateSection) { updateSection.dataset.state = updateState; updateSection.setAttribute('aria-busy', String(applying)); }
  const sectionIcon = document.getElementById('update-section-icon');
  if (sectionIcon) sectionIcon.hidden = updateState === 'none';
  const notice = document.querySelector<HTMLElement>('#update-notice');
  if (notice) notice.hidden = !waiting;
  const backToNote = document.querySelector<HTMLElement>('#return-note');
  if (backToNote) backToNote.hidden = !waiting || !(dirty || pendingMarker);
  const identitySave = document.querySelector<HTMLButtonElement>('#save-identity');
  if (identitySave) identitySave.disabled = busy || !identityDirty();
  const clockSave = document.querySelector<HTMLButtonElement>('#save-clock');
  if (clockSave) clockSave.disabled = busy || !clockDirty();
  const impact = document.querySelector<HTMLElement>('#clock-impact');
  if (impact) impact.textContent = calibrationImpact();
  const update = document.querySelector<HTMLButtonElement>('#apply-update');
  if (update) { update.hidden = !waiting && !applying; update.disabled = busy || blocked || applying; update.textContent = t(applying ? 'updateApplying' : failed ? 'updateRetry' : 'updateAction'); }
  const close = document.querySelector<HTMLButtonElement>('#close-dialog');
  if (close) close.disabled = busy || applying;
  const updateHelp = document.querySelector<HTMLElement>('#update-help');
  if (updateHelp) { updateHelp.hidden = updateState === 'none'; updateHelp.textContent = t(failed ? 'updateFailed' : 'updateHelp'); }
  const updateBlocked = document.querySelector<HTMLElement>('#update-blocked');
  if (updateBlocked) updateBlocked.hidden = !waiting || !blocked;
  const updateStatus = document.querySelector<HTMLElement>('#update-status');
  if (updateStatus && updateStatus.textContent !== updateMessage) updateStatus.textContent = updateMessage;
  const retryOffline = document.querySelector<HTMLButtonElement>('#retry-offline');
  if (retryOffline) { retryOffline.hidden = offline.status !== 'failed'; retryOffline.disabled = busy; }
}
async function checkStorage(): Promise<void> {
  if (storageCheck === 'checking') return;
  storageCheck = 'checking'; refreshStatus();
  try { persistence = await persistenceStatus(true); }
  catch { persistence = 'failed'; }
  finally { storageCheck = 'done'; refreshStatus(); }
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
  busy = true; nextFocus = undefined;
  const focusTarget = document.activeElement?.id;
  feedbackSection = document.activeElement?.closest('.setting-section')?.id;
  document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('button,input,textarea,select').forEach(node => { node.disabled = true; });
  try { await action(); } catch (error) { problem(error, fallback); }
  finally { busy = false; render(nextFocus ?? focusTarget); }
}
function touchDraft(): void {
  if (!dirty && !editing) {
    draft!.eventAtMs = Date.now(); draft!.capturedAtMs = draft!.eventAtMs;
    const stamp = document.querySelector('.time-stamp');
    if (stamp) stamp.textContent = draftStamp();
    const input = document.querySelector<HTMLInputElement>('#entry-time');
    if (input) input.value = monitorTime(draft!.eventAtMs, session!);
  }
  dirty = true;
  const stamp = document.querySelector('.time-stamp');
  if (stamp) stamp.textContent = draftStamp();
  const actions = document.querySelector<HTMLElement>('.edit-actions');
  if (actions) actions.hidden = false;
}
function remember(entry: Entry): void {
  entries = [...entries.filter(x => x.id !== entry.id), entry].sort((a, b) => a.eventAtMs - b.eventAtMs || a.id.localeCompare(b.id));
}
function identityDirty(): boolean {
  return modal === 'settings' && !!session && (settingsName !== session.name || settingsDateOfBirth !== (session.dateOfBirth ?? ''));
}
function clockDirty(): boolean { return modal === 'settings' && !!session && (sampleAt !== null || reading === 'reset'); }
function settingsDirty(): boolean { return identityDirty() || clockDirty(); }
function hasUnsavedChanges(): boolean {
  return dirty || !!suspendedDraft?.dirty || !!pendingMarker || settingsDirty() || (!session && !!(setupName || setupDateOfBirth || sampleAt !== null || reading));
}
function discardAllowed(): boolean { return !dirty || confirm(t('discardConfirm')); }
function timeBasis(): TextKey { return session?.calibration.offsetMs ? 'time' : 'phoneClock'; }
function draftStamp(): string {
  return `${!dirty && !editing ? t('now') : `${displayDate(monitorTime(draft!.eventAtMs, session!), lang)} · ${displayTime(draft!.eventAtMs, session!)}`} · ${t(timeBasis())}`;
}
function calibrationImpact(): string {
  if (!session || !clockDirty()) return '';
  try {
    const seconds = reading === 'reset' ? 0 : calibrate(sampleAt!, reading, session.clock).offsetMs / 1000;
    return t('clockImpact', { seconds: `${seconds >= 0 ? '+' : ''}${seconds}`, count: entries.length });
  } catch { return t('invalidTime'); }
}
function languageSelect(): string {
  return `<label for="language">${text('language')}</label><select id="language"><option value="de" ${lang === 'de' ? 'selected' : ''}>Deutsch</option><option value="en" ${lang === 'en' ? 'selected' : ''}>English</option></select>`;
}
function section(id: string, title: TextKey, summary: string, body: string, extraClass = '', icon = ''): string {
  return `<details id="${id}" data-disclosure class="setting-section ${extraClass}" ${openSections.has(id) ? 'open' : ''}><summary>${icon}<span><strong>${text(title)}</strong><span class="section-summary">${summary}</span></span></summary><div class="setting-body">${body}<p id="${id}-feedback" data-section-feedback="${id}" class="feedback" role="status" hidden></p></div></details>`;
}
function feedbackMarkup(inDialog = false): string {
  return `<p id="${inDialog ? 'dialog-' : ''}feedback" class="feedback" role="status" hidden></p><p id="${inDialog ? 'dialog-' : ''}error" class="error" role="alert" hidden></p>${conflict ? `<button type="button" class="secondary full" id="reload-data">${text('reload')}</button>` : ''}`;
}
function birthDateField(id: string, value: string): string {
  return `<label for="${id}">${text('dateOfBirth')}</label><input id="${id}" type="date" autocomplete="bday" min="0001-01-01" max="9999-12-31" value="${esc(value)}">`;
}
function calibrationFields(inSettings = false): string {
  const clock = session?.clock ?? captureClock(sampleAt ?? Date.now());
  const phoneSession = newSession(sampleAt ?? Date.now(), clock);
  return `${inSettings ? '<div class="calibration">' : `<details id="setup-clock" data-disclosure class="calibration" ${openSections.has('setup-clock') || sampleAt !== null ? 'open' : ''}><summary>${text('calibration')}</summary>`}
    <p class="help">${text('calibrationHelp')}</p><button type="button" id="capture-time" class="secondary">${text('capture')}</button>
    ${sampleAt === null ? '' : `<p class="help sample">${text('captured', { time: monitorTime(sampleAt, phoneSession).replace('T', ' ') })}</p>
    <label for="monitor-reading">${text('monitorReading')}</label><input id="monitor-reading" type="datetime-local" step="1" value="${esc(reading)}" required>
    <p class="help">${text('minuteHint')}</p>`}${inSettings ? '</div>' : '</details>'}`;
}
function settingsPanel(): string {
  const offset = session?.calibration.offsetMs ?? 0;
  return `<p id="dialog-update-announcement" class="sr-only" role="status"></p><div class="settings-list">${session ? section('identity-settings', 'identitySection', esc(session.name || t('identitySummary')), `<form id="settings-form"><p class="help">${text('identityHelp')}</p><label for="settings-name">${text('name')}</label>
    <input id="settings-name" autocomplete="name" maxlength="120" value="${esc(settingsName)}">${birthDateField('settings-birth-date', settingsDateOfBirth)}
    <button class="primary full" id="save-identity" type="submit">${text('saveIdentity')}</button></form>`) +
    section('clock-settings', 'clockSection', offset ? text('clockOffset', { seconds: `${offset > 0 ? '+' : ''}${offset / 1000}` }) : text('noCorrection'), `<form id="clock-form"><p class="help">${text('clockBasis', { basis: basis(session) })}</p><p class="help">${text('clockHelp')}</p>
    ${calibrationFields(true)}<button type="button" id="reset-clock" class="text-button">${text('resetClock')}</button><p class="help" id="clock-impact"></p><button class="primary full" id="save-clock" type="submit">${text('saveClock')}</button></form>`, 'clock-settings') : ''}
    ${section('language-settings', 'language', lang === 'de' ? 'Deutsch' : 'English', languageSelect())}
    ${section('storage-settings', 'storageSection', '<span data-offline-status></span><span data-storage-status></span>', `<h3>${text('offline')}</h3><p class="status-line" data-offline-status></p><button type="button" class="secondary full" id="retry-offline" hidden>${text('retryOffline')}</button>
    <h3>${text('storageProtection')}</h3><p class="status-line" data-storage-status></p><p class="help">${text('storageHelp')}</p><button type="button" class="secondary full" id="check-storage">${text('retryStorage')}</button><p class="help" role="status" data-storage-check></p>
    <details id="install-help" data-disclosure class="app-details"><summary>${text('install')}</summary><p class="help">${text('installHelp')}</p></details>`)}
    ${section('update-settings', 'updates', `<span id="update-status"></span><span id="installed-version">${text('installedVersion', { version: __APP_VERSION__ })}</span>`, `<p class="help" id="update-help" hidden>${text('updateHelp')}</p><p class="warning" id="update-blocked" hidden>${text('updateBlocked')}</p><button type="button" class="secondary full" id="return-note" hidden>${text('returnNote')}</button><button type="button" class="primary full" id="apply-update" hidden>${text('updateAction')}</button>`, '', `<span id="update-section-icon" class="update-section-icon" aria-hidden="true" hidden>${updateIcon}</span>`)}
    </div>${session ? `<section class="reset-section"><button class="text-button danger" id="reset-diary" type="button">${text('reset')}</button><p class="help">${text('resetCount', { count: entries.length })}</p></section>` : ''}`;
}
function composer(): string {
  return `<form id="entry-form" class="card composer"><label for="note" class="composer-title">${text(editing ? 'editing' : 'newEntry')}</label>
    <textarea id="note" aria-label="${text('note')}" rows="3" placeholder="${text('placeholder')}">${esc(draft!.note)}</textarea>
    <div class="time-row"><span class="time-stamp">${esc(draftStamp())}</span></div>
    <details id="entry-time-details" data-disclosure class="time-details" ${invalidTime || openSections.has('entry-time-details') ? 'open' : ''}><summary>${text('changeTime')}</summary><label for="entry-time">${text(timeBasis())}</label>
      <input id="entry-time" type="datetime-local" step="1" value="${esc(draftTimeInput ?? monitorTime(draft!.eventAtMs, session!))}" aria-describedby="time-help"><p class="help" id="time-help">${text(session!.calibration.offsetMs ? 'timeHelp' : 'phoneTimeHelp')}</p></details>
    <div class="composer-actions"><label class="check"><input id="entry-kind" type="checkbox" ${draft!.kind === 'symptom' ? 'checked' : ''}>${text('symptomsLabel')}</label><button type="submit" id="save-entry" class="primary">${text(editing ? 'saveChanges' : 'save')}</button></div>
    <div class="edit-actions" ${!editing && !dirty ? 'hidden' : ''}><button type="button" id="cancel-edit" class="text-button">${text('cancel')}</button>${editing ? `<button type="button" id="delete-entry" class="text-button danger">${text('delete')}</button>` : ''}</div></form>`;
}
function renderDialog(): string {
  if (!modal) return '';
  const title: TextKey = modal === 'edit' ? 'editing' : modal === 'reset' ? 'resetTitle' : modal === 'settings' ? 'settings' : 'export';
  return `<dialog id="dialog" class="${modal === 'reset' ? 'confirmation-dialog' : 'screen-dialog'}" aria-labelledby="dialog-title"><div class="dialog-head"><button type="button" class="back-button" id="close-dialog" aria-label="${text('close')}"><span aria-hidden="true">←</span> ${text(modal === 'edit' || modal === 'reset' ? 'cancel' : 'back')}</button><span>${text(title)}</span></div><div class="dialog-body"><h1 id="dialog-title" tabindex="-1">${text(title)}</h1>
    ${feedbackMarkup(true)}${modal === 'settings' ? settingsPanel() : modal === 'edit' ? composer() : modal === 'reset' ? `<p class="help">${text('resetCount', { count: entries.length })}</p><button id="export-before-reset" class="secondary full" ${!entries.length ? 'disabled' : ''}>${text('export')}</button><button id="confirm-reset" class="danger full">${text('resetAction')}</button>` :
      `<p class="help">${text('exportSummary', { count: entries.length, date: displayDate(monitorTime(session!.startedAtMs, session!), lang) })}</p><div class="card"><p class="help">${text('exportHelp')}</p><label for="report-language">${text('reportLanguage')}</label>
      <select id="report-language"><option value="de" ${reportLanguage === 'de' ? 'selected' : ''}>Deutsch</option><option value="en" ${reportLanguage === 'en' ? 'selected' : ''}>English</option></select>
      <div class="export-actions"><button id="download-pdf" class="primary">${text('pdf')} ${arrow}</button>${reportFile && typeof navigator.share === 'function' && navigator.canShare?.({ files: [reportFile] }) ? `<button id="share-pdf" class="secondary">${text('share')}</button>` : ''}<button id="download-text" class="secondary">${text('text')}</button></div></div>`}</div></dialog>`;
}
function render(focusTarget?: string): void {
  const focused = focusTarget ?? document.activeElement?.id;
  const scroll = document.querySelector('#dialog')?.scrollTop ?? 0;
  for (const details of document.querySelectorAll<HTMLDetailsElement>('[data-disclosure]')) {
    if (details.open) openSections.add(details.id); else openSections.delete(details.id);
  }
  quickObserver?.disconnect(); headerObserver?.disconnect();
  updateDocumentLanguage(); document.title = 'Holter Diary';
  root.innerHTML = `<header class="topbar"><span class="brand">${pulse}<span>holter<span class="brand-light"> diary</span></span></span><button type="button" id="settings" class="settings-button" aria-label="${text('settings')}">${text('settings')}<span id="update-notice" aria-hidden="true" hidden>${updateIcon}</span></button></header>
    ${pendingMarker ? `<div id="pending-marker" class="error"><p>${text('markerFailed')} <strong>${esc(pendingMarker.display)}</strong></p><button type="button" class="secondary" id="retry-marker" ${session?.id !== pendingMarker.entry.sessionId ? 'disabled' : ''}>${text('retryMarker')}</button><button type="button" class="text-button danger" id="discard-marker">${text('discardMarker')}</button></div>` : ''}
    ${loadError ? `<main class="card"><h1>${text('loadFailed')}</h1><button class="primary" id="retry-load">${text('reload')}</button></main>` :
    !session ? `<main class="welcome"><h1>${text('newDiaryTitle')}</h1><p class="intro">${text('welcomeText')}</p><form id="setup" class="card setup-card"><p class="help">${text('optionalSetup')}</p>
      <details id="setup-identity" data-disclosure ${openSections.has('setup-identity') ? 'open' : ''}><summary>${text('identitySection')}</summary><label for="setup-name">${text('name')}</label><input id="setup-name" autocomplete="name" maxlength="120" value="${esc(setupName)}">${birthDateField('setup-birth-date', setupDateOfBirth)}</details>
      ${calibrationFields()}<button class="primary full" id="start-diary" type="submit">${text('start')}</button></form>${!modal ? feedbackMarkup() : ''}<p class="footer-note">${text('localOnly')}</p><p class="status-line" data-offline-status></p></main>` :
    `<main><section class="page-heading"><h1>${text('today')}</h1><span class="eyebrow">${text('since', { date: displayDate(monitorTime(session.startedAtMs, session), lang) })}</span></section><p id="offline-badge" class="badge"></p><button id="offline-action" class="text-button" hidden>${text('offlineAction')}</button>
    <button type="button" id="export" class="export-button" ${!entries.length ? 'disabled aria-describedby="empty-export"' : ''}>${text('export')} ${arrow}</button>${!entries.length ? `<p id="empty-export" class="help">${text('emptyExport')}</p>` : ''}
    <section class="symptom-section"><button class="symptom-button" id="mark-symptom"><span>${text('symptoms')}</span><span aria-hidden="true">+</span></button><p>${text('symptomHint')}</p></section>
    ${lastMarkerId && entries.some(e => e.id === lastMarkerId) ? `<div class="marker-receipt" role="status"><p>${text('markedAt', { time: displayTime(entries.find(e => e.id === lastMarkerId)!.eventAtMs, session) })}</p><button class="text-button" id="marker-details">${text('markerDetails')}</button></div>` : ''}
    ${editing ? '' : composer()}${!modal ? feedbackMarkup() : ''}
    <section class="history"><div class="section-head"><h2>${text('entries')}</h2><span>${text('count', { count: entries.length })}</span></div>
      ${entries.length ? `<ol class="entries">${[...entries].reverse().map(entry => `<li class="entry ${entry.kind === 'symptom' ? 'is-symptom' : ''}"><button type="button" id="entry-${esc(entry.id)}" class="entry-button" data-entry="${esc(entry.id)}"><span class="entry-time"><strong>${displayTime(entry.eventAtMs, session!)}</strong><span>${esc(displayDate(monitorTime(entry.eventAtMs, session!), lang))}</span></span><span class="entry-content">${entry.kind === 'symptom' ? `<span class="symptom-label">${text('symptomsLabel')}</span>` : ''}<span class="entry-note">${esc(entry.note || t('noDetails'))}</span><span class="edit-word">${text('edit')}</span></span></button></li>`).join('')}</ol>` : `<div class="empty-state"><strong>${text('empty')}</strong><p>${text('emptyHelp')}</p></div>`}</section><p class="footer-note">${text('localOnly')}</p></main>`}
    ${!isSecureContext ? `<p class="preview-note">${text('preview')}</p>` : ''}<footer>${text('appInfo')}</footer>${renderDialog()}
    ${session && !modal ? `<div id="quick-actions" hidden><button id="new-note" type="button">↑ ${text('newEntry')}</button><button id="quick-symptom" type="button">${text('symptoms')} +</button></div>` : ''}`;
  bind(); refreshStatus(); refreshFeedback();
  const dialog = document.querySelector<HTMLDialogElement>('#dialog');
  dialog?.showModal(); if (dialog) dialog.scrollTop = scroll;
  const header = document.querySelector<HTMLElement>(dialog ? '.dialog-head' : '.topbar');
  if (header) {
    const setPadding = () => { (dialog ?? document.documentElement).style.scrollPaddingTop = `${header.offsetHeight + 12}px`; };
    setPadding(); headerObserver = new ResizeObserver(setPadding); headerObserver.observe(header);
  }
  if (focused && focused !== 'entry-time') {
    let target = document.getElementById(focused) ?? document.getElementById(modal ? 'dialog-title' : 'note');
    const disabled = target?.matches(':disabled');
    if (disabled) target = target?.closest('.setting-section')?.querySelector<HTMLElement>(':scope > summary') ?? document.getElementById('dialog-title');
    if (target && (!modal || dialog?.contains(target))) { target.focus({ preventScroll: true }); if (disabled) target.scrollIntoView({ block: 'nearest' }); }
  }
  if (!modal && session) {
    const composer = document.querySelector('#entry-form');
    quickObserver = new IntersectionObserver(([entry]) => {
      const bar = document.querySelector<HTMLElement>('#quick-actions');
      if (bar) bar.hidden = entry.isIntersecting || entry.boundingClientRect.bottom > 0;
    });
    if (composer) quickObserver.observe(composer);
  }
  if (revealMarker) { document.querySelector('.marker-receipt')?.scrollIntoView({ block: 'nearest' }); revealMarker = false; }
}
function on(id: string, action: () => void): void { document.getElementById(id)?.addEventListener('click', action); }
function bind(): void {
  document.querySelector<HTMLSelectElement>('#language')?.addEventListener('change', event => {
    const next = (event.target as HTMLSelectElement).value as Language;
    void task(async () => { await store.setPreferences({ schemaVersion: 1, id: 'preferences', language: next }); lang = next; });
  });
  document.querySelector<HTMLInputElement>('#setup-name')?.addEventListener('input', event => { setupName = (event.target as HTMLInputElement).value; });
  document.querySelector<HTMLInputElement>('#settings-name')?.addEventListener('input', event => { settingsName = (event.target as HTMLInputElement).value; refreshStatus(); });
  document.querySelector<HTMLInputElement>('#setup-birth-date')?.addEventListener('input', event => { setupDateOfBirth = (event.target as HTMLInputElement).value; });
  document.querySelector<HTMLInputElement>('#settings-birth-date')?.addEventListener('input', event => { settingsDateOfBirth = (event.target as HTMLInputElement).value; refreshStatus(); });
  document.querySelector<HTMLInputElement>('#monitor-reading')?.addEventListener('input', event => { reading = (event.target as HTMLInputElement).value; refreshStatus(); });
  on('capture-time', () => { sampleAt = Date.now(); reading = monitorTime(sampleAt, newSession(sampleAt, session?.clock ?? captureClock(sampleAt))); render(); });
  document.querySelector('#setup')?.addEventListener('submit', event => {
    event.preventDefault(); void task(async () => {
      const startedAt = Date.now(); const value = newSession(startedAt, captureClock(startedAt), setupName.trim());
      value.dateOfBirth = setupDateOfBirth;
      if (sampleAt !== null) value.calibration = calibrate(sampleAt, reading, value.clock);
      const permission = persistenceStatus(true);
      session = (await store.startSession(value)).value; entries = []; sampleAt = null; reading = ''; openSections.clear(); freshDraft();
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
      if (stamp) stamp.textContent = draftStamp();
    } catch { invalidTime = true; }
  });
  document.querySelector('#entry-form')?.addEventListener('submit', event => {
    event.preventDefault(); if (invalidTime) { notify('invalidTime', true); return; }
    if (!draft!.note.trim() && draft!.kind !== 'symptom') { notify('invalidNote', true); return; }
    void task(async () => {
      const saved = editing ? await store.updateEntry(draft!, draftSessionRevision) : await store.addEntry(draft!, draftSessionRevision);
      remember(saved.value); if (editing) finishEdit(); else freshDraft(); conflict = false; lastMarkerId = undefined; notify('saved');
    });
  });
  const mark = () => { if (pendingMarker || busy) return; const entry = newEntry(session!.id, Date.now(), 'symptom'); pendingMarker = { entry, revision: session!.revision, display: monitorTime(entry.eventAtMs, session!).replace('T', ' ') }; void saveMarker(); };
  on('mark-symptom', mark); on('quick-symptom', mark);
  on('new-note', () => { document.querySelector('#entry-form')?.scrollIntoView({ block: 'center' }); document.querySelector<HTMLElement>('#note')?.focus({ preventScroll: true }); });
  on('marker-details', () => { if (lastMarkerId) openEditor(lastMarkerId); });
  on('retry-marker', () => void saveMarker());
  on('discard-marker', () => { if (confirm(t('discardMarkerConfirm'))) { pendingMarker = undefined; message = undefined; render(); } });
  on('cancel-edit', () => { if (editing) closeDialog(); else if (discardAllowed()) { freshDraft(); conflict = false; message = undefined; render('note'); } });
  on('delete-entry', () => {
    if (!confirm(t('deleteConfirm'))) return;
    void task(async () => { await store.deleteEntry(draft!.id, draft!.revision); entries = entries.filter(x => x.id !== draft!.id); lastMarkerId = undefined; finishEdit(); notify('deleted'); });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-entry]').forEach(button => button.addEventListener('click', () => openEditor(button.dataset.entry!)));
  on('reload-data', () => {
    if (hasUnsavedChanges() && !confirm(t('discardConfirm'))) return;
    void task(async () => { await refreshData(); suspendedDraft = undefined; modal = null; freshDraft(); conflict = false; message = undefined; sampleAt = null; reading = ''; if (pendingMarker && session && pendingMarker.entry.sessionId === session.id) pendingMarker.revision = session.revision; nextFocus = 'note'; });
  });
  on('settings', () => openSettings());
  on('offline-action', () => { openSettings(); const details = document.querySelector<HTMLDetailsElement>('#storage-settings'); if (details) { details.open = true; details.scrollIntoView({ block: 'start' }); } });
  on('export', openExport);
  on('close-dialog', closeDialog);
  document.querySelector('#dialog')?.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
  on('check-storage', () => void checkStorage());
  on('retry-offline', () => void offline.start());
  on('return-note', closeDialog);
  on('apply-update', () => { if (busy || hasUnsavedChanges()) { refreshStatus(); return; } offline.applyUpdate(); });
  on('reset-clock', () => { sampleAt = null; reading = 'reset'; render('reset-clock'); });
  document.querySelector('#settings-form')?.addEventListener('submit', event => {
    event.preventDefault(); void task(async () => {
      const value = structuredClone(session!); value.name = settingsName.trim(); value.dateOfBirth = settingsDateOfBirth;
      await updateSession(value); settingsName = session!.name; settingsDateOfBirth = session!.dateOfBirth ?? ''; notify('settingsSaved');
    });
  });
  document.querySelector('#clock-form')?.addEventListener('submit', event => {
    event.preventDefault(); void task(async () => {
      const value = structuredClone(session!);
      if (sampleAt !== null) value.calibration = calibrate(sampleAt, reading, value.clock);
      else if (reading === 'reset') value.calibration = { capturedAtMs: Date.now(), monitorReading: null, offsetMs: 0 };
      await updateSession(value); sampleAt = null; reading = ''; notify('settingsSaved');
    });
  });
  on('reset-diary', () => {
    if (settingsDirty() && !confirm(t('discardSettings'))) return;
    sampleAt = null; reading = ''; modal = 'reset'; message = undefined; render(); focusDialog();
  });
  on('export-before-reset', openExport);
  on('confirm-reset', () => void task(async () => {
    await store.resetSession(session!.id, session!.revision);
    session = undefined; entries = []; draft = undefined; suspendedDraft = undefined; dirty = false; editing = false; pendingMarker = undefined; lastMarkerId = undefined;
    setupName = ''; setupDateOfBirth = ''; settingsDateOfBirth = ''; sampleAt = null; reading = ''; modal = null; message = undefined; conflict = false; openSections.clear(); nextFocus = 'start-diary';
  }));
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
function focusDialog(): void {
  const dialog = document.querySelector<HTMLDialogElement>('#dialog');
  if (dialog) dialog.scrollTop = 0;
  document.querySelector<HTMLElement>('#dialog-title')?.focus({ preventScroll: true });
}
function openSettings(): void {
  if (busy) return;
  if (offline.registration?.waiting?.state === 'installed' || offline.updateStatus === 'failed') openSections.add('update-settings');
  modal = 'settings'; dialogTrigger = 'settings'; settingsName = session?.name ?? ''; settingsDateOfBirth = session?.dateOfBirth ?? '';
  if (session) { sampleAt = null; reading = ''; }
  message = undefined; render(); focusDialog(); void offline.verify();
}
function openExport(): void {
  modal = 'export'; dialogTrigger = 'export'; reportLanguage = lang; reportFile = undefined; message = undefined; render(); focusDialog();
}
function openEditor(id: string): void {
  if (busy || editing) return;
  const entry = entries.find(e => e.id === id);
  if (!entry || !draft) return;
  suspendedDraft = { draft, revision: draftSessionRevision, dirty, invalid: invalidTime, timeInput: draftTimeInput };
  draft = structuredClone(entry); draftSessionRevision = session!.revision; dirty = false; editing = true; invalidTime = false; draftTimeInput = undefined;
  openSections.delete('entry-time-details'); modal = 'edit'; dialogTrigger = `entry-${id}`; message = undefined; lastMarkerId = undefined; render(); focusDialog();
}
function finishEdit(): void {
  const saved = suspendedDraft;
  if (saved) { draft = saved.draft; draftSessionRevision = saved.revision; dirty = saved.dirty; invalidTime = saved.invalid; draftTimeInput = saved.timeInput; }
  else freshDraft();
  suspendedDraft = undefined; editing = false; modal = null; nextFocus = entries.some(entry => `entry-${entry.id}` === dialogTrigger) ? dialogTrigger : 'note';
}
async function updateSession(value: Session): Promise<void> {
  session = (await store.updateSession(value)).value;
  if (!dirty && !editing) freshDraft(); else draftSessionRevision = session.revision;
  if (!invalidTime) draftTimeInput = undefined;
  if (suspendedDraft) { suspendedDraft.revision = session.revision; if (!suspendedDraft.invalid) suspendedDraft.timeInput = undefined; }
  if (pendingMarker?.entry.sessionId === session.id) pendingMarker.revision = session.revision;
}
function closeDialog(): void {
  if (busy || offline.updateStatus === 'applying') return;
  if (settingsDirty() && !confirm(t('discardSettings'))) return;
  if (modal === 'edit') { if (!discardAllowed()) return; finishEdit(); }
  else if (modal === 'reset') { openSettings(); return; }
  else { if (modal === 'settings' && session) { sampleAt = null; reading = ''; } modal = null; }
  message = undefined; render(dialogTrigger);
}
async function saveMarker(): Promise<void> {
  if (!pendingMarker) return;
  await task(async () => { const saved = await store.addEntry(pendingMarker!.entry, pendingMarker!.revision); remember(saved.value); pendingMarker = undefined; lastMarkerId = saved.value.id; message = undefined; revealMarker = true; }, 'markerFailed');
}
function filename(extension: string): string { return `holter-diary-${monitorTime(session!.startedAtMs, session!).slice(0, 10)}.${extension}`; }
function download(file: File): void {
  const url = URL.createObjectURL(file); const link = document.createElement('a'); link.href = url; link.download = file.name;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
window.addEventListener('beforeunload', event => { if (hasUnsavedChanges() && offline.updateStatus !== 'applying') { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('online', refreshStatus); window.addEventListener('offline', refreshStatus);
document.addEventListener('visibilitychange', () => { if (!document.hidden && session && !dirty && !editing && !busy && !modal) { freshDraft(); render(); } });
async function init(): Promise<void> {
  try { store = await openDiaryStore(); const preferences = await store.preferences(); if (preferences) lang = preferences.language;
    const requestedLanguage = new URL(location.href).searchParams.get('lang');
    if (requestedLanguage === 'de' || requestedLanguage === 'en') {
      lang = requestedLanguage;
      if (preferences?.language !== lang) await store.setPreferences({ schemaVersion: 1, id: 'preferences', language: lang });
      const cleanUrl = new URL(location.href); cleanUrl.searchParams.delete('lang');
      history.replaceState(history.state, '', cleanUrl);
    }
    updateDocumentLanguage();
    await refreshData(); freshDraft(); persistence = await persistenceStatus(); } catch { loadError = true; }
  render(); void offline.start();
}
void init();
