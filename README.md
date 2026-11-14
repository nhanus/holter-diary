# Holter Diary

A small diary for Holter monitoring: write a note, save, or mark symptoms with
one tap. German and English, local storage, offline use and printable A4 PDF/TXT
reports. No account, server database, analytics or external runtime assets.

**Implementation complete; real Android installation and phone restart
acceptance remain pending.** There is no public deployment yet. See
[validation](docs/VALIDATION.md) and [release checklist](https://github.com/nhanus/holter-diary/issues/6).

## Quick start

1. Start a diary. Your name, date of birth and a monitor-clock comparison are optional.
2. Type a note and save. **Symptoms now** immediately saves a timestamp; tap the
   resulting entry later to add details. Tap any entry to correct it or its time.
3. Open **Export diary**, choose the report language and download PDF or text.
   Open the PDF in your phone's viewer to print; sharing appears if supported.
4. Under **App & storage**, check the actual persistent-storage and offline status.
   On HTTPS, use the browser's **Install app / Add to Home screen** command.
   Open once online and wait for **Ready to use offline** before disconnecting.

A fresh note starts with the current time and refreshes on first typing if left
idle. Its time stays fixed while composing; **Change time** accepts monitor time.
A failed save keeps the draft and a failed symptom marker retains its original
time for retry. Unsaved drafts are not durable records: use Save before leaving.

## Kurz erklärt

1. **Tagebuch beginnen**; Name, Geburtsdatum und EKG-Zeitabgleich sind freiwillig.
2. Notiz eingeben und **Eintrag speichern**. **Beschwerden jetzt** speichert sofort
   die Uhrzeit. Einen Eintrag antippen, um Details oder die Zeit zu korrigieren.
3. **Protokoll exportieren**, Sprache wählen und PDF oder Text herunterladen.
   Das PDF anschließend im Dateibetrachter des Handys öffnen und drucken.
4. Unter **App & Speicherung** die Speicherfreigabe und Offline-Bereitschaft prüfen.
   Über HTTPS im Browsermenü installieren und einmal mit Internet öffnen.

Gespeicherte Einträge bleiben normalerweise auch nach einem Handyneustart erhalten.
Ungespeicherte Entwürfe sind nicht dauerhaft gesichert. Das Löschen der Website-Daten
entfernt das Tagebuch. Der tatsächliche Handytest steht noch aus.

## Data and time

Diary data stays in IndexedDB on this browser origin. A save is acknowledged only
after transaction completion. The app requests strict durability where supported.
Persistent storage is a browser decision, not reserved disk space or a backup;
the app displays the observed result. A denied request does not prevent ordinary
IndexedDB saving. Offline readiness is verified separately against cached assets.

Clearing site data, using private browsing, changing browser/profile/origin or
losing the device can make the diary unavailable. A downloaded report is an
independent file. Starting a new diary requires confirmation and removes the old
session and entries while retaining your language preference.

The session uses the timezone offset recorded at start, plus an optional monitor
clock correction. A correction applies to every entry. Original capture instants
are retained. Automatic handling of clock drift or a clock change during recording
is outside this version; check and correct affected entries explicitly. Minute-only
monitor readings do not establish second-level accuracy.

PDFs use standard Helvetica with Western European characters, including German
umlauts. Unsupported characters (such as emoji) cause a clear message; they are
never silently dropped. The UTF-8 text export preserves all characters. Report
language changes labels only, never the written notes. This app records observations
and does not interpret ECG data.

Static hosting may log ordinary requests and IP addresses. The app never sends
diary content in requests, URLs or telemetry. Browser data is isolated by origin,
not repository path; unrelated untrusted apps should not share its hosting origin.

## Development

Use Node.js 24 and npm 12.2.0 or later in the npm 12 line. Follow the
[dependency policy](docs/DEPENDENCIES.md):

```sh
npm run deps:install
npm run test:policy
npm run check
npm run test:unit
npm run build
./node_modules/.bin/playwright install chromium
npm run test:browser
npm run test:app
npm run dev
```

`dist/` is the complete static app at `/holter-diary/`. `npm run preview` serves
it for inspection; use the address printed by Vite. HTTPS or browser localhost
is required for offline installation and storage-permission APIs. Ordinary HTTP
previews still support notes and exports and display the limitation.

CI checks types, unit tests, real Chromium storage transactions and production-app
flows, including offline PDF export and safe updates. Builds and failure evidence
are retained seven days. CI does not publish automatically. A separate, disabled-by-default manual workflow
is prepared; see [deployment and Android acceptance](docs/DEPLOYMENT.md). Test fixtures are excluded from the
production build. The browser tests are intentionally small and Chromium-focused;
they do not replace actual Android acceptance. Printing is handled by the phone's PDF viewer, not by the app.

## Project history and license

- [Plan](docs/PLAN.md), [decisions](docs/DECISIONS.md), [validation](docs/VALIDATION.md)
- [Issues](https://github.com/nhanus/holter-diary/issues) and pull requests record implementation, review and evidence.
- [MIT](LICENSE). [Runtime dependency notices](public/THIRD_PARTY.txt) ship with the app.
  PDF.js is a development-only PDF validation dependency (Apache-2.0); it is not
  included in the application. Fonts used by the interface are system fonts.
