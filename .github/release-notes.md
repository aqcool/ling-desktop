LING Desktop local application packages.

- macOS: Apple Silicon (arm64) and Intel (x64) DMG.
- Windows: x64 NSIS installer.
- Linux: x64 AppImage and Debian package.

Every package passed its native headless build, tests, dependency audit and relocated-runtime smoke. Qualification reports and SHA256SUMS accompany the installers.

These builds are unsigned on Windows and ad-hoc signed on macOS, without Apple notarization. OS installation warnings may appear. Automatic in-app updates are not enabled. Existing user profiles are retained.
