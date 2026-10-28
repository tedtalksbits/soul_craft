import { Container, Graphics } from 'pixi.js';
import { Health, Player, Stamina } from '../../sim/components';
import type { Simulation } from '../../sim/simulation';
import type { Assets } from '../assets';
import { PixelText } from './pixel-text';

/** Screen-space HUD: health (with chip), stamina, flasks and souls. */
export class Hud {
  readonly root = new Container();
  private readonly g = new Graphics();
  private readonly flasks: PixelText;
  private readonly souls: PixelText;
  private chip = 1;
  private chipHoldMs = 0;
  private lastHp = -1;
  private shownSouls = -1;

  constructor(
    assets: Assets,
    private readonly viewW: number,
    private readonly viewH: number,
  ) {
    this.flasks = new PixelText(assets);
    this.souls = new PixelText(assets);
    this.root.addChild(this.g, this.flasks, this.souls);
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
    const stW = Math.round(stamina.max * 0.6);
    const low = stamina.value < 20;
    bar(g, 6, 12, stW, 2, Math.max(0, stamina.value / stamina.max), low ? 0x9a7a30 : 0x5c9a44);

    // Flask: a little bottle, greyed out when empty.
    const full = player.flasks > 0;
    g.rect(8, 18, 3, 2).fill(0xc8b898);
    g.rect(7, 20, 5, 6).fill(full ? 0xff9a30 : 0x555555);
    this.flasks.set(String(player.flasks), full ? 0xe8e0cc : 0x888888);
    this.flasks.position.set(15, 20);

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
