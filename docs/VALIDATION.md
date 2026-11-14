# Validation plan

## Current automated checks

- `npm ci` installs the committed dependency graph.
- `npm run check` type-checks the source.
- `npm run test:unit` tests the time model and storage-permission outcomes.
- `npm run build` produces static assets for `/holter-diary/`.
- `npm run test:browser` bundles a separate test fixture and runs actual Chromium
  IndexedDB checks: committed-data reload, aborted writes, immutable capture time,
  edit conflicts, schema refusal without deletion and durability fallback.
- GitHub Actions runs these checks on pushes and PRs, uploads `dist/` for seven
  days, and has read-only repository permissions. It does not deploy.
- An independent reviewer checks the code, workflow and plan; findings and fixes
  are recorded in the PR before merge.

The complete app is implemented. Automated tests exercise the production build;
real Android restart, installation and printer checks below remain pending.

- `npm run test:unit`: 21 tests covering fixed time, permission outcomes, actual
  PDF text extraction, A4 bounds, multipage continuation and Unicode fallback.
- `npm run test:browser`: 6 Chromium storage tests against a separate fixture.
- `npm run test:app`: 19 production mobile-browser tests for notes, markers,
  edits, failure recovery, conflicts, language, calibration, reset, offline reload
  and export, cache readiness/repair, explicit update adoption across tabs, export above a long history, timed confirmations and downloaded PDFs after setup, later clock corrections and resetting the correction.
- Patient details: all four name/birth-date combinations on every DE/EN PDF page and in TXT; leap dates, long names, legacy records, reload/edit/clear/reset, and unchanged existing entries. Missing fields and labels are omitted entirely.
- Missing comparisons and recorded zero differences each use one timestamp column with distinct explanations. Positive, negative and fractional nonzero differences use two. PDF/TXT, DE/EN, backdated events and empty reports are covered.
- Synthetic 24/48-hour diaries verify both dated phone and monitor timestamps and retain 49/97 short entries in 2/4 A4 pages.
- Synthetic German and English multipage reports with one reference clock or adjacent reference/recorder clocks were rendered for visual inspection. Tests also cover derived phone dates outside the monitor input year boundaries.
- Mobile layouts checked at 320, 393 and 768 CSS pixels, including enlarged text.
- Independent source review checked time, write acknowledgement, pending-marker
  recovery, same-tab settings changes, PDF output and service-worker lifecycle.
  Findings were resolved and consequential changes re-reviewed in the feature PR.

## Automated acceptance coverage

| Area | Required evidence |
| --- | --- |
| Time | Zero/positive/negative offset, midnight/date rollover, retroactive edits, corrected calibration, stable timezone and defined DST/clock-change behavior |
| Storage | Transaction success/failure, migration failure without data loss, reload retention, persistence granted/denied/unavailable, preserved draft on failure |
| Entry flow | Fresh timestamp, frozen draft timestamp, resume behavior, one-tap marker, correction, deletion protection, double-tap protection |
| Languages | DE/EN labels/errors, saved preference, English fallback, unchanged free text, 24-hour time |
| Offline | Install production worker online, verify assets, disconnect, relaunch, write/read, export PDF; `/holter-diary/` path and safe update |
| PDF | Correct time basis and order, optional name, both report languages, umlauts, supported Unicode, long notes and multiple pages, monochrome markers |
| Accessibility | Narrow viewport, large text, labels/focus, keyboard access and visible save/error feedback |

Run focused model tests plus Playwright Chromium tests against the production
build. Use synthetic data only in tests, screenshots, logs and artifacts. Add
failure traces/screenshots with short retention. Avoid a broad browser matrix or
an arbitrary coverage percentage. Tests must exercise behavior, not mirror code.

## Real-device acceptance (pending)

Record date, build SHA, Android version, browser version and observed results.
Desktop emulation cannot complete this checklist.

- [ ] Install on the Android home screen over HTTPS.
- [ ] Observe the actual persistent-storage permission result.
- [ ] Save entries, close the app, restart the phone normally, reopen and compare.
- [ ] Airplane mode: reopen, record an entry and generate a PDF.
- [ ] Compare sample monitor and phone times, including an entry across midnight.
- [ ] Read a long multi-page report in both languages; check umlauts and wrapping.
- [ ] Print a sample from the actual phone to the intended printer.

If persistence is denied, keep that status visible, investigate on the actual
browser and document the result; do not replace it with a fabricated green state.

## Evidence and release

Each feature PR records the relevant commands/results and independent review.
Issue #6 collects real-device evidence and the final CI run/commit. Keep untested
items marked pending and unresolved issues explicit. Prepare Pages deployment
after release-readiness review and maintainer approval.

Review repository files, examples, discussions, logs and artifacts for unintended
personal information. Setup instructions must be portable and examples synthetic.
When removing accidentally included private information, verify historical refs
and discussion revisions separately; editing the current files is insufficient.
