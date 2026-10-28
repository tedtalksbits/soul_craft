"""The Ashen One (player character) sprite generator.

Builds the character as a voxel model, ray-casts it from a 3/4 overhead
camera in eight directions, and writes the engine sprite sheet:

    assets/sprites/player.png    columns: S, SE, E, NE, N, NW, W, SW
                                 rows:    idle, walk 0-3
    assets/sprites/player.json   frame layout, animation names and pivots
                                 (format: src/content/sprite-sheet.ts)

Usage: pnpm art:ashen-one            (see tools/art/README.md)
       python tools/art/ashen_one.py [--out-dir DIR]

Ported from ashen_one_walk_generator.py (delivered 2026-10-28; walk output is
pixel-identical to the delivered sheet). Idle is the same model in a neutral
pose rather than the separate idle script's model, so idle and walk never
disagree. Output is deterministic: same script, same pixels.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

# ---------------------------------------------------------------- palette ramps


def hx(h):
    h = h.lstrip('#')
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


# material id -> (highlight, base, shadow, deep)
RAMPS = {
    1:  ('#c3c7cb', '#9da2a8', '#5f646b', '#34373c'),  # steel plate
    2:  ('#878b91', '#6b6f75', '#4a4d53', '#2a2c30'),  # chainmail
    3:  ('#a3261c', '#8a2219', '#5e1712', '#360d0b'),  # cape
    4:  ('#c43a2a', '#a3261c', '#7a1c15', '#45100c'),  # plume
    5:  ('#ecd096', '#d0a85c', '#9a7536', '#5c4220'),  # tarnished gold
    6:  ('#71543a', '#5a412b', '#3f2d1e', '#241a11'),  # shield wood
    7:  ('#7d8188', '#5f646b', '#41454b', '#26282c'),  # iron rim
    8:  ('#56585d', '#404247', '#2c2d31', '#1a1b1e'),  # trousers
    9:  ('#5c4535', '#45342a', '#30241d', '#1c1511'),  # leather
    10: ('#111111', '#111111', '#111111', '#111111'),  # eye slit
    11: ('#e1e5e9', '#b9bec4', '#858b92', '#4d5258'),  # blade
}
RAMPS = {k: [hx(c) for c in v] for k, v in RAMPS.items()}

# ---------------------------------------------------------------- voxel grid
# Model space: x right, y back (front is -y), z up, in pixel-sized units.

RES = 0.5
xs = np.arange(-16, 16, RES) + RES / 2
ys = np.arange(-12, 12, RES) + RES / 2
zs = np.arange(-1, 45, RES) + RES / 2
X, Y, Z = np.meshgrid(xs, ys, zs, indexing='ij')
M = np.zeros(X.shape, np.uint8)   # material per voxel, 0 = empty
N = np.zeros(X.shape + (3,))      # surface normal per voxel


def put(mask, mat):
    M[mask] = mat


def seg_dist(p0, p1):
    p0, p1 = np.array(p0, float), np.array(p1, float)
    d = p1 - p0
    L2 = d @ d
    t = ((X - p0[0]) * d[0] + (Y - p0[1]) * d[1] + (Z - p0[2]) * d[2]) / L2
    t = np.clip(t, 0, 1)
    return np.sqrt((X - p0[0] - t * d[0]) ** 2 + (Y - p0[1] - t * d[1]) ** 2 + (Z - p0[2] - t * d[2]) ** 2), t


def capsule(p0, p1, r0, r1=None):
    r1 = r0 if r1 is None else r1
    d, t = seg_dist(p0, p1)
    return d < r0 + (r1 - r0) * t


def gaussian_blur(vol, sigma):
    """Separable Gaussian, equivalent to scipy.ndimage.gaussian_filter's defaults
    (truncate=4, mode='reflect'), so we don't need SciPy for this one call."""
    r = int(4.0 * sigma + 0.5)
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    out = vol
    for axis in range(vol.ndim):
        pad = [(0, 0)] * vol.ndim
        pad[axis] = (r, r)
        p = np.pad(out, pad, mode='symmetric')
        n = vol.shape[axis]
        out = sum(k[i] * np.take(p, np.arange(i, i + n), axis=axis) for i in range(2 * r + 1))
    return out


