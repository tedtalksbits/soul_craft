/**
 * Darkness plus point lights. Each frame a screen-sized render texture is
 * filled with the area's darkness, lights are erased out of it, and it is
 * drawn over the world. Some lights also get a colored additive glow: warm
 * for fire, and the class color for the player, so their class shows even in
 * the dark.
 */
import { Container, Graphics, RenderTexture, Sprite, Texture, type Renderer } from 'pixi.js';
import { Abilities, Body, Bonfire, Empowered, Player, Torch } from '../../sim/components';
import { TILE } from '../../sim/constants';
import type { Simulation } from '../../sim/simulation';
import { classPalette } from './class-palette';

interface Light {
  x: number;
  y: number;
  radius: number;
  intensity: number;
  /** An additive glow over the light, or null for plain light. */
  glow: { color: number; alpha: number; scale: number } | null;
}

const FIRE = 0xff8c32;

const GRADIENT_SIZE = 128;

function radialTexture(stops: [number, string][]): Texture {
  const c = document.createElement('canvas');
  c.width = c.height = GRADIENT_SIZE;
  const g = c.getContext('2d')!;
  const r = GRADIENT_SIZE / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  for (const [at, color] of stops) grad.addColorStop(at, color);
  g.fillStyle = grad;
  g.fillRect(0, 0, GRADIENT_SIZE, GRADIENT_SIZE);
  return Texture.from(c);
}

export class Lighting {
  /** Drawn over the world in screen space. */
  readonly root = new Container();
  private target: RenderTexture;
  private readonly targetSprite: Sprite;
  private readonly scene = new Container();
  private readonly dark = new Graphics();
  private readonly erasers = new Container();
  private readonly glows = new Container();
  private readonly lightTex = radialTexture([
    [0, 'rgba(255,255,255,1)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  private readonly vignette: Sprite;
  private darkness = -1;

  constructor(
    private width: number,
    private height: number,
  ) {
    this.target = RenderTexture.create({ width, height });
    this.targetSprite = new Sprite(this.target);
    this.scene.addChild(this.dark, this.erasers);
    const vignetteTex = radialTexture([
      [0.55, 'rgba(0,0,0,0)'],
      [1, 'rgba(0,0,0,0.75)'],
    ]);
    this.vignette = new Sprite(vignetteTex);
    this.vignette.anchor.set(0.5);
    this.root.addChild(this.targetSprite, this.glows, this.vignette);
    this.resize(width, height);
  }

  /** The view changed size: a new darkness texture to match, and the vignette re-centered. */
  resize(width: number, height: number): void {
    if (width !== this.width || height !== this.height) {
      this.target.destroy(true);
      this.target = RenderTexture.create({ width, height });
      this.targetSprite.texture = this.target;
      this.width = width;
      this.height = height;
    }
    this.vignette.setSize(width * 1.25, height * 1.6);
    this.vignette.position.set(width / 2, height / 2);
  }

  update(
    renderer: Renderer,
    sim: Simulation,
    cam: { x: number; y: number },
    targetDarkness: number,
    hurt: number,
  ): void {
    this.darkness =
      this.darkness < 0 ? targetDarkness : this.darkness + (targetDarkness - this.darkness) * 0.04;
    this.dark.clear().rect(0, 0, this.width, this.height).fill({ color: 0x06050c, alpha: this.darkness });

    const lights = this.collect(sim, cam);
    syncPool(this.erasers, lights.length, () => {
      const s = new Sprite(this.lightTex);
      s.anchor.set(0.5);
      s.blendMode = 'erase';
      return s;
    });
    const glowing = lights.filter((l) => l.glow !== null);
    syncPool(this.glows, glowing.length, () => {
      const s = new Sprite(this.lightTex);
      s.anchor.set(0.5);
      s.blendMode = 'add';
      return s;
    });
    lights.forEach((l, i) => place(this.erasers.children[i] as Sprite, l, cam, l.radius * 2, l.intensity));
    glowing.forEach((l, i) => {
      const s = this.glows.children[i] as Sprite;
      if (!l.glow) return;
      s.tint = l.glow.color;
      place(s, l, cam, l.radius * l.glow.scale, l.glow.alpha);
    });
    renderer.render({ container: this.scene, target: this.target, clear: true });

    // Hurt flashes red; a running super tints the screen's edges in the class color.
    const a = sim.ecs.get(sim.player, Abilities);
    const superTint =
      a && sim.ecs.has(sim.player, Empowered) ? classPalette(sim.content, a.class).base : null;
    this.vignette.tint = hurt > 0 ? 0xff3020 : (superTint ?? 0xffffff);
    this.vignette.alpha = 1 + hurt * 0.5;
  }

  private collect(sim: Simulation, cam: { x: number; y: number }): Light[] {
    const { ecs } = sim;
    const lights: Light[] = [];
    const pb = ecs.get(sim.player, Body);
    const a = ecs.get(sim.player, Abilities);
    if (pb && ecs.get(sim.player, Player)?.state !== 'dead') {
      const empowered = ecs.has(sim.player, Empowered);
      const glow = a
        ? {
            color: classPalette(sim.content, a.class).base,
            alpha: empowered ? 0.3 : 0.1,
            scale: empowered ? 1.4 : 0.8,
          }
        : null;
      lights.push({ x: pb.x, y: pb.y - 6, radius: 64, intensity: 0.85, glow });
    }
    const fire = (scale: number) => ({ color: FIRE, alpha: 0.22, scale });
    for (const [, , b] of ecs.query(Torch, Body))
      lights.push({ x: b.x, y: b.y - 12, radius: 60, intensity: 1, glow: fire(1.1) });
    for (const [, bonfire, b] of ecs.query(Bonfire, Body)) {
      if (sim.state.litBonfires[bonfire.id])
        lights.push({ x: b.x, y: b.y - 8, radius: 90, intensity: 1, glow: fire(1.1) });
    }
    const tx0 = Math.floor(cam.x / TILE) - 2;
    const ty0 = Math.floor(cam.y / TILE) - 2;
    for (let ty = ty0; ty <= ty0 + Math.ceil(this.height / TILE) + 4; ty++) {
      for (let tx = tx0; tx <= tx0 + Math.ceil(this.width / TILE) + 4; tx++) {
        const light = sim.world.tileAt(tx, ty)?.light;
        if (light)
          lights.push({
            x: tx * TILE + 8,
            y: ty * TILE + 6,
            radius: light.radius,
            intensity: light.intensity,
            glow: null,
          });
      }
    }
    return lights.filter(
      (l) =>
        l.x + l.radius > cam.x &&
        l.x - l.radius < cam.x + this.width &&
        l.y + l.radius > cam.y &&
        l.y - l.radius < cam.y + this.height,
    );
  }
}

function syncPool(container: Container, n: number, make: () => Sprite): void {
  while (container.children.length < n) container.addChild(make());
  container.children.forEach((c, i) => (c.visible = i < n));
}

function place(s: Sprite, l: Light, cam: { x: number; y: number }, size: number, alpha: number): void {
  s.position.set(l.x - cam.x, l.y - cam.y);
  s.setSize(size, size);
  s.alpha = alpha;
}
