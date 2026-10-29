"""The Archer (enemy) sprite generator.

Writes the engine sprite sheet assets/sprites/archer.png + archer.json (format:
src/content/sprite-sheet.ts): 8 columns (down, down_right, right, up_right, up,
up_left, left, down_left), one row per animation frame, animations in ANIMATIONS
order. numpy + Pillow only, seeded, integer hashing: same script, same pixels.

Usage: pnpm art archer                    (see tools/art/README.md)
       python tools/art/archer.py [output_dir]

Delivered by the art agent 2026-10-29. Repo adaptations: this docstring, default output folder,
UTF-8 JSON with a trailing newline, the NaN warning silenced, a shadowed coords() removed, and
per-direction release pivots on the attack animations (the sheet-level one is their average).
"""
import json
import os
import sys

import numpy as np
from PIL import Image

# ---------------------------------------------------------------- palette ramps
def hx(h):
    h = h.lstrip('#')
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

# material: (highlight, base, shadow, deep); base/shadow from the spec, the rest derived
RAMPS = {
    1:  ('#6d8455', '#4a5a3a', '#2f3a25', '#1c2416'),  # hood and tunic (lifted highlight: reads on grass)
    3:  ('#987049', '#7a5a3a', '#523c26', '#362718'),  # bow wood, arrow shafts
    4:  ('#dfceac', '#c8b898', '#9a8c70', '#7a6d54'),  # string and feathers
    5:  ('#e7dec4', '#c8c0a8', '#8a8470', '#5f5a49'),  # bone: jaw, hands, arrowheads
    6:  ('#846643', '#6b5236', '#4a3825', '#332619'),  # leather: jerkin, bracer, quiver, boots
    # (no material 2: the shared compose() dithers id 2 as chainmail)
    10: ('#111111', '#111111', '#111111', '#111111'),  # inside the hood: all shadow
}
RAMPS = {k: [hx(c) for c in v] for k, v in RAMPS.items()}

# ---------------------------------------------------------------- voxel grid
RES = 0.5
xs = np.arange(-16, 16, RES) + RES / 2
ys = np.arange(-30, 30, RES) + RES / 2
zs = np.arange(-22, 45, RES) + RES / 2
X, Y, Z = np.meshgrid(xs, ys, zs, indexing='ij')
M = np.zeros(X.shape, np.uint8)
N = np.zeros(X.shape + (3,))

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

MODEL_SCALE = 1.08      # authored ~33 px tall; scaled to the spec's 36 px

def coords(Fr):
    Rm, t = Fr
    dx, dy, dz = X / MODEL_SCALE - t[0], Y / MODEL_SCALE - t[1], Z / MODEL_SCALE - t[2]
    return (Rm[0, 0] * dx + Rm[1, 0] * dy + Rm[2, 0] * dz,
            Rm[0, 1] * dx + Rm[1, 1] * dy + Rm[2, 1] * dz,
            Rm[0, 2] * dx + Rm[1, 2] * dy + Rm[2, 2] * dz)

def roty(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])

def unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)

THIGH, SHIN = 5.6, 5.4
UPPER_ARM, FOREARM = 3.6, 3.5
HIP_Z = 12.0
HIP = np.array([0.0, 0.0, HIP_Z])
NECK = np.array([0.0, -0.2, 22.4])
HEAD_C = np.array([0.0, -0.5, 25.0])
SHOULDER = {-1: np.array([-3.8, 0.1, 21.0]), 1: np.array([3.8, 0.1, 21.0])}
BOW_LEN = 28.0
BRACE = 2.6            # how far the tips sit behind the grip when the bow is at rest
ARROW_LEN = 14.0

_rng = np.random.default_rng(23)
TUNIC_HEM = _rng.choice([0, 0.5, 1.0, 1.5, 2.0], size=32)

def draw_arrow(put, C, tail, direction, length=ARROW_LEN, fletch=True):
    d = unit(direction)
    tail = np.asarray(tail, float)
    head = tail + d * length
    put(capsule(C, tail, head - d * 1.1, 0.42), 3)                               # shaft
    put(capsule(C, head - d * 1.3, head, 0.62, 0.25), 5)                         # bone head
    if fletch:
        put(capsule(C, tail + d * 0.2, tail + d * 2.2, 0.62, 0.45), 4)          # feathers

