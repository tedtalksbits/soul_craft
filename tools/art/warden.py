"""Ashen Warden sprite generator.

Writes warden.png and warden.json to <repo>/assets/sprites (or the directory given).

Usage: pnpm art warden

The first boss, Keeper of the Last Kindling: a hulking warden in ash-gray plate with a hearth
of embers burning behind a grille in its chest, an iron crown on its great helm, a tattered
ash mantle and a great maul. 64x64 frames (bigger than the 48x48 characters), drawn for no
tint. Same conventions as knight.py: numpy + Pillow only, integer hashing only, the shared
renderer (sized for 64x64), 8 columns (down, down_right, right, up_right, up, up_left, left,
down_left), one row per animation frame, animations in ANIMATIONS order; frame index =
row * 8 + column. The JSON is the engine's format, with a `head` pivot and per-animation
`offset` where a pose is fitted into the frame.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

DEFAULT_OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'sprites')

# ---------------------------------------------------------------- palette ramps
def hx(h):
    h = h.lstrip('#')
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

# material: (highlight, base, shadow, deep)
RAMPS = {
    1:  ('#bdb9b2', '#8f8b85', '#5f5c58', '#363431'),  # ash-gray plate
    2:  ('#7a7773', '#5f5c58', '#44423f', '#2a2927'),  # mail skirt (id 2: compose() dithers it as mail)
    3:  ('#7e7870', '#5e5952', '#423e39', '#282623'),  # ash mantle
    4:  ('#ffe6a8', '#ffa648', '#e8681e', '#9a3a12'),  # embers: bright at every level, they give light
    5:  ('#56534f', '#3e3c39', '#2c2a28', '#1a1918'),  # soot-black iron: crown, grille, maul head
    6:  ('#6e5a44', '#524333', '#3a2f24', '#231c15'),  # maul haft, wrapped
    7:  ('#6a5040', '#4a3a30', '#33281f', '#1f1813'),  # spent embers (dead)
    10: ('#111111', '#111111', '#111111', '#111111'),  # the dark inside the helm
}
RAMPS = {k: [hx(c) for c in v] for k, v in RAMPS.items()}

# ---------------------------------------------------------------- voxel grid
RES = 0.5
xs = np.arange(-30, 30, RES) + RES / 2
ys = np.arange(-34, 34, RES) + RES / 2
zs = np.arange(-24, 62, RES) + RES / 2
X, Y, Z = np.meshgrid(xs, ys, zs, indexing='ij')
M = np.zeros(X.shape, np.uint8)
N = np.zeros(X.shape + (3,))

MODEL_SCALE = 1.62      # authored at player proportions; scaled so it stands ~52 px, clearly over the knight

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

def roty(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])

def unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)

THIGH, SHIN = 5.6, 5.4
UPPER_ARM, FOREARM = 4.2, 4.0
HIP_Z = 12.0
HIP = np.array([0.0, 0.0, HIP_Z])
NECK = np.array([0.0, -0.4, 23.4])
HELM_C = np.array([0.0, -0.9, 27.0])
SHOULDER = {-1: np.array([-7.0, 0.0, 20.4]), 1: np.array([7.0, 0.0, 20.4])}
HAFT_BELOW, HAFT_ABOVE = 4.0, 10.6        # haft length below and above the right hand's grip
HEAD_LEN = 5.6                            # the maul head, across the haft

_rng = np.random.default_rng(31)
MANTLE_HEM = _rng.choice([0, 0.5, 1.0, 1.5, 2.5, 3.5], size=40)

def draw_maul(put, C, grip, hdir, side=(1.0, 0.0, 0.0)):
    """Great maul: wrapped haft, iron butt, a soot-iron head banded with ember-lit seams."""
    d = unit(hdir)
    s = np.asarray(side, float)
    s = unit(s - (s @ d) * d)
    grip = np.asarray(grip, float)
    butt, neck = grip - d * HAFT_BELOW, grip + d * HAFT_ABOVE
    put(capsule(C, butt, neck, 0.62), 6)
    put(capsule(C, butt - d * 0.6, butt + d * 0.4, 0.85), 5)                     # iron butt cap
    hc = neck + d * 1.6
    x, y, z = C
    rx, ry, rz = x - hc[0], y - hc[1], z - hc[2]
    a = rx * s[0] + ry * s[1] + rz * s[2]                                       # along the head
    b = rx * d[0] + ry * d[1] + rz * d[2]                                       # along the haft
    t = np.cross(d, s)
    c_ = rx * t[0] + ry * t[1] + rz * t[2]
    head = (np.abs(a) < HEAD_LEN / 2) & (np.abs(b) < 1.7) & (np.abs(c_) < 1.7)
    head &= ~((np.abs(a) > HEAD_LEN / 2 - 0.5) & (np.abs(b) > 1.2) & (np.abs(c_) > 1.2))   # bevelled corners
    put(head, 5)
    put(head & (np.abs(np.abs(a) - 1.2) < 0.32), 4)                             # ember-lit seams
    return hc

def build(pose):
    """Build the warden for one pose. Pose keys (body coordinates unless said otherwise):

    legR / legL     (thigh_pitch, shin_pitch[, thigh_abduct, shin_abduct]) degrees, forward +
    kneeR/ankleR... explicit knee/ankle points; footR/footL foot direction
    hip_z           explicit hip height; default: lowest ankle on the ground
    lean, twist, roll   torso pitch forward, turn (+ brings the right shoulder forward), side lean
    head_tilt, head_yaw helm pitch (+ chin down) and turn
    bob_extra       upper-body drop in model units (breathing)
    maul            dict(grip, dir[, side]): the right hand's grip on the haft and the haft direction
                    (towards the head); with two_hands the left hand holds the haft lower down
    maul_place      dict(grip, dir[, side]) a maul lying or planted without hands (channel, dead)
    handR / handL   explicit hand targets, overriding the maul grip (body coordinates)
    flare, phase    mantle motion
    spent           the embers have gone out (dead)
    """
    global M, N
    M = np.zeros(X.shape, np.uint8)
    def put(mask, mat):
        M[mask] = mat

    # ---- legs: wide planted stance, heavy plate
    legs = {}
    for side, sx in (('R', -1), ('L', 1)):
        Hp = np.array([3.0 * sx, 0.0, HIP_Z])
        if 'knee' + side in pose:
            K = np.asarray(pose['knee' + side], float)
            A = np.asarray(pose['ankle' + side], float)
        else:
            spec = pose['leg' + side]
            tp, sp = deg(spec[0]), deg(spec[1])
            ta = deg(spec[2]) if len(spec) > 2 else deg(8)
            sa = deg(spec[3]) if len(spec) > 3 else deg(-4)
            K = Hp + THIGH * limb_dir(tp, ta, sx)
            A = K + SHIN * limb_dir(sp, sa, sx)
        legs[side] = (Hp, K, A)
    hip_z = pose['hip_z'] if 'hip_z' in pose else HIP_Z + 1.3 - min(l[2][2] for l in legs.values())
    dz = hip_z - HIP_Z

    body = move((0, 0, dz))
    rel_torso = fcompose(move((0, 0, pose.get('bob_extra', 0.0))),
                         about(rotz(deg(pose.get('twist', 0.0))) @ rotx(deg(pose.get('lean', 6.0)))
                               @ roty(deg(pose.get('roll', 0.0))), HIP))
    torso = fcompose(body, rel_torso)
    head = fcompose(torso, about(rotz(deg(pose.get('head_yaw', 0.0))) @ rotx(deg(pose.get('head_tilt', 0.0))), NECK))
    CB, CT, CH = coords(body), coords(torso), coords(head)

    for side in ('R', 'L'):
        Hp, K, A = legs[side]
        put(capsule(CB, Hp, K, 2.2, 1.95), 1)
        put(ball(CB, K, 2.15), 1)                                                     # knee cop
        put(capsule(CB, K, A, 1.9, 1.75), 1)
        fd = unit(pose.get('foot' + side, (0, -1.0, 0)))
        lift = A[2] + dz - 1.3
        put(capsule(CB, A - 0.9 * fd + [0, 0, -0.3], A + 2.5 * fd + [0, 0, -0.6 + 0.3 * lift], 1.6), 5)   # sabatons

    # ---- torso: mail skirt, barrel cuirass, the ember hearth behind its grille
    x, y, z = CT
    put((((x / 6.4) ** 2 + (y / 4.5) ** 2) < 1) & (z >= 8.4) & (z < 13.6), 2)
    rx = 5.6 + np.clip(z - 13, 0, 8) * 0.16
    cuirass = (((x / rx) ** 2 + (y / 4.2) ** 2) < 1) & (z >= 13.0) & (z < 23.0)
    cuirass &= ~((z > 21.6) & ((x / rx) ** 2 > 0.6))
    put(cuirass, 1)
    put(cuirass & (np.abs(z - 13.5) < 0.6), 5)                                         # soot-iron belt
    grille = cuirass & (y < -2.9) & (np.abs(x) < 2.8) & (z > 15.0) & (z < 20.8)
    put(grille, 4)                                                                     # the hearth's glow
    bars = grille & (((x + 30.0) % 1.4) < 0.5)
    put(bars, 5)
    frame_ = cuirass & (y < -2.6) & (np.abs(x) < 3.4) & (z > 14.4) & (z < 21.4) & ~((np.abs(x) < 2.8) & (z > 15.0) & (z < 20.8))
    put(frame_, 5)
    put((((x / 3.2) ** 2 + ((y + 0.3) / 3.0) ** 2) < 1) & (z >= 22.6) & (z < 24.2), 1)   # gorget

    # ---- pauldrons: broad, layered, soot-edged
    for sx in (-1, 1):
        c = np.array([7.0 * sx, 0.2, 21.4])
        d2 = (x - c[0]) ** 2 + (y - c[1]) ** 2 * 1.05 + ((z - c[2]) * 1.2) ** 2
        put((d2 < 3.9 ** 2) & (z > 19.2), 1)
        put((d2 < 3.9 ** 2) & (d2 > 3.3 ** 2) & (np.abs(z - 19.9) < 0.45), 5)
        put((d2 < 3.0 ** 2) & (d2 > 2.4 ** 2) & (np.abs(z - 22.6) < 0.4), 5)

    # ---- the maul and the arms that hold it
    mp = pose.get('maul')
    targets = {}
    if mp:
        grip = np.asarray(mp['grip'], float)
        d = unit(mp['dir'])
        targets['R'] = grip
        if mp.get('two_hands'):
            targets['L'] = grip - d * 2.8
    for side in ('R', 'L'):
        if 'hand' + side in pose:
            targets[side] = np.asarray(pose['hand' + side], float)
    rest = {'R': (-8.2, -1.2, 13.4), 'L': (8.2, -1.2, 13.4)}
    hands = {}
    for side, sx in (('R', -1), ('L', 1)):
        tl = to_local(rel_torso, targets.get(side, np.array(rest[side])))
        el, hd = two_bone(SHOULDER[sx], tl, UPPER_ARM, FOREARM, pose.get('pole' + side, (sx * 1.0, 0.5, -0.5)))
        put(capsule(CT, SHOULDER[sx], el, 1.85, 1.7), 1)
        put(ball(CT, el, 1.75), 1)
        put(capsule(CT, el, hd, 1.7, 1.55), 1)
        put(ball(CT, hd, 1.55), 5)                                                     # soot-iron gauntlet
        hands[side] = to_world(rel_torso, hd)
    if mp:
        draw_maul(put, CB, hands['R'], mp['dir'], mp.get('side', (1.0, 0.0, 0.0)))
    if 'maul_place' in pose:
        mpl = pose['maul_place']
        draw_maul(put, CB, mpl['grip'], mpl['dir'], mpl.get('side', (1.0, 0.0, 0.0)))

    # ---- ash mantle over the shoulders and down the back, frayed at the hem
    flare, ph = pose.get('flare', 0.0), pose.get('phase', 0.0)
    zc0, zc1 = 11.0, 23.6
    w = 7.6 + (zc1 - z) * 0.1
    fold = 0.5 * np.clip((zc1 - z) / 8, 0, 1)
    yback = 4.2 + (zc1 - z) * (0.10 + 0.07 * flare) - (np.clip(np.abs(x) / w, 0, 1) ** 2) * 2.4 + fold * np.sin(x * 1.1 + ph)
    mantle = (np.abs(x) < w) & (y > yback) & (y < yback + 1.1) & (z >= zc0) & (z < zc1)
    mantle &= z >= zc0 + MANTLE_HEM[np.clip(np.floor(x).astype(int) + 20, 0, 39)] + 0.6 * flare
    put(mantle, 3)
    cowl = (((x / 7.8) ** 2 + ((y - 0.6) / 5.0) ** 2) < 1) & (z >= 22.4) & (z < 24.0) & (y > -1.0)
    put(cowl & (M == 0), 3)

    # ---- great helm: flat top, ember eye slit, iron crown of spikes
    hx_, hy_, hz_ = CH
    c = HELM_C
    ddx, ddy = np.abs(hx_ - c[0]), np.abs(hy_ - c[1])
    helm = ((ddx / 3.6) ** 4 + (ddy / 3.7) ** 4 < 1) & (hz_ >= c[2] - 3.4) & (hz_ < c[2] + 3.4)
    put(helm, 1)
    front = helm & (hy_ < c[1] - 2.9)
    put(front & (np.abs(hz_ - (c[2] + 0.6)) < 0.5) & (ddx < 2.7), 4)                 # glowing eye slit
    put(front & (ddx < 0.45) & (hz_ > c[2] - 2.8) & (hz_ < c[2] + 0.2), 10)          # breath slit
    band = ((ddx / 3.9) ** 4 + (ddy / 4.0) ** 4 < 1) & ((ddx / 3.3) ** 4 + (ddy / 3.4) ** 4 > 1) \
        & (hz_ >= c[2] + 2.6) & (hz_ < c[2] + 3.6)
    put(band, 5)                                                                       # crown band
    for k in range(7):
        a = 2 * np.pi * k / 7 + np.pi / 2
        b0 = c + [3.4 * np.cos(a), 3.5 * np.sin(a), 3.4]
        put(capsule(CH, b0, b0 + [0.3 * np.cos(a), 0.3 * np.sin(a), 2.6 if k % 2 == 0 else 1.8], 0.6, 0.2), 5)

    if pose.get('spent'):
        M[M == 4] = 7

    occ = gauss3d((M > 0).astype(float), 1.6)
    gx, gy, gz = np.gradient(occ)
    N = -np.stack([gx, gy, gz], -1)
    N /= (np.linalg.norm(N, axis=-1, keepdims=True) + 1e-9)
    return {'ankles': {k: v[2] * MODEL_SCALE for k, v in legs.items()}}

# ---------------------------------------------------------------- renderer
W, H = 64, 64                                 # the boss: 64x64 frames
PHI = np.radians(32)                          # camera pitch: 3/4 overhead
F = np.array([0, np.cos(PHI), -np.sin(PHI)])  # into the screen
U = np.array([0, np.sin(PHI), np.cos(PHI)])   # screen up
R = np.array([1.0, 0, 0])                     # screen right
LV = np.array([-0.6, 0.45, 0.85])            # light: upper-left, from the viewer side
LV /= np.linalg.norm(LV)
L_WORLD = LV[0] * R + LV[1] * U - LV[2] * F
FOOT_ROW = 61.0                               # ground 3 rows above the bottom, as for every sheet

def rot(v, ang):
    c, s = np.cos(ang), np.sin(ang)
    return np.stack([c * v[..., 0] - s * v[..., 1], s * v[..., 0] + c * v[..., 1], v[..., 2]], -1)

def render(facing_deg):
    th = np.radians(facing_deg)
    jj, ii = np.meshgrid(np.arange(W), np.arange(H))
    sx = jj - W / 2 + 0.5
    sy = FOOT_ROW - ii - 0.5
    ts = np.arange(-44, 44, 0.2)                  # deep enough for the bigger model
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


# ---------------------------------------------------------------- animations
DIRECTIONS = [('down', 0), ('down_right', 45), ('right', 90), ('up_right', 135),
              ('up', 180), ('up_left', 225), ('left', 270), ('down_left', 315)]

def P(*dicts, **kw):
    out = {}
    for d in dicts:
        out.update(d)
    out.update(kw)
    return out

# at rest the maul stands head-down beside the right foot, the hand on top of the haft
LEAN_ON_MAUL = dict(grip=(-8.0, -2.6, 14.2), dir=(-0.12, -0.22, -0.97), side=(0.0, 1.0, 0.0))
# walking, it is carried on the right shoulder
SHOULDERED = dict(grip=(-7.6, -3.2, 18.6), dir=(0.05, 0.55, 0.83))
# charging, it is held low across the body in both hands like a ram
RAM = dict(grip=(-3.6, -7.0, 15.6), dir=(0.92, -0.35, 0.15), two_hands=True, side=(0.0, 0.0, 1.0))
# overhead: the hands meet at the visor, the head rising above and behind the crown
OVERHEAD = dict(grip=(0.0, -2.8, 24.2), dir=(0.0, 0.55, 0.83), two_hands=True)
# slammed: driven into the ground in front
SLAMMED = dict(grip=(-2.6, -9.2, 13.4), dir=(-0.2, -0.48, -0.85), two_hands=True)   # out to the right so it shows

# kneeling on the right knee (channel)
KNEEL = dict(hip_z=7.0, kneeL=(3.0, -5.6, 10.6), ankleL=(3.0, -6.0, 6.3), footL=(0, -1.0, 0),
             kneeR=(-3.0, 1.8, 6.3), ankleR=(-3.0, 7.0, 6.2), footR=(0, 1.0, -0.25))

ANIMATIONS = [
    # (name, poses, fps, loop)
    ('idle', [P(legR=(4, 0), legL=(-4, 0), maul=LEAN_ON_MAUL),
              P(legR=(4, 0), legL=(-4, 0), maul=LEAN_ON_MAUL, bob_extra=-1.2, head_tilt=5)], 2, True),
    ('walk', [P(legR=(30, 12), legL=(-28, -39), roll=-3, twist=4, maul=SHOULDERED, handL=(8.0, -3.4, 13.6)),
              P(legR=(2, 0), legL=(16, -44), bob_extra=0.6, maul=SHOULDERED, handL=(8.2, -1.2, 13.4)),
              P(legR=(-28, -39), legL=(30, 12), roll=3, twist=-4, maul=SHOULDERED, handL=(8.0, 1.2, 13.6)),
              P(legR=(16, -44), legL=(2, 0), bob_extra=0.6, maul=SHOULDERED, handL=(8.2, -1.2, 13.4))], 6, True),
    ('windup', [
        # leaning in: shoulder dropped, maul swung low across the body, knees bending
        P(legR=(-20, -30), legL=(26, -6), lean=22, twist=-10, head_tilt=14, maul=RAM, flare=0.3),
        # dug in, about to go
        P(legR=(-30, -46), legL=(36, -16), lean=32, twist=-16, head_tilt=20, maul=RAM, flare=0.5),
    ], 4, False),
    ('attack', [                                                          # the charge: a looping sprint
        P(legR=(48, 22), legL=(-42, -76), lean=34, twist=-16, head_tilt=18, roll=-4, maul=RAM, flare=1.2, phase=0.0),
        P(legR=(14, -64), legL=(20, -24), lean=34, twist=-16, head_tilt=18, bob_extra=0.8, maul=RAM, flare=1.4, phase=0.8),
        P(legR=(-42, -76), legL=(48, 22), lean=34, twist=-16, head_tilt=18, roll=4, maul=RAM, flare=1.2, phase=1.6),
    ], 12, True),
    ('raise', [                                                           # the tell: hold the last frame
        P(legR=(8, 0, 12), legL=(-6, 0, 12), lean=2, maul=dict(grip=(-1.6, -6.6, 18.4), dir=(0.05, 0.1, 0.99), two_hands=True)),
        P(legR=(8, 0, 12), legL=(-6, 0, 12), lean=-6, head_tilt=-6, maul=dict(grip=(-0.6, -4.0, 22.6), dir=(0.0, 0.35, 0.94), two_hands=True)),
        P(legR=(8, 0, 12), legL=(-6, 0, 12), lean=-10, head_tilt=-10, maul=OVERHEAD, flare=0.4),
    ], 5, False),
    ('slam', [                                                            # the impact, then the shock settling
        P(legR=(38, -44, 12), legL=(-14, -36, 12), lean=36, head_tilt=12, maul=SLAMMED, flare=1.4, phase=0.6),
        P(legR=(36, -42, 12), legL=(-12, -34, 12), lean=32, head_tilt=10, bob_extra=-0.6, maul=SLAMMED, flare=0.7, phase=1.0),
    ], 12, False),
    ('recover', [                                                         # heavy, open to hits: head hanging, breathing hard
        P(legR=(14, -10, 12), legL=(-6, -8, 12), lean=22, head_tilt=22,
          maul=dict(grip=(-3.4, -7.4, 11.0), dir=(-0.16, -0.42, -0.89), two_hands=True), flare=0.3),
        P(legR=(14, -10, 12), legL=(-6, -8, 12), lean=24, head_tilt=26, bob_extra=-1.2,
          maul=dict(grip=(-3.4, -7.4, 10.6), dir=(-0.16, -0.42, -0.89), two_hands=True), flare=0.2),
    ], 3, False),
    ('channel', [                                                         # kneeling, arms raised, calling the flame
        P(KNEEL, lean=-4, head_tilt=-16, handR=(-8.2, -3.0, 26.2), handL=(8.2, -3.0, 26.2),
          poleR=(-1, 0.6, -0.2), poleL=(1, 0.6, -0.2),
          maul_place=dict(grip=(1.0, -10.6, 19.6), dir=(0.0, 0.02, -1.0), side=(1.0, 0.0, 0.0)), flare=0.6, phase=0.4),
        P(KNEEL, lean=-6, head_tilt=-20, bob_extra=0.5, handR=(-8.6, -2.6, 27.4), handL=(8.6, -2.6, 27.4),
          poleR=(-1, 0.6, -0.2), poleL=(1, 0.6, -0.2),
          maul_place=dict(grip=(1.0, -10.6, 19.6), dir=(0.0, 0.02, -1.0), side=(1.0, 0.0, 0.0)), flare=1.0, phase=1.2),
    ], 3, True),
    ('stunned', [                                                         # reeling as its shield breaks
        P(legR=(-18, -8, 12), legL=(16, 2, 12), lean=-14, roll=8, head_tilt=-20, head_yaw=14,
          maul=dict(grip=(-10.0, 1.4, 15.0), dir=(-0.3, 0.5, -0.81)), handL=(10.2, 0.4, 19.0), poleL=(1, 0.4, -0.4),
          flare=1.2, phase=0.4),
        P(legR=(-14, -6, 12), legL=(12, 2, 12), lean=-10, roll=-6, head_tilt=-14, head_yaw=-14,
          maul=dict(grip=(-9.6, 1.0, 14.0), dir=(-0.25, 0.45, -0.86)), handL=(9.6, 1.4, 18.0), poleL=(1, 0.4, -0.4),
          flare=0.8, phase=1.2),
    ], 3, True),
    ('dead', [                                                            # fallen to its knees, slumped, the hearth gone out
        P(hip_z=6.4, kneeR=(-3.0, -3.6, 7.0), ankleR=(-3.0, 2.4, 6.8), footR=(0, 1.0, -0.3),
          kneeL=(3.0, -3.8, 7.0), ankleL=(3.0, 2.2, 6.8), footL=(0, 1.0, -0.3),
          lean=50, head_tilt=36, roll=-5, handR=(-7.0, -9.6, 7.4), handL=(7.0, -9.2, 7.4),
          poleR=(-1, 0.4, 0.6), poleL=(1, 0.4, 0.6),
          maul_place=dict(grip=(-11.0, -1.0, 6.8), dir=(0.12, -1.0, 0.0), side=(1.0, 0.0, 0.0)),
          spent=True, flare=-0.4),
    ], 1, False),
]

# ---------------------------------------------------------------- fitting (whole pixels)
def screen_extent(theta):
    occ = np.argwhere(M > 0)
    p = np.stack([xs[occ[:, 0]], ys[occ[:, 1]], zs[occ[:, 2]]], -1)
    w = rot(p, theta)
    sx = w[:, 0]
    sy = w[:, 1] * np.sin(PHI) + w[:, 2] * np.cos(PHI)
    return sx.min(), sx.max(), sy.min(), sy.max()

def fit_shift(extents):
    """Smallest whole-pixel move of the drawing (dx right, dy down) that keeps it inside the frame.

    Both edges are honoured at once: a pose lifted off the bottom edge may not be pushed through
    the top. Returns (0, 0) when the pose already fits.
    """
    x0, x1 = min(e[0] for e in extents), max(e[1] for e in extents)
    y0, y1 = min(e[2] for e in extents), max(e[3] for e in extents)
    # content may reach columns 1-46 and rows 1-46, leaving room for the 1 px outline
    lim_x, lo_y, hi_y = W / 2 - 2.0, -1.5, FOOT_ROW - 1.5   # content in rows and columns 1..edge-2
    def least(lo_need, hi_room):
        # the move m must satisfy lo_need <= m <= hi_room; pick the one closest to 0
        a, b = int(np.ceil(lo_need)), int(np.floor(hi_room))
        if a > b:
            raise ValueError('pose is too big for the 48x48 frame')
        return min(max(0, a), b)
    dx = least(-lim_x - x0, lim_x - x1)
    up = least(lo_y - y0, hi_y - y1)
    return dx, -up

def render_shifted(theta, dx_px, dy_px):
    """Render with the drawing moved by whole pixels, by offsetting the grid origin (no voxels lost)."""
    global xs, ys
    if dx_px == 0 and dy_px == 0:
        return render(np.degrees(theta))
    wx, wy = float(dx_px), -float(dy_px) / np.sin(PHI)
    v = rot(np.array([[wx, wy, 0.0]]), -theta)[0]
    xs0, ys0 = xs, ys
    xs, ys = xs0 + v[0], ys0 + v[1]
    try:
        return render(np.degrees(theta))
    finally:
        xs, ys = xs0, ys0

def project(p_world, theta):
    """Pixel position of a world point relative to the anchor (24, 48), x right, y down, fit not applied."""
    w = rot(np.asarray(p_world, float)[None], theta)[0]
    sx = w[0]
    sy = w[1] * np.sin(PHI) + w[2] * np.cos(PHI)
    return sx, (FOOT_ROW - sy) - H

# ---------------------------------------------------------------- export (engine format)
def generate(out_dir=None, name='character', extra_pivots=None, anim_pivots=None):
    """Render every animation and write <name>.png and <name>.json.

    JSON offsets are the engine's correction: it adds `offset` to undo the in-frame fit,
    so offset = -(how far the drawing was moved). Sheet-wide pivots go in `pivots`; pivots that
    vary by direction (anim_pivots) go in each animation entry's own `pivots`.
    """
    out_dir = out_dir or DEFAULT_OUT
    rows, anims, report, infos, shifts = [], {}, {}, {}, {}
    row = 0
    for anim, poses, fps, loop in ANIMATIONS:
        ext = {d: [] for d, _ in DIRECTIONS}
        for pose in poses:
            build(pose)
            for d, ang in DIRECTIONS:
                ext[d].append(screen_extent(np.radians(ang)))
        moved = {d: fit_shift(ext[d]) for d, _ in DIRECTIONS}
        shifts[anim] = moved
        for fi, pose in enumerate(poses):
            infos[(anim, fi)] = build(pose)
            rows.append([Image.fromarray(compose(*render_shifted(np.radians(ang), *moved[d])), 'RGBA')
                         for d, ang in DIRECTIONS])
        for c, (d, _) in enumerate(DIRECTIONS):
            entry = {'frames': [(row + i) * 8 + c for i in range(len(poses))], 'fps': fps, 'loop': loop}
            if moved[d] != (0, 0):
                entry['offset'] = [-moved[d][0], -moved[d][1]]
            anims[f'{anim}_{d}'] = entry
        row += len(poses)
        print(f'{anim}: {len(poses)} frame(s)', flush=True)

    sheet = Image.new('RGBA', (W * 8, H * len(rows)), (0, 0, 0, 0))
    for r, imgs in enumerate(rows):
        for c, im in enumerate(imgs):
            sheet.paste(im, (c * W, r * H))

    # head pivot: top of the idle silhouette with each direction's fit undone
    alpha = np.array(sheet)[..., 3] > 0
    tops = []
    for c, (d, _) in enumerate(DIRECTIONS):
        top = int(np.where(alpha[0:H, c * W:(c + 1) * W].any(1))[0].min())
        tops.append(top - shifts['idle'][d][1])
    pivots = {'head': [0, min(tops) - H]}
    if extra_pivots:
        pivots.update(extra_pivots(infos, report))
    if anim_pivots:
        for key, pv in anim_pivots(infos, report).items():
            anims[key]['pivots'] = pv

    os.makedirs(out_dir, exist_ok=True)
    sheet.save(os.path.join(out_dir, f'{name}.png'))
    meta = {'image': f'{name}.png', 'frameWidth': W, 'frameHeight': H, 'anchor': [0.5, 1],
            'pivots': pivots, 'animations': anims}
    with open(os.path.join(out_dir, f'{name}.json'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(meta, indent=2) + '\n')
    report['height_px'] = H - min(tops)
    return sheet, meta, report

if __name__ == '__main__':
    sheet, meta, report = generate(sys.argv[1] if len(sys.argv) > 1 else None, 'warden')
    a = build(ANIMATIONS[1][1][0])['ankles']
    report['walk_stride_px'] = round(float(abs(a['R'][1] - a['L'][1])), 1)
    print('sheet', sheet.size, 'pivots', meta['pivots'], report)
