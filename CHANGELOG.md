# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-11-07

First public release.

### Added

- Manifest V3 extension for Microsoft Edge and Google Chrome (110+).
- Automated Bing searches typed into the bing.com search box, run in background tabs.
- Live points tracking: start balance, current balance and points earned during a run.
- Daily search limit check before a run, and auto-stop once Bing search is maxed.
- Search queries built from live Google Trends topics and Bing autocomplete, with no fixed word list and no repeats within a day.
- Bing cooldown detection: pauses after three searches with no new points, then resumes automatically (up to six pauses per run).
- Optional daily reminder card with today's open tasks, including unfinished "Keep earning" offers, plus a preview button.
- Settings panel: default search count, pace, auto-stop, cooldown wait, reminder schedule, theme and reduced motion.
- Light and dark themes with animated counters and transitions.
- A run cut off by closing the browser is not restarted on the next launch; the popup explains what happened instead.
- Release workflow that builds a ready-to-load zip for every `v*` tag.

[Unreleased]: https://github.com/ForhadHossain71/bing-rewards-search-automator/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/ForhadHossain71/bing-rewards-search-automator/releases/tag/v1.0.0
