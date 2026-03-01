# Changelog

All notable changes to this project will be documented in this file.

## [0.2] - 2026-03-01

### Added
- Feature tracking for player rounds won, updating the UI to display the total number of rounds won by each player at the conclusion of each minute round.

### Changed
- Reverted the short-lived speed update throttling mechanism. The speedometer now updates per-frame to ensure real-time responsiveness and accuracy without a 1/10th of a second throttle.
- Updated npm packages and dependencies.
