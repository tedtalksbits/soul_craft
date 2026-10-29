"""Slime sprite generator.

Writes slime.png and slime.json to <repo>/assets/sprites (or the directory given).

Usage: pnpm art slime

The forest's hopping blob: dusky violet gel with glowing teal nodules and two little mushroom
caps (fungal_cap's colours; the teal echoes glowspore). Undirected: idle, hop, hurt, dead, laid
out in one row of 48x48 frames, anchor [0.5, 1], ground plane 3 rows above the frame bottom as
for the characters. The hop's rise is drawn into the frames (the game has no enemy height) and
a ground shadow stays at the anchor in every frame. Same voxel renderer, camera, light, ramps and
outline as the characters. numpy + Pillow only, integer hashing only, no randomness.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

DEFAULT_OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'sprites')

def hx(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

# material: (highlight, base, shadow, deep). No id 2: compose() dithers it as chainmail.
RAMPS = {
    1: ('#b08ac0', '#7d5a92', '#55396a', '#33213f'),  # violet gel (items.py's slime_gel uses the same ramp)
    3: ('#d6fff2', '#8af0d6', '#4cc8b0', '#227a6c'),  # teal nodules: bright at every level, they glow
    4: ('#a07a8e', '#7a5668', '#553c4a', '#33232d'),  # mushroom cap (fungal_cap)
    5: ('#e0d6bc', '#bfb497', '#8f866e', '#5e5848'),  # cap stem (fungal_cap's cream)
    6: ('#6a5a80', '#4e3f62', '#382c48', '#221a2c'),  # spent nodules: the glow gone (dead)
}
RAMPS = {k: [hx(c) for c in v] for k, v in RAMPS.items()}

# the ground shadow: one flat colour (no gradient), drawn under the slime at the anchor
SHADOW = (12, 10, 20, 110)

# ---------------------------------------------------------------- voxel grid
RES = 0.5
xs = np.arange(-16, 16, RES) + RES / 2
ys = np.arange(-16, 16, RES) + RES / 2
zs = np.arange(-2, 44, RES) + RES / 2
X, Y, Z = np.meshgrid(xs, ys, zs, indexing='ij')
M = np.zeros(X.shape, np.uint8)
N = np.zeros(X.shape + (3,))
MODEL_SCALE = 1.0

def deg(a):
    return np.radians(a)

# ---------------------------------------------------------------- frames
# A frame maps local -> world as w = Rm @ l + t. Each body part is described in
# the standing pose's coordinates (feet on z=0, hips at z=12, facing -y) and
# evaluated on the grid's coordinates expressed in that part's frame.
def rotx(a):            # positive leans forward (+z rotates towards -y)
    c, s = np.cos(a), np.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])

def rotz(a):            # positive brings the right shoulder (-x) forward
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])

IDENT = (np.eye(3), np.zeros(3))

def fcompose(parent, child):
    return (parent[0] @ child[0], parent[0] @ child[1] + parent[1])

def about(Rm, pivot):
    pivot = np.asarray(pivot, float)
    return (Rm, pivot - Rm @ pivot)

def move(t):
    return (np.eye(3), np.asarray(t, float))

def coords(Fr):
    """The grid's coordinates expressed in frame Fr, in model units (world / MODEL_SCALE)."""
    Rm, t = Fr
    dx, dy, dz = X / MODEL_SCALE - t[0], Y / MODEL_SCALE - t[1], Z / MODEL_SCALE - t[2]
    return (Rm[0, 0] * dx + Rm[1, 0] * dy + Rm[2, 0] * dz,
            Rm[0, 1] * dx + Rm[1, 1] * dy + Rm[2, 1] * dz,
            Rm[0, 2] * dx + Rm[1, 2] * dy + Rm[2, 2] * dz)

def to_world(Fr, p):
    return Fr[0] @ np.asarray(p, float) + Fr[1]

