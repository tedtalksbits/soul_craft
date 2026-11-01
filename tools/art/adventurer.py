"""Layered Ashen One: all player action poses in eight directions.

Reuses the existing voxel rig/camera, with a neutral face, interchangeable clothing,
headwear and hair. Weapon pixels are split by depth against the body, not guessed
from a direction name. Run with Python + numpy + Pillow, or pnpm art adventurer.
"""
import json
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
import ashen_one as g

# The old model grid is narrower than a wound-back blade. Keep the viewport
# unchanged but give geometry enough room so tips aren't cut before projection.
g.xs = np.arange(-24, 24, g.RES) + g.RES / 2
g.X, g.Y, g.Z = np.meshgrid(g.xs, g.ys, g.zs, indexing='ij')
g.M = np.zeros(g.X.shape, np.uint8)

OUT = Path(__file__).resolve().parents[2] / 'assets' / 'sprites'
RAMPS = dict(g.RAMPS)
def ramp(*values):
    return [g.hx(v) for v in values]
RAMPS[13] = ramp('#ffffff', '#d8d8d8', '#9a9a9a', '#575757')  # tintable skin
RAMPS[14] = ramp('#ffffff', '#c8c8c8', '#858585', '#434343')  # tintable hair
RAMPS[15] = RAMPS[14]
RAMPS[16] = ramp('#a5a38d', '#777a6e', '#4d5753', '#2a3435')  # hood
RAMPS[17] = ramp('#c4a77c', '#8a7050', '#5c4b3c', '#303234')  # cap
RAMPS[18] = ramp('#d6dfdc', '#9baeb7', '#627480', '#35434f')  # helm
RAMPS[8] = ramp('#ffffff', '#bdbdbd', '#828282', '#464646')
g.RAMPS = RAMPS

# The strike stays in the forward hemisphere through the active frames.
attack = [
    g.P(g.ATTACK_LEGS, twist=-20, handR=(-6, -3, 19), handL=(5, -3, 16), sword_dir=(-0.8, -0.3, 0.5)),
    g.P(g.ATTACK_LEGS, twist=-10, handR=(-5, -6, 19), handL=(5, -3, 16), sword_dir=(-0.6, -0.7, 0.3)),
    g.P(g.ATTACK_LEGS, twist=8, lean=6, handR=(-3, -9, 17), handL=(5, -3, 16), sword_dir=(0, -1, 0.05)),
    g.P(g.ATTACK_LEGS, twist=18, lean=8, handR=(1, -8, 16), handL=(5, -3, 16), sword_dir=(0.6, -0.8, -0.1)),
    g.P(g.ATTACK_LEGS, twist=10, handR=(2, -5, 15), handL=(5, -3, 16), sword_dir=(0.8, -0.5, -0.3)),
]
animations = [(name, attack, 18, False) if name == 'attack' else (name, poses, fps, loop)
              for name, poses, fps, loop in g.ANIMATIONS]
ray_cache = {}
ground_shifts = {}
active_offset = (0, 0)
active_animation = 'idle'
legacy_meta = json.loads((OUT / 'player.json').read_text())['animations']

def render(angle):
    global active_offset
    active_offset = legacy_meta.get(f'{active_animation}_{dict((a, d) for d, a in g.DIRECTIONS)[angle]}', {}).get('offset', [0, 0]) if active_animation != 'attack' else (0, 0)
    # Cache the camera rays once per direction; all clothing shares the same rig.
    cache_key = (angle, *active_offset)
    if cache_key not in ray_cache:
        th = np.radians(angle)
        jj, ii = np.meshgrid(np.arange(g.W), np.arange(g.H))
        sx, sy = jj - g.W / 2 + .5 + active_offset[0], g.FOOT_ROW - ii - .5 - active_offset[1]
        ts = np.arange(-30, 30, .2)
        pts = sx[..., None, None] * g.R + sy[..., None, None] * g.U + ts[None, None, :, None] * g.F
        pl = g.rot(pts, -th)
        indices = [np.floor((pl[..., i] - axis[0] + g.RES / 2) / g.RES).astype(np.int16)
                   for i, axis in enumerate((g.xs, g.ys, g.zs))]
        ok = np.ones(indices[0].shape, bool)
        for i, idx in enumerate(indices):
            ok &= (idx >= 0) & (idx < g.M.shape[i])
            indices[i] = np.clip(idx, 0, g.M.shape[i] - 1)
        ray_cache[cache_key] = (indices, ok, ts, g.rot(g.L_WORLD[None], -th)[0])
    (ix, iy, iz), ok, ts, light = ray_cache[cache_key]
    mats = np.where(ok, g.M[ix, iy, iz], 0)
    hit = mats > 0
    any_hit = hit.any(-1)
    first = hit.argmax(-1)
    yy, xx = np.indices(first.shape)
    material = np.where(any_hit, mats[yy, xx, first], 0).astype(np.uint8)
    n = g.N[ix[yy, xx, first], iy[yy, xx, first], iz[yy, xx, first]]
    lighting = np.sum(n * light, axis=-1)
    levels = np.where(lighting > .78, 0, np.where(lighting > .2, 1, np.where(lighting > -.35, 2, 3))).astype(np.uint8)
    return material, levels, np.where(any_hit, ts[first], np.inf)

