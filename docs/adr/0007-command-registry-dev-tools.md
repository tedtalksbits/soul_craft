# 0007. One command registry for console, scenarios and tests

- Status: accepted
- Date: 2026-10-28

## Context

Development must not be gated behind progression. The same "put the game in state X" operations are needed
interactively, in boot URLs and in automated tests.

## Decision

`CommandRegistry` (in pure `src/core`) with typed, validated arguments and completion. Sim modules
contribute their own commands; the console, `?scenario=` / `?cmd=` URLs and tests all execute through it.
Dev tools load lazily, only in dev builds or with `?dev`.

## Consequences

- Each feature brings its own debug commands. Scenarios are just command lists in content.
- Player bundles do not include the dev tools.
