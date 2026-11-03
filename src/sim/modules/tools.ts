/**
 * Gathering tools (the owner's call, 2026-11-02): crafted, never loot, no Power, and kept apart from weapons. They
 * sit on the tool belt, one per kind. Attacking a tree or rock with the right tool on the belt swings that tool
 * instead of the weapon (a plain swing), and only tools fell trees and break rock. Each swing wears the tool down;
 * worn out, it breaks, and a new one has to be crafted: the materials' long-term sink.
 */
import type { Entity } from '../../core/ecs';
import { overlaps, type Box } from '../../core/math';
import type { ToolKind } from '../../content/schemas';
import { Body, Dying, Enemy, Inventory, Toolbelt, type ItemStack, type Player } from '../components';
import { TILE } from '../constants';
import type { SimCommand, SimModule } from '../module';
import type { Simulation } from '../simulation';
import { bodyBox } from '../physics';

const EMPTY_BELT: Toolbelt = { axe: null, pick: null };

export function toolbelt(sim: Simulation): Toolbelt {
  return sim.ecs.get(sim.player, Toolbelt) ?? sim.ecs.add(sim.player, Toolbelt, { ...EMPTY_BELT });
}

/** The tool belt as it stands, for reading only (the client): an empty one if the player has none yet. */
export function beltOf(sim: Simulation): Readonly<Toolbelt> {
  return sim.ecs.get(sim.player, Toolbelt) ?? EMPTY_BELT;
}

/** A player from before tools (an older save) is given the starting ones, once. */
function ensureBelt(sim: Simulation): void {
  if (!sim.ecs.has(sim.player, Toolbelt)) giveStartingTools(sim, sim.player);
}

/** A tool's numbers, if the item is one. */
export function toolDef(sim: Simulation, item: string) {
  const def = sim.content.items[item];
  return def?.kind === 'tool' ? def.tool : undefined;
}

/** Swings a tool has left before it breaks. */
export function durabilityLeft(sim: Simulation, stack: ItemStack): number {
  return stack.durability ?? toolDef(sim, stack.item)?.durability ?? 0;
}

/** The tool on the belt for a kind, with its numbers. */
export function beltTool(sim: Simulation, kind: ToolKind) {
  const stack = toolbelt(sim)[kind];
  const def = stack ? toolDef(sim, stack.item) : undefined;
  return stack && def ? { stack, def } : null;
}

/** Puts the starting tools on the belt. */
export function giveStartingTools(sim: Simulation, e: Entity): void {
  const belt = sim.ecs.get(e, Toolbelt) ?? sim.ecs.add(e, Toolbelt, { ...EMPTY_BELT });
  for (const item of sim.content.player.start.tools) {
    const def = toolDef(sim, item);
    if (def) belt[def.kind] = { item, count: 1, level: 0, durability: def.durability };
  }
}

/** Puts a carried tool (by pack index) on the belt, the one there going back to the pack. */
export function equipTool(sim: Simulation, index: number): boolean {
  const inv = sim.ecs.need(sim.player, Inventory);
  const stack = inv.stacks[index];
  const def = stack ? toolDef(sim, stack.item) : undefined;
  if (!stack || !def) return false;
  const belt = toolbelt(sim);
  const previous = belt[def.kind];
  inv.stacks.splice(index, 1, ...(previous ? [previous] : []));
  belt[def.kind] = stack;
  sim.events.emit({ type: 'equipped', item: stack.item, slot: def.kind });
  return true;
}

/** Takes a tool off the belt, into the pack (tools never run out of room there). */
export function unequipTool(sim: Simulation, kind: ToolKind): boolean {
  const belt = toolbelt(sim);
  const stack = belt[kind];
  if (!stack) return false;
  belt[kind] = null;
  sim.ecs.need(sim.player, Inventory).stacks.push(stack);
  sim.events.emit({ type: 'unequipped', item: stack.item, slot: kind });
  return true;
}

/** The box a tool swing strikes: just in front of the player, the way they face. */
export function toolBox(sim: Simulation, p: Player): Box {
  const body = sim.ecs.need(sim.player, Body);
  const { reach, width } = sim.content.player.toolSwing;
  const ax = Math.abs(p.dirX);
  const ay = Math.abs(p.dirY);
  const w = ax * reach + ay * width;
  const h = ax * width + ay * reach;
  const cx = body.x + p.dirX * (body.w / 2 + reach / 2);
  const cy = body.y + p.dirY * (body.h / 2 + reach / 2);
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/**
 * Whether an attack now should be a tool swing, and with which tool: something in the tool box needs a tool the belt
 * holds, and no foe stands there (a foe always gets the weapon).
 */
export function gatherTarget(sim: Simulation, p: Player): ToolKind | null {
  const box = toolBox(sim, p);
  for (const [e, , b] of sim.ecs.query(Enemy, Body))
    if (!sim.ecs.has(e, Dying) && overlaps(box, bodyBox(b))) return null;
  for (let ty = Math.floor(box.y / TILE); ty <= Math.floor((box.y + box.h) / TILE); ty++)
    for (let tx = Math.floor(box.x / TILE); tx <= Math.floor((box.x + box.w) / TILE); tx++) {
      const kind = sim.world.tileAt(tx, ty)?.cut?.tool;
      if (kind && beltTool(sim, kind)) return kind;
    }
  return null;
}

/** A swing of the tool: one more wear on it; worn out, it breaks and leaves the belt. */
export function wearTool(sim: Simulation, kind: ToolKind): void {
  const belt = toolbelt(sim);
  const stack = belt[kind];
  if (!stack) return;
  stack.durability = durabilityLeft(sim, stack) - 1;
  if (stack.durability > 0) return;
  belt[kind] = null;
  sim.events.emit({ type: 'toolBroke', item: stack.item });
}

const commands: SimCommand[] = [
  {
    name: 'tools',
    description: 'Print the tool belt and how many swings each tool has left.',
    run: ({ sim }) =>
      (['axe', 'pick'] as const)
        .map((k) => {
          const t = beltTool(sim, k);
          return `${k.padEnd(5)} ${t ? `${t.stack.item} (${durabilityLeft(sim, t.stack)}/${t.def.durability})` : '-'}`;
        })
        .join('\n'),
  },
];

export const toolsModule: SimModule = {
  id: 'tools',
  systems: [{ phase: 'control', run: ensureBelt, menu: true }],
  commands,
};
