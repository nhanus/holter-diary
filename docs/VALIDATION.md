# Validation plan

## Current automated checks

- `npm run deps:install` verifies the publication age and identity of every locked package, audits known vulnerabilities, and installs without lifecycle scripts.
- `npm run test:policy`: 11 dependency-free tests of the 14-day boundary, exact exceptions, registry/identity failures, optional dependencies and alternate lockfile rejection. CI runs these and the policy/audit checks before installing.
- `npm run check` type-checks the source.
- `npm run test:unit` tests the time model and storage-permission outcomes.
- `npm run build` produces app assets for `/holter-diary/app/` and root compatibility files.
- `npm run test:site` validates the composed website, locale links and offline separation.
- `npm run test:browser` bundles a separate test fixture and runs actual Chromium
  IndexedDB checks: committed-data reload, aborted writes, immutable capture time,
  edit conflicts, schema refusal without deletion and durability fallback.
- GitHub Actions runs these checks on pushes, PRs and a weekly schedule, uploads `dist/` for seven
  days, with read-only build permissions. A separate main-push release job can publish versioned app assets; a read-only website job composes the selected published app. It does not deploy on pushes, PRs or the schedule. The separate manual Pages
  workflow reuses CI before deployment; it requires explicit enablement.
- An independent reviewer checks the code, workflow and plan; findings and fixes
  are recorded in the PR before merge.

The complete app is implemented. Automated tests exercise the production build.
Device observations have been reported, but the reproducible real-device
acceptance record below is not complete.

- `npm run test:unit`: 23 tests covering fixed time, permission outcomes, actual
  PDF text extraction, A4 bounds, multipage continuation, Unicode fallback and update activation failures/timeouts.
- `npm run test:browser`: 6 Chromium storage tests against a separate fixture.
- `npm run test:app`: 32 production mobile-browser tests for notes, markers,
  edits, failure recovery, conflicts, language, calibration, reset, offline reload
  and export, cache readiness/repair, explicit update adoption across tabs, export above a long history, timed confirmations and downloaded PDFs after setup, later clock corrections and resetting the correction.
- Document language and localized description follow DE/EN selection and persisted preferences, including a delayed database open with a neutral loading shell. Repeated storage checks visibly report denial, API failure and grant without changing offline readiness or saved entries. Real persistence grants still require device checks. The translation prompt has stopped in reported device use; this is not an automated native-browser UI guarantee.
- Update adoption is blocked by unsaved notes, setup fields and pending symptom markers. Closing edited settings or an edited entry requires confirmation. Unified settings dialogs are checked at 320 pixels with enlarged text, visible focused controls and return focus. Translation opt-out metadata is asserted; native browser UI remains outside automated coverage.
- A separate editor retains the complete unfinished new note across save, failure, cancel and delete. Independent identity/time saves preserve the other section; aborted and stale writes stay retryable without overwriting committed data. Calibration changes only derived displays; invalid input remains editable. Conflict recovery after a reset in another tab clears discarded transient state. Long-list quick capture, connection versus offline readiness and explicit reset/export flows are covered.
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

## Real-device acceptance (record incomplete)

### Reported observations

Recorded on 2026-11-14: the maintainer reports installing and using the app on an
Android phone, seeing persistent-storage approval after installation, and applying
an app update with the installed version displayed. These observations support
the README's description of hands-on testing; they are not a completed acceptance
run. Android/browser versions and the exact build for each observation have not
been recorded. They do not establish every checklist item, every browser, the
latest release's full behavior, or WebAPK migration between launch paths.

### Outstanding acceptance record

Record date, build SHA, Android version, browser version and observed results.
Unchecked items below mean the reproducible acceptance record is outstanding,
not that no informal testing has occurred. Desktop emulation cannot complete
this checklist.

- [ ] Install on the Android home screen over HTTPS.
- [ ] Check the revised interface with the on-screen keyboard, large text and TalkBack.
- [ ] Check platform Back behavior; use the explicit app back/cancel control for the supported return path.
- [ ] Observe the actual persistent-storage permission result.
- [ ] Save entries, close the app, restart the phone normally, reopen and compare.
- [ ] Airplane mode: reopen, record an entry and generate a PDF.
- [ ] Compare sample monitor and phone times, including an entry across midnight.
- [ ] Read a long multi-page report in both languages; check umlauts and wrapping.

Printing is delegated to the phone's PDF viewer. A physical printer test is not a
project acceptance requirement; PDF layout, pagination and monochrome readability
remain covered by report validation.

