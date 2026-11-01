import { Container, Sprite } from 'pixi.js';
import { DEFAULT_APPEARANCE } from '../../content/appearance';
import { Appearance, Equipment, Player } from '../../sim/components';
import type { Simulation } from '../../sim/simulation';
import { currentMove, weaponType } from '../../sim/modules/weapons';
import type { Assets } from '../assets';
import { castFrame, selectAnim } from './anim-select';
import type { Dir8 } from './facing';

export const SKIN_COLORS = { fair: 0xf0d4b6, warm: 0xd4a574, brown: 0xa86e48, deep: 0x724a36 };
export const HAIR_COLORS = {
  black: 0x4a4345,
  brown: 0x89694c,
  auburn: 0xb16b48,
  blond: 0xd5bb79,
  silver: 0xd8d9ce,
};
const TIER_COLORS = {
  common: 0xffffff,
  standard: 0xc9ddbc,
  rare: 0xb7d6ee,
  noble: 0xceb9eb,
  legendary: 0xf0d599,
};

/** Match the artwork's anticipation, contact, follow-through and recovery to each move's hit window. */
export function swordFrame(
  t: number,
  move: { activeFrom: number; activeTo: number; duration: number },
): number {
  if (t < move.activeFrom) return Math.min(1, Math.floor((t / Math.max(1, move.activeFrom)) * 2));
  if (t <= move.activeTo) return t < (move.activeFrom + move.activeTo) / 2 ? 2 : 3;
  return 4;
}

export function playerLook(sim: Simulation) {
  const appearance = sim.ecs.get(sim.player, Appearance) ?? DEFAULT_APPEARANCE;
  const equipment = sim.ecs.need(sim.player, Equipment);
  const chest = equipment.chest ? sim.content.items[equipment.chest.item] : undefined;
  const helmet = equipment.helmet ? sim.content.items[equipment.helmet.item] : undefined;
  const outfit = chest?.kind === 'armor' ? chest.armor.weight : 'bare';
  const head =
    appearance.hideHelmet || helmet?.kind !== 'armor'
      ? null
      : helmet.armor.weight === 'plate'
        ? 'helm'
        : helmet.armor.weight === 'leather'
          ? 'cap'
          : 'hood';
  const tint = (tier: keyof typeof TIER_COLORS | undefined) => (tier ? TIER_COLORS[tier] : 0xffffff);
  return {
    appearance,
    sheetPrefix: appearance.prototype ? 'pf' : 'adventurer',
    scale: appearance.prototype ? 0.5 : 1,
    outfit,
    head,
    chestTint: tint(equipment.chest?.gear?.tier),
    headTint: tint(equipment.helmet?.gear?.tier),
    legsTint: equipment.legs ? 0x9da99d : 0x8a8070,
    hasSword: equipment.weapon !== null && weaponType(sim).id === 'sword',
  };
}

export function playerLayerSpecs(look: ReturnType<typeof playerLook>): [string, number][] {
  const specs: [string, number][] = [];
  if (look.hasSword) specs.push(['sword_back', 0xffffff]);
  if (look.appearance.prototype) {
    specs.push(['skin_bare', SKIN_COLORS[look.appearance.skin]]);
    if (look.head !== 'hood' && look.head !== 'helm' && look.appearance.hair !== 'bald')
      specs.push([`${look.appearance.hair}_back`, HAIR_COLORS[look.appearance.hairColor]]);
    specs.push(['legs', look.legsTint], [look.outfit, look.chestTint]);
  } else {
    specs.push(
      ['legs', look.legsTint],
      [look.outfit, look.chestTint],
      [`skin_${look.outfit}`, SKIN_COLORS[look.appearance.skin]],
    );
  }
  if (look.appearance.beard && look.head !== 'helm')
    specs.push(['beard', HAIR_COLORS[look.appearance.hairColor]]);
  if (look.head !== 'hood' && look.head !== 'helm' && look.appearance.hair !== 'bald')
    specs.push([look.appearance.hair, HAIR_COLORS[look.appearance.hairColor]]);
  if (look.head) specs.push([look.head, look.headTint]);
  if (look.hasSword) specs.push(['sword_front', 0xffffff]);
  return specs;
}

interface Part {
  sprite: Sprite;
  glow: Sprite;
}

/** Every player action uses the same customizable body and synchronized gear layers. */
export class PlayerAppearanceView {
  readonly root = new Container();
  private readonly parts: Part[] = [];

  constructor(private readonly assets: Assets) {}

  update(sim: Simulation, direction: Dir8, elapsedMs: number, alpha: number, flash: number): boolean {
    const player = sim.ecs.need(sim.player, Player);
    const look = playerLook(sim);
    const state = player.state;
    const move = state === 'attack' ? currentMove(sim) : null;
    const sheet = this.assets.sheet(`${look.sheetPrefix}_${look.outfit}`);
    const choice = selectAnim(sim, sim.player, direction, (key) => !!sheet?.anim(key));
    const key = choice.key;
    const bodyAnim = sheet?.anim(key);
    if (!bodyAnim) {
      this.root.visible = false;
      return false;
    }
    this.root.visible = true;
    this.root.alpha = alpha;
    this.root.scale.set(look.scale);
    const count = bodyAnim.textures.length;
    const time = choice.elapsedMs ?? elapsedMs;
    let index = Math.floor((time / 1000) * bodyAnim.fps);
    index = bodyAnim.loop ? index % count : Math.min(index, count - 1);
    if (move && key.startsWith('attack_')) index = swordFrame(player.t, move);
    if (choice.cast && bodyAnim.release !== undefined)
      index = castFrame(choice.cast, count, bodyAnim.release, bodyAnim.fps);
    const specs = playerLayerSpecs(look);
    for (let i = 0; i < Math.max(specs.length, this.parts.length); i++) {
      const spec = specs[i];
      if (!spec) {
        const part = this.parts[i];
        if (part) part.sprite.visible = part.glow.visible = false;
        continue;
      }
      let part = this.parts[i];
      if (!part) {
        part = { sprite: new Sprite(), glow: new Sprite() };
        part.glow.blendMode = 'add';
        this.root.addChild(part.sprite, part.glow);
        this.parts.push(part);
      }
      const anim = this.assets.sheet(`${look.sheetPrefix}_${spec[0]}`)?.anim(key);
      const texture = anim?.textures[index];
      part.sprite.visible = part.glow.visible = texture !== undefined;
      if (!texture) continue;
      part.sprite.texture = part.glow.texture = texture;
      part.sprite.anchor.set(0.5, 1);
      part.glow.anchor.set(0.5, 1);
      part.sprite.position.set(...anim.offset);
      part.glow.position.set(...anim.offset);
      part.sprite.tint = spec[1];
      part.glow.alpha = flash;
    }
    return true;
  }
}
