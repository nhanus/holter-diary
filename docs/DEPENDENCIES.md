# Dependency policy

New npm releases must be at least **14 full days old**, measured from the exact
version's publication timestamp. This is a minimum age, not a maximum: older
versions are allowed if they pass the vulnerability check. The delay gives the
ecosystem time to detect bad releases; it does not prove a package is safe.

## Installing the reviewed lockfile

Use Node.js 24 and npm 12.2.0 or later in the npm 12 line, then run:

```sh
npm run deps:install
```

This runs the dependency policy check, audits the entire lockfile for known
vulnerabilities, then runs `npm ci --ignore-scripts`. It needs access to the public
npm registry. Registry errors, missing timestamps and identity mismatches stop
the installation; they are not treated as approval. Development network access
does not change the application's offline runtime behavior.

The policy checks every package in `package-lock.json`, including transitive,
development and optional packages for other platforms. Each version's tarball URL
and SHA-512 integrity must match the registry metadata. Git, local, arbitrary URL,
alias dependencies and alternate `npm-shrinkwrap.json` files are deliberately
unsupported. Supporting another source requires a separate policy review.

`.npmrc` applies npm's native `min-release-age=14` when resolving versions and
disables automatic lifecycle scripts. However, **plain `npm ci` does not recheck
the age of a valid locked version**. Use the wrapper above; CI always runs the
preflight explicitly before installation. A root `preinstall` hook is not a
substitute because dependency installation can occur before that hook runs.
Explicit project scripts and test tools still execute code when invoked.

## Updates and security fixes

Dependabot proposes weekly npm and GitHub Actions version updates with a 14-day
cooldown. Keep Actions pinned to full commit hashes when accepting updates. Node type
definitions stay on the runtime major (24); major updates require a coordinated
runtime review. No update
is auto-merged. Dependabot alerts and security updates are enabled separately in
the repository settings; `dependabot.yml` alone does not enable them.
Security-update proposals are not delayed by Dependabot's cooldown;
our npm CI still requires the age check or
an explicitly approved exception. The workflow also runs weekly so newly reported
vulnerabilities in unchanged dependencies are checked. The audit covers all
severities and includes development dependencies; a security exception does not
suppress the audit.

For an ordinary update, prepare the lockfile without executing install scripts:

```sh
npm install --package-lock-only --save-exact PACKAGE@VERSION
npm run deps:install
```

Replace `PACKAGE@VERSION` with the selected exact release. Review the complete
lockfile diff, then run the project's checks and obtain independent review.
Native resolution can preserve existing locked packages; the preflight remains
the final age check for the whole graph.

For an urgent security fix younger than 14 days:

1. Identify the affected advisory and the exact fixed version. Obtain explicit
   maintainer approval for that package/version and record it in the PR.
2. Add only that exact pair to `.github/dependency-age-exceptions.json`, together
   with an HTTPS advisory link and a meaningful reason. The file starts empty.
   Its schema is `{"exceptions":[{"name":"PACKAGE","version":"VERSION",
   "advisory":"https://...","reason":"Why this fix cannot wait"}]}`.
3. Generate the lockfile using a one-command native exception:

   ```sh
   npm install --package-lock-only --save-exact PACKAGE@VERSION --min-release-age-exclude=PACKAGE
   ```

4. Run `npm run deps:install`, review all changed transitive dependencies, and run
   the complete tests. Any other young dependency needs its own approved exact
   exception. Never commit a package-wide exclusion or disable the global delay.

The JSON file records the exception; the checker cannot authenticate human
approval. Approval is a maintainer-review requirement, not a self-declared boolean
or permission for an agent to approve its own exception. An exception applies to
no other version and becomes unnecessary once that release reaches 14 days.
Remove it during subsequent maintenance. Currently no exceptions are granted.

Node.js, the npm executable, GitHub Actions and the explicitly downloaded test
browser are separate toolchain components. This npm lockfile policy does not
claim to age-check them. Use the maintained Node.js 24 line and keep its security
patches current. CI explicitly selects npm 12.2.2. The current Dependabot updater uses
12.2.0, which is also supported. npm 11 is no longer a project target. Retain strict engines,
release-age checks and disabled install scripts. The npm executable is installed
as a separately pinned toolchain component, before project dependency checks.
Actions are pinned to commit hashes. The test browser is fetched
through the installed, reviewed Playwright version rather than an `npx` fallback.

## Maintaining the published app

- Review outstanding alerts, update PRs and scheduled CI results weekly. Triage
  high/critical or actively exploited vulnerabilities promptly rather than waiting
  for that routine review. Check the affected version and whether the vulnerable
  behavior is used in the app, build or tests; development-only does not mean safe.
  Record evidence for fixes or dismissals, rather than dismissing by severity alone.
- Maintainers should watch the repository with **Security alerts** included and
  enable their preferred delivery method in
  [GitHub notification settings](https://github.com/settings/notifications).
  Repository settings do not prove that an email arrived. Check the repository's
  Security tab as well, including alerts for which no automatic fix PR is available.
- Review the complete dependency or Action diff, retain least-privilege workflow
  permissions, run CI and obtain independent review. Wait for the completed
  automated Codex review of the final changes and validate its findings before
  manually merging. The npm age-exception process above remains mandatory for
  urgent fixes younger than 14 days; enabling security updates grants no exception.
- Include Node.js, the pinned npm executable, GitHub Actions and the Playwright
  browser in maintenance. `.node-version` selects the maintained Node.js 24 line
  in CI; update local installations too. Dependabot's npm configuration does not
  update the separate npm executable pin. Action cooldowns do not provide the
  lockfile's independent CI age validation; review release dates for those updates.
  GitHub does not generate Dependabot vulnerability alerts for SHA-pinned Actions.
  Check their upstream security advisories and release notes during the weekly
  review; version-update PRs alone do not close that monitoring gap.
- A merge is not a deployed fix. For changes affecting the shipped app, publish a
  new app version and select that release for the website in the reviewed PR.
  The main pipeline deploys automatically when Pages is enabled. Verify the
  successful deployment, published version and update path. Installed
  offline copies receive fixes only after reconnecting and applying the update.
  Tooling-only changes do not require a new app version unless they affect the
  shipped output. Record validation and publication in the associated PR or issue.

The repository's private reporting route is documented in [SECURITY.md](../SECURITY.md).
These checks detect known problems and reduce exposure; neither a clean audit nor
the 14-day delay is a guarantee against unknown vulnerabilities or malicious code.

## References

- [npm configuration](https://docs.npmjs.com/cli/v11/using-npm/config/#min-release-age)
- [npm install-script controls](https://docs.npmjs.com/cli/v11/using-npm/config/#ignore-scripts)
- [Dependabot cooldown](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#cooldown)
- [Monitoring Actions and SHA-pinning limits](https://docs.github.com/en/actions/reference/security/secure-use#monitoring-the-actions-in-your-workflows)