HUNCH = 0.13          # forward lean of the torso per unit height


def torso_cy(z):      # torso centre y as a function of height (front is -y)
    return -(np.clip(z, 13, 30) - 13) * HUNCH


def build(pose):
    """Voxelise the character in a pose; returns the body bob (hip height offset).

    pose: legL, legR = (thigh_angle, shin_angle) in radians, forward positive;
    arm = arm swing (-1..1, + means sword arm forward); flare, phase = cape motion;
    plume = how far the plume trails.
    """
    global M, N
    M = np.zeros(X.shape, np.uint8)

    # ---- legs, solved from the pose; body bob comes from how high the hips sit
    def leg_pts(lx, th, sh):
        Hp = np.array([lx, 0.0, 0.0])
        K = Hp + 5.5 * np.array([0, -np.sin(th), -np.cos(th)])
        A = K + 5.4 * np.array([0, -np.sin(sh), -np.cos(sh)])
        return Hp, K, A
    legs = [leg_pts(2.2 * sx, *pose[k]) for sx, k in ((-1, 'legR'), (1, 'legL'))]
    hip_z = 1.15 - min(l[2][2] for l in legs)       # lowest ankle sits at z=1.15
    bob = hip_z - 12.0
    for Hp, K, A in legs:
        Hp, K, A = Hp + [0, 0, hip_z], K + [0, 0, hip_z], A + [0, 0, hip_z]
        put(capsule(Hp, K, 1.55, 1.45), 8)
        put(capsule(K, K + 0.35 * (A - K), 1.45), 8)
        put(capsule(K + 0.35 * (A - K), A, 1.7, 1.6), 9)         # boot shaft
        lift = A[2] - 1.15
        put(capsule(A + [0, 0.9, -0.2], A + [0, -2.0, -0.4 + 0.3 * lift], 1.25), 9)  # foot

    # ---- chain skirt, belt, buckle
    Zu = Z - bob                                    # upper body rides on the hips
    cy = torso_cy(Zu)
    put((((X / 5.0) ** 2 + ((Y - cy) / 3.2) ** 2) < 1) & (Zu >= 10) & (Zu < 13.6), 2)
    put((((X / 4.9) ** 2 + ((Y - cy) / 3.15) ** 2) < 1) & (Zu >= 13.5) & (Zu < 15), 9)
    put((np.abs(X) < 0.9) & (Y < cy - 2.2) & (Y > cy - 3.6) & (Zu >= 13.5) & (Zu < 15), 5)

    # ---- torso: breastplate front, chainmail back and sides; gorget
    rx = 4.9 + (np.clip(Zu, 15, 22) - 15) * 0.12
    tor = (((X / rx) ** 2 + ((Y - cy) / 3.0) ** 2) < 1) & (Zu >= 15) & (Zu < 23)
    tor &= ~((Zu > 21.5) & (((X / rx) ** 2) > 0.55))
    put(tor & (Y < cy + 0.4), 1)
    put(tor & (Y >= cy + 0.4), 2)
    put((((X / 2.4) ** 2 + ((Y - torso_cy(23)) / 2.2) ** 2) < 1) & (Zu >= 22.5) & (Zu < 23.6), 1)

    # ---- helm with eye slit and lower rim
    hcx, hcy, hz0, hz1 = 0.0, torso_cy(23) - 0.9, 23.2, 28.4
    dx, dy = np.abs(X - hcx), np.abs(Y - hcy)
    box = ((dx / 3.3) ** 4 + (dy / 3.3) ** 4 < 1) & (Zu >= hz0) & (Zu < hz1)
    dome = (dx ** 2 + dy ** 2 + ((Zu - hz1) * 1.25) ** 2 < 3.3 ** 2) & (Zu >= hz1)
    put(box | dome, 1)
    put(box & (Y < hcy - 2.3) & (np.abs(X - hcx) < 2.1) & (Zu >= 26.0) & (Zu < 27.0), 10)
    put(box & (Y < hcy - 2.3) & (Zu >= 23.2) & (Zu < 24.0), 7)

    # ---- plume: tall crest sweeping back, trailing on the up-beat
    b = np.array([0, 0, bob])
    sway = pose.get('plume', 0.0)
    pts = [(0, hcy - 0.6, 30.6), (0, hcy + 0.2, 33.4), (0, hcy + 1.6 + 0.3 * sway, 35.4),
           (0, hcy + 3.4 + 0.6 * sway, 36.0 - 0.2 * sway), (0, hcy + 5.4 + 0.9 * sway, 35.0 - 0.5 * sway)]
    rads = [2.0, 2.3, 2.1, 1.7, 1.1]
    for i in range(len(pts) - 1):
        put(capsule(np.add(pts[i], b), np.add(pts[i + 1], b), rads[i], rads[i + 1]), 4)
    put(capsule(np.add((0, hcy, 30.6), b), np.add((0, hcy + 0.2, 31.4), b), 1.2), 5)

    # ---- pauldrons
    for sx in (-1, 1):
        c = np.array([5.6 * sx, torso_cy(21) + 0.2, 21.3 + bob])
        d2 = (X - c[0]) ** 2 + ((Y - c[1]) * 1.1) ** 2 + ((Z - c[2]) * 1.2) ** 2
        put((d2 < 3.1 ** 2) & (Zu > 19.4), 1)

    # ---- arms: right (x<0) holds the sword, left (x>0) carries the shield
    a = pose['arm']
    sh_r, el_r, hd_r = arm_points(pose, bob)[0]
    sh_l, el_l, hd_l = arm_points(pose, bob)[1]
    for p, q, r in ((sh_r, el_r, hd_r), (sh_l, el_l, hd_l)):
        put(capsule(p, q, 1.35), 2)
        put(capsule(q, r, 1.35, 1.25), 1)

    # ---- sword, with a chip in the blade
    hand = hd_r
    bdir = np.array([-0.30, -0.40 - 0.25 * a, -0.87])
    bdir /= np.linalg.norm(bdir)
    guard_c = hand + bdir * 1.4
    put(capsule(hand - bdir * 1.2, hand + bdir * 0.6, 0.55), 9)
    put(capsule(hand - bdir * 1.6, hand - bdir * 1.2, 0.75), 5)
    perp = np.cross(bdir, [0, 1.0, 0])
    perp /= np.linalg.norm(perp)
    put(capsule(guard_c - perp * 1.9, guard_c + perp * 1.9, 0.5), 5)
    tip = guard_c + bdir * 12.5
    blade = capsule(guard_c, tip, 0.75, 0.35)
    put(blade, 11)
    chip = guard_c + bdir * 7.0 + perp * 0.6
    put(blade & (((X - chip[0]) ** 2 + (Y - chip[1]) ** 2 + (Z - chip[2]) ** 2) < 0.5 ** 2), 0)

    # ---- round shield on the left forearm
    sc = np.array([8.1, -3.7 + 0.7 * a, 15.4]) + b
    sn = np.array([0.55, -0.83, 0.08])
    sn /= np.linalg.norm(sn)
    rel = np.stack([X - sc[0], Y - sc[1], Z - sc[2]], -1)
    h = rel @ sn
    radial = np.sqrt(np.maximum((rel ** 2).sum(-1) - h ** 2, 0))
    disc = (radial < 4.6) & (np.abs(h) < 0.55)
    put(disc & (radial >= 3.8), 7)
    put(disc & (radial < 3.8), 6)
    put((radial < 1.3) & (h >= 0.0) & (h < 0.55 + 0.9 * (1 - radial / 1.3)), 5)

    # ---- cape: flare pushes the hem back, phase ripples the folds; frayed hem and tears
    rng = np.random.default_rng(7)
    zc0, zc1 = 6.5 + bob, 23.0 + bob
    w = 5.8 + (zc1 - Z) * 0.14
    drop = np.clip((zc1 - Z) / 8, 0, 1)
    FOLD = 0.45 * drop
    ph = pose['phase']
    yback = (torso_cy(Zu) * 0.35 + 3.1 + (zc1 - Z) * (0.10 + 0.07 * pose['flare'])
             - (np.clip(np.abs(X) / w, 0, 1) ** 2) * 1.9 + FOLD * np.sin(X * 1.25 + ph))
    cape = (np.abs(X) < w) & (Y > yback) & (Y < yback + 1.0) & (Z >= zc0) & (Z < zc1)
    cols = np.arange(-16, 16, 1.0)
    hem = dict(zip(cols, rng.choice([0, 0, 0.5, 1.0, 1.5, 2.5, 3.5], size=len(cols))))
    hemz = zc0 + np.vectorize(lambda x: hem[np.floor(x)])(X[:, 0, 0])[:, None, None] + 0.6 * pose['flare']
    cape &= Z >= hemz
    for (tx, tz, tr) in [(2.3, 10.0, 0.8), (-3.1, 12.5, 0.6)]:
        cape &= ~(((X - tx) ** 2 + (Z - tz - bob) ** 2) < tr ** 2)
    put(cape, 3)
    collar = ((((X / 5.2) ** 2 + ((Y - torso_cy(23) - 0.6) / 3.3) ** 2) < 1) & (Zu >= 22.3) & (Zu < 23.6)
              & (Y > torso_cy(23) + 0.3))
    put(collar & (M == 0), 3)

    # ---- normals from the blurred occupancy; the cape uses an analytic normal for clean folds
    occ = gaussian_blur((M > 0).astype(float), 1.6)
    gx, gy, gz = np.gradient(occ)
    N = -np.stack([gx, gy, gz], -1)
    N /= (np.linalg.norm(N, axis=-1, keepdims=True) + 1e-9)
    fx = 3.8 * X / w ** 2 - FOLD * 1.25 * np.cos(X * 1.25 + ph)
    cn = np.stack([fx, np.ones_like(X), 0.10 + 0.07 * pose['flare'] + 0 * X], -1)
    cn /= np.linalg.norm(cn, axis=-1, keepdims=True)
    N[M == 3] = cn[M == 3]
    return bob