def draw_bow(put, C, grip, up, fwd, flex=1.0, nock=None, arrow=False):
    """A longbow: limbs curving back from the grip, string straight at rest or drawn to `nock`."""
    up = unit(up)
    fwd = unit(np.asarray(fwd, float) - (np.asarray(fwd, float) @ up) * up)
    grip = np.asarray(grip, float)
    sag = BRACE * flex
    pts = []
    for s in np.linspace(-1, 1, 17):
        pts.append(grip + up * (s * BOW_LEN / 2) - fwd * (sag * s * s))
    for i in range(len(pts) - 1):
        s = abs(-1 + (i + 0.5) * 2 / 16)
        put(capsule(C, pts[i], pts[i + 1], 0.85 - 0.35 * s), 3)
    put(capsule(C, grip - up * 1.3, grip + up * 1.3, 0.85), 6)                    # leather grip
    top, bot = pts[-1], pts[0]
    if nock is None:
        put(capsule(C, top, bot, 0.38), 4)
    else:
        nock = np.asarray(nock, float)
        put(capsule(C, top, nock, 0.38), 4)
        put(capsule(C, nock, bot, 0.38), 4)
        if arrow:
            draw_arrow(put, C, nock, grip - nock)
    return top, bot

def build(pose):
    """Build the archer for one pose. Pose keys:

    legR / legL     (thigh_pitch, shin_pitch[, thigh_abduct, shin_abduct]) degrees, forward +
    hip_z, tilt, tilt_pivot, ground   as in player.py
    lean, twist, roll   torso pitch, turn (+ brings the draw shoulder (right, -x) forward), side lean
    head_tilt, head_yaw head pitch (+ chin down) and turn (+ towards screen-left of the torso)
    bob_extra       upper-body drop in model units
    handR / handL   hand targets (two-bone IK), in body coordinates if hand_frame == 'body'
    bow             dict(up=..., fwd=..., flex=..., nock=bool, arrow=bool) in body coordinates;
                    the grip is the left hand, a drawn string ends at the right hand
    bow_place       dict(grip=, up=, fwd=) to place the bow in body coordinates without the hand (dead)
    spill           arrows scattered on the ground after landing: list of (x, y, angle_deg)
    """
    global M, N
    M = np.zeros(X.shape, np.uint8)
    def put(mask, mat):
        M[mask] = mat

    # ---- legs (body coordinates), feet shoulder-width apart
    legs = {}
    for side, sx in (('R', -1), ('L', 1)):
        Hp = np.array([1.9 * sx, 0.0, HIP_Z])
        spec = pose['leg' + side]
        tp, sp = deg(spec[0]), deg(spec[1])
        ta = deg(spec[2]) if len(spec) > 2 else deg(3)
        sa = deg(spec[3]) if len(spec) > 3 else 0.0
        K = Hp + THIGH * limb_dir(tp, ta, sx)
        A = K + SHIN * limb_dir(sp, sa, sx)
        legs[side] = (Hp, K, A)
    hip_z = pose['hip_z'] if 'hip_z' in pose else HIP_Z + 1.0 - min(l[2][2] for l in legs.values())
    dz = hip_z - HIP_Z

    body = fcompose(move((0, 0, dz)), about(rotx(deg(pose.get('tilt', 0.0))), pose.get('tilt_pivot', (0, 0, 16.0))))
    rel_torso = fcompose(move((0, 0, pose.get('bob_extra', 0.0))),
                         about(rotz(deg(pose.get('twist', 0.0))) @ rotx(deg(pose.get('lean', 2.0)))
                               @ roty(deg(pose.get('roll', 0.0))), HIP))
    torso = fcompose(body, rel_torso)
    head = fcompose(torso, about(rotz(deg(pose.get('head_yaw', 0.0))) @ rotx(deg(pose.get('head_tilt', 0.0))), NECK))
    CB, CT, CH = coords(body), coords(torso), coords(head)

    for side in ('R', 'L'):
        Hp, K, A = legs[side]
        put(capsule(CB, Hp, K, 1.3, 1.15), 1)                                     # tunic-green legs
        put(capsule(CB, K + 0.15 * (A - K), A, 1.2, 1.1), 6)                      # soft boots
        lift = A[2] + dz - 1.0
        put(capsule(CB, A + [0, 0.6, -0.1], A + [0, -1.9, -0.3 + 0.3 * lift], 1.0), 6)

    # ---- torso: ragged tunic, leather jerkin open at the front, belt, small cowl
    x, y, z = CT
    rxt = 3.2 + np.clip(z - 9, 0, 11) * 0.05
    hem = 8.6 + TUNIC_HEM[np.clip(np.floor(x).astype(int) + 16, 0, 31)]
    put((((x / rxt) ** 2 + (y / 2.4) ** 2) < 1) & (z >= hem) & (z < 22.2), 1)
    jerkin = (((x / (rxt + 0.3)) ** 2 + (y / 2.7) ** 2) < 1) & (z >= 13.2) & (z < 21.4)
    jerkin &= ~((y < -1.2) & (np.abs(x) < 0.9))                                    # open front shows the tunic
    put(jerkin, 6)
    put((((x / (rxt + 0.45)) ** 2 + (y / 2.85) ** 2) < 1) & (z >= 13.2) & (z < 14.0), 6)   # belt
    cowl = (((x / 3.4) ** 2 + ((y - 0.1) / 2.9) ** 2) < 1) & (z >= 20.6) & (z < 22.8)
    put(cowl, 1)
    put(capsule(CT, (0, -0.1, 21.8), NECK + [0, -0.1, 0.9], 0.9), 1)

    # ---- quiver on the back, feathers over the right shoulder
    q0, q1 = np.array([1.7, 2.9, 13.4]), np.array([-1.5, 3.3, 22.6])
    put(capsule(CT, q0, q1, 1.05), 6)
    qd = unit(q1 - q0)
    for k, off in enumerate(([-0.5, 0.2, 0], [0.4, -0.2, 0.1], [0.0, 0.5, -0.1])):
        a0 = q1 + np.array(off)
        put(capsule(CT, a0 + qd * 0.6, a0 + qd * (2.6 + 0.3 * k), 0.55), 4)

    # ---- arms: tunic sleeves, leather bracer on the bow arm, bony hands
    arms = {}
    for side, sx in (('R', -1), ('L', 1)):
        S = SHOULDER[sx]
        tgt = np.asarray(pose['hand' + side], float)
        if pose.get('hand_frame', 'torso') == 'body':
            tgt = to_local(rel_torso, tgt)
        pole = pose.get('pole' + side, (sx * 1.0, 0.6, -0.5))
        el, hd = two_bone(S, tgt, UPPER_ARM, FOREARM, pole)
        put(capsule(CT, S, el, 0.95, 0.85), 1)
        put(capsule(CT, el, hd, 0.8, 0.7), 6 if sx > 0 else 1)
        put(ball(CT, hd, 0.75), 5)
        arms[side] = (S, el, hd)

    # ---- head: deep pointed hood, shadowed face, pale bony jaw
    hx_, hy_, hz_ = CH
    c = HEAD_C
    hood = (((hx_ - c[0]) / 3.0) ** 2 + ((hy_ - c[1] - 0.3) / 3.1) ** 2 + ((hz_ - c[2] - 0.3) / 3.3) ** 2) < 1
    hood |= capsule(CH, c + [0, 0.5, 2.3], c + [0, 2.0, 8.0], 2.3, 0.35)        # the point, swept back
    put(hood, 1)
    cavity = hood & (hy_ < c[1] - 1.3) & (np.abs(hx_ - c[0]) < 1.9) & (hz_ > c[2] - 2.7) & (hz_ < c[2] + 1.3)
    put(cavity, 10)
    jaw = cavity & (hz_ < c[2] - 1.5) & (np.abs(hx_ - c[0]) < 1.25) & (hy_ < c[1] - 1.7)
    put(jaw, 5)

    # ---- the bow
    grip_w = None
    if 'bow' in pose:
        b = pose['bow']
        grip_b = to_world(rel_torso, arms['L'][2])
        nock_b = to_world(rel_torso, arms['R'][2]) + np.array([0.3, 0.0, 0.0]) if b.get('nock') else None
        draw_bow(put, CB, grip_b, b['up'], b.get('fwd', (0, -1.0, 0)), b.get('flex', 1.0), nock_b, b.get('arrow', False))
        grip_w = to_world(body, grip_b) * MODEL_SCALE
    elif 'bow_place' in pose:
        b = pose['bow_place']
        draw_bow(put, CB, b['grip'], b['up'], b['fwd'])

    # ---- drop to the ground
    shift_k = 0
    if pose.get('ground'):
        ks = np.where((M > 0).any(axis=(0, 1)))[0]
        shift_k = int(ks.min()) - int(round((0.25 - zs[0]) / RES))
        M = np.roll(M, -shift_k, axis=2)
        if shift_k < 0:
            M[:, :, :(-shift_k)] = 0
        elif shift_k > 0:
            M[:, :, M.shape[2] - shift_k:] = 0
    for (ax, ay, aa) in pose.get('spill', []):
        d = np.array([np.cos(deg(aa)), np.sin(deg(aa)), 0.0])
        draw_arrow(put, (X / MODEL_SCALE, Y / MODEL_SCALE, Z / MODEL_SCALE), np.array([ax, ay, 0.55]) - d * ARROW_LEN / 2, d, ARROW_LEN * 0.8)

    occ = gauss3d((M > 0).astype(float), 1.6)
    gx, gy, gz = np.gradient(occ)
    N = -np.stack([gx, gy, gz], -1)
    N /= (np.linalg.norm(N, axis=-1, keepdims=True) + 1e-9)
    return {'ankles': {k: v[2] * MODEL_SCALE for k, v in legs.items()}, 'grip_world': grip_w}

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
        with np.errstate(invalid='ignore'):   # inf - inf on empty pixels; masked out by isfinite
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

