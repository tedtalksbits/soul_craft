/**
 * Per-device settings (controls, display, audio, which tutorial hints were
 * seen), kept in the browser's local storage like a game's options file.
 * They are separate from save slots: rebinding a key applies to every save.
 * Storage can be missing or throw (private windows, blocked site data), so
 * every read and write is guarded and the game runs on defaults without it.
 */
import { z } from 'zod';
import { ALL_BINDINGS, DEFAULT_BINDINGS, type Binding, type Bindings } from './keybinds';

const STORAGE_KEY = 'soul-craft-settings';

export interface Settings {
  bindings: Bindings;
  /** Fill the window by showing a little more world, instead of black borders. */
  fill: boolean;
  /** The compass bar across the top of the HUD. */
  compass: boolean;
  /** 0-1. */
  volume: number;
  muted: boolean;
  /** Tutorial hints already shown, by id. */
  seenHints: readonly string[];
}

export const DEFAULT_SETTINGS: Settings = {
  bindings: DEFAULT_BINDINGS,
  fill: true,
  compass: true,
  volume: 0.8,
  muted: false,
  seenHints: [],
};

const StoredSchema = z.object({
  bindings: z.record(z.string(), z.array(z.string())).optional(),
  fill: z.boolean().optional(),
  compass: z.boolean().optional(),
  volume: z.number().min(0).max(1).optional(),
  muted: z.boolean().optional(),
  seenHints: z.array(z.string()).optional(),
});

/** Stored settings over the defaults. Unknown or broken values fall back; new actions get their defaults. */
export function parseSettings(raw: unknown): Settings {
  const stored = StoredSchema.safeParse(raw);
  if (!stored.success) return DEFAULT_SETTINGS;
  const s = stored.data;
  const bindings: Record<Binding, readonly string[]> = { ...DEFAULT_BINDINGS };
  for (const b of ALL_BINDINGS) {
    const keys = s.bindings?.[b];
    if (keys) bindings[b] = keys;
  }
  return {
    bindings,
    fill: s.fill ?? DEFAULT_SETTINGS.fill,
    compass: s.compass ?? DEFAULT_SETTINGS.compass,
    volume: s.volume ?? DEFAULT_SETTINGS.volume,
    muted: s.muted ?? DEFAULT_SETTINGS.muted,
    seenHints: s.seenHints ?? [],
  };
}

export class SettingsStore {
  private value: Settings;
  private readonly listeners = new Set<(s: Settings) => void>();

  constructor() {
    this.value = DEFAULT_SETTINGS;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) this.value = parseSettings(JSON.parse(raw));
    } catch {
      // No storage (private window, blocked site data) or a corrupt entry: run on defaults.
    }
  }

  get current(): Settings {
    return this.value;
  }

  update(change: Partial<Settings>): void {
    this.value = { ...this.value, ...change };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.value));
    } catch {
      // Not saved; the change still applies for this session.
    }
    for (const fn of this.listeners) fn(this.value);
  }

  /** Calls `fn` now and on every change. */
  watch(fn: (s: Settings) => void): () => void {
    this.listeners.add(fn);
    fn(this.value);
    return () => this.listeners.delete(fn);
  }
}
