"""Stations sprite generator.

Writes stations.png and stations.json to <repo>/assets/sprites (or the directory given).

Usage: pnpm art stations

Crafting stations, 32 wide by 48 tall, stored as named stills in `frames` (forge, alchemy) with
`animations` empty; anchor [0.5, 1] on the ground under the station's centre, ground plane 3 rows
above the frame bottom as for the characters. Rendered with the characters' own voxel renderer,
camera, light, ramps and outline at the same 1 unit = 1 px scale. numpy + Pillow only, integer
hashing only, no randomness. Writes only stations.*: never another tool's sheet.
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
    1:  ('#8f897c', '#6c675d', '#4a463f', '#2c2a26'),  # stone
    3:  ('#5a554c', '#46423b', '#34312c', '#211f1c'),  # mortar and shadowed stone
    4:  ('#fff0b0', '#ffb347', '#e0701e', '#8a3010'),  # embers: bright at every level, they give light
    5:  ('#4a4440', '#2e2a28', '#1e1b1a', '#111111'),  # coal and soot
    6:  ('#767b83', '#5f646b', '#41454b', '#2c2f35'),  # iron (the knight's rim iron)
    7:  ('#7a5e44', '#5e4632', '#402f22', '#271c14'),  # table wood
    8:  ('#6e5442', '#4f3c30', '#33271f', '#1c1511'),  # leather (the items' leather)
    9:  ('#4f3c30', '#3a2c23', '#271e18', '#140f0c'),  # dark leather: bellows pleats, book cover
    10: ('#a0805c', '#7e6244', '#56422e', '#33271b'),  # light wood: handles, corks, pestle, boards
    11: ('#5e4632', '#4a3726', '#33261a', '#1e160f'),  # dark wood: seams, apron, stretcher
    12: ('#ecd096', '#d0a85c', '#9a7536', '#5c4220'),  # brass (the player's gold)
    13: ('#eef4f4', '#a9b8bc', '#6e7c82', '#3e474c'),  # glass
    14: ('#fff8d0', '#ffe080', '#ffb040', '#a85a10'),  # flame
    15: ('#d4ff9a', '#8fd65a', '#5a9e3e', '#2f5c26'),  # green brew (the glowspore's colour)
    16: ('#ffd27a', '#ff9a30', '#c4691c', '#7a3e10'),  # potion_ember
    17: ('#cfc6b4', '#948a78', '#655d50', '#3a352d'),  # potion_stone
    18: ('#d0f6ff', '#6ec8e8', '#3a8aae', '#1d4c62'),  # potion_breath
    19: ('#f2ead2', '#d8ccaa', '#a89c7c', '#6e654e'),  # parchment
    20: ('#f0e8d0', '#d6cba8', '#a89c7c', '#6e654e'),  # candle wax
}
RAMPS = {k: [hx(c) for c in v] for k, v in RAMPS.items()}

# ---------------------------------------------------------------- voxel grid
RES = 0.5
xs = np.arange(-18, 18, RES) + RES / 2
ys = np.arange(-10, 16, RES) + RES / 2
zs = np.arange(-2, 48, RES) + RES / 2
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

def box(C, x0, x1, y0, y1, z0, z1):
    x, y, z = C
    return (x >= x0) & (x < x1) & (y >= y0) & (y < y1) & (z >= z0) & (z < z1)

def courses(C, mask, h=2.6, w=4.2, mortar=0.5):
    """Mortar lines of a running-bond stone wall, on any face of mask."""
    x, y, z = C
    row = np.floor(z / h)
    off = (row % 2) * (w / 2)
    bed = (z - row * h) < mortar
    head = ((x + off) - np.floor((x + off) / w) * w) < mortar
    head2 = ((y + off) - np.floor((y + off) / w) * w) < mortar
    return mask & (bed | head | head2)

def build_forge():
    """A stone forge about as wide as the knight: chest-high hearth with a glowing fire mouth
    and coal bed, an iron hood and chimney, bellows on the left, hammer and tongs on the right."""
    global M
    M = np.zeros(X.shape, np.uint8)
    def put(mask, mat):
        M[mask] = mat
    C = coords(IDENT)
    x, y, z = C
    TOP = 18.0
    # hearth: running-bond stone, slightly battered (wider at the foot)
    batter = (TOP - np.clip(z, 0, TOP)) * 0.05
    hearth = (np.abs(x) < 9.8 + batter) & (y >= -2.6 - batter * 0.4) & (y < 8.0) & (z >= 0) & (z < TOP)
    put(hearth, 1)
    put(courses(C, hearth), 3)
    put(hearth & (ihash3(x, y, z, 0.45) > 0.86), 3)                           # weathered stones
    # cap stones round the top edge
    cap = (np.abs(x) < 10.4) & (y >= -3.0) & (y < 8.4) & (z >= TOP - 1.2) & (z < TOP)
    put(cap, 1)
    put(cap & (((x + 30) % 3.4) < 0.45), 3)
    # the fire mouth: an arched opening in the front, glowing from inside
    mouth = (np.abs(x) < 3.6) & (y < 0.2) & (z >= 3.0) & ((z < 7.4) | (x ** 2 + (z - 7.4) ** 2 < 3.6 ** 2))
    put(mouth & hearth, 0)
    put((np.abs(x) < 3.6) & (y >= 0.2) & (y < 1.0) & (z >= 3.0) & (z < 11.0) & ((z < 7.4) | (x ** 2 + (z - 7.4) ** 2 < 3.6 ** 2)), 4)
    put((np.abs(x) < 3.0) & (y >= -0.2) & (y < 0.6) & (z >= 3.0) & (z < 4.4), 5)       # coals in the mouth
    put((np.abs(x) < 3.0) & (y >= -0.2) & (y < 0.6) & (z >= 3.0) & (z < 4.4) & (ihash3(x, y, z, 1.2) > 0.5), 4)
    arch = (np.abs(x) < 4.6) & (y >= -2.8) & (y < -1.8) & (z >= 3.0) & ((z < 7.4) | (x ** 2 + (z - 7.4) ** 2 < 4.6 ** 2))
    put(arch & ~((np.abs(x) < 3.6) & ((z < 7.4) | (x ** 2 + (z - 7.4) ** 2 < 3.6 ** 2))), 3)   # voussoirs
    # coal bed sunk into the top
    put(box(C, -6.6, 6.6, -1.0, 5.6, TOP - 1.2, TOP + 0.2), 0)
    bed = box(C, -6.6, 6.6, -1.0, 5.6, TOP - 1.2, TOP - 0.4)
    put(bed, 4)
    put(bed & (ihash3(x, y, z, 0.9) > 0.6), 5)
    lip = box(C, -7.0, 7.0, -1.4, 6.0, TOP - 0.4, TOP + 0.3) & ~box(C, -6.4, 6.4, -0.8, 5.4, TOP - 2, TOP + 1)
    put(lip, 6)
    # iron hood flaring down over the bed, chimney rising behind it
    HOOD0, HOOD1 = TOP + 5.0, TOP + 11.0
    k = np.clip((HOOD1 - z) / (HOOD1 - HOOD0), 0, 1)
    hood = (z >= HOOD0) & (z < HOOD1) & (np.abs(x) < 3.4 + 4.6 * k) & (y > 6.2 - 7.0 * k) & (y < 7.8)
    hood &= ~((np.abs(x) < 2.6 + 4.6 * k) & (y > 6.9 - 7.0 * k) & (y < 7.2) & (z < HOOD1 - 0.8))
    put(hood, 6)
    put(hood & (np.abs(z - (HOOD0 + 0.5)) < 0.5), 7)                           # riveted iron band
    chimney = box(C, -3.4, 3.4, 4.0, 8.0, HOOD1, TOP + 24.0)
    put(chimney, 1)
    put(courses(C, chimney, h=2.4, w=3.4), 3)
    put(box(C, -3.9, 3.9, 3.5, 8.5, TOP + 22.8, TOP + 24.0), 1)                 # chimney cap
    put(box(C, -2.4, 2.4, 5.0, 7.0, TOP + 23.4, TOP + 24.2), 5)                 # soot at the flue
    for sx in (-1, 1):                                                         # hood supports
        put(capsule(C, (sx * 6.4, 6.2, TOP + 0.2), (sx * 3.4, 6.6, HOOD1 - 0.2), 0.4), 6)
    # bellows on the left: two boards and a leather body, nozzle into the hearth side
    bc = np.array([-11.6, 3.0, 9.0])
    put(capsule(C, bc + [0, -3.2, 0], bc + [0, 3.2, 0], 1.7, 1.0), 8)          # leather pleats
    put(capsule(C, bc + [0, -3.2, 0], bc + [0, 3.2, 0], 1.75, 1.05) & (((y - bc[1]) % 1.4) < 0.35), 9)
    put(box(C, bc[0] - 2.0, bc[0] + 2.0, bc[1] - 3.6, bc[1] + 3.6, bc[2] + 1.5, bc[2] + 2.1), 10)   # top board
    put(box(C, bc[0] - 2.0, bc[0] + 2.0, bc[1] - 3.6, bc[1] + 3.6, bc[2] - 2.1, bc[2] - 1.5), 10)   # bottom board
    put(capsule(C, bc + [0, 3.6, 1.8], bc + [0, 6.4, 3.6], 0.45), 10)          # handle
    put(capsule(C, bc + [1.2, -3.0, 0], (-9.6, -1.0, 9.0), 0.55), 6)           # nozzle
    put(capsule(C, (-11.6, 1.0, 0.0), (-11.6, 1.0, 7.0), 0.5), 10)             # stand
    put(capsule(C, (-11.6, 5.0, 0.0), (-11.6, 5.0, 7.0), 0.5), 10)
    # hammer and tongs leaning against the right side
    put(capsule(C, (11.2, -1.2, 0.3), (10.7, -0.8, 10.2), 0.45), 10)          # hammer haft
    put(capsule(C, (9.9, -0.9, 10.2), (11.7, -0.7, 10.4), 0.85), 6)            # hammer head
    put(capsule(C, (11.6, 1.6, 0.3), (10.6, 1.8, 12.6), 0.38), 6)              # tongs
    put(capsule(C, (12.4, 1.8, 0.3), (10.9, 1.9, 12.6), 0.38), 6)

def build_alchemy():
    """An alchemy table at hip height: a green brew bubbling over a burner, a rack of the three
    potions, a tall blue vial, a mortar and pestle, an open book and a lit candle."""
    global M
    M = np.zeros(X.shape, np.uint8)
    def put(mask, mat):
        M[mask] = mat
    C = coords(IDENT)
    x, y, z = C
    TOP = 12.0
    top = box(C, -11.4, 11.4, -2.6, 6.4, TOP - 1.2, TOP)
    put(top, 7)
    put(top & ((((y + 30) % 2.3) < 0.35) | (np.abs(np.abs(x) - 11.0) < 0.4)), 11)   # plank seams, end grain
    for lx in (-10.2, 10.2):                                                   # turned legs
        for ly in (-1.4, 5.2):
            put(box(C, lx - 0.75, lx + 0.75, ly - 0.75, ly + 0.75, 0.0, TOP - 1.2), 7)
            put(box(C, lx - 0.95, lx + 0.95, ly - 0.95, ly + 0.95, 0.0, 0.8), 11)
    put(box(C, -10.0, 10.0, -2.2, -1.4, TOP - 3.4, TOP - 1.2), 11)             # front apron
    put(box(C, -2.6, 2.6, -2.5, -2.1, TOP - 2.8, TOP - 1.6), 7)                # drawer front
    put(ball(C, (0, -2.6, TOP - 2.2), 0.45), 12)                               # brass pull
    put(box(C, -9.6, 9.6, 4.6, 5.6, 2.2, 3.0), 11)                             # stretcher
    put(box(C, -9.6, 9.6, -2.0, 6.0, 3.0, 3.6) & ((((x + 30) % 2.8) < 2.2)), 7)  # low shelf
    put(capsule(C, (-7.0, 1.0, 3.6), (-7.0, 1.0, 5.4), 1.3, 1.1), 13)          # a stoppered jar on the shelf
    put(capsule(C, (-7.0, 1.0, 5.4), (-7.0, 1.0, 6.2), 0.6), 10)
    # round flask of green brew over a little burner (left)
    fc = np.array([-6.4, 1.8, TOP + 5.0])
    put(capsule(C, (fc[0], fc[1], TOP), (fc[0], fc[1], TOP + 1.6), 1.3), 6)    # burner
    put(capsule(C, (fc[0], fc[1], TOP + 1.6), (fc[0], fc[1], TOP + 2.6), 0.6, 0.2), 14)
    for a in (0, 2.09, 4.19):                                                  # tripod
        put(capsule(C, (fc[0] + 2.4 * np.cos(a), fc[1] + 2.4 * np.sin(a), TOP), (fc[0], fc[1], TOP + 2.8), 0.3), 6)
    put(ball(C, fc, 2.9), 15)
    put(ball(C, fc, 2.9) & (z > fc[2] + 1.2), 13)
    put(capsule(C, fc + [0, 0, 2.4], fc + [0, 0, 5.4], 0.85), 13)              # neck
    put(capsule(C, fc + [0, 0, 5.2], fc + [3.6, 0.6, 6.4], 0.4), 12)           # brass condenser tube
    put(ball(C, fc + [0.8, -1.5, 1.6], 0.55), 15)                              # bubbles breaking the surface
    put(ball(C, fc + [-1.0, -1.2, 1.9], 0.45), 15)
    # rack of the three potions (ember, stone, breath), centre back
    put(box(C, -2.6, 3.8, 3.4, 5.2, TOP, TOP + 0.6), 7)
    put(box(C, -2.6, 3.8, 3.4, 5.2, TOP + 3.0, TOP + 3.5) & ~(((x + 30) % 2.1) < 1.2), 7)
    for i, (px, mat) in enumerate(((-1.5, 16), (0.6, 17), (2.7, 18))):
        put(capsule(C, (px, 4.3, TOP + 0.6), (px, 4.3, TOP + 3.2), 0.75), mat)
        put(capsule(C, (px, 4.3, TOP + 3.2), (px, 4.3, TOP + 4.6), 0.4), 13)
        put(ball(C, (px, 4.3, TOP + 4.8), 0.45), 10)                           # corks
    # tall blue vial and a mortar with its pestle (front right)
    vc = np.array([7.0, 2.6, TOP])
    put(capsule(C, vc + [0, 0, 0.5], vc + [0, 0, 7.5], 1.2), 18)
    put(capsule(C, vc + [0, 0, 4.6], vc + [0, 0, 7.5], 1.2), 13)
    put(capsule(C, vc + [0, 0, 7.5], vc + [0, 0, 8.6], 0.8), 10)
    mc = np.array([3.6, -0.8, TOP])
    put(capsule(C, mc + [0, 0, 0.3], mc + [0, 0, 1.9], 1.5, 1.9), 1)
    put(capsule(C, mc + [0, 0, 1.6], mc + [0, 0, 2.2], 1.2), 3)
    put(capsule(C, mc + [0.2, 0.3, 1.8], mc + [1.8, 1.0, 4.4], 0.5), 10)
    # an open book, front left, and a stub of candle at the back right
    bk = (np.abs(x + 2.2) < 2.6) & (y > -2.2) & (y < 1.4) & (z >= TOP) & (z < TOP + 0.6 + 0.25 * np.abs(x + 2.2))
    put(bk, 19)
    put(bk & (np.abs(x + 2.2) < 0.3), 9)                                       # spine
    put(bk & (z < TOP + 0.4), 9)                                               # cover
    cc = np.array([9.4, 5.0, TOP])
    put(capsule(C, cc, cc + [0, 0, 3.4], 0.75), 20)
    put(capsule(C, cc + [0.4, 0, 0], cc + [0.6, -0.1, 1.6], 0.35), 20)         # a wax drip
    put(capsule(C, cc + [0, 0, 4.0], cc + [0, 0, 5.4], 0.55, 0.2), 14)

STATIONS = [('forge', build_forge), ('alchemy', build_alchemy)]

def finish():
    global N
    occ = gauss3d((M > 0).astype(float), 1.6)
    gx, gy, gz = np.gradient(occ)
    N = -np.stack([gx, gy, gz], -1)
    N /= (np.linalg.norm(N, axis=-1, keepdims=True) + 1e-9)

def measure():
    occ = np.argwhere(M > 0)
    p = np.stack([xs[occ[:, 0]], ys[occ[:, 1]], zs[occ[:, 2]]], -1)
    return p[:, 0], p[:, 1] * np.sin(PHI) + p[:, 2] * np.cos(PHI)

def check_fits(name):
    """Stations stand on their anchor and are never shifted, so they must already fit the frame."""
    sx, sy = measure()
    lim_x, lo_y, hi_y = W / 2 - 1.25, -1.5, FOOT_ROW - 1.5      # content in columns and rows 1..edge-2
    if sx.min() < -lim_x or sx.max() > lim_x or sy.min() < lo_y or sy.max() > hi_y:
        raise ValueError(f'{name} does not fit the {W}x{H} frame: '
                         f'x {sx.min():.1f}..{sx.max():.1f}, y {sy.min():.1f}..{sy.max():.1f}')

def generate(out_dir=None, name='stations'):
    """Write <name>.png and <name>.json. Stills go in `frames` (name -> index); `animations` stays empty."""
    out_dir = out_dir or DEFAULT_OUT
    sheet = Image.new('RGBA', (W * len(STATIONS), H), (0, 0, 0, 0))
    frames, report = {}, {}
    for i, (key, fn) in enumerate(STATIONS):
        fn()
        finish()
        check_fits(key)
        sx, sy = measure()
        report[key] = {'width_px': round(float(sx.max() - sx.min()) + 1), 'height_px': round(float(sy.max() - sy.min()) + 1)}
        sheet.paste(Image.fromarray(compose(*render(0)), 'RGBA'), (i * W, 0))
        frames[key] = i
    os.makedirs(out_dir, exist_ok=True)
    sheet.save(os.path.join(out_dir, f'{name}.png'))
    meta = {'image': f'{name}.png', 'frameWidth': W, 'frameHeight': H, 'anchor': [0.5, 1],
            'pivots': {}, 'frames': frames, 'animations': {}}
    with open(os.path.join(out_dir, f'{name}.json'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(meta, indent=2) + '\n')
    return sheet, meta, report

# ---------------------------------------------------------------- renderer
W, H = 32, 48                                 # stations: 32 wide, 48 tall
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
    print('sheet', sheet.size, meta['frames'], report)