def normals():
    occ = g.gauss3d((g.M > 0).astype(float), 1.6)
    g.N = -np.stack(np.gradient(occ), -1)
    g.N /= np.linalg.norm(g.N, axis=-1, keepdims=True) + 1e-9

def build(pose, outfit='cloth', head=None):
    g.M = np.zeros(g.X.shape, np.uint8)
    def put(mask, material):
        g.M[mask] = material
    legs = {}
    for side, sx in [('R', -1), ('L', 1)]:
        hp = np.array([2.2 * sx, 0., 12.])
        spec = pose.get('leg' + side, (0, 0))
        knee = hp + g.THIGH * g.limb_dir(g.deg(spec[0]), g.deg(spec[2] if len(spec) > 2 else 0), sx)
        ankle = knee + g.SHIN * g.limb_dir(g.deg(spec[1]), g.deg(spec[3] if len(spec) > 3 else 0), sx)
        if 'knee' + side in pose:
            knee = np.asarray(pose['knee' + side], float)
            ankle = np.asarray(pose['ankle' + side], float)
        legs[side] = (hp, knee, ankle)
    dz = pose.get('hip_z', 12 + 1.15 - min(v[2][2] for v in legs.values())) - 12
    body = g.fcompose(g.move((0, 0, dz)), g.about(g.rotx(g.deg(pose.get('tilt', 0))), pose.get('tilt_pivot', (0, 0, 9))))
    relative = g.fcompose(g.move((0, 0, pose.get('bob_extra', 0))),
        g.about(g.rotz(g.deg(pose.get('twist', 0))) @ g.rotx(g.deg(pose.get('lean', 0))), g.HIP))
    torso = g.fcompose(body, relative)
    head_transform = g.fcompose(torso, g.about(g.rotx(g.deg(pose.get('head_tilt', 0))), g.NECK))
    cb, ct = g.coords(body), g.coords(torso)
    for hp, knee, ankle in legs.values():
        put(g.capsule(cb, hp, knee, 1.55, 1.4), 8)
        put(g.capsule(cb, knee, ankle, 1.5, 1.35), 8)
        put(g.capsule(cb, ankle + [0, .7, -.2], ankle + [0, -2, -.4], 1.3), 9)
    x, y, z = ct
    cy = g.torso_cy(z)
    radius = 4.6 if outfit != 'plate' else 5.2
    torso_mask = ((x / radius) ** 2 + ((y - cy) / 2.9) ** 2 < 1) & (z >= 12) & (z < 23)
    cloth = {'cloth': ramp('#a3a998', '#747f73', '#4d5d58', '#2e3e3e'),
             'leather': ramp('#b7976d', '#8d6a48', '#624b38', '#35332f'),
             'plate': ramp('#d2dcdd', '#9aabb5', '#617685', '#354752'),
             'bare': ramp('#c0ae91', '#8e806d', '#605e53', '#343e3b')}
    g.RAMPS[1] = cloth[outfit]
    put(torso_mask, 1)
    put(torso_mask & (z > 13) & (z < 14.5), 9)
    put(torso_mask & (abs(x) < .8) & (y < cy - 2.3) & (z > 13) & (z < 14.5), 5)
    put(g.capsule(ct, (0, 0, 22), (0, 0, 24.5), 1.5), 13)
    # Open, unhelmeted face is the foundation, never a permanently baked knight.
    hx, hy, hz = g.coords(head_transform)
    face = ((hx / 3.05) ** 2 + ((hy + 1) / 2.9) ** 2 + ((hz - 26.4) / 4.1) ** 2 < 1)
    put(face, 13)
    put(face & (hy < -3.25) & (abs(abs(hx) - 1.2) < .5) & (hz > 26) & (hz < 26.8), 10)
    arms = {}
    for side, sx in [('R', -1), ('L', 1)]:
        shoulder = g.SHOULDER[sx]
        a = pose.get('arm', 0)
        target = np.array(pose.get('hand' + side, (sx * 6.1, -3.1 + sx * a * 1.5, 14.6)))
        if pose.get('hand_frame') == 'body': target = g.to_local(relative, target)
        elbow, hand = g.two_bone(shoulder, target, g.UPPER_ARM, g.FOREARM, pose.get('pole' + side, (sx, .3, -.7)))
        put(g.capsule(ct, shoulder, elbow, 1.45), 1)
        put(g.capsule(ct, elbow, hand, 1.25, 1.05), 1)
        put(g.ball(ct, hand, 1.25), 13)
        if outfit == 'plate': put(g.ball(ct, shoulder + [0, 0, .4], 2.4), 1)
        arms[side] = hand
    if head in ('short', 'swept'):
        hair = ((hx / 3.3) ** 2 + ((hy + .9) / 3.2) ** 2 + ((hz - 26.8) / 4.15) ** 2 < 1)
        hair &= (hz > 28) | (hy > .6) | ((abs(hx) > 2.6) & (hz > 26.2))
        if head == 'swept': hair |= g.capsule(g.coords(head_transform), (-2, -1, 30), (1.5, .2, 31.4), 1.3)
        put(hair, 14)
    elif head == 'beard':
        beard = face & (hy < -2.4) & (hz < 25.5) & (hz > 23)
        put(beard, 15)
    elif head in ('hood', 'cap', 'helm'):
        hood = ((hx / 3.8) ** 2 + ((hy + .4) / 3.8) ** 2 + ((hz - 26.5) / 4.9) ** 2 < 1)
        opening = (hy < -2.2) & (abs(hx) < 2.5) & (hz > 24.5) & (hz < 28.4)
        if head == 'cap': hood &= hz > 28
        if head != 'helm': hood &= ~opening
        put(hood, {'hood': 16, 'cap': 17, 'helm': 18}[head])
        if head == 'helm': put(hood & (hy < -3.3) & (hz > 26.2) & (hz < 27), 10)
    if pose.get('flask'):
        put(g.capsule(ct, *pose['flask'], 1.25), 5)
    if pose.get('ground'):
        ks = np.where(g.M > 0)[2]
        shift = ground_shifts.setdefault(id(pose), int(ks.min()) - int(round((.25 - g.zs[0]) / g.RES)))
        g.M = np.roll(g.M, -shift, axis=2)
        if shift < 0: g.M[:, :, :-shift] = 0
        elif shift > 0: g.M[:, :, -shift:] = 0
        ct = (ct[0], ct[1], ct[2] + shift * g.RES)
    normals()
    return ct, arms