def to_local(Fr, p):
    return Fr[0].T @ (np.asarray(p, float) - Fr[1])

# ---------------------------------------------------------------- shape helpers
def capsule(C, p0, p1, r0, r1=None):
    x, y, z = C
    r1 = r0 if r1 is None else r1
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    d = p1 - p0
    L2 = max(d @ d, 1e-9)
    t = np.clip(((x - p0[0]) * d[0] + (y - p0[1]) * d[1] + (z - p0[2]) * d[2]) / L2, 0, 1)
    dist = np.sqrt((x - p0[0] - t * d[0]) ** 2 + (y - p0[1] - t * d[1]) ** 2 + (z - p0[2] - t * d[2]) ** 2)
    return dist < r0 + (r1 - r0) * t

def ball(C, c, r):
    x, y, z = C
    return (x - c[0]) ** 2 + (y - c[1]) ** 2 + (z - c[2]) ** 2 < r * r

def limb_dir(pitch, abduct, sx):
    """Unit vector for a limb hanging down, swung forward by pitch and outward by abduct."""
    return np.array([sx * np.sin(abduct), -np.sin(pitch) * np.cos(abduct), -np.cos(pitch) * np.cos(abduct)])

def two_bone(S, target, L1, L2, pole):
    """Analytic two-bone IK: elbow and hand for a shoulder S reaching for target."""
    S, target, pole = np.asarray(S, float), np.asarray(target, float), np.asarray(pole, float)
    v = target - S
    dist = np.linalg.norm(v)
    u = v / dist
    dist = min(dist, L1 + L2 - 1e-3)
    hand = S + u * dist
    a = (L1 ** 2 - L2 ** 2 + dist ** 2) / (2 * dist)
    h = np.sqrt(max(L1 ** 2 - a ** 2, 0))
    perp = pole - (pole @ u) * u
    perp /= np.linalg.norm(perp) + 1e-9
    return S + u * a + perp * h, hand

def gauss3d(a, sigma=1.6, truncate=4.0):
    """Separable Gaussian blur, identical to scipy.ndimage.gaussian_filter (mode='reflect')."""
    r = int(truncate * sigma + 0.5)
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    out = a.astype(float)
    for ax in range(3):
        pad = [(0, 0)] * 3
        pad[ax] = (r, r)
        p = np.pad(out, pad, mode='symmetric')
        acc = np.zeros_like(out)
        for i, w in enumerate(k):
            sl = [slice(None)] * 3
            sl[ax] = slice(i, i + out.shape[ax])
            acc += w * p[tuple(sl)]
        out = acc
    return out

def shift_grid(a, di, dj, dk=0):
    """Shift an array along its first three axes by whole cells, filling with zeros."""
    out = np.zeros_like(a)
    def sl(d, n):
        return (slice(max(d, 0), n + min(d, 0)), slice(max(-d, 0), n + min(-d, 0)))
    (a0, b0), (a1, b1), (a2, b2) = sl(di, a.shape[0]), sl(dj, a.shape[1]), sl(dk, a.shape[2])
    out[a0, a1, a2] = a[b0, b1, b2]
    return out

def ihash3(x, y, z, scale=1.0):
    """Deterministic 0..1 noise from integer cell coordinates, using only integer arithmetic.

    No sin/exp: the result is bit-identical on every CPU and numpy build. Patterns are taken
    in each part's own coordinates, so they don't swim between frames.
    """
    xi = np.floor(np.asarray(x) * scale).astype(np.int64).astype(np.uint64)
    yi = np.floor(np.asarray(y) * scale).astype(np.int64).astype(np.uint64)
    zi = np.floor(np.asarray(z) * scale).astype(np.int64).astype(np.uint64)
    with np.errstate(over='ignore'):
        h = xi * np.uint64(0x9E3779B1) ^ yi * np.uint64(0x85EBCA77) ^ zi * np.uint64(0xC2B2AE3D)
        h ^= h >> np.uint64(15)
        h *= np.uint64(0x2C1B3C6D)
        h ^= h >> np.uint64(12)
        h *= np.uint64(0x297A2D39)
        h ^= h >> np.uint64(15)
    return (h & np.uint64(0xFFFF)).astype(np.float64) / 65535.0

