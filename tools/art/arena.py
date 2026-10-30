"""Arena sprite generator.

Writes arena.png and arena.json to <repo>/assets/sprites (or the directory given).

Usage: pnpm art arena

The Warden's arena braziers, 16 wide by 24 tall, anchor [0.5, 1] on the ground under the brazier,
ground plane 3 rows above the frame bottom: `brazier` (cold, a still in `frames`) and `brazier_lit`
(3 frames, 8 fps, looping, in `animations`). Rendered with the characters' voxel renderer, camera,
light, ramps and outline at 1 unit = 1 px. numpy + Pillow only, integer hashing only, no
randomness. Writes only arena.*.
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
    1:  ('#8f897c', '#6c675d', '#4a463f', '#2c2a26'),  # stone (the stations' stone)
    3:  ('#5a554c', '#46423b', '#34312c', '#211f1c'),  # mortar
    4:  ('#fff0b0', '#ffb347', '#e0701e', '#8a3010'),  # embers and outer flame: bright at every level
    5:  ('#4a4440', '#2e2a28', '#1e1b1a', '#111111'),  # coal and soot
    6:  ('#767b83', '#5f646b', '#41454b', '#2c2f35'),  # iron
    11: ('#bcb7ae', '#9a958d', '#77736c', '#4e4b46'),  # cold ash (the village's ash)
    13: ('#fffbe6', '#fff0b0', '#ffd27a', '#c8802a'),  # the flame's heart: bright at every level
}
RAMPS = {k: [hx(c) for c in v] for k, v in RAMPS.items()}

# ---------------------------------------------------------------- voxel grid
RES = 0.5
xs = np.arange(-10, 10, RES) + RES / 2
ys = np.arange(-8, 10, RES) + RES / 2
zs = np.arange(-2, 26, RES) + RES / 2
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

BOWL_C = np.array([0.0, 1.2, 8.6])

# three flame shapes for the burning loop: (x sway of the main tongue, its height, side tongue heights)
FLAMES = [(-0.4, 11.6, (7.6, 6.2)), (0.5, 10.4, (6.4, 8.2)), (-0.1, 12.4, (7.0, 6.8))]

def build(lit_frame=None):
    """The brazier: a stone pedestal with an iron bowl; cold (None) or burning (flame shape 0-2)."""
    global M
    M = np.zeros(X.shape, np.uint8)
    def put(mask, mat):
        M[mask] = mat
    C = coords(IDENT)
    x, y, z = C
    c = BOWL_C
    r = np.sqrt((x - c[0]) ** 2 + (y - c[1]) ** 2)
    put((r < 2.6) & (z >= 0) & (z < 1.4), 1)                                            # plinth
    put((r < 1.7) & (z >= 1.4) & (z < 6.4), 1)                                          # column
    put((r < 1.8) & (z >= 1.4) & (z < 6.4) & (((z + 30) % 1.9) < 0.35), 3)
    put((r < 2.3) & (z >= 6.0) & (z < 6.8), 1)                                          # capital
    rim = (r < 4.9) & (r > 3.6) & (z >= c[2] + 1.0) & (z < c[2] + 1.8)
    outer = (r < 4.7) & (z >= 6.8) & (z < c[2] + 1.6) & (r > 1.9 + (z - 6.8) * 1.0)
    put(outer, 6)
    put(rim, 6)
    put((r < 3.8) & (z >= c[2] - 0.2) & (z < c[2] + 1.2), 5)                            # the fuel bed
    if lit_frame is None:
        put((r < 3.6) & (z >= c[2] + 0.4) & (z < c[2] + 1.4 + 0.6 * (1 - r / 3.6)) & (ihash3(x, y, 0 * z, 1.1) > 0.25), 11)
    else:
        put((r < 3.7) & (z >= c[2] + 0.4) & (z < c[2] + 1.3) & (ihash3(x, y, z, 1.0) > 0.45), 4)   # glowing coals
        sway, h, (hl, hr) = FLAMES[lit_frame]
        base = c + [0, 0, 1.0]
        put(capsule(C, base, base + [sway, 0, h], 2.6, 0.2), 4)                          # outer tongues
        put(capsule(C, base + [-1.8, 0.2, 0], base + [-2.4 - sway, 0.2, hl], 1.5, 0.15), 4)
        put(capsule(C, base + [1.8, -0.2, 0], base + [2.4 - sway, -0.2, hr], 1.5, 0.15), 4)
        put(capsule(C, base + [0, -0.6, 0], base + [0.6 * sway, -0.6, h * 0.62], 1.5, 0.2), 13)   # the bright heart

VARIANTS = [('brazier', None), ('brazier_lit', 0), ('brazier_lit', 1), ('brazier_lit', 2)]

def finish():
    global N
    M[:, :, zs < 0] = 0
    occ = gauss3d((M > 0).astype(float), 1.6)
    gx, gy, gz = np.gradient(occ)
    N = -np.stack([gx, gy, gz], -1)
    N /= (np.linalg.norm(N, axis=-1, keepdims=True) + 1e-9)

def check_fits(name):
    """The brazier stands on its anchor and is never shifted, so every frame must already fit."""
    occ = np.argwhere(M > 0)
    p = np.stack([xs[occ[:, 0]], ys[occ[:, 1]], zs[occ[:, 2]]], -1)
    sx, sy = p[:, 0], p[:, 1] * np.sin(PHI) + p[:, 2] * np.cos(PHI)
    lim_x, lo_y, hi_y = W / 2 - 1.25, -1.5, FOOT_ROW - 1.5      # content in columns and rows 1..edge-2
    if sx.min() < -lim_x or sx.max() > lim_x or sy.min() < lo_y or sy.max() > hi_y:
        raise ValueError(f'{name} does not fit the {W}x{H} frame: '
                         f'x {sx.min():.1f}..{sx.max():.1f}, y {sy.min():.1f}..{sy.max():.1f}')

def generate(out_dir=None, name='arena'):
    """Write <name>.png and <name>.json: the cold brazier as a still, the burning loop as an animation."""
    out_dir = out_dir or DEFAULT_OUT
    sheet = Image.new('RGBA', (W * len(VARIANTS), H), (0, 0, 0, 0))
    for i, (key, lit) in enumerate(VARIANTS):
        build(lit)
        finish()
        check_fits(f'{key} {lit}')
        sheet.paste(Image.fromarray(compose(*render(0)), 'RGBA'), (i * W, 0))
    os.makedirs(out_dir, exist_ok=True)
    sheet.save(os.path.join(out_dir, f'{name}.png'))
    meta = {'image': f'{name}.png', 'frameWidth': W, 'frameHeight': H, 'anchor': [0.5, 1],
            'frames': {'brazier': 0},
            'animations': {'brazier_lit': {'frames': [1, 2, 3], 'fps': 8, 'loop': True}}}
    with open(os.path.join(out_dir, f'{name}.json'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(meta, indent=2) + '\n')
    return sheet, meta

# ---------------------------------------------------------------- renderer
W, H = 16, 24                                 # the brazier: 16 wide, 24 tall
PHI = np.radians(32)                          # camera pitch: 3/4 overhead
F = np.array([0, np.cos(PHI), -np.sin(PHI)])  # into the screen
U = np.array([0, np.sin(PHI), np.cos(PHI)])   # screen up
R = np.array([1.0, 0, 0])                     # screen right
LV = np.array([-0.6, 0.45, 0.85])            # light: upper-left, from the viewer side
LV /= np.linalg.norm(LV)
L_WORLD = LV[0] * R + LV[1] * U - LV[2] * F
FOOT_ROW = 21.0                               # ground 3 rows above the bottom, as for every sheet

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
    sheet, meta = generate(sys.argv[1] if len(sys.argv) > 1 else None)
    print('sheet', sheet.size, 'frames', meta['frames'], 'animations', meta['animations'])