def masked(material, levels, depth, keep):
    # Mask before composing so each layer owns its own one-pixel outline.
    return g.compose(np.where(np.isin(material, keep), material, 0), levels, depth)

def render_animation(spec):
    global active_animation, ray_cache
    name, poses, fps, loop = spec
    active_animation = name
    ray_cache = {}
    names = ['cloth', 'leather', 'plate', 'bare']
    layers = {f'adventurer_{n}': [] for n in names}
    layers.update({f'adventurer_skin_{n}': [] for n in names})
    layers.update({f'adventurer_{n}': [] for n in ['legs', 'short', 'swept', 'beard', 'hood', 'cap', 'helm', 'sword_front', 'sword_back']})
    for pose in poses:
        body_depth = {}
        for outfit in names:
            ct, arms = build(pose, outfit)
            for direction, angle in g.DIRECTIONS:
                m, l, d = render(angle)
                layers[f'adventurer_{outfit}'].append(masked(m, l, d, [1, 5, 9]))
                layers[f'adventurer_skin_{outfit}'].append(masked(m, l, d, [13, 10]))
                if outfit == 'cloth':
                    body_depth[angle] = d
                    layers['adventurer_legs'].append(masked(m, l, d, [8]))
        for head in ['short', 'swept', 'beard', 'hood', 'cap', 'helm']:
            build(pose, head=head)
            for direction, angle in g.DIRECTIONS:
                m, l, d = render(angle)
                ids = {'short': [14], 'swept': [14], 'beard': [15], 'hood': [16], 'cap': [17], 'helm': [18, 10]}[head]
                layers[f'adventurer_{head}'].append(masked(m, l, d, ids))
        ct, arms = build(pose)
        g.M.fill(0)
        def put(mask, mat): g.M[mask] = mat
        sword_dir = pose.get('sword_dir', (-.1, -.35, -.94))
        if pose.get('sword', 'hand') is not None:
            g.draw_sword(put, ct, pose.get('lap_grip', arms['R']), sword_dir)
        normals()
        for direction, angle in g.DIRECTIONS:
            m, l, d = render(angle)
            image = g.compose(m, l, d)
            back = d > body_depth[angle] + .2
            for side, selection in [('back', back), ('front', ~back)]:
                pixels = image.copy()
                pixels[~selection] = 0
                layers[f'adventurer_sword_{side}'].append(pixels)
    print(f'{name}: {len(poses)} poses, all layers and directions', flush=True)
    return layers

