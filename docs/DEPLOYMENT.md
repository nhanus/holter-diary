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
   artifact, packages only `dist/` and deploys it. It never uploads repository
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

Download `holter-diary-COMMIT_SHA` from a successful main CI run and extract its
contents, including `.nojekyll`, into the server's `/holter-diary/` directory.
Alternatively, use the complete `dist/` from a validated local build. Serve with
a certificate trusted by Android and correct HTML, JavaScript and manifest MIME
types. Serve `sw.js`, `index.html` and the manifest with revalidation (for example
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

1. **Install / Installieren:** Open the HTTPS address in Android Chrome, install
   from its menu and launch from the home screen. / HTTPS-Adresse in Chrome öffnen,
   über das Menü installieren und vom Startbildschirm öffnen.
2. **Storage / Speicher:** In App & storage, note the actual persistent-storage result
   and wait for offline readiness. / In App & Speicherung die tatsächliche
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

After device acceptance, record the verified main commit and tag the first release.
Keep untested behavior explicit; publication of repository history remains a
separate review from testing the application.

When an update is ready, a notice appears below the app header. Open it and choose
**Update now**. Save or discard unfinished input first; the app will not apply an
update while a note, setup entry or symptom marker remains unsaved. App & storage
also contains offline status and the optional persistent-storage check.
