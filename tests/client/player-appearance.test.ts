import fs from 'node:fs';
import { PNG } from 'pngjs';
import { Texture } from 'pixi.js';
import type { Assets } from '../../src/client/assets';
import { describe, expect, it } from 'vitest';
import {
  PlayerAppearanceView,
  playerLayerSpecs,
  playerLook,
  swordFrame,
} from '../../src/client/render/player-appearance';
import { Appearance, Equipment, Player } from '../../src/sim/components';
import { SpriteSheetSchema } from '../../src/content/sprite-sheet';
import { selectAnim } from '../../src/client/render/anim-select';
import { currentMove, swingOf, weaponType } from '../../src/sim/modules/weapons';
import { newSim } from '../helpers';

describe('layered player prototype', () => {
  it('keeps the sword handle on the drawn fist throughout cardinal idle and walk frames', () => {
    const root = new URL('../../assets/sprites/', import.meta.url);
    const meta = SpriteSheetSchema.parse(JSON.parse(fs.readFileSync(new URL('pf_cloth.json', root), 'utf8')));
    const read = (name: string) => PNG.sync.read(fs.readFileSync(new URL(`pf_${name}.png`, root)));
    const skin = read('skin_bare');
    const cloth = read('cloth');
    const legs = read('legs');
    const blades = [read('sword_front'), read('sword_back')];
    const offset = (image: PNG, frame: number, x: number, y: number) =>
      ((Math.floor(frame / 8) * 96 + y) * image.width + (frame % 8) * 96 + x) * 4;
    for (const pose of ['idle', 'walk']) {
      for (const direction of ['down', 'up', 'left', 'right']) {
        for (const frame of meta.animations[`${pose}_${direction}`]!.frames) {
          if (typeof frame !== 'number') throw new Error('Expected indexed frames');
          const handle: [number, number][] = [];
          for (const blade of blades) {
            for (let y = 0; y < 96; y++)
              for (let x = 0; x < 96; x++) {
                const i = offset(blade, frame, x, y);
                if (
                  blade.data[i] === 105 &&
                  blade.data[i + 1] === 79 &&
                  blade.data[i + 2] === 56 &&
                  blade.data[i + 3]
                )
                  handle.push([x, y]);
              }
          }
          expect(handle.length).toBeGreaterThan(0);
          const cx = Math.round(handle.reduce((sum, point) => sum + point[0], 0) / handle.length);
          const cy = Math.round(handle.reduce((sum, point) => sum + point[1], 0) / handle.length);
          let touchesFist = false;
          for (let y = cy - 1; y <= cy + 1; y++)
            for (let x = cx - 1; x <= cx + 1; x++) {
              const i = offset(skin, frame, x, y);
              if (
                y >= 50 &&
                y < 74 &&
                skin.data[i]! >= 139 &&
                skin.data[i] === skin.data[i + 1] &&
                skin.data[i] === skin.data[i + 2] &&
                skin.data[i + 3] &&
                !cloth.data[offset(cloth, frame, x, y) + 3] &&
                !legs.data[offset(legs, frame, x, y) + 3]
              )
                touchesFist = true;
            }
          expect(touchesFist, `${pose}_${direction}, frame ${frame}: handle must meet the exposed fist`).toBe(
            true,
          );
        }
      }
    }
  });

  it('derives clothing and headwear from equipped gear and hides only the helmet', () => {
    const sim = newSim();
    const eq = sim.ecs.need(sim.player, Equipment);
    expect(playerLook(sim)).toMatchObject({ outfit: 'cloth', head: 'hood', hasSword: true });
    eq.chest = { item: 'iron_mail', count: 1, level: 0 };
    eq.helmet = { item: 'iron_helm', count: 1, level: 0 };
    expect(playerLook(sim)).toMatchObject({ outfit: 'plate', head: 'helm' });
    sim.ecs.need(sim.player, Appearance).hideHelmet = true;
    const layers = playerLayerSpecs(playerLook(sim)).map(([layer]) => layer);
    expect(layers).toContain('plate');
    expect(layers).toContain('short');
    expect(layers).not.toContain('helm');
    expect(layers[0]).toBe('sword_back');
    expect(layers.at(-1)).toBe('sword_front');
    expect(layers.indexOf('skin_bare')).toBeLessThan(layers.indexOf('plate'));
    expect(layers.indexOf('short_back')).toBeLessThan(layers.indexOf('plate'));
    expect(layers.indexOf('short')).toBeGreaterThan(layers.indexOf('plate'));
    eq.weapon = null;
    expect(playerLayerSpecs(playerLook(sim)).some(([layer]) => layer.startsWith('sword'))).toBe(false);
  });

  it('keeps blade contact inside the move active window at different attack speeds', () => {
    for (const move of [
      { activeFrom: 3, activeTo: 9, duration: 16 },
      { activeFrom: 8, activeTo: 18, duration: 30 },
    ]) {
      expect(swordFrame(0, move)).toBe(0);
      expect(swordFrame(move.activeFrom, move)).toBe(2);
      expect(swordFrame(move.activeTo, move)).toBe(3);
      expect(swordFrame(move.activeTo + 1, move)).toBe(4);
    }
  });

  it.each(['pf', 'adventurer'])(
    'resolves every weapon action on %s to an available layered pose',
    (prefix) => {
      const meta = SpriteSheetSchema.parse(
        JSON.parse(
          fs.readFileSync(new URL(`../../assets/sprites/${prefix}_cloth.json`, import.meta.url), 'utf8'),
        ),
      );
      const view = new PlayerAppearanceView({
        sheet: () => ({
          anim: (key: string) => {
            const animation = meta.animations[key];
            return animation
              ? { ...animation, textures: animation.frames.map(() => Texture.EMPTY) }
              : undefined;
          },
        }),
      } as unknown as Assets);
      const sim = newSim();
      sim.ecs.need(sim.player, Appearance).prototype = prefix === 'pf';
      const equipment = sim.ecs.need(sim.player, Equipment);
      const player = sim.ecs.need(sim.player, Player);
      for (const [id, item] of Object.entries(sim.content.items)) {
        if (item.kind !== 'weapon') continue;
        equipment.weapon = { item: id, count: 1, level: 0 };
        const exists = (key: string) => meta.animations[key] !== undefined;
        for (const state of ['free', 'roll', 'hurt', 'drink', 'sit', 'dead'] as const) {
          player.state = state;
          expect(view.update(sim, 'down', 0, 1, 0), `${id}: ${state}`).toBe(true);
          expect(selectAnim(sim, sim.player, 'down', exists).key).toBe(
            `${state === 'free' ? 'idle' : state}_down`,
          );
        }
        player.state = 'charge';
        expect(view.update(sim, 'down', 0, 1, 0), `${id}: charge`).toBe(true);
        expect(view.root.scale.x).toBe(prefix === 'pf' ? 0.5 : 1);
        expect(selectAnim(sim, sim.player, 'down', exists).key).toBe(
          `${weaponType(sim).def.chargePose}_down`,
        );
        player.state = 'attack';
        const swing = swingOf(sim);
        for (const move of ['chain', 'charged', 'dash'] as const) {
          swing.move = move;
          const steps = move === 'chain' ? weaponType(sim).def.chain.length : 1;
          for (let step = 0; step < steps; step++) {
            swing.step = step;
            expect(view.update(sim, 'down', 0, 1, 0), `${id}: ${move} ${step}`).toBe(true);
            expect(selectAnim(sim, sim.player, 'down', exists).key).toBe(`${currentMove(sim).pose}_down`);
          }
        }
      }
    },
  );

  it.each(['pf', 'adventurer'])(
    'shares frame indices, anchors and timing across every %s layer and direction',
    (prefix) => {
      const root = new URL('../../assets/sprites/', import.meta.url);
      const files = fs
        .readdirSync(root)
        .filter((name) => name.startsWith(`${prefix}_`) && name.endsWith('.json'));
      expect(files).toHaveLength(prefix === 'pf' ? 16 : 17);
      const original = SpriteSheetSchema.parse(
        JSON.parse(fs.readFileSync(new URL('player.json', root), 'utf8')),
      );
      let reference: unknown;
      for (const name of files) {
        const meta = SpriteSheetSchema.parse(JSON.parse(fs.readFileSync(new URL(name, root), 'utf8')));
        const png = PNG.sync.read(fs.readFileSync(new URL(meta.image, root)));
        expect(png.width).toBe(prefix === 'pf' ? 768 : 384);
        expect(png.height).toBeGreaterThan(528);
        expect(meta.anchor).toEqual([0.5, 1]);
        for (const pose of [
          'idle',
          'walk',
          'attack',
          'roll',
          'drink',
          'sit',
          'dead',
          'hurt',
          'cast_slam',
          'cast_throw',
          'cast_charge',
          'cast_push',
          'cast_raise',
        ]) {
          for (const direction of [
            'down',
            'down_right',
            'right',
            'up_right',
            'up',
            'up_left',
            'left',
            'down_left',
          ])
            expect(meta.animations[`${pose}_${direction}`], `${name}: ${pose}_${direction}`).toBeDefined();
        }
        for (const key of Object.keys(original.animations))
          expect(meta.animations[key], `${name} must cover original action ${key}`).toBeDefined();
        if (reference) expect(meta.animations).toEqual(reference);
        else reference = meta.animations;
      }
    },
  );
});