def main():
    names = ['cloth', 'leather', 'plate', 'bare']
    layers = {f'adventurer_{n}': [] for n in names}
    layers.update({f'adventurer_skin_{n}': [] for n in names})
    layers.update({f'adventurer_{n}': [] for n in ['legs', 'short', 'swept', 'beard', 'hood', 'cap', 'helm', 'sword_front', 'sword_back']})
    meta, row = {}, 0
    with ProcessPoolExecutor(max_workers=4) as pool:
        for spec, rendered in zip(animations, pool.map(render_animation, animations)):
            name, poses, fps, loop = spec
            for layer, frames in rendered.items(): layers[layer].extend(frames)
            for column, (direction, angle) in enumerate(g.DIRECTIONS):
                entry = {'frames': [(row + i) * 8 + column for i in range(len(poses))], 'fps': fps, 'loop': loop}
                if name in g.CAST_RELEASE: entry['release'] = g.CAST_RELEASE[name]
                if name != 'attack': entry['offset'] = legacy_meta.get(f'{name}_{direction}', {}).get('offset', [0, 0])
                meta[f'{name}_{direction}'] = entry
            row += len(poses)
    OUT.mkdir(parents=True, exist_ok=True)
    for name, frames in layers.items():
        atlas = Image.new('RGBA', (48 * 8, 48 * row))
        for index, pixels in enumerate(frames):
            atlas.paste(Image.fromarray(pixels), ((index % 8) * 48, (index // 8) * 48))
        atlas.save(OUT / f'{name}.png')
        (OUT / f'{name}.json').write_text(json.dumps({'image': f'{name}.png', 'frameWidth': 48, 'frameHeight': 48,
            'anchor': [.5, 1], 'pivots': {'swing': [0, -13]}, 'frames': {}, 'animations': meta}, indent=2) + '\n')
    print(f'Wrote {len(layers)} synchronized sheets, {row * 8} frames each.', flush=True)

def preview():
    """Review sheet and animation: columns follow down, down-right, right, ... ."""
    target = OUT.parents[1] / 'output' / 'character-preview'
    target.mkdir(parents=True, exist_ok=True)
    parts = [('sword_back', (255, 255, 255)), ('legs', (157, 169, 157)),
             ('cloth', (255, 255, 255)), ('skin_cloth', (212, 165, 116)),
             ('short', (137, 105, 76)), ('sword_front', (255, 255, 255))]
    atlases = []
    for name, tint in parts:
        pixels = np.array(Image.open(OUT / f'adventurer_{name}.png'))
        pixels[..., :3] = (pixels[..., :3].astype(float) * np.array(tint) / 255).astype(np.uint8)
        atlases.append(Image.fromarray(pixels))
    def row(frame):
        image = Image.new('RGBA', (384, 48), '#282e32')
        for atlas in atlases:
            image.alpha_composite(atlas.crop((0, frame * 48, 384, (frame + 1) * 48)))
        return image.resize((1152, 144), Image.Resampling.NEAREST).convert('RGB')
    rows = [row(0)] + [row(i) for i in range(6, 11)]
    montage = Image.new('RGB', (1152, 144 * len(rows)), '#282e32')
    for index, image in enumerate(rows): montage.paste(image, (0, index * 144))
    montage.save(target / 'sword-directions.png')
    rows[1].save(target / 'sword-directions.gif', save_all=True, append_images=rows[2:],
                 duration=[140, 100, 100, 100, 220], loop=0)
    metadata = json.loads((OUT / 'adventurer_cloth.json').read_text())['animations']
    review = Image.new('RGB', (560, len(animations) * 96), '#282e32')
    labels = ImageDraw.Draw(review)
    for index, (name, poses, fps, loop) in enumerate(animations):
        labels.text((4, index * 96 + 40), name, fill='#ddd6c4')
        for column, direction in enumerate(['down', 'down_right', 'up', 'up_left']):
            entry = metadata[f'{name}_{direction}']
            frame = entry['frames'][entry.get('release', len(poses) // 2)]
            x, y = frame % 8 * 48, frame // 8 * 48
            cell = Image.new('RGBA', (48, 48), '#282e32')
            for atlas in atlases:
                cell.alpha_composite(atlas.crop((x, y, x + 48, y + 48)))
            review.paste(cell.resize((96, 96), Image.Resampling.NEAREST).convert('RGB'), (160 + column * 96, index * 96))
    review.save(target / 'all-actions.png')


if __name__ == '__main__':
    if '--preview-only' not in sys.argv: main()
    preview()
