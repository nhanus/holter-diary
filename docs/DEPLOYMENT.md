# Deployment and Android acceptance

The app is a static build. No database server, application backend or runtime
package installation is needed. Repository visibility and website visibility
are separate decisions. Publishing is not enabled by merging this workflow.

## GitHub Pages (prepared, not activated)

1. Confirm hosting approval and Pages eligibility for the repository's current
   visibility and GitHub plan. Keep a private repository private if required.
   A Pages website is normally public even when its source repository is private.
2. In repository Settings → Pages, select **GitHub Actions** as the source.
   Keep the standard project URL ending in `/holter-diary/`; custom domains or
   another base path need coordinated changes to Vite, manifest, worker and links.
3. Configure the `github-pages` environment to allow deployments from `main`
   only; add a required reviewer where supported. Set the repository Actions
   variable `PAGES_ENABLED` to the literal value `true` only after approval.
4. Run **Publish to Pages (manual)** on `main` and explicitly check `publish`.
   It runs the existing full CI first, then downloads that run's exact commit
   website artifact, packages `site-dist/` and deploys it. It never uploads repository
   source or browser-test evidence as website content. A failed check prevents
   deployment. Pushes, PRs and scheduled audits never trigger publication.
5. Verify the workflow's HTTPS URL, then run the Android checklist below.

The workflow requires Pages configuration to exist; it does not create a site or
change repository visibility. An unset/false enablement variable, unchecked
confirmation or non-main branch skips publication. Removing `PAGES_ENABLED`
disables future workflow publications; it does not unpublish an existing site.
Deployment itself remains untested until hosting is approved and activated.

