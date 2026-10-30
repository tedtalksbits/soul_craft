"""Village sprite generator.

Writes village.png and village.json to <repo>/assets/sprites (or the directory given).

Usage: pnpm art village

The five restoration sites of Ashen Village, 32x32 named stills in `frames` (`animations` is
empty), anchor [0.5, 1] on the ground under each site, ground plane 3 rows above the frame
bottom. Row 1 holds the ruins (ash-choked and collapsed), row 2 the rebuilt sites (clean and
lived-in), in the order well, storehouse, palisade, lamps, smithy. Each ruin and its rebuilt
version share one footprint, so a site doesn't jump when it is restored. Rendered with the
characters' voxel renderer, camera, light, ramps and outline at 1 unit = 1 px. numpy + Pillow
only, integer hashing only, no randomness. Writes only village.*.
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
    3:  ('#5a554c', '#46423b', '#34312c', '#211f1c'),  # mortar and shadowed stone
    4:  ('#fff0b0', '#ffb347', '#e0701e', '#8a3010'),  # embers: bright at every level
    5:  ('#4a4440', '#2e2a28', '#1e1b1a', '#111111'),  # coal and soot
    6:  ('#767b83', '#5f646b', '#41454b', '#2c2f35'),  # iron
    7:  ('#9a7a56', '#76593e', '#523d2a', '#30241a'),  # fresh wood
    8:  ('#6e5440', '#523d2e', '#3a2b20', '#221912'),  # dark wood: posts, frames
    9:  ('#4c423b', '#362e29', '#25201d', '#151210'),  # charred wood
    10: ('#946048', '#704634', '#4e3024', '#2e1c15'),  # roof shingles
    11: ('#bcb7ae', '#9a958d', '#77736c', '#4e4b46'),  # drifted ash
    12: ('#d0bc94', '#ae9a72', '#7e6e50', '#4c4232'),  # rope, sacking, rushes
    13: ('#fff8d0', '#ffe080', '#ffb040', '#a85a10'),  # lamplight: bright at every level
    14: ('#86bcd2', '#548aa2', '#36606f', '#1d3640'),  # water
}
RAMPS = {k: [hx(c) for c in v] for k, v in RAMPS.items()}

# ---------------------------------------------------------------- voxel grid
RES = 0.5
xs = np.arange(-18, 18, RES) + RES / 2
ys = np.arange(-8, 20, RES) + RES / 2
zs = np.arange(-2, 36, RES) + RES / 2
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

def courses(C, mask, h=2.2, w=3.2, mortar=0.45):
    """Mortar lines of a running-bond stone wall, on any face of mask."""
    x, y, z = C
    row = np.floor(z / h)
    off = (row % 2) * (w / 2)
    bed = (z - row * h) < mortar
    head = ((x + off) - np.floor((x + off) / w) * w) < mortar
    head2 = ((y + off) - np.floor((y + off) / w) * w) < mortar
    return mask & (bed | head | head2)

def ash_drift(C, cx, cy, rx, ry, h):
    """A low, lumpy drift of ash on the ground."""
    x, y, z = C
    d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
    top = h * (1 - d) + 0.5 * (ihash3(x, y, 0 * z, 0.9) - 0.5)
    return (d < 1) & (z >= 0) & (z < top)

def rubble(put, C, stones):
    for (sx, sy, r) in stones:
        put(ball(C, (sx, sy, r * 0.6), r) & (C[2] >= 0), 1)

def gable(C, x0, x1, y0, y1, z0, ridge):
    """A gable roof along x: eaves at z0 on the y0 and y1 edges, ridge in the middle."""
    x, y, z = C
    yc, half = (y0 + y1) / 2, (y1 - y0) / 2
    roof_z = z0 + (ridge - z0) * (1 - np.abs(y - yc) / half)
    return (x >= x0) & (x < x1) & (y >= y0) & (y < y1) & (z >= roof_z - 0.9) & (z < roof_z)

# ---------------------------------------------------------------- well
WELL_C = (0.0, 3.0)
def well(ruined):
    C = coords(IDENT); x, y, z = C
    put = PUT
    r = np.sqrt((x - WELL_C[0]) ** 2 + (y - WELL_C[1]) ** 2)
    ang = np.arctan2(y - WELL_C[1], x - WELL_C[0])
    ring = (r < 5.2) & (r > 3.6) & (z >= 0)
    if not ruined:
        put(ring & (z < 4.6), 1)
        put(courses(C, ring & (z < 4.6), h=1.6, w=2.6), 3)
        put((r <= 3.6) & (z >= 0) & (z < 3.0), 14)                                # water
        for sx in (-1, 1):
            put(box(C, sx * 5.9 - 0.6, sx * 5.9 + 0.6, 2.4, 3.6, 0, 14.0), 8)       # posts
        put(capsule(C, (-6.2, 3.0, 13.2), (6.2, 3.0, 13.2), 0.55), 8)              # crossbeam and windlass
        put(capsule(C, (6.2, 3.0, 13.2), (7.6, 3.0, 12.0), 0.35), 6)                # crank
        put(gable(C, -7.4, 7.4, 0.2, 5.8, 13.6, 17.0), 10)
        put(capsule(C, (0.6, 3.0, 13.0), (0.6, 3.0, 7.6), 0.25), 12)               # rope
        put(capsule(C, (0.6, 3.0, 6.0), (0.6, 3.0, 7.6), 1.0, 1.15), 7)            # bucket on the rope
        put(capsule(C, (-8.4, -1.0, 0.0), (-8.4, -1.0, 2.0), 1.1, 1.25), 7)        # a full bucket by the wall
        put(ball(C, (-8.4, -1.0, 1.9), 0.9), 14)
    else:
        broken = ihash3(np.floor(ang * 3.0), 0 * x, 0 * z, 1.0)
        height = 1.0 + 3.2 * broken                                                  # uneven, tumbled courses
        put(ring & (z < height) & ~((ang > 0.9) & (ang < 1.8)), 1)                  # a breach at the back
        put(courses(C, ring & (z < height), h=1.6, w=2.6), 3)
        put(ash_drift(C, WELL_C[0], WELL_C[1], 3.8, 3.8, 3.6), 11)                 # choked with ash
        put(ash_drift(C, -5.6, 0.2, 3.6, 2.4, 1.8), 11)
        put(ash_drift(C, 6.2, 5.6, 3.0, 2.2, 1.4), 11)
        put(box(C, -6.5, -5.3, 2.4, 3.6, 0, 5.2), 9)                                # a charred stump
        put(capsule(C, (5.2, 3.0, 0.6), (11.0, -1.2, 0.6), 0.6), 9)                 # the other post, fallen
        rubble(put, C, [(-3.0, -1.2, 1.0), (4.4, -1.0, 1.2), (7.8, 2.0, 0.9), (2.6, 8.0, 0.9)])

# ---------------------------------------------------------------- storehouse
def storehouse(ruined):
    C = coords(IDENT); x, y, z = C
    put = PUT
    walls = box(C, -9.4, 9.4, -1.0, 9.0, 0, 10.0) & ~box(C, -8.6, 8.6, -0.2, 8.2, 0.2, 11.0)
    seams = ((x + 30.0) % 1.8) < 0.3
    if not ruined:
        put(walls, 7)
        put(walls & seams & (y < -0.4), 8)
        put(box(C, -9.4, 9.4, -1.0, 9.0, 0, 0.8), 1)                               # stone footing
        put(box(C, -2.4, 2.4, -1.4, -0.6, 0.0, 7.2), 8)                            # door
        put(box(C, -2.0, 2.0, -1.5, -1.3, 3.2, 3.6), 6)                            # iron strap
        put(gable(C, -10.4, 10.4, -2.2, 10.2, 9.6, 16.4), 10)
        put(box(C, -10.4, 10.4, 3.6, 4.6, 15.6, 16.6), 8)                          # ridge beam
        for (cx, cy, h) in ((-6.6, -1.6, 2.8), (-4.0, -1.5, 2.2)):                 # sacks by the door
            put(ball(C, (cx, cy, h * 0.55), 1.5) & (z >= 0), 12)
        put(box(C, 4.2, 7.6, -2.2, 0.6, 0, 3.0), 7)                                # a crate
        put(box(C, 4.2, 7.6, -2.2, 0.6, 0, 3.0) & ((np.abs(x - 5.9) < 0.3) | (np.abs(z - 1.5) < 0.3)), 8)
    else:
        jag = 2.0 + 6.0 * ihash3(np.floor((x + 30) / 1.8), 0 * x, 0 * z, 1.0)         # burned down to ragged heights
        put(walls & (z < jag), 9)
        put(box(C, -9.4, 9.4, -1.0, 9.0, 0, 0.8), 1)
        put(capsule(C, (-8.8, 8.2, 9.0), (3.0, -0.6, 0.6), 0.6), 9)                 # roof beams fallen in
        put(capsule(C, (8.6, 8.2, 7.4), (-1.0, 1.0, 0.6), 0.55), 9)
        put(ash_drift(C, 0.0, 4.0, 8.0, 4.4, 3.2), 11)
        put(ash_drift(C, -6.0, -1.0, 3.6, 1.5, 1.6), 11)
        put(box(C, 4.6, 7.2, -2.6, -0.4, 0, 1.6), 9)                                # a burst crate
        rubble(put, C, [(8.4, -1.4, 0.8), (-2.6, -1.4, 0.9)])

# ---------------------------------------------------------------- palisade (one wall segment)
STAKES = [(-11.2, 16.0), (-7.5, 17.2), (-3.8, 16.4), (0.0, 17.6), (3.8, 16.2), (7.5, 17.0), (11.2, 15.8)]
def palisade(ruined):
    C = coords(IDENT); x, y, z = C
    put = PUT
    if not ruined:
        for sx, h in STAKES:
            put(capsule(C, (sx, 2.0, 0.0), (sx, 2.0, h - 3.6), 1.45), 7)                # split logs, gaps between
            put(capsule(C, (sx, 2.0, h - 3.8), (sx, 2.0, h), 1.4, 0.1), 7)              # long sharpened points
            put(capsule(C, (sx, 2.0, 0.0), (sx, 2.0, h - 3.6), 1.5) & (C[1] > 2.6), 8)  # bark on the back
        for bz in (4.2, 11.0):                                                          # rope lashings
            put(box(C, -13.0, 13.0, 0.1, 3.9, bz - 0.4, bz + 0.4) & (np.abs(y - 2.0) > 1.6), 12)
        put(ash_drift(C, 0.0, 1.0, 13.6, 2.6, 1.0) & (z < 0.8), 7)                     # packed earth at the foot
    else:
        for i, (sx, h) in enumerate(STAKES):
            if i == 4:
                continue                                                                # a gap where one burned away
            top = (4.0, 11.6, 6.4, 13.4, 0, 3.2, 8.6)[i]
            put(capsule(C, (sx, 2.0, 0.0), (sx, 2.0, top), 1.75), 9)
            put(ball(C, (sx, 2.0, top), 1.6) & (ihash3(x, y, z, 1.4) > 0.35), 9)        # splintered, burned-off tops
        put(capsule(C, (2.4, 0.6, 0.9), (13.4, -1.8, 0.9), 1.4), 9)                     # a stake fallen across the ground
        put(ash_drift(C, 0.0, 1.2, 13.6, 3.0, 2.6), 11)

# ---------------------------------------------------------------- lamp post
def lamps(ruined):
    C = coords(IDENT); x, y, z = C
    put = PUT
    put(box(C, -2.0, 2.0, -0.4, 3.6, 0, 1.6), 1)                                       # stone footing
    if not ruined:
        put(capsule(C, (0.0, 1.6, 1.6), (0.0, 1.6, 21.0), 0.75), 8)
        put(capsule(C, (0.0, 1.6, 20.0), (4.2, 1.6, 20.0), 0.45), 6)                    # bracket
        put(capsule(C, (0.0, 1.6, 17.6), (2.6, 1.6, 20.0), 0.35), 6)
        put(capsule(C, (4.2, 1.6, 19.8), (4.2, 1.6, 18.6), 0.25), 6)                    # hook
        lamp = box(C, 2.8, 5.6, 0.2, 3.0, 13.6, 18.4)
        put(lamp, 13)                                                                   # lit lantern
        put(lamp & ((np.abs(x - 2.8) < 0.45) | (np.abs(x - 5.6) < 0.45) | (np.abs(z - 13.6) < 0.5) | (np.abs(z - 18.4) < 0.5)), 6)
        put(capsule(C, (4.2, 1.6, 18.4), (4.2, 1.6, 19.2), 1.3, 0.4), 6)                # cap
        put(ball(C, (-2.6, -0.6, 0.8), 1.0) & (z >= 0), 12)                             # a tuft of rushes at the foot
    else:
        put(capsule(C, (0.0, 1.6, 1.6), (0.0, 1.6, 9.0), 0.75), 9)                      # snapped
        put(capsule(C, (0.6, 1.0, 0.9), (9.8, -2.0, 0.9), 0.75), 9)                     # the top half, fallen
        put(box(C, 10.0, 12.6, -2.6, 0.0, 0.0, 2.6), 5)                                 # the lantern, dark and burst
        put(box(C, 10.0, 12.6, -2.6, 0.0, 0.0, 2.6) & ((np.abs(x - 10.0) < 0.4) | (np.abs(z - 2.6) < 0.5)), 6)
        put(ash_drift(C, 0.0, 1.6, 6.0, 3.2, 2.2), 11)
        rubble(put, C, [(-4.6, -1.4, 0.8)])

# ---------------------------------------------------------------- smithy
def smithy(ruined):
    C = coords(IDENT); x, y, z = C
    put = PUT
    hearth = box(C, -10.4, 1.2, -1.2, 6.0, 0, 7.2)
    put(hearth, 1)
    put(courses(C, hearth), 3)
    put(box(C, -8.8, -0.4, 0.2, 4.4, 6.4, 7.4), 0)                                      # the hearth bed
    chimney = box(C, -8.2, -3.4, 3.6, 6.4, 7.2, 22.0)
    anvil_at = np.array([6.4, 0.6, 0.0])
    if not ruined:
        bed = box(C, -8.8, -0.4, 0.2, 4.4, 6.4, 6.9)
        put(bed, 4)
        put(bed & (ihash3(x, y, z, 1.0) > 0.6), 5)
        put(box(C, -9.2, 0.0, -0.2, 4.8, 6.9, 7.5) & ~box(C, -8.6, -0.6, 0.4, 4.2, 6, 8), 6)   # iron lip
        put(chimney, 1)
        put(courses(C, chimney, h=2.0, w=2.4), 3)
        put(box(C, -8.6, -3.0, 3.2, 6.8, 21.0, 22.0), 1)                                # chimney cap
        put(box(C, -7.2, -4.4, 4.4, 5.6, 21.6, 22.2), 5)                                # soot at the flue
        a = anvil_at
        put(box(C, a[0] - 1.5, a[0] + 1.5, a[1] - 1.5, a[1] + 1.5, 0, 3.6), 8)          # stump
        put(box(C, a[0] - 1.2, a[0] + 1.2, a[1] - 0.9, a[1] + 0.9, 3.6, 4.6), 6)        # anvil foot and waist
        put(box(C, a[0] - 2.4, a[0] + 2.0, a[1] - 1.1, a[1] + 1.1, 4.6, 6.0), 6)        # face
        put(capsule(C, (a[0] - 2.4, a[1], 5.6), (a[0] - 4.2, a[1], 5.2), 0.75, 0.25), 6)   # horn
        put(capsule(C, (a[0] + 0.6, a[1] - 0.2, 6.2), (a[0] + 2.4, a[1] + 0.4, 6.2), 0.35), 8)   # a hammer on the face
        put(box(C, a[0] + 2.0, a[0] + 3.0, a[1] - 0.2, a[1] + 1.0, 6.0, 6.8), 6)
        put(box(C, 2.4, 6.0, 4.0, 7.4, 0, 2.6), 8)                                       # quench tub
        put(box(C, 2.8, 5.6, 4.4, 7.0, 2.0, 2.7), 14)
    else:
        put(box(C, -8.8, -0.4, 0.2, 4.4, 6.0, 7.6) & (ihash3(x, y, 0 * z, 1.0) > 0.15), 11)   # bed full of ash
        stump_h = 7.2 + 3.0 * ihash3(np.floor(x), 0 * x, 0 * z, 1.0)
        put(chimney & (z < stump_h), 1)                                                 # the chimney, fallen to a stump
        put(courses(C, chimney & (z < stump_h), h=2.0, w=2.4), 3)
        rubble(put, C, [(-11.6, -1.6, 1.2), (-12.6, 1.6, 1.0), (-2.4, 7.6, 1.1), (1.8, -1.2, 1.0), (-9.6, 8.2, 0.9)])
        put(ash_drift(C, -4.6, 2.4, 7.4, 4.6, 2.2) & ~hearth, 11)
        a = anvil_at
        put(box(C, a[0] - 2.0, a[0] + 2.4, a[1] - 1.0, a[1] + 1.4, 0, 2.2), 6)          # the anvil, overturned
        put(ash_drift(C, a[0] + 0.4, a[1] - 0.4, 3.8, 2.6, 1.6), 11)                    # half buried in ash
        put(capsule(C, (a[0] - 1.6, a[1] + 4.0, 0.8), (a[0] + 2.2, a[1] + 5.6, 0.8), 1.3), 9)   # the stump, burned

SITES = ['well', 'storehouse', 'palisade', 'lamps', 'smithy']
BUILDERS = {'well': well, 'storehouse': storehouse, 'palisade': palisade, 'lamps': lamps, 'smithy': smithy}

def build(site, ruined):
    global M, PUT
    M = np.zeros(X.shape, np.uint8)
    def put(mask, mat):
        M[mask] = mat
    PUT = put
    BUILDERS[site](ruined)
    M[:, :, zs < 0] = 0                       # nothing sits below the ground

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
    """Sites stand on their anchor and are never shifted, so they must already fit the frame."""
    sx, sy = measure()
    lim_x, lo_y, hi_y = W / 2 - 1.25, -1.5, FOOT_ROW - 1.5      # content in columns and rows 1..edge-2
    if sx.min() < -lim_x or sx.max() > lim_x or sy.min() < lo_y or sy.max() > hi_y:
        raise ValueError(f'{name} does not fit the {W}x{H} frame: '
                         f'x {sx.min():.1f}..{sx.max():.1f}, y {sy.min():.1f}..{sy.max():.1f}')

def generate(out_dir=None, name='village'):
    """Write <name>.png and <name>.json: ruins in row 1, rebuilt sites in row 2, as named stills."""
    out_dir = out_dir or DEFAULT_OUT
    sheet = Image.new('RGBA', (W * len(SITES), H * 2), (0, 0, 0, 0))
    frames, report = {}, {}
    for row, ruined in ((0, True), (1, False)):
        for col, site in enumerate(SITES):
            key = f'{site}_ruin' if ruined else site
            build(site, ruined)
            finish()
            check_fits(key)
            sx, sy = measure()
            report[key] = (round(float(sx.max() - sx.min()) + 1), round(float(sy.max() - sy.min()) + 1))
            sheet.paste(Image.fromarray(compose(*render(0)), 'RGBA'), (col * W, row * H))
            frames[key] = row * len(SITES) + col
    frames = {k: frames[k] for s in SITES for k in (f'{s}_ruin', s)}                   # the placeholder's key order
    os.makedirs(out_dir, exist_ok=True)
    sheet.save(os.path.join(out_dir, f'{name}.png'))
    meta = {'image': f'{name}.png', 'frameWidth': W, 'frameHeight': H, 'anchor': [0.5, 1],
            'frames': frames, 'animations': {}}
    with open(os.path.join(out_dir, f'{name}.json'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(meta, indent=2) + '\n')
    return sheet, meta, report

# ---------------------------------------------------------------- renderer
W, H = 32, 32                                 # village sites: 32x32
PHI = np.radians(32)                          # camera pitch: 3/4 overhead
F = np.array([0, np.cos(PHI), -np.sin(PHI)])  # into the screen
U = np.array([0, np.sin(PHI), np.cos(PHI)])   # screen up
R = np.array([1.0, 0, 0])                     # screen right
LV = np.array([-0.6, 0.45, 0.85])            # light: upper-left, from the viewer side
LV /= np.linalg.norm(LV)
L_WORLD = LV[0] * R + LV[1] * U - LV[2] * F
FOOT_ROW = 29.0                               # ground 3 rows above the bottom, as for every sheet

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
    print('sheet', sheet.size, 'frames', meta['frames'])
    for k, v in report.items():
        print(f'  {k:16s} {v[0]} x {v[1]} px')