def arm_points(pose, bob):
    """(shoulder, elbow, hand) for the right (sword) and left (shield) arms."""
    a = pose['arm']
    b = np.array([0, 0, bob])
    right = (np.array((-5.9, torso_cy(20), 20.0)) + b,
             np.array((-6.8, torso_cy(17) - 0.2 - 1.0 * a, 16.6 + 0.2 * abs(a))) + b,
             np.array((-7.0, -2.8 - 2.0 * a, 13.6 + 0.6 * max(a, 0))) + b)
    left = (np.array((5.9, torso_cy(20), 20.0)) + b,
            np.array((6.9, torso_cy(17) - 0.2 + 0.4 * a, 16.8)) + b,
            np.array((6.3, -3.4 + 0.7 * a, 15.4)) + b)
    return right, left

# ---------------------------------------------------------------- renderer


W, H = 48, 48
PHI = np.radians(32)                          # camera pitch: 3/4 overhead
F = np.array([0, np.cos(PHI), -np.sin(PHI)])  # into the screen
U = np.array([0, np.sin(PHI), np.cos(PHI)])   # screen up
R = np.array([1.0, 0, 0])                     # screen right
LV = np.array([-0.6, 0.45, 0.85])             # light: upper-left, from the viewer side
LV /= np.linalg.norm(LV)
L_WORLD = LV[0] * R + LV[1] * U - LV[2] * F
FOOT_ROW = 45.0                               # pixel row of the ground plane at the model origin