PX_TO_Z = 1.0 / np.cos(np.radians(32))      # model units of height per pixel of screen lift

NODULES = ((-3.5, -4.0, 6.0, 1.15), (2.8, -5.2, 4.6, 1.1), (4.4, 2.0, 6.2, 1.15), (-1.0, 1.0, 8.2, 1.0),
           (-5.6, 1.6, 4.4, 1.0), (5.8, -2.6, 3.0, 0.9))
CAPS = ((-2.4, 2.4, 3.4), (2.6, 3.2, 2.4))       # (x, y, stem height) on top of the dome

def build(pose):
    """Build the slime. Pose keys:

    wide, tall      squash and stretch about the base (wide scales x and y, tall scales z)
    lift_px         how far the whole body is drawn above the ground, in screen pixels
    drops           droplets flung off, as (x, y, z) points in model units (hurt)
    dead            spread into a puddle with the caps toppled and the glow gone
    """
    global M, N
    M = np.zeros(X.shape, np.uint8)
    def put(mask, mat):
        M[mask] = mat
    w, t = pose.get('wide', 1.0), pose.get('tall', 1.0)
    lift = pose.get('lift_px', 0.0) * PX_TO_Z
    C = coords((np.diag([1 / w, 1 / w, 1 / t]), np.array([0.0, 0.0, lift])))
    x, y, z = C
    r2 = (x / 8.2) ** 2 + (y / 7.2) ** 2 + ((z - 0.6) / 7.8) ** 2
    body = (r2 < 1) & (z >= 0)
    body |= ((x / 8.6) ** 2 + (y / 7.6) ** 2 < 1) & (z >= 0) & (z < 1.2)       # the spread foot
    put(body, 1)
    glow = 6 if pose.get('dead') else 3
    for (cx, cy, cz, rr) in NODULES:
        put(ball(C, (cx, cy, cz), rr), glow)
    if pose.get('dead'):
        # the caps have toppled off and lie on the ground beside the puddle (world coordinates)
        G = coords(IDENT)
        for (cx, cy, ang) in ((-12.0, 1.0, 0.5), (11.0, -2.5, 2.6)):
            d = np.array([np.cos(ang), np.sin(ang), 0.0])
            base = np.array([cx, cy, 0.7])
            put(capsule(G, base, base + d * 2.6, 0.6), 5)
            gx, gy, gz = G
            capc = base + d * 3.3
            put(((gx - capc[0]) ** 2 + (gy - capc[1]) ** 2 + ((gz - 1.0) * 1.6) ** 2 < 2.0 ** 2) & (gz >= 0), 4)
    else:
        for (cx, cy, h) in CAPS:
            put(capsule(C, (cx, cy, 7.0), (cx, cy, 7.0 + h), 0.6), 5)
            put(((x - cx) ** 2 + (y - cy) ** 2 < 2.0 ** 2) & (z >= 7.0 + h)
                & (z < 7.0 + h + 0.9 + 0.6 * (1 - ((x - cx) ** 2 + (y - cy) ** 2) / 4)), 4)
    for p in pose.get('drops', []):
        put(ball(coords(IDENT), p, 0.9), 1)
    occ = gauss3d((M > 0).astype(float), 1.6)
    g = np.gradient(occ)
    N = -np.stack(g, -1)
    N /= (np.linalg.norm(N, axis=-1, keepdims=True) + 1e-9)

