/**
 * The class screen: three cards, one per class, with its abilities on their
 * keys. Shown before a new game starts, and at a bonfire to change class.
 */
import type { Content } from '../../content/content';
import { ABILITY_SLOTS, type AbilitySlot } from '../../content/schemas';
import { unlockHint } from '../../sim/modules/unlocks';
import { primaryKey, type Bindings } from '../keybinds';
import { h } from './dom';

export interface ClassScreenOptions {
  content: Content;
  /** The player's class now, marked on its card; null before a new game. */
  current: string | null;
  mode: 'newGame' | 'bonfire';
  bindings: Bindings;
  /** Which slots are awakened: the player's at a bonfire, the start's on a new game. */
  unlocked: { class: boolean; super: boolean };
  sigil(cls: string): HTMLElement;
  abilityIcon(ability: string): HTMLElement;
  pick(id: string): void;
  cancel(): void;
}

const SLOT_BINDING = { aoe: 'aoe', class: 'classAbility', super: 'super' } as const satisfies Record<
  AbilitySlot,
  string
>;

export function classScreen(o: ClassScreenOptions): HTMLElement {
  const cards = Object.entries(o.content.classes).map(([id, cls]) => {
    const isCurrent = id === o.current;
    const abilities = ABILITY_SLOTS.map((slot) => {
      const def = o.content.ability(cls.abilities[slot]);
      const locked = slot !== 'aoe' && !o.unlocked[slot];
      return h(
        'li',
        locked ? { class: 'locked' } : {},
        h(
          'div',
          { class: 'keys' },
          o.abilityIcon(cls.abilities[slot]),
          h('kbd', {}, primaryKey(o.bindings, SLOT_BINDING[slot])),
        ),
        h(
          'div',
          {},
          h('div', { class: 'ability' }, def.name),
          h('div', { class: 'what' }, def.description),
          locked ? h('div', { class: 'locked-note' }, unlockHint(o.content, slot)) : null,
        ),
      );
    });
    const card = h(
      'div',
      { class: isCurrent ? 'class-card current' : 'class-card' },
      h(
        'div',
        { class: 'card-head' },
        o.sigil(id),
        h('div', {}, h('h2', {}, cls.name), h('div', { class: 'element' }, cls.element.name)),
      ),
      h('p', { class: 'about' }, cls.description),
      h('ul', {}, ...abilities),
      h(
        'button',
        { disabled: isCurrent, onclick: () => o.pick(id) },
        isCurrent ? 'Your class' : o.mode === 'newGame' ? `Begin as ${cls.name}` : `Become ${cls.name}`,
      ),
    );
    card.style.setProperty('--class-color', cls.element.base);
    card.style.setProperty('--class-light', cls.element.light);
    card.style.setProperty('--class-dark', cls.element.dark);
    return card;
  });
  return h(
    'div',
    { class: 'screen classes' },
    h('h1', {}, o.mode === 'newGame' ? 'CHOOSE YOUR PATH' : 'ATTUNE'),
    h(
      'div',
      { class: 'sub' },
      o.mode === 'newGame'
        ? 'You can change class later, when you rest at a bonfire.'
        : 'Your abilities change at once. Super energy is kept.',
    ),
    h('div', { class: 'class-cards' }, ...cards),
    h(
      'button',
      { class: 'quiet', onclick: () => o.cancel() },
      o.mode === 'newGame' ? 'Back' : 'Keep my class (Esc)',
    ),
  );
}
