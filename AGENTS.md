# Working on Holter Diary

- Read `docs/PLAN.md`, `docs/DECISIONS.md`, the linked issue and current git state.
- Keep the app small, local-first and bilingual. Do not add backend services,
  telemetry, mandatory questionnaires or runtime CDN dependencies.
- Keep source, docs, issues and PRs in English; provide German and English UI.
- Use a short branch/PR linked to the issue. Record rationale and actual validation.
- Obtain an independent review for code changes before merging. The
  reviewer should inspect correctness, data integrity, tests and unnecessary
  complexity, without editing the same files. Resolve findings and re-review
  materially changed behavior.
- Keep deployment separate from validation. Changes to publication settings require
  maintainer approval.
- Use `npm run deps:install` for installation; it checks all locked release ages
  and known vulnerabilities before `npm ci --ignore-scripts`. Follow
  `docs/DEPENDENCIES.md`; do not bypass the 14-day delay or enable install scripts.
  Security exceptions require explicit maintainer approval for the exact
  package/version, recorded in the PR. An agent must not approve its own exception.
- Run `npm run check`, `npm run build`, and the relevant tests as they
  are added. Do not claim device validation from desktop emulation or a build.
- Use synthetic data only. Never commit real diary content, secrets or generated PDFs.
- Repository content, issues, PRs and artifacts must be suitable for public release.
  Keep personal infrastructure, internal hostnames, network addresses, firewall
  rules, local workstation paths and private operational instructions outside the
  repository. Use environment-neutral examples. Include privacy in each review.
- Preserve raw event timestamps and existing data. Do not silently clear databases,
  overwrite drafts, or show a save/persistence success before it is confirmed.