def rot(v, ang):
    c, s = np.cos(ang), np.sin(ang)
    return np.stack([c * v[..., 0] - s * v[..., 1], s * v[..., 0] + c * v[..., 1], v[..., 2]], -1)


def render(facing_deg):
    th = np.radians(facing_deg)
    jj, ii = np.meshgrid(np.arange(W), np.arange(H))
    sx = jj - W / 2 + 0.5
    sy = FOOT_ROW - ii - 0.5
    ts = np.arange(-30, 30, 0.2)
    P = (sx[..., None, None] * R + sy[..., None, None] * U + ts[None, None, :, None] * F)  # world pts
    Pl = rot(P, -th)                                                                      # model pts
    gi = np.floor((Pl[..., 0] - xs[0] + RES / 2) / RES).astype(int)
    gj = np.floor((Pl[..., 1] - ys[0] + RES / 2) / RES).astype(int)
    gk = np.floor((Pl[..., 2] - zs[0] + RES / 2) / RES).astype(int)
    ok = (gi >= 0) & (gi < M.shape[0]) & (gj >= 0) & (gj < M.shape[1]) & (gk >= 0) & (gk < M.shape[2])
    mat = np.zeros(ok.shape, np.uint8)
    mat[ok] = M[gi[ok], gj[ok], gk[ok]]
    hit = mat > 0
    first = np.where(hit.any(-1), hit.argmax(-1), -1)
    out_mat = np.zeros((H, W), np.uint8)
    out_lvl = np.zeros((H, W), np.uint8)
    depth = np.full((H, W), np.inf)
    Ll = rot(L_WORLD[None], -th)[0]
    for i in range(H):
        for j in range(W):
            k = first[i, j]
            if k < 0:
                continue
            m = mat[i, j, k]
            out_mat[i, j] = m
            depth[i, j] = ts[k]
            n = N[gi[i, j, k], gj[i, j, k], gk[i, j, k]]
            d = float(n @ Ll)
            out_lvl[i, j] = 0 if d > 0.78 else 1 if d > 0.2 else 2 if d > -0.35 else 3
    return out_mat, out_lvl, depth


