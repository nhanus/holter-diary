# Holter Diary

A small, local-first diary for Holter monitoring: open, write a note, save.
Planned for Android, with German and English UI and printable PDF reports.

**Status: project foundation only. The diary, offline storage and PDF export are
not implemented yet. Do not use this baseline to record a monitoring session.**

There is no released application yet. The included page is only a build placeholder.

## Plan and history

- [Implementation plan](docs/PLAN.md): scope, screen flow and linked issues.
- [Decisions](docs/DECISIONS.md): brief explanations of consequential choices.
- [Validation](docs/VALIDATION.md): automated checks and real-device acceptance.
- [Issues](https://github.com/nhanus/holter-diary/issues): work and acceptance criteria.
- Pull requests: change rationale, independent review and validation evidence.

## Development

Use Node.js 24 (see `.node-version`) and npm.

```sh
npm ci
npm run check
npm run build
npm run dev
```

The build produces `dist/`, with the `/holter-diary/` base path used by the future
GitHub Pages site. `npm run preview` serves this build for local inspection.
Open the local URL printed by Vite. Service-worker installation and persistent
storage checks require a secure context: HTTPS or localhost in the test browser.

CI runs type checking and a production build on pushes and pull requests and
retains a build artifact for seven days. Functional tests will be added alongside
the features; the baseline has no diary behavior to test. CI does not publish.

## Planned data behavior

Diary content stays in IndexedDB on the device. Persistent storage will be
requested and its actual result displayed; it cannot be guaranteed in advance.
Offline readiness and persistent-storage permission are separate states.
There is no server database, account, analytics or cloud sync. An explicitly
exported PDF is a separate file. Clearing site data removes the local diary.

The future GitHub Pages host can receive normal website requests and log IP
addresses; diary notes must never be sent in requests, URLs or telemetry.

## License

[MIT](LICENSE). Third-party libraries and fonts retain their own licenses.