# upright, bow held low at the side, almost as tall as the archer
BOW_LOW = dict(up=(0.30, -0.22, 0.93), fwd=(0.75, -0.66, 0.0))   # top leans out: the arc stands clear of the body
REST = dict(legR=(2, 0), legL=(-2, 0), handR=(-4.2, -0.6, 14.0), handL=(4.5, -1.2, 14.8), bow=BOW_LOW)

# drawing: body turned side-on, bow arm out along the facing, head turned back to the target
AIM = dict(legR=(-8, -2, 6), legL=(10, 4, 6), hand_frame='body', poleR=(-1, 1.0, 0.2), poleL=(1, 0.3, -1))

ANIMATIONS = [
    # (name, poses, fps, loop)
    ('idle', [P(REST),
              P(REST, roll=3, bob_extra=-0.8, head_tilt=4, handL=(4.5, -1.0, 14.3), handR=(-4.2, -0.4, 13.5),
                bow=dict(BOW_LOW, up=(0.34, -0.18, 0.92)))],
     2, True),
    # a careful upright stalk, no forward lean (the game also plays it backwards when retreating)
    ('walk', [P(REST, legR=(32, 12), legL=(-30, -40), handL=(4.5, -0.2, 14.8), handR=(-4.2, -2.0, 14.2)),
              P(REST, legR=(2, 0), legL=(14, -40), bob_extra=0.4),
              P(REST, legR=(-30, -40), legL=(32, 12), handL=(4.5, -2.4, 14.8), handR=(-4.2, 0.8, 14.2)),
              P(REST, legR=(14, -40), legL=(2, 0), bob_extra=0.4)],
     6, True),
    ('windup', [
        # nock and raise
        P(AIM, twist=-35, head_yaw=30, handL=(1.8, -7.6, 19.6), handR=(-0.4, -4.4, 19.8),
          bow=dict(up=(0.15, 0.0, 1.0), flex=1.0, nock=True, arrow=True)),
        # full draw: string at the jaw, limbs flexed
        P(AIM, twist=-55, head_yaw=50, head_tilt=-4, handL=(1.2, -9.4, 21.4), handR=(-0.8, -1.4, 23.2),
          bow=dict(up=(0.1, 0.0, 1.0), flex=1.5, nock=True, arrow=True)),
    ], 4, False),
    ('attack', [
        # release: the string snaps straight, the arrow is gone, the draw hand flies back past the ear
        P(AIM, twist=-55, head_yaw=50, head_tilt=-4, handL=(1.2, -9.4, 21.4), handR=(-1.8, 1.6, 24.0),
          bow=dict(up=(0.1, 0.0, 1.0), flex=1.0)),
        # the bow arm recoils up
        P(AIM, twist=-48, head_yaw=44, handL=(1.8, -8.0, 23.6), handR=(-2.6, 1.2, 22.2),
          bow=dict(up=(0.26, 0.18, 0.95), flex=1.0)),
        # and the bow lowers
        P(AIM, twist=-28, head_yaw=24, handL=(3.2, -5.6, 17.2), handR=(-3.8, 0.4, 17.0),
          bow=dict(up=(0.2, -0.3, 0.93), flex=1.0)),
    ], 15, False),
    # flinch sideways, hood ducked, the draw hand coming up to cover
    ('hurt', [P(legR=(-8, -4, 8), legL=(6, 2, 2), roll=14, twist=14, lean=6, head_tilt=28, head_yaw=-10,
                handL=(4.2, -1.8, 15.2), handR=(-2.2, -3.0, 21.0), poleR=(-1, 0.2, -1), bow=BOW_LOW)],
     round(1000 / 233, 2), False),
    # fallen backwards, bow across the body, arrows spilled from the quiver
    ('dead', [P(legR=(12, 4, 10), legL=(-4, 10, 12), tilt=-90, ground=True, head_tilt=-8, head_yaw=20,
                hand_frame='body', handL=(2.6, -3.8, 17.0), handR=(-7.4, -1.6, 22.5), poleR=(-1, 0, 1),
                bow_place=dict(grip=(1.6, -3.8, 17.5), up=(0.85, 0.0, 0.53), fwd=(0, -1.0, 0)),
                spill=[(4.5, 8.0, 20), (-3.0, 10.5, 70), (6.5, 4.0, -35), (1.0, 12.5, 115)])],
     1, False),
]

