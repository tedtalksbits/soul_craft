import { Container, Graphics, Sprite } from 'pixi.js';
import type { StatId } from '../../content/schemas';
import { TICK_RATE } from '../../sim/constants';
import { ABILITY_SLOTS } from '../../content/schemas';
import {
  Abilities,
  Buffs,
  Empowered,
  Equipment,
  Health,
  Inventory,
  Player,
  Stamina,
} from '../../sim/components';
import { FULL_ENERGY } from '../../sim/modules/energy';
import { countItem } from '../../sim/modules/items';
import type { Simulation } from '../../sim/simulation';
import type { Assets } from '../assets';
import { DEFAULT_BINDINGS, hudKeyLabel, type Binding, type Bindings } from '../keybinds';
import { slotUnlocked } from '../../sim/modules/unlocks';
import { classPalette } from './class-palette';
import { Compass } from './compass';
import { PixelText } from './pixel-text';

/** Buff pip colors, matching the potions that grant them. */
const BUFF_COLORS: Readonly<Record<StatId, number>> = {
  damage: 0xff7a30,
  defense: 0x8a8778,
  staminaRegen: 0x7ad8d0,
  maxHp: 0xc43a2a,
};

/** Screen-space HUD: health (with chip), stamina, flasks, quick item, buffs and souls. */
export class Hud {
  readonly root = new Container();
  private readonly g = new Graphics();
  private readonly flasks: PixelText;
  private readonly souls: PixelText;
  private readonly quickIcon = new Sprite();
  private readonly quickCount: PixelText;
  private chip = 1;
  private chipHoldMs = 0;
  private lastHp = -1;
  private shownSouls = -1;
  /** Drives the full-super glow. */
  private clockMs = 0;
  /** The player's key bindings, for the key labels on the slots. */
  bindings: Bindings = DEFAULT_BINDINGS;
  /** Key labels: the three ability slots, then the quick item. */
  private readonly keyLabels: PixelText[];
  /** The class sigil and the three ability icons, tinted with the class's element. */
  private readonly sigil = new Sprite();
  private readonly abilityIcons = [new Sprite(), new Sprite(), new Sprite()];
  /** Drawn over the icons: cooldown fills and the super's glow. */
  private readonly over = new Graphics();
  private readonly compass: Compass;
  /** From settings. */
  showCompass = true;
  /** Which of the three ability slots are not yet awakened (no key label, no fill). */
  private locked = [false, false, false];

  constructor(
    private readonly assets: Assets,
    private viewW: number,
    private viewH: number,
  ) {
    this.flasks = new PixelText(assets);
    this.souls = new PixelText(assets);
    this.quickCount = new PixelText(assets);
    this.keyLabels = [0, 1, 2, 3].map(() => new PixelText(assets));
    this.compass = new Compass(assets);
    this.root.addChild(
      this.g,
      this.sigil,
      ...this.abilityIcons,
      this.over,
      this.flasks,
      this.souls,
      this.quickIcon,
      this.quickCount,
      ...this.keyLabels,
      this.compass.root,
    );
  }

  /** The view changed size (window resize, fill mode): the bottom and right edges move. */
  resize(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
  }

