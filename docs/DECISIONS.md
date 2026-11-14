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

## 2026-11-14 — Readable reports and accessible export

**Choice:** Place export directly below the diary heading, independent of history
length. Non-error confirmations disappear after four seconds without rerendering
or moving focus; errors stay visible. Each new notification cancels the previous
timeout so it cannot dismiss a later error.

**Report:** Use a restrained teal header, an entry/marked-symptom count summary,
large time labels and shaded symptom rows with a bold label and left marker that
also work in monochrome. Keep calibrated metadata, original notes and repeated
headers. Every page includes page numbering and visible, clickable canonical
project website/repository URLs. These links identify the generating application;
adding them does not activate hosting or change the publication decision.

## 2026-11-14 — Verify calibration and compact multi-day reports

**Evidence:** Reproduced clock adjustments through the production interface and
extracted the downloaded PDFs before changing report layout. Automatic entries
at phone time 23:58 became 00:01 the next day with +3 minutes, or 23:54 with
-4 minutes. Later calibration shifted already-saved rows without rewriting raw
entries. Setup at -2 minutes produced 13:28 for an automatic phone-time 13:30
entry; a manually specified monitor time 13:30 remained 13:30. No header-only
conversion defect was reproduced. Keep the existing arithmetic; make explicit
that displayed times and manual time input are already in the monitor basis.

**Layout:** Put date and time in separate columns on the same baseline. Keep
notes and timestamps at 10pt with 13pt leading and modest row padding, and reduce
the summary height. Short entries take one line; long notes wrap and continue
without truncation. Dates remain present on every row, and table headings and
provenance footers repeat on every page. Synthetic 24/48-hour fixtures with
49/97 short entries fit in 2/4 pages in DE/EN; longer notes naturally use more.

## 2026-11-14 — Compare phone and monitor clocks directly

**Choice:** Replace the separate date/time columns with adjacent phone-time and
monitor-time columns, each containing its own date and time. Both represent the
same event instant, including backdated entries; capture/save time is not used
as the phone-time column. Derive both from the session's fixed UTC basis and
apply calibration only to the monitor column. Stored entries remain unchanged.

**Why:** Readers can match an observation against either clock without applying
the correction themselves, including when the clocks show different dates.
Metadata explicitly labels its monitor-time basis. The text fallback also labels
both clocks. Keep 10pt timestamps and notes, wrapping, repeated headers and
provenance footers. Longer notes naturally require more pages.

**Validation:** Production-download tests cover zero, positive and negative
corrections, midnight and manual monitor-time input. PDF extraction verifies
both dated columns across 24/48-hour reports; rendered DE/EN samples check
readability. Independent review identified a derived phone-date boundary case,
now covered by preserving expanded ISO years without relaxing monitor input
validation. The fix passed re-review.

## 2026-11-14 — Explicit reference time and conditional recorder time

**Choice:** Keep the ordinary event timestamp in a stable first column labelled
“Uhrzeit (Referenz)” / “Reference time”. Add “EKG-Gerätezeit” / “Recorder time”
only when the validated calibration offset is nonzero. Both timestamps retain
their own dates; the reference clock uses the measurement's fixed UTC offset,
without the recorder correction. All report metadata also uses reference time,
including report creation. Raw event and capture timestamps remain unchanged.

**Clarity:** Explain the reference source and recorded correction in wrapped
metadata. Distinguish an absent comparison from an explicitly entered zero
without asserting verified synchronization. For nonzero differences, state the
signed calculation and that recorder time is derived. Preserve fractional-second
corrections rather than silently rounding them to zero. The single-clock layout
gives the recovered space to notes. This supersedes the always-dual layout above.