def compose(out_mat, out_lvl, depth):
    H_, W_ = out_mat.shape
    img = np.zeros((H_, W_, 4), np.uint8)
    lvl = out_lvl.copy()
    # depth-discontinuity lines: a farther pixel next to a much nearer one is darkened
    for di, dj in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        nd = np.full_like(depth, np.inf)
        si = slice(max(di, 0), H_ + min(di, 0))
        ti = slice(max(-di, 0), H_ + min(-di, 0))
        sj = slice(max(dj, 0), W_ + min(dj, 0))
        tj = slice(max(-dj, 0), W_ + min(-dj, 0))
        nd[ti, tj] = depth[si, sj]
        with np.errstate(invalid='ignore'):   # inf - inf on empty pixels; masked out by isfinite
            edge = (out_mat > 0) & np.isfinite(nd) & np.isfinite(depth) & ((depth - nd) > 3.0)
        lvl[edge] = 3
    # chainmail texture: alternating rows on lit/base areas
    ii, jj = np.indices(out_mat.shape)
    mail = (out_mat == 2) & (lvl == 1) & (((ii + jj) % 2) == 0) & ((ii % 2) == 0)
    lvl[mail] = 2
    for m, ramp in RAMPS.items():
        for lv in range(4):
            sel = (out_mat == m) & (lvl == lv)
            img[sel, :3] = ramp[lv]
            img[sel, 3] = 255
    # 1px outline: deep shade of the neighbouring material
    solid = out_mat > 0
    outline = np.zeros_like(img)
    for di, dj in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        sh = np.pad(out_mat, 1)[1 - di:1 - di + out_mat.shape[0], 1 - dj:1 - dj + out_mat.shape[1]]
        sel = (~solid) & (sh > 0) & (outline[..., 3] == 0)
        for m, ramp in RAMPS.items():
            s2 = sel & (sh == m)
            outline[s2, :3] = tuple(int(c * 0.55) for c in ramp[3])
            outline[s2, 3] = 255
    return np.where(img[..., 3:] > 0, img, outline)