# ---------------------------------------------------------------- animations
ANIMATIONS = [
    # (name, poses, fps, loop); each pose may also set the ground shadow's size, 'shadow' (1 = full)
    ('idle', [dict(wide=0.98, tall=1.03),                                 # swell
              dict(wide=1.05, tall=0.92)], 2, True),                     # sag
    ('hop', [dict(wide=1.22, tall=0.68),                                  # 0: squashed flat in place, the tell
             dict(wide=0.84, tall=1.38, lift_px=4, shadow=0.85),          # 1: stretched launch, ~4 px up
             dict(wide=0.96, tall=1.08, lift_px=8, shadow=0.7),           # 2: top of the arc, ~8 px up
             dict(wide=1.32, tall=0.58)], 10, False),                    # 3: landing splat
    ('hurt', [dict(wide=1.18, tall=0.74,                                  # symmetric flinch, drops flung off
                   drops=[(-11.0, -1.0, 5.0), (10.5, 0.5, 6.0), (-6.0, -7.5, 9.0), (6.5, -6.0, 10.0), (0.5, 4.0, 12.0)])],
     round(1000 / 233, 2), False),
    ('dead', [dict(wide=1.45, tall=0.28, dead=True)], 1.5, False),        # a puddle; held through the 667 ms fade
]

# ---------------------------------------------------------------- shadow and export
def draw_shadow(img, scale, up=0):
    """Flat ground shadow centred on the anchor (moved with the drawing), under every pixel of the sprite."""
    out = np.zeros_like(img)
    ii, jj = np.indices(img.shape[:2])
    a, b = 8.6 * scale, 3.4 * scale
    inside = ((jj + 0.5 - W / 2) / a) ** 2 + ((ii + 0.5 - (FOOT_ROW - 0.4 - up)) / b) ** 2 < 1
    out[inside] = SHADOW
    sprite = img[..., 3] > 0
    out[sprite] = img[sprite]
    return out

def render_lifted(up):
    """Render with the whole drawing moved up by whole pixels, by offsetting the grid origin (nothing lost)."""
    global ys
    if up == 0:
        return render(0)
    ys0 = ys
    ys = ys0 + up / np.sin(PHI)
    try:
        return render(0)
    finally:
        ys = ys0

def measure():
    occ = np.argwhere(M > 0)
    p = np.stack([xs[occ[:, 0]], ys[occ[:, 1]], zs[occ[:, 2]]], -1)
    return p[:, 0], p[:, 1] * np.sin(PHI) + p[:, 2] * np.cos(PHI)

def lift_for(extents, name):
    """Whole pixels to raise an animation's drawing so every frame clears the frame bottom; 0 if it fits.

    One lift per animation keeps the drawn rise between hop frames exact. The JSON `offset` lets the
    engine undo it, as for the characters.
    """
    lim_x, lo_y, hi_y = W / 2 - 1.25, -1.5, FOOT_ROW - 1.5      # content in columns and rows 1..edge-2
    x0, x1 = min(e[0] for e in extents), max(e[1] for e in extents)
    y0, y1 = min(e[2] for e in extents), max(e[3] for e in extents)
    up = max(0, int(np.ceil(lo_y - y0)))
    if x0 < -lim_x or x1 > lim_x or y1 + up > hi_y:
        raise ValueError(f'{name} does not fit the {W}x{H} frame')
    return up

