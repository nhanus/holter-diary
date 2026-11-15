# Security policy

## Supported versions

Security fixes target the latest published beta or stable app release. Older
versions do not have a separate backport commitment. Installed offline copies
need to reconnect and apply the offered app update to receive a published fix.
Save unfinished input before updating; do not clear site data or reinstall as a
troubleshooting step, since that can remove the diary.

## Report a vulnerability privately

Use GitHub's [Report a vulnerability form](https://github.com/nhanus/holter-diary/security/advisories/new).
A GitHub account is required. Please do not publish exploit details in an issue
or pull request before a fix or coordinated disclosure.

Include the affected version, relevant browser, reproduction steps using fictional
data, and the possible impact. Never include real diary entries, patient details,
credentials or unrelated private information, even in a private report. Test only
with data and systems you control. Response times may vary; there is no guaranteed
response time or bug bounty.

## Dependency maintenance

Dependabot alerts and security-update proposals complement weekly npm and GitHub
Actions version updates and CI vulnerability checks. Updates are reviewed and
merged manually. The [dependency policy](docs/DEPENDENCIES.md) describes the
14-day npm release delay, explicitly approved exceptions and the maintenance
process. Automated checks cannot establish that a dependency is free of unknown
vulnerabilities or malicious code.
