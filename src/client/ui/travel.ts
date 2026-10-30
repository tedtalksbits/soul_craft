/**
 * The bonfire travel screen: every lit bonfire, nearest first, with where it
 * is and how far. Picking one warps there (a `travel` action).
 */
import { h } from './dom';

export interface TravelDestination {
  id: string;
  name: string;
  /** The area or biome it stands in, to tell same-named shrines apart. */
  area: string;
  /** Paces (tiles) from here, and the compass direction, e.g. "NE". */
  paces: number;
  direction: string;
  /** The bonfire the player is resting at now. */
  here: boolean;
}

export interface TravelScreenOptions {
  destinations: readonly TravelDestination[];
  travel(id: string): void;
  cancel(): void;
}

export function travelScreen(o: TravelScreenOptions): HTMLElement {
  const rows = o.destinations.map((d) =>
    h(
      'div',
      { class: d.here ? 'slot here' : 'slot' },
      h(
        'div',
        { class: 'info' },
        h('div', { class: 'name' }, d.name),
        h(
          'div',
          { class: 'meta' },
          d.here ? `${d.area} · you are here` : `${d.area} · ${d.paces} paces ${d.direction}`,
        ),
      ),
      h('button', { disabled: d.here, onclick: () => o.travel(d.id) }, d.here ? 'Here' : 'Travel'),
    ),
  );
  return h(
    'div',
    { class: 'screen travel' },
    h('h1', {}, 'TRAVEL'),
    h('div', { class: 'sub' }, 'Warp to any bonfire you have lit. Light more to go further.'),
    h('div', { class: 'slots' }, ...rows),
    h('button', { class: 'quiet', onclick: () => o.cancel() }, 'Stay (Esc)'),
  );
}

const DIRECTIONS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'] as const;

/** The 8-way compass direction of a vector in screen space (y grows downward). */
export function compassDirection(dx: number, dy: number): string {
  const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return DIRECTIONS[(octant + 8) % 8] ?? 'N';
}
