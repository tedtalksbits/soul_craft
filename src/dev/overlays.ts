/**
 * Debug visualisations: hitboxes, AI state, chunk borders, solid tiles and a
 * stats readout. Toggle with F1-F4/F5 or the `overlay` command.
 */
import { Container, Graphics, Text } from 'pixi.js';
import type { App } from '../client/app';
import { h } from '../client/ui/dom';
import { Ai, Body, Enemy, Health, Pickup, Player, Projectile } from '../sim/components';
import { CHUNK, TILE } from '../sim/constants';
import { attackBox } from '../sim/modules/player';
import { VIEW_H, VIEW_W } from '../client/render/renderer';

export const OVERLAYS = ['hitboxes', 'ai', 'chunks', 'solids', 'stats'] as const;
export type OverlayName = (typeof OVERLAYS)[number];

export const OVERLAY_KEYS: Readonly<Record<string, OverlayName>> = {
  F1: 'hitboxes',
  F2: 'ai',
  F3: 'chunks',
  F4: 'stats',
  F5: 'solids',
};

export class Overlays {
  readonly enabled: Record<OverlayName, boolean> = {
    hitboxes: false,
    ai: false,
    chunks: false,
    solids: false,
    stats: false,
  };
  private readonly g = new Graphics();
  private readonly labels = new Container();
  private readonly labelPool: Text[] = [];
  private readonly stats = h('div', { class: 'dev-stats hidden' });
  private fps = 60;

  constructor(private readonly app: App) {
    app.renderer.debugWorld.addChild(this.g, this.labels);
    document.body.append(this.stats);
    app.onFrame((dt) => this.update(dt));
  }

  set(name: OverlayName, on: boolean): void {
    this.enabled[name] = on;
  }

  private update(dtMs: number): void {
    this.fps += (1000 / Math.max(1, dtMs) - this.fps) * 0.05;
    const sim = this.app.sim;
    const g = this.g.clear();
    let label = 0;
    const text = (s: string, x: number, y: number, color = 0xffffff) => {
      let t = this.labelPool[label];
      if (!t) {
        t = new Text({ text: '', style: { fontFamily: 'monospace', fontSize: 8, fill: 0xffffff } });
        t.resolution = 2;
        this.labelPool.push(t);
        this.labels.addChild(t);
      }
      t.visible = true;
      t.text = s;
      t.style.fill = color;
      t.position.set(Math.round(x), Math.round(y));
      label++;
    };

    if (sim) {
      const cam = this.app.renderer.camera;
      const tx0 = Math.floor(cam.x / TILE) - 1;
      const ty0 = Math.floor(cam.y / TILE) - 1;
      const tw = Math.ceil(VIEW_W / TILE) + 2;
      const th = Math.ceil(VIEW_H / TILE) + 2;

      if (this.enabled.solids) {
        for (let ty = ty0; ty < ty0 + th; ty++)
          for (let tx = tx0; tx < tx0 + tw; tx++)
            if (sim.world.isSolid(tx, ty))
              g.rect(tx * TILE, ty * TILE, TILE, TILE).fill({ color: 0xff0000, alpha: 0.18 });
      }
      if (this.enabled.chunks) {
        const size = CHUNK * TILE;
        for (const c of sim.world.loaded) {
          g.rect(c.cx * size, c.cy * size, size, size).stroke({ width: 1, color: 0x40c0ff, alpha: 0.8 });
          text(`chunk ${c.key}`, c.cx * size + 3, c.cy * size + 3, 0x80d0ff);
          for (const a of c.areas) {
            g.rect(a.x0 * TILE, a.y0 * TILE, (a.x1 - a.x0 + 1) * TILE, (a.y1 - a.y0 + 1) * TILE).stroke({
              width: 1,
              color: 0xffc040,
              alpha: 0.7,
            });
          }
        }
      }
      if (this.enabled.hitboxes) {
        for (const [e, b] of sim.ecs.query(Body)) {
          const color = sim.ecs.has(e, Player)
            ? 0x40ff60
            : sim.ecs.has(e, Enemy)
              ? 0xff4040
              : sim.ecs.has(e, Projectile)
                ? 0xffffff
                : sim.ecs.has(e, Pickup)
                  ? 0x80a0ff
                  : 0xffd040;
          g.rect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h).stroke({ width: 1, color, alpha: 0.9 });
        }
        const box = attackBox(sim, sim.player);
        if (box) g.rect(box.x, box.y, box.w, box.h).fill({ color: 0xffffff, alpha: 0.35 });
      }
      if (this.enabled.ai) {
        for (const [e, ai, b] of sim.ecs.query(Ai, Body)) {
          const hp = sim.ecs.get(e, Health);
          text(
            `${ai.state} ${ai.t}${hp ? ` ${Math.ceil(hp.hp)}hp` : ''}`,
            b.x - 14,
            b.y - b.h / 2 - 30,
            0xffe0a0,
          );
        }
      }
    }
    for (let i = label; i < this.labelPool.length; i++) this.labelPool[i]!.visible = false;

    this.stats.classList.toggle('hidden', !this.enabled.stats);
    if (this.enabled.stats) this.stats.textContent = this.statsText();
  }

  private statsText(): string {
    const { sim, loop } = this.app;
    const lines = [`fps ${this.fps.toFixed(0)}  ${loop.paused ? 'PAUSED' : `x${loop.timeScale}`}`];
    if (sim) {
      const b = sim.ecs.need(sim.player, Body);
      const tx = Math.floor(b.x / TILE);
      const ty = Math.floor(b.y / TILE);
      lines.push(
        `tick ${sim.tick}  seed ${sim.state.seed}`,
        `entities ${sim.ecs.entityCount}  chunks ${sim.world.loadedKeys.length}`,
        `tile ${tx},${ty}  ${sim.world.gen.biomeAt(tx, ty)}`,
        `area ${sim.state.currentArea ?? '-'}`,
        `slot ${this.app.slot ?? 'scratch'}`,
      );
    } else lines.push('no game running');
    return lines.join('\n');
  }
}
