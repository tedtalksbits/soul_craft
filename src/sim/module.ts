import type { CommandDef } from '../core/commands';
import type { Simulation } from './simulation';

/**
 * Systems run once per tick, grouped by phase in this order. Within a phase
 * they run in module registration order (see modules/index.ts).
 */
export const PHASES = ['world', 'control', 'ai', 'physics', 'combat', 'cleanup'] as const;
export type Phase = (typeof PHASES)[number];

export type System = (sim: Simulation) => void;

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
  readonly systems?: readonly { readonly phase: Phase; readonly run: System }[];
  readonly commands?: readonly SimCommand[];
}
