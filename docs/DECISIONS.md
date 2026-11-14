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