  /**
   * The class sigil, then F / C / V: each ability's icon in the class's color. A ready ability
   * is bright; one cooling down is dim, with the slot filling back up from the bottom. The
   * super fills with energy, glows when full, and shows the time left while it runs.
   */
  private drawAbilities(sim: Simulation, g: Graphics): void {
    const over = this.over.clear();
    const a = sim.ecs.get(sim.player, Abilities);
    const cls = a ? sim.content.classes[a.class] : undefined;
    const shown = a !== undefined && cls !== undefined;
    this.sigil.visible = shown;
    for (const icon of this.abilityIcons) icon.visible = shown;
    if (!a || !cls) return;
    const pal = classPalette(sim.content, a.class);
    const y = this.viewH - 6 - SLOT;

    const sigil = this.assets.sheet('sigils')?.named.get(a.class);
    this.sigil.visible = sigil !== undefined;
    if (sigil) {
      this.sigil.texture = sigil;
      this.sigil.tint = pal.base;
      this.sigil.position.set(SIGIL_X, y);
    }

    this.locked = ABILITY_SLOTS.map((slot) => !slotUnlocked(a, slot));
    ABILITY_SLOTS.forEach((slot, i) => {
      const x = slotX(i);
      const def = sim.content.abilities[cls.abilities[slot]];
      let fill: number;
      if (slot === 'super') fill = a.energy / FULL_ENERGY;
      else {
        const total = (def?.cooldown ?? 0) * TICK_RATE;
        fill = total > 0 ? 1 - a.cooldowns[slot] / total : 1;
      }
      const locked = this.locked[i] === true;
      const ready = fill >= 1 && !locked;
      g.rect(x - 1, y - 1, SLOT + 2, SLOT + 2).fill({ color: 0x000000, alpha: 0.65 });
      g.rect(x, y, SLOT, SLOT).fill({ color: pal.dark, alpha: 0.6 });

      const icon = this.abilityIcons[i];
      const tex = this.assets.sheet('abilities')?.named.get(cls.abilities[slot]);
      if (icon) {
        icon.visible = tex !== undefined;
        if (tex) icon.texture = tex;
        // A locked slot shows its icon as a faint gray silhouette: there to see, not yet to use.
        icon.tint = locked ? 0x6a6a70 : ready ? pal.light : pal.base;
        icon.alpha = locked ? 0.3 : ready ? 1 : 0.45;
        icon.position.set(x, y);
      }
      if (locked) return;
      if (!ready) {
        const h = Math.round(SLOT * Math.min(1, fill));
        over.rect(x, y + SLOT - h, SLOT, h).fill({ color: pal.base, alpha: 0.3 });
      } else if (slot === 'super') {
        const pulse = 0.4 + 0.4 * Math.sin(this.clockMs / 160);
        over.rect(x - 2, y - 2, SLOT + 4, SLOT + 4).stroke({ color: pal.light, alpha: pulse, width: 1 });
      }
    });
    const emp = sim.ecs.get(sim.player, Empowered);
    const seconds = sim.content.abilities[cls.abilities.super]?.effects.find(
      (fx) => fx.type === 'empower',
    )?.seconds;
    if (emp && seconds) {
      over.rect(slotX(2), y - 4, Math.round(SLOT * (emp.ticks / (seconds * TICK_RATE))), 2).fill(pal.base);
    }
  }

  /** Each slot's key in its top-left corner, so the HUD itself says what to press. */
  private labelKeys(quickShown: boolean): void {
    const y = this.viewH - 6 - SLOT;
    LABELED.forEach((binding, i) => {
      const t = this.keyLabels[i];
      if (!t) return;
      const code = this.bindings[binding][0];
      t.visible = code !== undefined && (binding === 'item' ? quickShown : this.locked[i] !== true);
      t.set(code ? hudKeyLabel(code) : '', 0xffffff);
      if (binding === 'item') t.position.set(27, 17);
      else t.position.set(slotX(i) + 1, y + 1);
    });
  }

  reset(): void {
    this.lastHp = -1;
    this.shownSouls = -1;
  }