[GitHub Pages workflow requirements](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

## Another HTTPS host

Download `holter-website-COMMIT_SHA` from a successful main CI run and extract its
contents, including `.nojekyll`, into the server's `/holter-diary/` directory.
For development, `npm run build && npm run build:site` produces `site-dist/`.
Production assembly selects the published app as described below. Serve with
a certificate trusted by Android and correct HTML, JavaScript and manifest MIME
types. Serve `sw.js`, both `index.html` files and the manifest with revalidation (for example
`Cache-Control: no-cache`); content-hashed assets may be cached long-term.
Do not substitute HTML error/fallback pages for missing assets. Deploy the whole
build together, preserving old hashed assets while existing tabs can use them.

Use an origin dedicated to trusted content. Choose a stable URL before recording
real diary entries: browser storage does not automatically move between hosts,
HTTP and HTTPS, browsers or profiles. A self-signed certificate warning is not a
substitute for a trusted HTTPS setup. Existing report footer links identify the
canonical GitHub project, even when the test build is hosted elsewhere.

## Android test / Android-Test

Use synthetic entries and record the tested commit, date, Android/browser versions
and actual results in issue #6. Never attach real patient details or diaries.

1. **Install / Installieren:** Open the app at the HTTPS address ending in `/app/` in Android Chrome, install
   from its menu and launch from the home screen. / HTTPS-Adresse in Chrome öffnen,
   über das Menü installieren und vom Startbildschirm öffnen.
2. **Storage / Speicher:** In Settings → Offline & storage, note the actual persistent-storage result
   and wait for offline readiness. / In Einstellungen → Offline & Speicherung die tatsächliche
   Speicherfreigabe prüfen und auf Offline-Bereitschaft warten.
3. **Save and restart / Speichern und neu starten:** Save two notes and a symptom
   marker, restart the phone and verify all entries. / Zwei Notizen und eine
   Beschwerdemarkierung speichern, Handy neu starten und Einträge vergleichen.
4. **Offline:** Close the app, enable airplane mode, reopen, save another entry
   and export/open a PDF. / App schließen, Flugmodus aktivieren, erneut öffnen,
   weiteren Eintrag speichern und PDF exportieren/öffnen.
5. **Time and report / Zeit und Bericht:** Compare a report without correction
   and one with a small clock correction; reference time must remain unchanged.
   Check supplied patient details and DE/EN output. / Bericht ohne und mit kleiner
   Zeitabweichung vergleichen; Referenzzeit muss gleich bleiben. Angegebene
   Patientendaten und deutsche/englische Ausgabe prüfen.

A denied persistence request must remain visibly denied and be investigated on
the device; normal saving alone does not prove eviction protection. Do not clear
site data to troubleshoot a real diary. Export existing entries first.

The app's responsibility ends with a readable PDF/TXT file. The operating system
and PDF viewer handle sharing and printing; no printer configuration or physical
printer acceptance is required for this project.

Preview releases may be created while device acceptance is pending. After device
acceptance, record the verified release and commit before selecting a stable version.
Keep untested behavior explicit; publication of repository history remains separate.

When an update is ready, the single **Settings** button shows an update icon.
Open Settings → App updates and choose **Update now**. Save or explicitly discard
unfinished input first: new notes, editor changes, setup fields, settings sections
and pending symptom markers remain protected. Settings also contains offline
status, installation help and the optional persistent-storage check.

Use the visible back/cancel controls to return from full-height dialogs. Their
native cancel event uses the same unsaved-change protection. Browser/device Back
behavior varies and is not claimed as a validated app navigation mechanism.


## Versioned releases

The installed version is always visible in **Settings → App updates**, including
when offline or when no update is waiting. It is embedded in the running app, not
read from the newest server version. `package.json` is the version source;
`package-lock.json` must match. Vite embeds it and emits `app/version.json`, which the
offline build includes in its integrity-checked assets.

To release a change:

1. In a reviewed PR, update the package version and both lockfile root versions.
   Use `X.Y.Z` for a stable release or `X.Y.Z-beta.N` (also `alpha`/`rc`) for a
   prerelease. Build metadata and other suffix formats are intentionally unsupported.
2. Add reviewed English notes in `releases/VERSION.md`. Keep them suitable for
   public release and describe any pending device acceptance.
3. Merge after review and CI. The successful **main push** CI packages its tested
   `dist/` once, then automatically creates tag `vVERSION` at that exact commit.
   It uploads the app archive, `SHA256SUMS` and `release.json` to a draft, verifies
   upload digests, and publishes it. Prereleases are not marked as latest stable.
   PR, scheduled, manual and Pages workflow runs cannot publish releases.
4. Deploy the attached `holter-diary-VERSION.tar.gz`, after checking its SHA-256
   against `SHA256SUMS`. `release.json` records the version, source commit and
   archive checksum. Extract its contents into the existing app base path using
   the hosting precautions above. GitHub's automatically added **source** archives
   are not the app build. GitHub release creation does not deploy the website.

An unchanged version does not create another release. Released tags/assets are
never overwritten. Rerun a failed main CI at the **same commit** to recover a
matching tag-only or partial draft release; conflicting commits or asset digests
stop publication. Do not move a tag to repair a release. Once published, deploy
only its package under that version; unreleased commits with an unchanged package
version are development builds, not replacements for the release.

The repository can remain private: release creation does not change visibility
or enable Pages. The release job alone gets `contents: write`; tests and builds
retain read-only permissions. Release packages are also retained as CI artifacts
for seven days; the release assets provide the durable download.

## Separate website and app

`website/` contains the German/English introduction, guide and FAQ. The diary
source remains in `src/`. The public routes are `/holter-diary/`, `guide/`,
`faq/` and `app/`. Installation starts only the diary; guide and FAQ are online
website content and are not included in its offline package.

The app archive contains `app/**`, `sw.js`, `manifest.webmanifest` and `.nojekyll`.
The worker and manifest deliberately retain their original URLs. The manifest
keeps the original effective identity `/`, while its start URL and display scope
move to `app/`. The root worker registration remains for existing installations;
its cache handles only app content, its manifest and legacy hashed assets.
Old installed start URLs redirect to the diary in standalone mode; offline root
navigation also redirects there. No data migration or database reset occurs.
Do not unregister the worker or remove old hashed assets during this transition.
An old active worker can continue showing the old diary until its update is adopted.

For a website-only change, edit `website/` and keep `website/app-release.json`
pinned to the existing published version. After validation, the CI website job
downloads that release, verifies its asset digests and source tag, and copies its
bytes into the combined `holter-website-COMMIT_SHA` artifact. It does not rebuild
the app. Thus documentation edits do not change the installed version or worker.
For an app release, also update the website pin when that version should be served.
The main run publishes the new app before assembling the website. An unavailable
or mismatched selected release fails assembly; there is no development-build fallback.

Deploy the complete combined artifact for a website plus app. The standalone app
archive is not a complete website. Build/assembly and hosting remain separate;
creating artifacts or releases does not activate GitHub Pages.