def screen_offset(p):
    """Pixel offset of a model-space point from the sprite anchor (bottom-centre of the frame),
    seen from the south. Used to publish attachment points (pivots) for the engine."""
    return [int(round(float(p @ R))), int(round(float(-(H - FOOT_ROW) - p @ U)))]

# ---------------------------------------------------------------- sheet layout


# Facing angle in model space -> engine direction name. Columns follow this order.
DIRS = [('down', 0), ('down_right', 45), ('right', 90), ('up_right', 135),
        ('up', 180), ('up_left', 225), ('left', 270), ('down_left', 315)]
d = np.radians
IDLE = dict(legR=(0.0, 0.0), legL=(0.0, 0.0), arm=0.0, flare=0.0, phase=0.0, plume=0.0)
# 4-frame walk: contact (R fwd), passing (R planted, L lifting through), contact (L fwd), passing
WALK = [
    dict(legR=(d(24), d(8)),    legL=(d(-22), d(-32)), arm=-1.0, flare=1.0, phase=0.0, plume=1.0),
    dict(legR=(d(2), d(0)),     legL=(d(14), d(-38)),  arm=0.0,  flare=0.4, phase=0.8, plume=0.2),
    dict(legR=(d(-22), d(-32)), legL=(d(24), d(8)),    arm=1.0,  flare=1.0, phase=1.6, plume=1.0),
    dict(legR=(d(14), d(-38)),  legL=(d(2), d(0)),     arm=0.0,  flare=0.4, phase=2.4, plume=0.2),
]
# (animation, poses, fps, loop); each animation occupies consecutive rows.
ANIMATIONS = [('idle', [IDLE], 1, False), ('walk', WALK, 8, True)]


def build_sheet():
    rows = sum(len(poses) for _, poses, _, _ in ANIMATIONS)
    sheet = Image.new('RGBA', (W * len(DIRS), H * rows), (0, 0, 0, 0))
    animations = {}
    row = 0
    for name, poses, fps, loop in ANIMATIONS:
        for f, pose in enumerate(poses):
            build(pose)
            print(f'  {name} {f}', flush=True)
            for col, (_, ang) in enumerate(DIRS):
                sheet.paste(Image.fromarray(compose(*render(ang)), 'RGBA'), (col * W, (row + f) * H))
        for col, (dname, _) in enumerate(DIRS):
            frames = [(row + f) * len(DIRS) + col for f in range(len(poses))]
            animations[f'{name}_{dname}'] = {'frames': frames, 'fps': fps, 'loop': loop}
        row += len(poses)

    sword_hand = arm_points(IDLE, 0.0)[0][2]
    meta = {
        'image': 'player.png',
        'frameWidth': W,
        'frameHeight': H,
        'anchor': [0.5, 1],
        # Where the sword swings from: body centre, at sword-hand height.
        'pivots': {'swing': [0, screen_offset(sword_hand)[1]]},
        'frames': {},
        'animations': animations,
    }
    return sheet, meta


def main():
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--out-dir', type=Path, default=root / 'assets' / 'sprites')
    args = parser.parse_args()
    sheet, meta = build_sheet()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    sheet.save(args.out_dir / 'player.png', optimize=True)
    (args.out_dir / 'player.json').write_text(json.dumps(meta, indent=2) + '\n', encoding='utf-8')
    print(f'wrote {args.out_dir / "player.png"} and player.json')


if __name__ == '__main__':
    main()
