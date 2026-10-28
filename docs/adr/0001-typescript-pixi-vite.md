# 0001. TypeScript + PixiJS + Vite, web first

- Status: accepted
- Date: 2026-10-28

## Context

The prototype is a single HTML file. Targets are the web now and desktop (Steam) later. Development is shared
between people and AI agents, so the stack must be text-first, strongly typed and quick to iterate on.

## Decision

Strict TypeScript, PixiJS 8 for WebGL rendering, Vite for dev server, hot reload and bundling, Vitest for
tests, pnpm. Desktop ships later by wrapping the web build (Tauri or Electron).

## Consequences

- Fast reload loop; no editor-bound scene files, so every change is a reviewable text diff.
- We own engine concerns (ECS, physics, loop) ourselves; kept small on purpose (ADR 0003).
- typescript-eslint pins TypeScript to `~6.0` until it supports TypeScript 7.