def generate(out_dir=None, name='slime'):
    out_dir = out_dir or DEFAULT_OUT
    frames, anims, report = [], {}, {}
    for anim, poses, fps, loop in ANIMATIONS:
        ext = []
        for pose in poses:
            build(pose)
            sx, sy = measure()
            ext.append((sx.min(), sx.max(), sy.min(), sy.max()))
        up = lift_for(ext, anim)
        idx = []
        for k, pose in enumerate(poses):
            build(pose)
            sx, sy = measure()
            report[f'{anim}_{k}'] = {'width_px': round(float(sx.max() - sx.min()) + 1),
                                     'body_bottom_px': round(float(sy.min()), 1)}
            frames.append(Image.fromarray(draw_shadow(compose(*render_lifted(up)), pose.get('shadow', 1.0), up), 'RGBA'))
            idx.append(len(frames) - 1)
        anims[anim] = {'frames': idx, 'fps': fps, 'loop': loop}
        if up:
            anims[anim]['offset'] = [0, up]          # the engine adds this to undo the lift
    sheet = Image.new('RGBA', (W * len(frames), H), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        sheet.paste(f, (i * W, 0))
    # head pivot: the top of the resting slime (idle frame 0), relative to the anchor
    a = np.array(frames[0])[..., 3] == 255
    top = int(np.where(a.any(1))[0].min()) + anims['idle'].get('offset', [0, 0])[1]
    meta = {'image': f'{name}.png', 'frameWidth': W, 'frameHeight': H, 'anchor': [0.5, 1],
            'pivots': {'head': [0, top - H]}, 'animations': anims}
    os.makedirs(out_dir, exist_ok=True)
    sheet.save(os.path.join(out_dir, f'{name}.png'))
    with open(os.path.join(out_dir, f'{name}.json'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(meta, indent=2) + '\n')
    return sheet, meta, report

# ---------------------------------------------------------------- renderer
W, H = 48, 48
PHI = np.radians(32)                          # camera pitch: 3/4 overhead
F = np.array([0, np.cos(PHI), -np.sin(PHI)])  # into the screen
U = np.array([0, np.sin(PHI), np.cos(PHI)])   # screen up
R = np.array([1.0, 0, 0])                     # screen right
LV = np.array([-0.6, 0.45, 0.85])            # light: upper-left, from the viewer side
LV /= np.linalg.norm(LV)
L_WORLD = LV[0] * R + LV[1] * U - LV[2] * F
FOOT_ROW = 45.0

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
    # depth-discontinuity lines: farther pixel next to a much nearer one gets darkened
    for di, dj in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        nd = np.full_like(depth, np.inf)
        si = slice(max(di, 0), H_ + min(di, 0)); ti = slice(max(-di, 0), H_ + min(-di, 0))
        sj = slice(max(dj, 0), W_ + min(dj, 0)); tj = slice(max(-dj, 0), W_ + min(-dj, 0))
        nd[ti, tj] = depth[si, sj]
        with np.errstate(invalid='ignore'):
            edge = (out_mat > 0) & np.isfinite(nd) & np.isfinite(depth) & ((depth - nd) > 3.0)
        lvl[edge] = 3
    # chainmail texture: alternating rows on lit/base areas
    ii, jj = np.indices(out_mat.shape)
    mail = (out_mat == 2) & (lvl == 1) & (((ii + jj) % 2) == 0) & ((ii % 2) == 0)
    lvl[mail] = 2
    for m, ramp in RAMPS.items():
        for l in range(4):
            sel = (out_mat == m) & (lvl == l)
            img[sel, :3] = ramp[l]
            img[sel, 3] = 255
    # 1px outline: deep shade of the neighbouring material
    solid = out_mat > 0
    outline = np.zeros_like(img)
    for di, dj in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        sh = np.pad(out_mat, 1)[1 - di:1 - di + out_mat.shape[0], 1 - dj:1 - dj + out_mat.shape[1]]
        sel = (~solid) & (sh > 0) & (outline[..., 3] == 0)
        for m, ramp in RAMPS.items():
            s2 = sel & (sh == m)
            dark = tuple(int(c * 0.55) for c in ramp[3])
            outline[s2, :3] = dark
            outline[s2, 3] = 255
    img = np.where(img[..., 3:] > 0, img, outline)
    return img


if __name__ == '__main__':
    sheet, meta, report = generate(sys.argv[1] if len(sys.argv) > 1 else None)
    print('sheet', sheet.size, 'pivots', meta['pivots'])
    for k, v in report.items():
        print(' ', k, v)
