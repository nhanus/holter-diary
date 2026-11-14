# Implementation plan

## Goal

A minimal Android-friendly diary for a short Holter monitoring session. Record
activities and symptom times quickly, then print a clear report. The project
records the user's observations; it does not interpret ECG data.

## First version

- A short setup: optional name and date of birth, measurement start and optional monitor-clock calibration.
- A single main screen: timestamp, free-text note, Save, Symptoms now, recent entries and PDF.
- No required symptom categories, severity scales or activity questionnaires.
- Save a symptom marker immediately on tap; allow details later.
- Edit existing notes and backdate entries; protect against accidental deletion.
- German and English UI, initially following the device language (English fallback).
- Persist language choice; independent PDF language selection; never translate notes.
- Explicit dates and 24-hour times. Preserve phone timestamps and calibration.
- Local database and offline launch/export after verified initial setup.
- A4 PDF with supplied name/date of birth on every page, session period, time basis, ordered entries and monochrome symptom markers.

## Screen flow

1. **Setup once:** initialize the session, optionally compare monitor and phone
   date/time, request persistent storage and verify offline assets. Display the
   observed result of each check, including refusal or unsupported APIs.
2. **Ordinary entry:** open a fresh entry, capture its time, type freely, Save.
   Keep the captured time while typing. Preserve unsaved input on failure.
3. **Symptoms now:** persist a marker at the actual tap time, then optionally
   add text. Clearly acknowledge success or failure.
4. **History:** tap an entry to correct its text or time. Retain raw event time
   so a corrected calibration can update all displayed monitor times.
5. **PDF:** export anytime in DE or EN without ending or erasing the session.

On returning from the background, an empty fresh entry gets a current time;
an existing draft keeps its original event time. Saving and starting the next
entry must not silently reuse the previous timestamp. These transitions need
explicit browser tests.

## Delivery sequence

| Phase | Deliverable | Depends on |
| --- | --- | --- |
| Foundation | Plan, build baseline, CI and review process | — |
| Data model | Local persistence and monitor-time model | Foundation |
| Diary UI | Minimal mobile UI, DE/EN and editing | Data model |
| Offline app | Installation, offline assets and safe updates | Data model, Diary UI |
| Report | Local PDF export and print layout | Data model, Diary UI, Offline app |
| Validation | Integrated validation and reviewed release | All preceding phases |

The issue tracker owns live completion status. This table describes sequence,
not a second checklist to keep synchronized. CI tests grow with each feature.

## Implementation shape

- Plain TypeScript, HTML and CSS with Vite for reproducible static builds.
- Small modules for storage, time conversion, translations and PDF generation.
- IndexedDB with a versioned schema; no backend, ORM or UI framework.
- Web app manifest and service worker scoped to `/holter-diary/`.
- Bundle dependencies and fonts locally; add a PDF library only when needed.
- Node's test runner or a small compatible runner for model logic; Playwright
  Chromium for important browser workflows against the production build.

## Done for each feature

Use a short branch and a PR linked to its issue. Explain the user-visible result
and the relevant design choice, add focused tests, run CI and obtain an independent
review before merging. Record reviewer scope, findings and their resolution
in the PR, including limitations. Request re-review when fixes materially change
the reviewed behavior. Include unintended personal information in the review
scope. Merge after passing checks and resolving findings. Close issues only with
evidence.

## Release boundary

Prepare release automation after the diary works and passes release-readiness
review. Do not deploy from CI in this foundation. Pages eligibility and website
visibility must be checked separately from repository visibility. Real Android
storage permission and restart checks cannot be replaced by desktop
browser emulation; keep results pending until a tester supplies device evidence.
Printing belongs to the phone's PDF viewer; report layout remains in scope.
All documentation, discussions and artifacts must be suitable for public release,
using environment-neutral setup instructions and synthetic examples.

## Out of scope

Accounts, server databases, sync, automatic cloud backups, ECG/device integration,
medical analysis, dashboards, notifications, native Android packaging and protection
against device destruction. A single active measurement is enough; starting another
must not silently erase the previous data. Full multi-session management is deferred.
