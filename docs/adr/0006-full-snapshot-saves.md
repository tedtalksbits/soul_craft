# 0006. Saves are versioned full snapshots with migrations and a backup

- Status: accepted
- Date: 2026-10-28

## Context

Souls-like games autosave constantly. Players must never lose a world to a bad write or an update.

## Decision

A save is `{ format, version, meta, snapshot }` where the snapshot is the complete sim state. Version bumps
come with pure, ordered migrations. Each slot keeps one rolling backup used when the primary is unreadable.
Dev snapshots share the envelope.

## Consequences

- Load restores the exact moment, and exported snapshots double as bug reports.
- Any change to component shapes needs a migration and a test.
