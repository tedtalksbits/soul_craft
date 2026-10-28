# 0008. Character art is generated from source scripts

- Status: accepted
- Date: 2026-10-28

## Context

The first real character art (the Ashen One) arrived as PNGs together with the Python scripts that
produced them: a voxel model ray-cast in eight directions. Hand-editing 40 frames for every proportion,
palette or pose change does not scale, and new animations (attack, roll and so on) are still to come.

## Decision

The generators live in `tools/art/` and are the source of truth for their sheets. They write
`assets/sprites/<sheet>.png` and `.json` directly in the engine format, deterministically, and the outputs
are committed alongside script changes. They run in a project-local venv (`pnpm art:setup`,
`pnpm art <tool>`) with pinned numpy and Pillow; SciPy was replaced by a numpy blur proven equivalent.
Idle and walk share one model, idle being a neutral pose, so they cannot drift apart. Sheets may carry
8-way animations and named pivots; the renderer derives diagonals from movement while the sim stays
4-way.

## Consequences

- Art changes are reviewable code diffs. Regenerating without changes produces no diff.
- Contributors who only touch TypeScript never need Python; the generated files are committed.
- Effects attach through sheet pivots, so art can change size without code changes.
- Placeholder generation no longer covers sheets that have real art.