  update(sim: Simulation, dtMs: number): void {
    const e = sim.player;
    const health = sim.ecs.get(e, Health);
    const stamina = sim.ecs.get(e, Stamina);
    const player = sim.ecs.get(e, Player);
    if (!health || !stamina || !player) return;

    const frac = Math.max(0, health.hp / health.max);
    if (this.lastHp >= 0 && health.hp < this.lastHp) this.chipHoldMs = 500;
    if (this.lastHp < 0 || health.hp > this.lastHp) this.chip = frac;
    this.lastHp = health.hp;
    if (this.chipHoldMs > 0) this.chipHoldMs -= dtMs;
    else this.chip = Math.max(frac, this.chip - dtMs / 700);

    const g = this.g.clear();
    const hpW = Math.round(health.max * 0.8);
    bar(g, 6, 6, hpW, 4, frac, 0xa3261c, this.chip);
    this.compass.root.visible = this.showCompass;
    if (this.showCompass) this.compass.update(sim, this.viewW, 6 + hpW);
    const stW = Math.round(stamina.max * 0.6);
    const low = stamina.value < 20;
    bar(g, 6, 12, stW, 2, Math.max(0, stamina.value / stamina.max), low ? 0x9a7a30 : 0x5c9a44);

    // Flask: a little bottle, grayed out when empty.
    const full = player.flasks > 0;
    g.rect(8, 18, 3, 2).fill(0xc8b898);
    g.rect(7, 20, 5, 6).fill(full ? 0xff9a30 : 0x555555);
    this.flasks.set(String(player.flasks), full ? 0xe8e0cc : 0x888888);
    this.flasks.position.set(15, 20);

    // Quick item (Q): its icon and how many are left, grayed out at zero.
    const quick = sim.ecs.get(e, Equipment)?.quick ?? null;
    const quickDef = quick ? sim.content.items[quick] : undefined;
    const tex = quickDef ? this.assets.sheet('items')?.named.get(quickDef.icon) : undefined;
    this.quickIcon.visible = tex !== undefined;
    this.quickCount.visible = tex !== undefined;
    if (tex && quick) {
      const left = countItem(sim.ecs.need(e, Inventory), quick);
      g.rect(26, 16, 16, 16).fill({ color: 0x000000, alpha: 0.5 });
      this.quickIcon.texture = tex;
      this.quickIcon.position.set(26, 16);
      this.quickIcon.alpha = left > 0 ? 1 : 0.35;
      this.quickCount.set(String(left), left > 0 ? 0xe8e0cc : 0x888888);
      this.quickCount.position.set(44, 20);
    }

    // Buffs: a pip per active buff, its bar running down with the time left.
    let bx = 6;
    for (const b of sim.ecs.get(e, Buffs)?.active ?? []) {
      const def = sim.content.items[b.source];
      const total =
        def?.kind === 'consumable' && def.effect.type === 'buff' ? def.effect.seconds * TICK_RATE : b.ticks;
      g.rect(bx, 34, 5, 5).fill(BUFF_COLORS[b.stat]);
      g.rect(bx, 40, 5, 1).fill({ color: 0x000000, alpha: 0.6 });
      g.rect(bx, 40, Math.max(1, Math.round((5 * b.ticks) / total)), 1).fill(0xe8e0cc);
      bx += 8;
    }

    this.clockMs += dtMs;
    this.drawAbilities(sim, g);
    this.labelKeys(tex !== undefined);

    // Souls count up toward the true value.
    if (this.shownSouls < 0) this.shownSouls = player.souls;
    const diff = player.souls - this.shownSouls;
    this.shownSouls += Math.abs(diff) < 1 ? diff : diff * Math.min(1, dtMs / 180);
    const shown = String(Math.round(this.shownSouls));
    this.souls.set(shown, diff > 0 ? 0xffffff : 0xd8e4ff);
    const sx = this.viewW - 8 - this.souls.pixelWidth;
    const sy = this.viewH - 12;
    this.souls.position.set(sx, sy);
    g.rect(sx - 13, sy - 4, this.souls.pixelWidth + 19, 12).fill({ color: 0x000000, alpha: 0.5 });
    g.rect(sx - 9, sy + 1, 3, 3).fill(0xe8f0ff);
    g.rect(sx - 8, sy - 1, 1, 2).fill(0xa8c0ff);
  }
}

/** Ability slot size (px): the icons' size, shown at 1x. */
const SLOT = 16;
const SLOT_GAP = 3;

/** The slots that get a key label: the three abilities, then the quick item. */
const LABELED: readonly Binding[] = ['aoe', 'classAbility', 'super', 'item'];

/** The class sigil sits at the left; the three ability slots follow it. */
const SIGIL_X = 6;
const slotX = (i: number) => SIGIL_X + SLOT + 4 + i * (SLOT + SLOT_GAP);

function bar(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  frac: number,
  color: number,
  chip?: number,
): void {
  g.rect(x - 1, y - 1, w + 2, h + 2).fill({ color: 0x000000, alpha: 0.65 });
  if (chip !== undefined) g.rect(x, y, Math.round(w * chip), h).fill(0xe8d8b0);
  g.rect(x, y, Math.round(w * frac), h).fill(color);
}
