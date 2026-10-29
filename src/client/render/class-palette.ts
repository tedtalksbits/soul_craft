/**
 * A class's element colors as numbers for Pixi (and strings for CSS). Every
 * class-colored thing (ability effects, HUD, light, damage numbers, menus)
 * reads from here, so changing a class's element in content changes it all.
 */
import type { Content } from '../../content/content';

export interface Palette {
  name: string;
  light: number;
  base: number;
  dark: number;
}

const WHITE: Palette = { name: '', light: 0xffffff, base: 0xffffff, dark: 0x808080 };

const hex = (c: string) => Number.parseInt(c.slice(1), 16);

/** The palette of a class, or white for an unknown one. */
export function classPalette(content: Content, cls: string): Palette {
  const el = content.classes[cls]?.element;
  return el ? { name: el.name, light: hex(el.light), base: hex(el.base), dark: hex(el.dark) } : WHITE;
}

/** The palette of the class an ability belongs to, or white for an ability no class uses. */
export function abilityPalette(content: Content, ability: string): Palette {
  for (const [id, cls] of Object.entries(content.classes)) {
    if (Object.values(cls.abilities).includes(ability)) return classPalette(content, id);
  }
  return WHITE;
}
