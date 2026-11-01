import type { CommandDef } from '../core/commands';
import type { Simulation } from './simulation';

/**
 * Systems run once per tick, grouped by phase in this order. Within a phase
 * they run in module registration order (see modules/index.ts).
 */
export const PHASES = ['world', 'control', 'ai', 'physics', 'combat', 'cleanup'] as const;
export type Phase = (typeof PHASES)[number];

export type System = (sim: Simulation) => void;

/**
 * A system and when it runs. `menu` systems also run while a menu holds the world still (an open
 * panel, or resting at a bonfire): they apply the menu's actions. Everything else waits.
 */
export interface SystemDef {
  readonly phase: Phase;
  readonly run: System;
  readonly menu?: boolean;
}

/** What a simulation-level console command can touch. */
export interface SimContext {
  readonly sim: Simulation;
}
export type SimCommand = CommandDef<SimContext>;

/**
 * A feature's contribution to the simulation. New gameplay features are new
 * modules: they bring their own systems and dev commands and are listed once
 * in modules/index.ts.
 */
export interface SimModule {
  readonly id: string;
  readonly systems?: readonly SystemDef[];
  readonly commands?: readonly SimCommand[];
}
