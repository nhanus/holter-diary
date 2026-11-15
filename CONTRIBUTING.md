# Contributing to Holter Diary

Bug reports, small fixes, documentation improvements and translation corrections
are welcome. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Start with a small, clear change

Check existing [issues](https://github.com/nhanus/holter-diary/issues) and discuss
larger changes before implementing them. Keep the diary quick to use, bilingual
(DE/EN), offline-capable and local to the user's browser. Accounts, telemetry,
server databases and ECG interpretation are outside the current scope.

For a bug, describe what you expected, what happened and the shortest reproduction
steps. Include the app version and relevant browser/device information when known.
Do not clear a real diary to reproduce a problem. Reports, screenshots and test
fixtures must use fictional entries: never upload real patient details, exported
personal reports, credentials or private infrastructure information.

Please write repository discussions, documentation and code comments in English.
UI changes should include both German and English labels. Keep free-text diary
entries unchanged when switching languages.

## Development and validation

Use the Node.js and npm versions specified in `package.json` and `.node-version`.

```sh
npm run deps:install
npm run check
npm run build
./node_modules/.bin/playwright install chromium
npm test
```

`deps:install` checks dependency age and vulnerabilities before installing without
lifecycle scripts. Follow [the dependency policy](docs/DEPENDENCIES.md); do not
bypass its checks or approve your own exception.

For code changes, run focused tests while working and the full suite before
submitting. Documentation-only changes use relevant checks and CI. Changes
should have meaningful regression coverage when needed. Existing tests cover PDF
content, optional identity fields, clock conversion, languages, storage and updates.
Do not substitute a manual phone checklist for these automated checks or ask a
tester to repeat already confirmed device results without a relevant change.
See [validation evidence and limits](docs/VALIDATION.md).

## Pull requests

1. Fork the repository and work on a short-lived branch.
2. Link the relevant issue and explain the change, its reason and actual validation.
3. Keep unrelated edits out. Do not commit generated builds, test traces or reports.
4. Flag changes to storage, time interpretation, app identity or offline updates.
   Never silently discard diary data or unfinished input.
5. Wait for CI and the final automated Codex review. The maintainer also obtains
   independent review for code changes and validates findings against the change's
   purpose before merging. External-fork workflows require maintainer approval;
   that approval starts tests and does not merge the contribution.

AI-assisted contributions are welcome when verified by the contributor. Describe
material AI assistance and its validation; do not paste private prompts or secrets.
The [README](README.md#development-transparency) describes this project's origins.
Contributions are made under the existing [MIT license](LICENSE).

A pull request does not grant write access or publish a website update. Maintainers
handle releases and explicitly approved deployments. Response times may vary;
there is no guaranteed support or review turnaround.
