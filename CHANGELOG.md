# Changelog

All notable changes to this project will be documented in this file.

## [0.3.2] - 2026-05-19

### Changed

- Refined the theme system so sidebar chrome, palette, export surfaces, fullscreen panels, overlays, and elevation all stay tinted by the active theme instead of falling back to dark neutral fills.
- Updated the README feature list to call out the built-in theme picker and synchronized light/dark UI chrome.

### Fixed

- Passed highlighted comment state into both diff layouts so focused comments no longer crash the main workspace.
- Removed the hardcoded sidebar version label so the UI now reflects the published package version automatically.

## [0.3.1] - 2026-05-19

### Added

- Published `CHANGELOG.md` in the npm package so release notes ship with the CLI.

### Changed

- Expanded the README release guidance with a changelog pointer and a short publish checklist.

### Fixed

- Prevented the DiffViewer from entering a scroll feedback loop when the workspace chrome toggles compact mode near the top of the diff.

## [0.3.0] - 2026-05-15

### Added

- Published the 0.3 line with the browser review workspace, inline findings, review history, local exports, and the `diffvision-mcp` stdio server.
