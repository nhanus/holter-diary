# Holter Diary

A small diary for Holter monitoring: write a note, save, or mark symptoms with
one tap. German and English, local storage, offline use and printable A4 PDF/TXT
reports. No account, server database, analytics or external runtime assets.

**AI-developed project:** The project-specific implementation of this first
version was developed entirely with **OpenAI Codex**, guided by a human maintainer.
See [development transparency](#development-transparency).

**Status: beta.** See [releases](https://github.com/nhanus/holter-diary/releases)
for available versions and changes.

## Quick start

1. Start a diary. Your name, date of birth and a monitor-clock comparison are optional.
2. Type a note and save. **Symptoms now** immediately saves a timestamp; tap the
   resulting entry later to add details. Tap any entry to correct it or its time.
3. Open **Report**, choose the report language and download PDF or text.
   Open the PDF in your phone's viewer to print; sharing appears if supported.
4. Under **Settings → Offline & storage**, check the actual persistent-storage and offline status. If permission is denied, install the app, launch it from the home screen and check again. Installation can help; the browser still decides.
   On HTTPS, use the browser's **Install app / Add to Home screen** command.
   Open once online and wait for **Ready to use offline** before disconnecting.

A fresh note starts with the current time and refreshes on first typing if left
idle. Its time stays fixed while composing; **Change time** uses the clock named
in the field: phone time without a correction, monitor time with a correction.
A failed save keeps the draft and a failed symptom marker retains its original
time for retry. Unsaved drafts are not durable records: use Save before leaving.

## Kurz erklärt

1. **Tagebuch beginnen**; Name, Geburtsdatum und EKG-Zeitabgleich sind freiwillig.
2. Notiz eingeben und **Speichern**. **Beschwerden jetzt** speichert sofort
   die Uhrzeit. Einen Eintrag antippen, um Details oder die Zeit zu korrigieren.
3. **Protokoll**, Sprache wählen und PDF oder Text herunterladen.
   Das PDF anschließend im Dateibetrachter des Handys öffnen und drucken.
4. Unter **Einstellungen → Offline & Speicherung** die Speicherfreigabe und Offline-Bereitschaft prüfen. Bei fehlender Freigabe die App installieren, vom Startbildschirm öffnen und erneut prüfen. Die Installation kann helfen; die Entscheidung bleibt beim Browser.
   Über HTTPS im Browsermenü installieren und einmal mit Internet öffnen.

Gespeicherte Einträge bleiben normalerweise auch nach einem Handyneustart erhalten.
Ungespeicherte Entwürfe sind nicht dauerhaft gesichert. Das Löschen der Website-Daten
entfernt das Tagebuch.

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

`npm run build` produces the app-only release in `dist/`, with the diary at
`/holter-diary/app/` and compatibility worker/manifest at the parent path.
`npm run build:site` composes the bilingual website and app into `site-dist/`.
Preview the complete site with `npm run preview -- --dir site-dist`; open
`/holter-diary/`. Production website assembly copies the published app selected
in `website/app-release.json` without rebuilding it. See [hosting](docs/DEPLOYMENT.md).

CI checks types, unit tests, real Chromium storage transactions and production-app
flows, including offline PDF export and safe updates. Builds and failure evidence
are retained seven days. Main-branch automation publishes new app versions as GitHub Releases and
assembles the website with the selected published app. Website deployment uses a
separate, disabled-by-default manual workflow; see
[deployment and Android acceptance](docs/DEPLOYMENT.md). Test fixtures are excluded from the
production build. The browser tests are intentionally small and Chromium-focused;
they do not replace actual Android acceptance. Printing is handled by the phone's PDF viewer, not by the app.

## Development transparency

OpenAI Codex produced the project-specific application code, website, tests,
documentation and build/release workflows for the first version. The human
maintainer supplied requirements, made product and design decisions, provided
feedback and tested the app on an Android device. Existing third-party libraries
and tools retain their own authorship and licenses.

Reviews also used AI agents, including Astra, and automated Codex pull-request
reviews. These are AI reviews, not independent human code audits. Automated tests
and reported device checks are described in [validation](docs/VALIDATION.md);
this disclosure is not a claim that the software is error-free.

AI was used during development. The running diary does not use an AI model,
call an AI service or send diary entries to an AI provider.

## Project history and license

- [Plan](docs/PLAN.md), [decisions](docs/DECISIONS.md), [validation](docs/VALIDATION.md)
- [Issues](https://github.com/nhanus/holter-diary/issues) and pull requests record current implementation, review and evidence.
  Git history and versioned release files retain the earlier development record.
  Historical issue and pull request discussions were not imported; references in
  older commits belong to the previous tracker.
- [MIT](LICENSE). [Runtime dependency notices](public/THIRD_PARTY.txt) ship with the app.
  PDF.js is a development-only PDF validation dependency (Apache-2.0); it is not
  included in the application. Fonts used by the interface are system fonts.
