/**
 * Darkness plus point lights. Each frame a screen-sized render texture is
 * filled with the area's darkness, lights are erased out of it, and it is
 * drawn over the world. Warm lights also get an additive glow.
 */
import { Container, Graphics, RenderTexture, Sprite, Texture, type Renderer } from 'pixi.js';
import { Body, Bonfire, Player, Torch } from '../../sim/components';
import { TILE } from '../../sim/constants';
import type { Simulation } from '../../sim/simulation';

interface Light {
  x: number;
  y: number;
  radius: number;
  intensity: number;
  warm: boolean;
}

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
  private readonly target: RenderTexture;
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
    private readonly width: number,
    private readonly height: number,
  ) {
    this.target = RenderTexture.create({ width, height });
    this.scene.addChild(this.dark, this.erasers);
    const vignetteTex = radialTexture([
      [0.55, 'rgba(0,0,0,0)'],
      [1, 'rgba(0,0,0,0.75)'],
    ]);
    this.vignette = new Sprite(vignetteTex);
    this.vignette.setSize(width * 1.25, height * 1.6);
    this.vignette.anchor.set(0.5);
    this.vignette.position.set(width / 2, height / 2);
    this.root.addChild(new Sprite(this.target), this.glows, this.vignette);
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
    const warm = lights.filter((l) => l.warm);
    syncPool(this.glows, warm.length, () => {
      const s = new Sprite(this.lightTex);
      s.anchor.set(0.5);
      s.blendMode = 'add';
      s.tint = 0xff8c32;
      return s;
    });
    lights.forEach((l, i) => place(this.erasers.children[i] as Sprite, l, cam, l.radius * 2, l.intensity));
    warm.forEach((l, i) => place(this.glows.children[i] as Sprite, l, cam, l.radius * 1.1, 0.22));
    renderer.render({ container: this.scene, target: this.target, clear: true });

    this.vignette.tint = hurt > 0 ? 0xff3020 : 0xffffff;
    this.vignette.alpha = 1 + hurt * 0.5;
  }

  private collect(sim: Simulation, cam: { x: number; y: number }): Light[] {
    const { ecs } = sim;
    const lights: Light[] = [];
    const pb = ecs.get(sim.player, Body);
    if (pb && ecs.get(sim.player, Player)?.state !== 'dead') {
      lights.push({ x: pb.x, y: pb.y - 6, radius: 64, intensity: 0.85, warm: false });
    }
    for (const [, , b] of ecs.query(Torch, Body))
      lights.push({ x: b.x, y: b.y - 12, radius: 60, intensity: 1, warm: true });
    for (const [, bonfire, b] of ecs.query(Bonfire, Body)) {
      if (sim.state.litBonfires[bonfire.id])
        lights.push({ x: b.x, y: b.y - 8, radius: 90, intensity: 1, warm: true });
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
            warm: false,
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
