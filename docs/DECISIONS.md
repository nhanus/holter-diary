# Decision log

Keep this short. Add a dated entry only when a choice affects behavior, reliability
or maintenance. PRs retain implementation details and review evidence.

## 2026-11-14 — Static, local-first web app

**Choice:** An installable static app, local IndexedDB and local PDF generation.
Use GitHub Pages for a reviewed release. No server-side diary storage.

**Why:** A short monitoring session needs quick capture and a printable report.
Local storage keeps the tool small; a backend or native package adds maintenance.

**Consequences:** Closing the browser or normal phone restart should retain saved
records. Persistent storage is requested with `persist()` and checked with
`persisted()`; it is a permission, not reserved disk space or a backup. Refusal
must remain visible. Explicit site-data deletion removes records. Use transaction
completion for save acknowledgements and request strict durability where supported.
Offline availability must be verified independently.

References: [Storage Standard](https://storage.spec.whatwg.org/),
[persistent storage](https://web.dev/articles/persistent-storage),
[transaction durability](https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/transaction).

## 2026-11-14 — Small build, no UI framework

**Choice:** TypeScript, Vite, plain DOM/CSS and a committed npm lockfile. Node 24.

**Why:** Type checking helps protect the time and storage model; a build bundles
the later PDF dependency and static assets. This does not need a router, component
framework or application server. Add test/PDF dependencies when their features land.

**Consequences:** The baseline builds a placeholder, not a usable diary. CI initially
checks types and the production build, then gains behavior tests with each feature.

## 2026-11-14 — Raw event time plus monitor offset

**Choice:** Preserve the immutable captured phone instant separately from an
editable event time and a session calibration (phone instant, monitor date/time
and measurement timezone). Derive monitor times for UI and PDF. A time correction
entered in monitor time must be converted back through the session calibration.
Capture the calibration phone instant at the matching monitor-read/confirmation
gesture, not after an unrelated form-filling delay.

**Why:** The monitor can differ from the phone. Correcting calibration must not
destroy original timestamps. Use explicit dates and test midnight transitions.

**Consequences:** A constant offset assumes no changing relative clock drift.
Device-clock changes and daylight-saving transitions need defined behavior and
tests before shipping. Do not infer a monitor's timezone or DST behavior silently;
keep a fixed session time basis and allow explicit correction. UI language must
never change the stored event instant or time basis.

## 2026-11-14 — One small delivery process

**Choice:** Six issues, short PRs, CI, and independent review for code changes.
Record actual review results and validation evidence in each PR; do not imply
approval or a review that did not run.

**Why:** Independent review and recorded evidence make changes understandable
without a large project-management system.

**Consequences:** No separate project board or duplicate task tracker. Merge
changes after checks and review; evaluate release readiness separately.

## 2026-11-14 — Hosting and publication

**Choice:** Prepare `/holter-diary/` paths now. Keep deployment separate from build
validation; require a release-readiness review. No deployment credentials in CI.

**Why:** Successful compilation alone does not establish release readiness.

**Consequences:** GitHub Pages can log ordinary visitor requests/IPs, while the
app must never upload diary content. Storage permissions/databases are scoped to
an origin, not isolated by repository path: other projects on the same
`<account>.github.io` origin are not a separate security boundary. Use specific names
to prevent accidental collisions, and revisit a dedicated origin if unrelated
untrusted applications will share that host. A later origin change does not carry
the diary over automatically. Check Pages plan eligibility and actual audience
before release; do not equate private source with private website.

Reference: [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

## 2026-11-14 — Public documentation boundary

**Choice:** Keep repository content suitable for public distribution at every
stage, regardless of current visibility. Document portable setup steps and
technical decisions, using synthetic data and environment-neutral examples.

**Why:** Source history, discussions and build artifacts can outlive an edit.

**Consequences:** Personal infrastructure and operational notes belong outside
the project. Review files, discussion text and artifacts for unintended personal
information before publishing changes. A removal from the latest tree does not
by itself remove historical copies.

## 2026-11-14 — Transactional storage and fixed measurement clock

**Choice:** Store versioned session, entry and language records in IndexedDB.
A save resolves only after transaction completion and returns the browser's
reported durability. Request strict durability; report the actual fallback if
the browser rejects or ignores that option. No in-memory success fallback.

**Why:** A successful individual request is not enough to confirm a committed
record. Preserve caller drafts on failure. Revision checks prevent a stale tab
from silently replacing a more recent edit. Entry inserts and updates also require
the session revision used for time conversion, checked in the same transaction;
the UI must preserve the draft and refresh/review it after a session conflict.
Unknown database versions or invalid
schemas fail without erasing existing data. A second session cannot silently
replace the first.

**Time basis:** Capture an IANA timezone label and its UTC offset at measurement
start. Use that fixed offset throughout the session, independent of the browser's
later timezone or DST changes. Monitor readings are explicit local date/time
strings. A separate calibration offsets that fixed wall clock; it can be corrected
without modifying original entry capture instants. Manual monitor-time edits
convert back into the phone time basis. A correction to calibration applies to
all event times; per-period clock drift correction is outside this version.

**Limits:** If a phone or monitor clock changes during a measurement, a single
constant offset cannot recover all affected timestamps automatically. Do not
silently recalibrate on resume or timezone changes. The UI must explain the fixed
time basis and allow explicit entry correction. A minute-only monitor reading is
interpreted at second zero; matching the capture gesture to the reading limits
calibration error, but does not establish sub-minute accuracy. Real-device
persistence permission and restart/printing checks remain separate acceptance.

**Validation:** Unit tests exercise offsets, date boundaries, manual corrections,
fixed DST behavior and permission outcomes. Chromium tests exercise real IndexedDB
transactions, reloads, failures, edit conflicts and non-destructive schema refusal.
The fixture is bundled separately and excluded from the production app artifact.

## 2026-11-14 — Complete mobile flow and explicit offline updates

**Choice:** One main screen with a note composer and a separate immediate symptom
button. Keep the current draft when marking symptoms, changing language or opening
settings. Accept a write only after its transaction commits; update the in-memory
history from the committed value so a later read cannot falsely report save failure.
Same-tab settings changes rebase the draft's expected session revision. Another
tab's change is rejected and shown for explicit recovery. Failed markers show their
original time and offer retry or confirmed discard, even if the diary was replaced.

**Time behavior:** Refresh untouched entry time on first typing or return from
background; keep it fixed after the first edit. A manually entered time is not
replaced. The symptom action always captures the actual tap time.

**Offline behavior:** Generate an asset list and content-derived version at build
time. Cache the entire application under its project scope and verify every asset
before reporting readiness. Missing assets can be repaired online only when SHA-256 integrity matches that
worker's build; never mix a newer document with an older asset set. A new worker
waits for explicit adoption; accepting it reloads only the initiating tab, with
confirmation for unsaved work. Other tabs retain their drafts. Previous asset
caches are retained to support those tabs; IndexedDB is never touched by worker
updates. This deliberately trades a small amount of cache space per release for
simple, safe updates; automatic old-cache eviction is deferred.

## 2026-11-14 — Local A4 report with honest character limits

**Choice:** Bundle pdf-lib and generate a dated chronological A4 report from one
transactional session/entry snapshot. Use standard PDF fonts, repeat table headers,
continue long entries across pages and label symptoms in bold for monochrome print.
Select report language independently from the UI and preserve original notes.

**Why:** PDF is directly shareable/printable on the phone without a print service or
network dependency. Standard fonts keep the application small and cover DE/EN text.

**Consequences:** Unsupported glyphs stop PDF generation with an explicit message;
a UTF-8 text download preserves all content. Do not replace unknown characters
silently. Download is always offered; the native share sheet is an additional action
when file sharing is supported. PDF extraction and layout bounds are automatically
checked, while physical phone printing remains a separate acceptance step.