If persistence is denied, keep that status visible, investigate on the actual
browser and document the result; do not replace it with a fabricated green state.

## Evidence and release

Each feature PR records the relevant commands/results and independent review.
The [release-readiness issue](https://github.com/nhanus/holter-diary/issues/2) collects
real-device evidence and the final CI run/commit. Keep untested
items marked pending and unresolved issues explicit. The manual Pages workflow is prepared but remains disabled until maintainer
approval and hosting configuration. See [deployment](DEPLOYMENT.md).

Review repository files, examples, discussions, logs and artifacts for unintended
personal information. Setup instructions must be portable and examples synthetic.
When removing accidentally included private information, verify historical refs
and discussion revisions separately; editing the current files is insufficient.

## Website separation validation

The separation change passes 94 automated checks: 11 dependency-policy tests,
14 release/selection tests, 23 unit tests, 6 browser-storage tests, 35 app tests
and 5 website tests. Type checking, workflow lint, locked dependency age checks
and the vulnerability audit also pass. No dependencies were added.

A separate Chromium transition exercise used the actual published beta.1 archive:
saved records and raw timestamps survived adoption, both tabs' drafts remained
protected, the old start URL reopened the new diary offline, old hashed assets
remained available, and PDF export worked. Standalone launch was simulated;
physical Android/WebAPK migration still requires device acceptance.

## Direct capture regression coverage

Ten additional production-app tests exercise stable action coordinates on focus
and first input, retained textarea identity/selection, constant spacing through
bidirectional scrolling, manual time changes, editor actions, header layering
and settings access. The matrix covers 320/393 CSS pixels, normal/150% root text,
layout resizing and a simulated visual viewport overlay. Scroll-only events and
unchanged viewport sizes must not pull the page back to the focused note.
A wider-font regression also verifies that the first full timestamp does not
add a line and move Save.

Existing failure/retry, suspended draft, time calibration, offline/PDF and update
protection tests remain applicable. Native keyboards and nonzero viewport panning
require device validation; the synthetic overlay uses a zero vertical offset.

## Clock-difference presentation

Formatter coverage includes both languages, positive/negative offsets, exact zero,
subsecond differences, minute/hour rounding carries and durations over 24 hours.
Production browser tests verify the saved and pending displays, reload, reset,
unchanged precise calibration values and original entry records. Report access
is checked at 320/393 CSS pixels with normal and 150% text. Existing report and
update tests continue to verify the underlying calculations and stored diaries.
# Validated review follow-up (0.1.0-beta.5)

Regression coverage for the validated review follow-up:

- Reset counts and exports entries saved in another tab before opening. Inserts,
  edits, deletions and replacements after opening prevent deletion, preserve the
  local draft and require fresh confirmation.
- Distinct synthetic app versions exercise late activation, settings edited during
  activation and activation in another tab. Verify guarded reload, installed
  version, retained records, offline restart and the unsaved-input unload guard.
- Draft release retries recover incomplete starter assets, retain completed
  assets, and fail safely on cleanup errors or invalid asset identifiers.
- Existing settings-draft update guards and the full app/storage/report/website
  suites remain required. Browser emulation does not establish physical Android
  validation.

GitHub workflow validation checks the main-push queue before the reusable build
pipeline and the separate publication queue. The main-only wrapper retains one
main-push pipeline; CI itself handles PRs, manual/scheduled and reusable calls. Older
Actionlint versions report `queue` as unknown (upstream issue
[rhysd/actionlint#657](https://github.com/rhysd/actionlint/issues/657)); when using
such a version, exclude only that known diagnostic and retain all other checks.
PR CI and completed automated review of the final head remain merge requirements.

## Website FAQ help

The DE/EN update walkthrough uses semantic numbered lists. Browser tests at 320px
with 150% text verify reading without horizontal overflow, keyboard disclosure
operation, repeated activation of the same update shortcut, retained legacy
fragments and language switching. Website composition still preserves the app,
manifest and worker bytes. Native pull-to-refresh and Android task-switcher
gestures are browser/device behavior and are not claimed as emulated validation.

## Website captures of the selected app

The DE/EN landing-page images were captured from the unchanged published
0.1.0-beta.5 app using a fresh Chromium profile and fictional entries. Visually
check actual button order and labels against the captures. Website tests check
both images load, full-size links, text alternatives and no horizontal overflow
at 320px. The image itself has fixed text sizes; the full-size link provides a
larger view. Release assembly tests verify website image copying
and unchanged app bytes. Desktop captures do not establish physical-device
keyboard or installation behavior.
