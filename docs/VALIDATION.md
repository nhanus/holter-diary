# Validation plan

## Foundation (current)

- `npm ci` installs the committed dependency graph.
- `npm run check` type-checks the source.
- `npm run build` produces static assets for `/holter-diary/`.
- GitHub Actions runs these checks on pushes and PRs, uploads `dist/` for seven
  days, and has read-only repository permissions. It does not deploy.
- An independent reviewer checks the code, workflow and plan; findings and fixes
  are recorded in the PR before merge.

There are no feature tests yet. A passing baseline build does **not** validate
storage, time conversion, offline behavior or PDF output.

## Automated acceptance (add with features)

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