**Review and inspiration:** An independent Astra review informed the terminology,
state handling and structure, then checked the implementation, geometry and
privacy. Official examples were inspected for orientation only:
[Gateshead Health's diary](https://www.gatesheadhealth.nhs.uk/resources/ambulatory-ecg-monitor/)
explicitly identifies recorder time alongside activity and symptoms;
[University Hospital Southampton's leaflet, page 3](https://www.uhs.nhs.uk/Media/UHS-website-2019/Docs/Services/Blood-heart-and-circulation/cardioscan-ambulatory-ecg-monitor-leaflet1.pdf)
uses a simple dated observation table. No template, branding or clinical
certification is adopted. This remains a patient observation diary.

**Evidence:** PDF/TXT tests cover missing, zero, positive, negative and fractional
corrections in both languages, including backdated events and multipage reports.
Production-interface downloads cover default setup, a recorded zero, nonzero
corrections and restoring uncorrected reference time. Rendered DE/EN samples
were inspected in all three modes. Real Android/printer acceptance remains
separate.

## 2026-11-14 — Patient identification on every report page

**Choice:** Add an optional date of birth beside the existing name in setup and
settings. Repeat supplied details in a compact 10pt dark-text header beneath the
title on every PDF page, including long-note continuation pages. Omit absent
values and their labels completely; omit the whole identity line when both are
absent. Use the same presence rules in TXT. This helps associate separated pages
with the correct person while preserving a minimal report.

**Storage:** Keep date of birth as a validated YYYY-MM-DD calendar string, not a
timestamp. German output uses DD.MM.YYYY; English uses YYYY-MM-DD. Missing or
empty fields are accepted in existing schema-version-1 sessions, requiring no
database reset or migration. Normal revision checks still guard edits; entries
and event times are unaffected. Validation is independent of the current device
clock so a clock adjustment cannot invalidate stored patient details.

**Layout:** Names wrap without clipping or shrinking the type. Exceptionally
large identity blocks that cannot reasonably repeat are rejected explicitly for
PDF; TXT preserves the full name. No patient details are placed in filenames or
PDF document metadata. Both fields remain optional, and starting a new diary
clears them.

**Evidence:** Calendar validation includes leap-year boundaries. Real IndexedDB
tests add, reopen and clear the field in a legacy session while retaining entries.
Production-interface tests cover input, language changes, committed reload,
editing, omission and reset. DE/EN PDF extraction checks every page for each
presence combination and a 120-character name. Synthetic rendered first and
continuation pages were inspected. Independent review checked compatibility,
layout, data integrity and privacy; no unresolved findings.

## 2026-11-14 — Delay npm releases and verify the entire lockfile

**Choice:** Apply a 14-day minimum release age, exact direct pins and disabled
install lifecycle scripts. Use a small dependency-free Node preflight before
installation, comparing all locked package/version pairs to public registry
publication times and tarball/integrity metadata. Fail closed on unavailable or
invalid evidence. CI runs the same preflight, all-severity lockfile audit and
policy tests before installing, with an additional weekly run. Dependabot uses
a 14-day cooldown for ordinary weekly npm update proposals.

**Why a separate check:** Installed npm 11.19.1 source review and a dry run showed
that valid locked versions bypass release-age resolution in `npm ci`. Root
`preinstall` runs too late to act as the security boundary. Also reject alternate
shrinkwrap files, which npm would prioritize over the checked lockfile. Native
npm settings remain useful for resolution, while the explicit preflight covers
locked transitive, development and optional packages.

**Exceptions:** Only exact security-fix package/version pairs with an advisory,
rationale and explicit maintainer approval; none are granted initially. No
permanent package-wide exclusions, automatic merge or audit suppression. The
approval is a review requirement, not something a JSON field can authenticate.
See [dependency policy](DEPENDENCIES.md) for the installation and exception flow.

**Existing graph:** Resolve age-compliant development releases before installation:
Playwright 1.64.1, PDF.js 6.4.299 and Vite 8.3.5, together with compatible aged
transitives. Runtime pdf-lib remains 1.17.1. All 84 locked versions passed the age
and identity check and the initial audit reported no known vulnerabilities.
The old graph was verified to fail the age gate. After installation with scripts disabled, all 11 policy, 21 unit/report,
6 storage and 19 production-app tests passed. Zero-second browser-test inputs
use the normalized datetime-local representation accepted by the aged Playwright
release; the actual timestamp assertions remain unchanged. The delay
reduces exposure to new malicious releases; it is not a safety guarantee for old
packages or a replacement for vulnerability monitoring.

## 2026-11-14 — Supported toolchain and manual deployment preparation

**Problem:** Dependabot's npm 12.2.0 updater failed with EBADENGINE because the
project permitted npm 11 only. The same error was reproduced with a local
lockfile-only dry run. Expanding the npm engine range resolved it without
turning off strict engine validation or changing the dependency graph.

**Choice:** Standardize on npm 12 (minimum 12.2.0 for updater compatibility), with
CI explicitly selecting the current tested patch 12.2.2. npm 11 is no longer a
project target. Keep Node.js 24 on its maintained LTS line with current security
patches; .node-version lets CI pick the latest patch. Node type definitions stay
on major 24 until a coordinated runtime upgrade. The 14-day package age check,
registry identity verification, full lockfile audit and disabled lifecycle scripts
remain mandatory. Node/npm executables are separately managed toolchain components,
as documented in the dependency policy.

**Deployment:** Add a manual-only Pages workflow gated by the main branch, an
explicit confirmation input and PAGES_ENABLED=true. Reuse full CI and deploy
only its same-run static artifact; isolate Pages/OIDC permissions to deployment.
No Pages activation, visibility change or deployment is part of this preparation.
The hosting guide also explains how to serve the validated build on another HTTPS
host and why a stable origin is needed before recording real entries.

**Acceptance boundary:** This supersedes earlier references to pending physical
printer acceptance. PDF structure, pagination and monochrome readability remain
project responsibilities. Printing the downloaded PDF is handled by the phone
and its viewer; a printer test is not a release requirement. Actual Android
installation, storage status, phone restart and offline use remain pending.

**Validation:** All 57 policy, unit/report, storage and production-app tests passed
with npm 12.2.0 and again with npm 12.2.2 on patched Node.js 24 LTS. The 84 locked
versions passed age/identity verification and the audit reported no known
vulnerabilities. Type checking, production build, actionlint and whitespace checks
passed. Independent Astra review found no blocking issue; documentation now
explicitly supersedes the old printer requirement. Live Pages deployment and
actual Android checks remain pending; automated updater coverage is recorded in
[validation](VALIDATION.md).

## 2026-11-14 — Language metadata and storage-check feedback

Keep the static loading shell language-neutral rather than declaring English
before the saved preference is read. Set HTML language and a localized description
when that preference is available, before loading the rest of the diary, and on
each interface render. Label the bilingual no-script text individually. IndexedDB
remains the only language-preference store; no translation opt-out or fixed server
Content-Language header is introduced. Browser translation prompts use additional
heuristics and still need actual device verification.

Persistent-storage permission protects against automatic eviction under storage
pressure; it is separate from normal committed storage and offline readiness.
Keep all reported outcomes honest. The explicit check now shows a neutral, visible
progress/result line, including repeated denials and API failures, and keeps its
live region mounted for accessibility. It does not rebuild the settings dialog,
clear data or force a browser grant. Explain these distinctions in both languages.

Validation covers DE/EN language and description, saved-language reload, a delayed
IndexedDB open with a saved language different from the browser, repeated denial,
failure, actual API grant reporting, English feedback and retained entries. The
22 production-app tests and 21 unit/report tests pass. Independent review findings
about provisional language and live-region replacement were fixed and re-reviewed;
no blocking findings remain. Real browser grants and the Android translation
prompt are not established by mocked browser tests.


## 2026-11-14 — Separate diary settings from app maintenance

Keep daily capture and export unchanged. Diary settings contain identity and a
collapsed recorder-clock section. A separate **App & storage** dialog groups
updates, offline readiness and optional eviction protection. A conditional notice
below the header makes a waiting update discoverable without opening a dialog or
reloading automatically. Installation help and storage explanations use disclosure
sections; offline repair appears only after a failed readiness check.

An update waits for unfinished notes, setup fields and pending symptom markers.
Closing edited settings requires confirmation. Activation failures and a ten-second
timeout restore normal navigation and unload protection. A stable polite live
region announces a newly available update. Dialog headings remain visible, and
scroll padding prevents focused controls from being hidden behind them.

Chrome still offered translation after accurate language metadata was introduced.
For this self-localized interface, use HTML `translate="no"` plus Chromium's
`google/notranslate` metadata while retaining the real DE/EN document language and
explicit language selector. This supersedes the earlier decision not to opt out.
The intent is to avoid a second translation layer on operational controls; native
Android translation UI still needs device confirmation.

References: [GOV.UK details guidance](https://design-system.service.gov.uk/components/details/),
[WCAG reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html),
[modal dialog guidance](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/),
[status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html),
[Chromium translation exceptions](https://chromium.googlesource.com/playground/chromium-org-site/+/refs/heads/main/developers/design-documents/translate.md),
and [HTML translation semantics](https://html.spec.whatwg.org/multipage/dom.html#the-translate-attribute).

Validation: type checking and production build pass; 24 production-app tests cover
real waiting-worker adoption, cross-tab data retention, blocked unsaved inputs,
failed-marker recovery, narrow dialogs and language metadata. Two focused unit
tests cover missing workers, activation errors and timeouts. Independent Astra
source and visual review found no blocking issues; its live-announcement and
focused-control visibility recommendations were implemented and tested. Only
synthetic diary data was used. No dependencies or hosting settings changed.


## 2026-11-14 — Unified settings and separate entry editing

A complete task-flow review found that separate diary settings and app maintenance
forced users to guess between two locations. A reviewed local prototype therefore
supersedes the previous split: one labelled Settings button opens a full-height
native dialog with report details, recorder time, language, offline/storage and
updates. Each section shows its current state when collapsed. A waiting-update
indicator belongs to that same Settings button. Export remains a diary task.

Keep the daily form compact, show Now before first input, then the frozen date/time
and actual time basis. Time correction continues using the established fixed-clock
model. A successful symptom marker offers Add details without opening the keyboard.
When the form scrolls out of view, a small action bar returns to it or marks a
symptom immediately. Entries retain explicit dates for multi-day recordings.

Editing now uses its own dialog while retaining the complete new-entry draft,
including capture/event timestamps, revision, dirty state and invalid manual input.
Identity and clock forms patch only their own section of the last committed
same-tab session. Successful writes update dependent revision tokens; cross-tab
stale writes still fail. A calibration updates derived display times without
rewriting raw entries or reinterpreting valid drafts. Invalid input remains visible.

Updates require all unfinished state to be resolved. Reset uses a separate explicit
confirmation showing the entry count and an export action, and clears state only
after the transaction commits. Native dialogs provide focus containment; explicit
back/cancel and native cancel events share discard protection. No router or
browser-Back guarantee is added. Sticky-header scroll padding follows actual
header height so enlarged text does not conceal focused controls.

Independent Astra review identified settings feedback jumping to the top, focus
restoration to a deleted entry, and stale transient flags after another tab reset
the diary. These were corrected with section-local feedback, a surviving focus
target and clearing draft flags before the no-session return. After a successful
section save disables its button, keyboard focus returns to the visible section
summary; the success message cannot scroll that focus away. Regression tests
exercise these transitions alongside actual IndexedDB aborts, stale writes,
service-worker updates, offline restart and PDF extraction. No data migration,
new dependencies or publication settings are needed. Real Android keyboard,
TalkBack and platform Back behavior remain device validation rather than claims
based on desktop emulation.

Design rationale follows the prior review's W3C/GOV.UK references: clear action
labels, visible status summaries, large touch targets and secondary details on
demand. The single settings hierarchy is a project-specific design decision,
not a prescribed standards layout.


## 2026-11-14 — Installation guidance for persistent storage

Make installation an explicit troubleshooting step when persistent storage is not
granted: install from the browser menu, launch from the home screen and check the
actual permission again in Settings → Offline & storage. Do not make installation
a universal requirement or infer permission from standalone display mode. The
browser's API result remains the only basis for the displayed grant.

Chromium uses several signals, including installation or bookmarking and site
engagement, to decide whether to grant persistent storage. Installation therefore
can help, but is neither a cross-browser guarantee nor a universal prerequisite.
See [Chrome team's persistent-storage guidance](https://web.dev/articles/persistent-storage).
The bilingual help-text update also provides a normal small release for exercising
the existing explicit update flow; storage schema and behavior are unchanged.

## 2026-11-14 — Recognizable pending updates

Replace the small header subtitle with a static circle-arrow-up icon inside the
existing Settings button. Its accessible name includes update availability.
Keep App updates in its established position, but highlight a pending update with
an icon, bold status text and a pale background. On entering Settings with an
available update, expand that section once without moving focus or scrolling away
from the heading. A manual collapse survives status refreshes and form saves;
an update arriving during the visit does not open it unexpectedly.

Distinguish availability, activation in progress, failure and no installable
update. Show a localized retry action only while an installed waiting worker
exists. Keep existing unsaved-input guards and explicit activation. Route polite
announcements to the active settings dialog or the main screen, with the
collapsed section's readable status kept separate from the live region.
No storage migration, dependencies or worker activation behavior changes.

The approved prototype and independent implementation review informed this
change. Production-browser regression tests cover real waiting-worker detection,
narrow-screen layout, disclosure state across language changes and settings saves,
unsaved-note protection, activation timeout and successful retry retaining saved
records. Existing offline, storage and report checks remain part of CI. Desktop
browser checks do not replace Android screen-reader or device acceptance.


## 2026-11-14 — Installed version and automated preview releases

Start with `0.1.0-beta.1` while Android acceptance remains in progress. Show a
quiet installed-version line under App updates even when the section is collapsed.
Embed it at build time from the validated package/lock version, so offline clients
and clients awaiting activation identify their own app rather than a server's
newer deployment. Include the version manifest in offline integrity checks.

Extend existing CI instead of adding an independent build pipeline. After all
checks pass, package the tested static app with normalized archive metadata and
record its checksum and exact source commit. Only a main-push release job gets
write access and publishes those downloaded bytes without rebuilding. Use reviewed
per-version notes rather than copying commit history or private operational notes.

Create a fixed tag and draft first; verify every asset before publication. Recover
matching interrupted drafts without clobbering uploaded assets, reject conflicting
commits/content, and leave published versions unchanged. Main-push runs cannot
cancel publication midway. Hosting remains separate and repository visibility is
unchanged. Deploy release packages, not builds of later unversioned commits.

Regression coverage includes version/lock/build consistency, deterministic
packaging, checksum failures, publication event guards, exact tag commits,
prerelease flags, partial-upload recovery, conflicts and API failures. Production
browser coverage checks the installed version in both languages, offline and
while a worker update waits. Actual GitHub release execution and subsequent
hosting verification are required in addition to these isolated tests.

Independent Astra review caught two integration details: draft releases require
paginated discovery when the published-tag endpoint returns 404, and the Pages
caller needs the reusable workflow's permission ceiling even though publication
is skipped for manual runs. Both were corrected. Release tests model draft lookup,
pagination and duplicate matches; API status errors remain distinct from absence.


## 2026-11-14 — Separate website and immutable app release

**Choice:** Keep one repository with independent website sources and app build.
Compose website publication from a selected, verified published app release.
Documentation-only changes cannot silently replace an installed version's bytes.

**Migration:** Keep the root worker URL/scope and manifest URL, and preserve the
manifest's effective identity `/`. Put the diary under `app/`, with offline and
standalone compatibility redirects for old installed launch URLs. Narrow worker
fetch handling instead of creating competing registrations. Retain old hashed
assets for open tabs and never replace IndexedDB or force unfinished work closed.
A ready-cache response includes the app version, preventing a new UI from treating
an old worker's assets as its own offline readiness.

**Validation:** Exercise bilingual routes, mobile reflow, manifest identity,
offline root/app routing, cache separation and unchanged app bytes after FAQ edits.
Keep physical Android/WebAPK update acceptance distinct from Chromium emulation.

## 2026-11-14 — Automatic website language with an explicit preference

The website uses a valid DE/EN URL selection first, then its saved explicit
choice, then the browser's preferred language (German for `de-*`, English
otherwise), matching the app's initial fallback. A deliberate website choice is
stored separately from the app's IndexedDB language preference. Automatically
detected website navigation omits the language parameter so it cannot silently
turn detection into a remembered choice. App links still hand off the displayed
language. Invalid values are ignored; blocked local storage leaves navigation
and explicit language links working. Language switches retain the current anchor.

## 2026-11-14 — Direct capture with stable keyboard actions

Keep a real note field on the diary screen: focusing it does not navigate or
replace the field. Group note, symptom flag and time before Save/Discard. Keep
the action row sticky inside the card from the initial render, with consistent
padding and a layer below the header. Report export is a labelled utility by the
diary heading; the immediate symptom marker stays a separate action.

Viewport scrolling updates keyboard geometry without moving the document back
to a focused field. Focus and viewport shrink may reveal a covered field. Existing
entries use a scrollable editor with a separate action row. Successful new-entry
save and discard return focus to the diary heading, ending text entry; failures
retain the draft, its time and retry path. Existing draft suspension and timestamp
rules are unchanged. The manifest, database schema and worker identity stay stable.

Browser tests cover large text, narrow layouts, resizing and simulated visual
viewport keyboard overlays, including repeated scrolling across the sticky edge.
Physical keyboard animation, viewport panning and accessibility settings remain
part of device validation; emulation is not a substitute for that check.

CI exposed a font-dependent timestamp wrap at 150% text. Its flex basis now
scales with its own font size, allowing the time controls to wrap before editing
rather than moving Save when the first timestamp replaces “Now”. A wider-font
regression reproduces the original failure independently of installed fonts.

## 2026-11-14 — One CI run per pull request update

Validate feature branches through pull requests; automatic push builds target
only `main`, where the validated commit also produces the release and website
artifact. Manual, scheduled and reusable execution remain available. Separate
concurrency groups by event so a manual or scheduled check cannot cancel an
in-progress main-push release. Newer pull request updates still cancel obsolete
checks for the same pull request. Pages publication remains explicitly gated.

## 2026-11-14 — Readable clock differences and report access

Clock settings display durations in hours, minutes and seconds, with ahead/behind
wording relative to phone time. Round the absolute magnitude once before splitting
units, omit zero units, and preserve direction. A nonzero difference below one
second is labelled explicitly rather than described as no correction. A pending
comparison is the new total offset, not the change from the previously saved one.
Only display formatting changes: stored calibration precision, event timestamps,
report calculations and data schema remain unchanged.

Keep Report beside the diary heading as an outlined secondary button with a
hidden decorative document icon, a 48px minimum target and an accessible name
containing its visible label. Let the entire button wrap at narrow widths or
large text sizes; Save remains the primary capture action.

## 2026-11-14 — Validated review follow-up

Read a fresh atomic snapshot when opening reset confirmation. Compare its entry
IDs/revisions and session revision within the deletion transaction, so changes
committed after opening also require renewed consent. Keep this snapshot separate
from unfinished drafts; no schema or global revision redesign is necessary.

Worker activation and page reload are separate states. A late or cross-tab
activation exposes an explicit reload action even when no waiting worker remains.
Recheck unsaved input and in-flight writes at the actual reload boundary. An older
page controlled by a different-version worker must not claim verified offline
readiness until it reloads. Installation can help persistence permission, but is
not a universal prerequisite or guarantee.

A small main-push workflow queues the whole reusable CI pipeline before builds
with GitHub's `queue: max` (up to 100 pending runs). A faster later build cannot
overtake a pipeline already in that queue, and newer pending runs do not replace
earlier ones. Publication retains its separate queue as a safety barrier. GitHub
orders by arrival at the queue, not an absolute commit-time guarantee. PR checks
still replace obsolete runs;
feature-branch pushes do not start duplicate builds. Only incomplete `starter`
assets in a verified matching draft may be removed and reuploaded; completed
assets, published releases and conflicting identities remain protected.

Validate automated review findings against the PR goal and current evidence before
making changes. Wait for completed automated review of the final changes as well
as CI and independent review. The earlier settings-draft and npm findings were
already fixed. The manifest-ID suggestion was invalid: both `./` and `/` resolve
against the start URL's origin, so the current identity is preserved.

References: [manifest ID processing](https://www.w3.org/TR/appmanifest/#id-member),
[GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency),
[release asset recovery](https://docs.github.com/en/rest/releases/assets).

## 2026-11-14 — Plain-language update and everyday help

Keep this a website-only change using the existing published app. Provide DE/EN
numbered update steps: save unfinished input, connect, refresh where supported,
apply the offered update and check the installed version. Pull-to-refresh is
browser behavior and reload alone may not activate a waiting update. Provide a
browser reload or installed-app close/reopen alternative without recommending
data deletion or reinstallation.

Group FAQs by task, retain the existing numbered fragment links and make the
update walkthrough directly reachable from the FAQ introduction and guide. Use
relative font sizes, readable answers and native keyboard-operable disclosures.
Explain save acknowledgement, the clock label when correcting times, keyboard
controls, finding PDFs and replacing a diary safely. Downloaded reports do not
update themselves or provide a diary-import mechanism.

References: [Chrome pull-to-refresh](https://developer.chrome.com/blog/overscroll-behavior/),
[service worker update lifecycle](https://developer.chrome.com/docs/workbox/service-worker-lifecycle).

## 2026-11-14 — Capture the published app for website examples

Replace the independently styled phone illustration with real DE/EN app captures.
This keeps Report beside the diary heading, the note composer first and Symptoms
now below it. Capture a fresh browser profile with fictional records; do not
retouch the UI or load personal data. Provide a full-size image link and a text
alternative. Keep the report illustration and FAQ content unchanged.

Refresh captures when selecting a new app release or changing the illustrated UI.
With dependencies installed, run `node scripts/capture-website.mjs APP_DIRECTORY`
against the unpacked selected release (or a matching local build; default `dist`).
The script serves it temporarily on loopback port 4178, checks the selected version,
creates two fictional entries through the UI and captures both languages.
Versioned image names make missing captures visible in website tests when the
selected release changes. Images belong only to the website, outside app caches.
