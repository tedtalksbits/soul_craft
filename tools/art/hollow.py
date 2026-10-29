"""The Hollow (enemy) sprite generator.

Writes the engine sprite sheet assets/sprites/hollow.png + hollow.json (format:
src/content/sprite-sheet.ts): 8 columns (down, down_right, right, up_right, up,
up_left, left, down_left), one row per animation frame, animations in ANIMATIONS
order. numpy + Pillow only, seeded, integer hashing: same script, same pixels.

Usage: pnpm art hollow                    (see tools/art/README.md)
       python tools/art/hollow.py [output_dir]

Delivered by the art agent 2026-10-29 (second revision: lifted hood highlight, reworked attack,
integer hash). Repo adaptations: this docstring, default output folder, UTF-8 JSON with a
trailing newline, the NaN warning silenced, a shadowed coords() removed.
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
    1:  ('#7a7359', '#4e4a3c', '#34312a', '#22201d'),  # hood and shawl (lifted highlight: separates from dark grass)
    2:  ('#736a58', '#5c5446', '#3d372e', '#27231d'),  # padded jacket
    3:  ('#888680', '#6b6a64', '#45443f', '#2a2925'),  # rusted iron
    4:  ('#bd703a', '#9a5a2e', '#6b3c1e', '#4a2713'),  # rust
    5:  ('#aca996', '#8a8778', '#5c5a50', '#3c3a34'),  # ashen skin
    6:  ('#897a64', '#6e6250', '#4a4236', '#312c24'),  # wraps and rope
    10: ('#111111', '#111111', '#111111', '#111111'),  # the face: all shadow
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

MODEL_SCALE = 1.12      # authored ~30 px tall; scaled to the spec's 33-34 px

def coords(Fr):
    Rm, t = Fr
    dx, dy, dz = X / MODEL_SCALE - t[0], Y / MODEL_SCALE - t[1], Z / MODEL_SCALE - t[2]
    return (Rm[0, 0] * dx + Rm[1, 0] * dy + Rm[2, 0] * dz,
            Rm[0, 1] * dx + Rm[1, 1] * dy + Rm[2, 1] * dz,
            Rm[0, 2] * dx + Rm[1, 2] * dy + Rm[2, 2] * dz)

def roty(a):            # negative drops the sword side (-x)
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])

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

THIGH, SHIN = 5.0, 5.0
UPPER_ARM, FOREARM = 3.4, 3.3
HIP_Z = 11.0
HIP = np.array([0.0, 0.0, HIP_Z])
NECK = np.array([0.0, -0.6, 20.6])
HEAD_C = np.array([0.0, -1.6, 23.0])
SHOULDER = {-1: np.array([-3.9, -0.2, 18.8]), 1: np.array([3.9, -0.2, 19.4])}   # sword side lower
BLADE_LEN = 15.0
DRAG_LEN = 12.5        # the same blade, measured to the point where it meets the ground

_rng = np.random.default_rng(11)
JACKET_HEM = _rng.choice([0, 0.5, 1.0, 1.5, 2.5], size=32)
SHAWL_HEM = _rng.choice([0, 0.5, 1.0, 2.0, 3.0], size=24)

def draw_blade(put, C, grip, bdir, length):
    """Long rusty sword: wrapped grip, iron crossguard, notched blade with rust patches."""
    bdir = np.asarray(bdir, float)
    bdir = bdir / np.linalg.norm(bdir)
    grip = np.asarray(grip, float)
    put(capsule(C, grip - bdir * 1.3, grip + bdir * 0.7, 0.5), 6)                # grip wraps
    put(ball(C, grip - bdir * 1.6, 0.65), 3)                                      # pommel
    perp = np.cross(bdir, [0, 0, 1.0])
    if np.linalg.norm(perp) < 1e-3:
        perp = np.cross(bdir, [0, 1.0, 0])
    perp /= np.linalg.norm(perp)
    gc = grip + bdir * 1.2
    put(capsule(C, gc - perp * 1.6, gc + perp * 1.6, 0.45), 3)                   # crossguard
    tip = gc + bdir * length
    blade = capsule(C, gc, tip, 0.7, 0.3)
    x, y, z = C
    # rust: blotches along the blade, measured along its length so they stay put
    t = ((x - gc[0]) * bdir[0] + (y - gc[1]) * bdir[1] + (z - gc[2]) * bdir[2])
    rusty = blade & (ihash3(t, 0 * t, 0 * t, 0.9) > 0.66)
    put(blade, 3)
    put(rusty, 4)
    for f, side in ((0.35, 1), (0.55, 1), (0.72, -1)):                              # notches
        put(blade & ball(C, gc + bdir * (length * f) + perp * 0.75 * side, 0.55), 0)
    return tip

def build(pose):
    """Build the hollow for one pose. Pose keys:

    legR / legL     (thigh_pitch, shin_pitch[, thigh_abduct, shin_abduct]) degrees, forward +
    kneeR/ankleR... explicit knee/ankle points in body coordinates; footR/footL foot direction
    hip_z           explicit hip height; default: lowest ankle on the ground
    tilt, ground    whole-body pitch about tilt_pivot; drop the model onto the ground
    lean, twist, roll   torso pitch forward, turn (+ sword shoulder forward), side drop (- sword side down)
    head_tilt       + chin down, - head back
    bob_extra       upper-body drop in model units
    handR / handL   hand targets in torso coordinates (two-bone IK); poleR/poleL bend the elbows
    hand_frame      'body' to give hand targets and blade_dir in body coordinates instead (unaffected by twist)
    blade_dir       blade direction in torso coordinates, or tip=(x, y, z) in body coordinates
                    (the blade then reaches for that point, e.g. resting on the ground)
    blade           'hand' (default) or 'ground' (dropped, placed after landing)
    """
    global M, N
    M = np.zeros(X.shape, np.uint8)
    def put(mask, mat):
        M[mask] = mat

    # ---- legs (body coordinates, hips at z = 11), narrow stance
    legs = {}
    for side, sx in (('R', -1), ('L', 1)):
        Hp = np.array([1.8 * sx, 0.0, HIP_Z])
        if 'knee' + side in pose:
            K = np.asarray(pose['knee' + side], float)
            A = np.asarray(pose['ankle' + side], float)
        else:
            spec = pose['leg' + side]
            tp, sp = deg(spec[0]), deg(spec[1])
            ta = deg(spec[2]) if len(spec) > 2 else 0.0
            sa = deg(spec[3]) if len(spec) > 3 else 0.0
            K = Hp + THIGH * limb_dir(tp, ta, sx)
            A = K + SHIN * limb_dir(sp, sa, sx)
        legs[side] = (Hp, K, A)
    hip_z = pose['hip_z'] if 'hip_z' in pose else HIP_Z + 1.0 - min(l[2][2] for l in legs.values())
    dz = hip_z - HIP_Z

    body = fcompose(move((0, 0, dz)), about(rotx(deg(pose.get('tilt', 0.0))), pose.get('tilt_pivot', (0, 0, 8.0))))
    rel_torso = fcompose(move((0, 0, pose.get('bob_extra', 0.0))),
                         about(rotz(deg(pose.get('twist', 0.0))) @ rotx(deg(pose.get('lean', 24.0)))
                               @ roty(deg(pose.get('roll', -7.0))), HIP))
    torso = fcompose(body, rel_torso)
    head = fcompose(torso, about(rotx(deg(pose.get('head_tilt', 10.0))), NECK))
    CB, CT, CH = coords(body), coords(torso), coords(head)

    for side in ('R', 'L'):
        Hp, K, A = legs[side]
        put(capsule(CB, Hp, K, 1.35, 1.2), 2)                                    # padded legs
        put(capsule(CB, K, A, 1.15, 1.05), 6)                                    # wrapped shins
        fd = np.asarray(pose.get('foot' + side, (0, -1.0, 0)), float)
        fd /= np.linalg.norm(fd)
        lift = A[2] + dz - 1.0
        put(capsule(CB, A - 0.7 * fd + [0, 0, -0.1], A + 1.8 * fd + [0, 0, -0.3 + 0.3 * lift], 1.0), 6)

    # ---- torso (torso coordinates): rotted padded jacket with a ragged hem, rope belt
    x, y, z = CT
    rxj = 3.8 + np.clip(z - 8, 0, 9) * 0.09 - np.clip(z - 18, 0, 3) * 0.3
    hem = 8.0 + JACKET_HEM[np.clip(np.floor(x).astype(int) + 16, 0, 31)]
    jacket = (((x / rxj) ** 2 + ((y + 0.2) / 2.8) ** 2) < 1) & (z >= hem) & (z < 20.2)
    put(jacket, 2)
    put((((x / (rxj + 0.25)) ** 2 + ((y + 0.2) / 2.85) ** 2) < 1) & (z >= 12.4) & (z < 13.2), 6)  # rope belt
    put(capsule(CT, (-1.0, -2.6, 12.8), (-1.6, -2.9, 10.6), 0.35), 6)                          # rope end
    put(capsule(CT, (0, -0.3, 19.6), NECK + [0, -0.3, 0.8], 0.95), 5)                        # neck

    # ---- arms (torso coordinates): sleeves to the elbow, bare gaunt forearms
    arms = {}
    for side, sx in (('R', -1), ('L', 1)):
        S = SHOULDER[sx]
        tgt = np.asarray(pose['hand' + side], float)
        if pose.get('hand_frame', 'torso') == 'body':
            tgt = to_local(rel_torso, tgt)
        pole = pose.get('pole' + side, (sx * 1.0, 0.5, -0.4))
        el, hd = two_bone(S, tgt, UPPER_ARM, FOREARM, pole)
        put(capsule(CT, S, el, 1.05, 0.95), 2)
        put(capsule(CT, el, hd, 0.75, 0.65), 5)
        put(ball(CT, hd, 0.85), 5)
        arms[side] = (S, el, hd)
        put(capsule(CT, S + [0, 0, 0.3], S + 0.45 * (el - S), 1.25), 3)                         # mail scraps
    # bony fingers held out on the empty hand
    S, el, hd = arms['L']
    fdir = (hd - el) / np.linalg.norm(hd - el)
    side_v = np.cross(fdir, [0, 0, 1.0]); side_v /= np.linalg.norm(side_v) + 1e-9
    for k in (-1, 0, 1):
        put(capsule(CT, hd, hd + fdir * 1.5 + side_v * 0.7 * k - [0, 0, 0.2], 0.38), 5)

    # ---- shawl: a big soft lopsided drape over the shoulders, longer on the empty-hand side
    ang = np.arctan2(x, -(y + 0.2))
    rad = np.sqrt(x ** 2 + ((y + 0.2) / 0.78) ** 2)
    r_out = np.minimum(1.8 + (21.4 - z) * 0.66, 5.9)
    shem = 14.6 - 1.8 * np.clip(x / 4.0, 0, 1) - 1.2 * (np.cos(ang) < -0.3) \
        + SHAWL_HEM[np.clip(((ang + np.pi) / (2 * np.pi) * 24).astype(int), 0, 23)] * 0.7
    shawl = (rad < r_out) & (rad > r_out - 1.3) & (z >= shem) & (z < 21.4)
    put(shawl, 1)

    # ---- head (head coordinates): face in shadow, cracked kettle helm, torn hood over it
    hx_, hy_, hz_ = CH
    c = HEAD_C
    put(((hx_ - c[0]) ** 2 + ((hy_ - c[1]) * 1.05) ** 2 + ((hz_ - c[2]) * 0.95) ** 2) < 2.1 ** 2, 10)
    dome = (((hx_ - c[0]) ** 2 + (hy_ - c[1]) ** 2 + ((hz_ - c[2] - 0.4) * 1.1) ** 2) < 2.7 ** 2) & (hz_ > c[2] + 0.5)
    brim_z = c[2] + 0.55 - 0.18 * np.clip(-(hx_ - c[0]), 0, 5)                           # dented: droops on one side
    hood = ((hx_ - c[0]) ** 2 + ((hy_ - c[1] - 0.5) * 0.95) ** 2 + ((hz_ - c[2] - 0.6) * 1.05) ** 2)
    hood = (hood < 3.5 ** 2) & (hood > 2.6 ** 2) & ((hz_ > brim_z + 0.3) | (hy_ > c[1] + 1.2)) & (hz_ > c[2] - 2.0)
    hood |= capsule(CH, c + [0.3, 2.4, 2.6], c + [1.7, 4.2, -1.4], 1.2, 0.6)            # drooping hood tail
    put(hood, 1)
    put(dome & (M != 1), 3)
    brim_d = np.sqrt((hx_ - c[0]) ** 2 + (hy_ - c[1]) ** 2)
    brim = (brim_d < 4.5) & (brim_d > 2.0) & (np.abs(hz_ - brim_z) < 0.4)
    put(brim, 3)
    helm = (M == 3) & (dome | brim)
    put(helm & (ihash3(hx_, hy_, hz_, 1.6) > 0.62), 4)                                    # rust streaks
    crack = dome & (np.abs(hx_ - c[0] - 0.7 - 0.35 * (hz_ - c[2])) < 0.3) & (hy_ < c[1])
    put(crack & (M != 1), 10)

    # ---- the sword
    blade = pose.get('blade', 'hand')
    if blade == 'hand':
        grip = arms['R'][2]
        if 'tip' in pose:
            # the tip rests on the ground: aim along the target's bearing, keep the blade's length
            g_b = to_world(rel_torso, grip)
            tgt = np.asarray(pose['tip'], float)
            u = tgt[:2] - g_b[:2]
            u /= np.linalg.norm(u)
            reach = DRAG_LEN + 1.2
            drop_z = g_b[2] - (0.5 - dz)
            h = np.sqrt(max(reach ** 2 - drop_z ** 2, 0.0))
            tip_b = np.array([g_b[0] + u[0] * h, g_b[1] + u[1] * h, 0.5 - dz])
            draw_blade(put, CT, grip, to_local(rel_torso, tip_b) - grip, DRAG_LEN)
        else:
            bd = np.asarray(pose.get('blade_dir', (-0.1, -0.5, -0.86)), float)
            if pose.get('hand_frame', 'torso') == 'body':
                bd = rel_torso[0].T @ bd
            draw_blade(put, CT, grip, bd, BLADE_LEN)

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
    drop = -shift_k * RES / MODEL_SCALE

    if blade == 'ground':
        hand_w = to_world(torso, arms['R'][2]) + [0, 0, drop]
        g = np.array([hand_w[0] - 2.0, hand_w[1] + 1.5, 0.6])
        draw_blade(put, (X / MODEL_SCALE, Y / MODEL_SCALE, Z / MODEL_SCALE), g, pose.get('ground_dir', (-0.35, -1.0, 0.0)), BLADE_LEN)

    occ = gauss3d((M > 0).astype(float), 1.6)
    gx, gy, gz = np.gradient(occ)
    N = -np.stack([gx, gy, gz], -1)
    N /= (np.linalg.norm(N, axis=-1, keepdims=True) + 1e-9)
    return {'ankles': {k: v[2] * MODEL_SCALE for k, v in legs.items()}, 'hip_z': hip_z * MODEL_SCALE}

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

# hunched, knees bent, sword arm hanging with the tip on the ground ahead and to the side
REST = dict(legR=(12, -8), legL=(8, -10), handR=(-4.4, -3.2, 12.2), handL=(4.4, -3.6, 13.6),
            poleL=(1, 0.6, -0.2), tip=(-6.0, -9.5, 0.6))

# shamble: the sword-side leg drags; small sway and an uneven shoulder roll
WALK_ARMS_A = dict(handL=(4.4, -5.6, 14.6), handR=(-4.6, -2.0, 12.0))
WALK_ARMS_B = dict(handL=(4.4, -1.0, 13.2), handR=(-4.4, -3.8, 12.4))

ANIMATIONS = [
    # (name, poses, fps, loop)
    ('idle', [P(REST),
              P(REST, bob_extra=-0.9, head_tilt=20, lean=26, handR=(-4.4, -3.0, 11.6), handL=(4.3, -3.4, 13.0))],
     2, True),
    ('walk', [P(WALK_ARMS_B, legR=(36, 16), legL=(-34, -48), roll=-10, twist=6, lean=27, tip=(-6.5, -6.0, 0.6)),
              P(WALK_ARMS_B, legR=(4, -2), legL=(12, -24), roll=-6, twist=2, lean=25, bob_extra=0.5, tip=(-6.5, -7.5, 0.6)),
              P(WALK_ARMS_A, legR=(-32, -42), legL=(36, 16), roll=-4, twist=-6, lean=27, tip=(-6.5, -9.0, 0.6),
                footR=(0, -1, -0.35)),
              P(WALK_ARMS_A, legR=(10, -14), legL=(4, -2), roll=-8, twist=-2, lean=25, bob_extra=0.5, tip=(-6.5, -7.5, 0.6),
                footR=(0, -1, -0.25))],
     6, True),
    ('windup', [
        # rearing back, the blade coming up over the sword shoulder
        P(legR=(-14, -10), legL=(20, 6), lean=12, twist=-14, roll=-4, head_tilt=4,
          handR=(-5.0, 0.4, 19.0), poleR=(-1, 0.2, -1), blade_dir=(-0.25, 0.45, 0.86),
          handL=(4.6, -4.6, 15.5)),
        # fully reared: blade high and back, empty hand thrown forward for balance
        P(legR=(-20, -14), legL=(26, 10), lean=0, twist=-26, roll=-2, head_tilt=-4,
          handR=(-5.2, 1.8, 21.6), poleR=(-1, 0.3, -1), blade_dir=(-0.2, 0.75, 0.62),
          handL=(4.8, -6.4, 17.0)),
    ], 5, False),
    ('attack', [
        # (hands and blade in body coordinates: the thrust angles out over the sword side,
        #  so it still reads as a diagonal when the hollow lunges straight at the camera)
        # push off
        P(legR=(-36, -30), legL=(30, 8), lean=32, twist=6, roll=-6, head_tilt=6, hand_frame='body',
          handR=(-4.8, -5.6, 15.8), poleR=(-1, 0.4, -0.6), blade_dir=(-0.36, -0.88, 0.30),
          handL=(4.6, 2.6, 15.2)),
        # full thrust: this is the frame the hit lands on
        P(legR=(-46, -42), legL=(44, 18), lean=40, twist=24, roll=-6, head_tilt=8, hand_frame='body',
          handR=(-3.8, -10.0, 15.2), poleR=(-1, 0.3, -0.4), blade_dir=(-0.50, -0.85, 0.14),
          handL=(4.4, 3.6, 16.2)),
        # overextended stumble: the tip dips towards the ground, head lolls
        P(legR=(-34, -54), legL=(52, 30), lean=52, twist=14, roll=-10, head_tilt=22, hand_frame='body',
          handR=(-3.8, -9.2, 10.4), poleR=(-1, 0.3, -0.4), blade_dir=(-0.42, -0.62, -0.66),
          handL=(5.0, 3.0, 14.2)),
    ], 18, False),
    ('hurt', [
        # head snapped back, arms flung out
        P(legR=(-16, -8), legL=(10, 2), lean=8, roll=-4, head_tilt=-34,
          handR=(-8.4, 0.6, 18.6), poleR=(-0.4, 1, -0.6), blade_dir=(-0.45, 0.35, 0.82),
          handL=(8.0, 0.8, 19.0), poleL=(0.4, 1, -0.6)),
    ], round(1000 / 267, 2), False),
    ('dead', [
        # crumpled forward onto knees and face, blade dropped
        P(hip_z=5.0, kneeR=(-2.0, -3.4, 7.0), ankleR=(-2.2, 1.8, 6.9), footR=(0, 1.0, -0.4),
          kneeL=(2.0, -3.0, 7.0), ankleL=(2.3, 2.0, 6.9), footL=(0, 1.0, -0.4),
          lean=96, roll=-12, twist=8, head_tilt=12,
          handR=(-4.8, -2.2, 26.0), poleR=(-1, 0, -1), handL=(4.4, -1.4, 24.6),
          blade='ground', ground=True),
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
    sheet, meta, report = generate(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT, 'hollow')
    a = build(ANIMATIONS[1][1][0])['ankles']
    report['walk_stride_px'] = round(float(abs(a['R'][1] - a['L'][1])), 1)
    print('sheet', sheet.size, 'pivots', meta['pivots'], report)