def release_pivot(infos, report):
    """The bow hand at the moment of release, per direction; the JSON gets the centred average height."""
    g = infos[('attack', 0)]['grip_world']
    per_dir = {d: tuple(int(round(v)) for v in project(g, np.radians(ang))) for d, ang in DIRECTIONS}
    report['release_by_direction'] = per_dir
    return {'release': [0, int(round(np.mean([p[1] for p in per_dir.values()])))]}

# ---------------------------------------------------------------- fitting (whole pixels)
def screen_extent(theta):
    occ = np.argwhere(M > 0)
    p = np.stack([xs[occ[:, 0]], ys[occ[:, 1]], zs[occ[:, 2]]], -1)
    w = rot(p, theta)
    sx = w[:, 0]
    sy = w[:, 1] * np.sin(PHI) + w[:, 2] * np.cos(PHI)
    return sx.min(), sx.max(), sy.min(), sy.max()

def fit_shift(extents):
    """Whole-pixel move of the drawing (dx right, dy down) that keeps it inside the frame; (0, 0) if it fits."""
    x0, x1 = min(e[0] for e in extents), max(e[1] for e in extents)
    y0, y1 = min(e[2] for e in extents), max(e[3] for e in extents)
    lim_x, lo_y, hi_y = 22.0, -1.0, 43.5
    dx = 0
    if x1 > lim_x:
        dx = -int(np.ceil(x1 - lim_x))
    elif x0 < -lim_x:
        dx = int(np.ceil(-lim_x - x0))
    up = 0
    if y0 < lo_y:
        up = int(np.ceil(lo_y - y0))
    elif y1 > hi_y:
        up = -int(np.ceil(y1 - hi_y))
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
def generate(out_dir='.', name='character', extra_pivots=None):
    """Render every animation and write <name>.png and <name>.json.

    JSON offsets are the engine's correction: it adds `offset` to undo the in-frame fit,
    so offset = -(how far the drawing was moved).
    """
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
    # The game draws each arrow at the release height for its direction of flight.
    for d, (rx, ry) in report.get('release_by_direction', {}).items():
        anims[f'attack_{d}']['pivots'] = {'release': [rx, ry]}

    os.makedirs(out_dir, exist_ok=True)
    sheet.save(os.path.join(out_dir, f'{name}.png'))
    meta = {'image': f'{name}.png', 'frameWidth': W, 'frameHeight': H, 'anchor': [0.5, 1],
            'pivots': pivots, 'animations': anims}
    with open(os.path.join(out_dir, f'{name}.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=2)
        f.write('\n')
    report['height_px'] = H - min(tops)
    return sheet, meta, report

DEFAULT_OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'sprites')

if __name__ == '__main__':
    sheet, meta, report = generate(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT, 'archer', release_pivot)
    a = build(ANIMATIONS[1][1][0])['ankles']
    report['walk_stride_px'] = round(float(abs(a['R'][1] - a['L'][1])), 1)
    print('sheet', sheet.size, 'pivots', meta['pivots'], report)
