"""The Ashen One (player character) sprite generator.

Builds the character as a voxel model, ray-casts it from a 3/4 overhead
camera in eight directions, and writes the engine sprite sheet:

    assets/sprites/player.png    8 columns (one per direction), one row per animation
                                 frame, animations in ANIMATIONS order;
                                 frame index = row * 8 + column
    assets/sprites/player.json   format: src/content/sprite-sheet.ts

Usage: pnpm art ashen_one                (see tools/art/README.md)
       python tools/art/ashen_one.py [output_dir]

numpy + Pillow only, all randomness seeded: same script, same pixels.
Delivered by the art agent 2026-10-29 as player.py (all eight player
animations); adapted to emit the engine's JSON exactly, to fit poses into the
frame by whole pixels and to record those shifts as per-animation offsets.
Cast poses (cast_slam, cast_throw, cast_charge, cast_push, cast_raise) added by
the art agent 2026-10-29; each cast entry records its RELEASE frame as `release`.
"""
import json
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image

# ---------------------------------------------------------------- palette ramps
def hx(h):
    h = h.lstrip('#')
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

# material: (highlight, base, shadow, deep)
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
    12: ('#ffc46e', '#ff9a30', '#c4691c', '#7a3e10'),  # flask (orange)
    13: ('#b8aa9a', '#968878', '#6e6256', '#463e36'),  # ashen skin
    14: ('#4a4440', '#36302c', '#24201e', '#141210'),  # hair
    15: ('#8c8270', '#6e6656', '#4e483c', '#2e2a22'),  # undyed tunic
    16: ('#7a5a40', '#5e4430', '#422f20', '#261a12'),  # leather jerkin
    # the helmet group (30-39): drawn on its own layer
    30: ('#c3c7cb', '#9da2a8', '#5f646b', '#34373c'),  # helm steel
    31: ('#8e8676', '#6e675a', '#4c473e', '#2c2924'),  # hood cloth
    33: ('#c43a2a', '#a3261c', '#7a1c15', '#45100c'),  # plume
    35: ('#111111', '#111111', '#111111', '#111111'),  # eye slit
    36: ('#7d8188', '#5f646b', '#41454b', '#26282c'),  # faceplate band
    # the weapon group (40-59): drawn on its own layer
    40: ('#e1e5e9', '#b9bec4', '#858b92', '#4d5258'),  # blade
    41: ('#5c4535', '#45342a', '#30241d', '#1c1511'),  # grip leather
    42: ('#ecd096', '#d0a85c', '#9a7536', '#5c4220'),  # guard and pommel
    43: ('#71543a', '#5a412b', '#3f2d1e', '#241a11'),  # shield wood
    44: ('#7d8188', '#5f646b', '#41454b', '#26282c'),  # shield rim
    46: ('#c8b896', '#a89a7a', '#7a6e56', '#4a4234'),  # ash shaft
    47: ('#c3c7cb', '#9da2a8', '#5f646b', '#34373c'),  # iron head
    48: ('#a49a88', '#827868', '#5a5248', '#36322c'),  # stone head
    49: ('#e7dec4', '#c8c0a8', '#8a8470', '#5f5a49'),  # bone
    50: ('#b08a5c', '#8a6a44', '#5e4830', '#36291a'),  # bow wood
    51: ('#e8e2d0', '#c8c0a8', '#a09880', '#6e6656'),  # bowstring
    52: ('#ffe0a0', '#ffb050', '#e07020', '#8a3a10'),  # ember orb
    53: ('#7a6a58', '#5e5040', '#40362a', '#261f18'),  # staff wood
    # trims: neutral grays the game tints with the piece's tier color
    60: ('#ffffff', '#d4d4d4', '#9c9c9c', '#5c5c5c'),  # chest trim
    61: ('#ffffff', '#d4d4d4', '#9c9c9c', '#5c5c5c'),  # helmet trim
}
GRAY = ('#e8e8e8', '#b4b4b4', '#7c7c7c', '#444444')   # legs, recolored for the game to tint
RAMPS = {k: [hx(c) for c in v] for k, v in RAMPS.items()}
GRAY = [hx(c) for c in GRAY]

# What the character wears: its chest's weight, its helmet's shape and its weapon's type. Each kit is
# rendered whole, then cut into the layers the game stacks (see KITS).
KIT = dict(chest='plate', helm='helm', weapon='sword')
HELM_MATS = set(range(30, 40))
WEAPON_MATS = set(range(40, 60))

# ---------------------------------------------------------------- voxel grid
RES = 0.5
xs = np.arange(-16, 16, RES) + RES / 2
ys = np.arange(-30, 30, RES) + RES / 2     # room for a body lying flat or tumbling
zs = np.arange(-22, 45, RES) + RES / 2     # room below the ground for mid-roll poses
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

def coords(Fr):
    Rm, t = Fr
    dx, dy, dz = X - t[0], Y - t[1], Z - t[2]
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

HUNCH = 0.13
def torso_cy(z):
    return -(np.clip(z, 13, 30) - 13) * HUNCH

THIGH, SHIN = 5.5, 5.4
UPPER_ARM, FOREARM = 3.6, 3.5
HIP = np.array([0.0, 0.0, 12.0])
NECK = np.array([0.0, float(torso_cy(23)), 23.2])
SHOULDER = {-1: np.array([-5.9, float(torso_cy(20)), 20.0]), 1: np.array([5.9, float(torso_cy(20)), 20.0])}
HELM_CY = float(torso_cy(23)) - 0.9

# rng for the cape hem, seeded so every frame frays the same way
_rng = np.random.default_rng(7)
HEM = _rng.choice([0, 0, 0.5, 1.0, 1.5, 2.5, 3.5], size=32)

def _axes(bdir, ref):
    bdir = np.asarray(bdir, float)
    bdir = bdir / np.linalg.norm(bdir)
    perp = np.cross(bdir, ref)
    if np.linalg.norm(perp) < 1e-3:
        perp = np.cross(bdir, [0, 0, 1.0])
    return bdir, perp / np.linalg.norm(perp)

def draw_sword(put, C, grip, bdir, ref=(0, 1.0, 0)):
    bdir, perp = _axes(bdir, ref)
    grip = np.asarray(grip, float)
    guard_c = grip + bdir * 1.4
    put(capsule(C, grip - bdir * 1.2, grip + bdir * 0.6, 0.55), 41)              # grip
    put(capsule(C, grip - bdir * 1.6, grip - bdir * 1.2, 0.75), 42)              # pommel
    put(capsule(C, guard_c - perp * 1.9, guard_c + perp * 1.9, 0.5), 42)        # crossguard
    blade = capsule(C, guard_c, guard_c + bdir * 12.5, 0.75, 0.35)
    put(blade, 40)
    chip = guard_c + bdir * 7.0 + perp * 0.6
    put(blade & ball(C, chip, 0.5), 0)                                           # a chip
    return guard_c + bdir * 12.5

def draw_spear(put, C, grip, bdir, ref=(0, 1.0, 0)):
    """A long ash shaft through the hand, the iron head out along the blade direction."""
    bdir, _ = _axes(bdir, ref)
    grip = np.asarray(grip, float)
    put(capsule(C, grip - bdir * 6.0, grip + bdir * 14.6, 0.6), 46)
    put(capsule(C, grip - bdir * 0.8, grip + bdir * 0.8, 0.72), 41)              # wrapped grip
    put(capsule(C, grip + bdir * 14.4, grip + bdir * 15.0, 0.85), 42)            # socket
    put(capsule(C, grip + bdir * 15.0, grip + bdir * 19.5, 1.1, 0.2), 47)        # head

def draw_hammer(put, C, grip, bdir, ref=(0, 1.0, 0)):
    """A short haft hanging from the hand, a heavy stone head at its end."""
    bdir, perp = _axes(bdir, ref)
    grip = np.asarray(grip, float)
    put(capsule(C, grip - bdir * 1.8, grip + bdir * 9.0, 0.5), 46)
    put(capsule(C, grip - bdir * 1.0, grip + bdir * 1.0, 0.62), 41)
    head = grip + bdir * 9.8
    put(capsule(C, head - perp * 2.6, head + perp * 2.6, 1.75), 48)
    put(capsule(C, head - perp * 2.9, head - perp * 2.5, 1.9), 47)               # iron bands
    put(capsule(C, head + perp * 2.5, head + perp * 2.9, 1.9), 47)

def draw_dagger(put, C, grip, bdir, ref=(0, 1.0, 0)):
    bdir, perp = _axes(bdir, ref)
    grip = np.asarray(grip, float)
    put(capsule(C, grip - bdir * 1.0, grip + bdir * 0.5, 0.5), 41)
    put(capsule(C, grip + bdir * 0.8 - perp * 1.1, grip + bdir * 0.8 + perp * 1.1, 0.4), 42)
    put(capsule(C, grip + bdir * 0.9, grip + bdir * 7.2, 0.7, 0.22), 40)

def draw_bow(put, C, hand, up, fwd):
    """A bow held upright in the hand: its limbs arc forward, the string straight behind them."""
    up = np.asarray(up, float) / np.linalg.norm(up)
    fwd = np.asarray(fwd, float)
    fwd = fwd - (fwd @ up) * up
    fwd /= np.linalg.norm(fwd)
    hand = np.asarray(hand, float)
    pts = [hand + up * (7.2 * t) + fwd * (1.8 * (1 - t * t) - 0.6) for t in np.linspace(-1, 1, 9)]
    for a, b in zip(pts, pts[1:]):
        put(capsule(C, a, b, 0.62), 50)
    put(capsule(C, hand - up * 0.9, hand + up * 0.9, 0.62), 41)                  # grip
    for tip, inward in ((pts[0], pts[1]), (pts[-1], pts[-2])):
        put(capsule(C, tip, tip + (tip - inward) * 0.4, 0.45), 49)                # bone tips
    put(capsule(C, pts[0] - fwd * 0.4, pts[-1] - fwd * 0.4, 0.18), 51)           # string

def draw_staff(put, C, grip, bdir, ref=(0, 1.0, 0)):
    """A tall staff through the hand: its foot out along the blade direction, the ember at its head."""
    bdir, perp = _axes(bdir, ref)
    grip = np.asarray(grip, float)
    top = grip - bdir * 14.0
    put(capsule(C, grip + bdir * 4.5, top, 0.62), 53)
    put(capsule(C, grip - bdir * 0.9, grip + bdir * 0.9, 0.72), 41)
    for k in (-1, 1):
        put(capsule(C, top, top - bdir * 2.0 + perp * 1.5 * k, 0.38), 47)        # the iron cage
    put(ball(C, top - bdir * 2.0, 1.55), 52)                                     # the ember

WEAPONS = {'sword': draw_sword, 'spear': draw_spear, 'hammer': draw_hammer, 'daggers': draw_dagger,
           'staff': draw_staff}

def draw_weapon(put, C, grip, bdir, ref=(0, 1.0, 0)):
    kind = KIT['weapon']
    if kind in WEAPONS:
        WEAPONS[kind](put, C, grip, bdir, ref)
    elif kind == 'bow':        # laid down (lap, ground): along the blade direction
        bd, perp = _axes(bdir, ref)
        draw_bow(put, C, np.asarray(grip, float) + bd * 2.0, bd, perp)

def draw_shield(put, C, sc, sn):
    sn = np.asarray(sn, float)
    sn = sn / np.linalg.norm(sn)
    x, y, z = C
    rx, ry, rz = x - sc[0], y - sc[1], z - sc[2]
    h = rx * sn[0] + ry * sn[1] + rz * sn[2]
    radial = np.sqrt(np.maximum(rx * rx + ry * ry + rz * rz - h * h, 0))
    disc = (radial < 4.6) & (np.abs(h) < 0.55)
    put(disc & (radial >= 3.8), 44)
    put(disc & (radial < 3.8), 43)
    put((radial < 1.3) & (h >= 0.0) & (h < 0.55 + 0.9 * (1 - radial / 1.3)), 42)

# ---------------------------------------------------------------- the model
def build(pose):
    """Build the voxel model for one pose. Pose keys (all optional except the legs):

    legR / legL     (thigh_pitch, shin_pitch[, thigh_abduct, shin_abduct]) in degrees, forward +
    kneeR/ankleR... explicit knee/ankle points in body coordinates (overrides legR/legL)
    footR / footL   foot direction in body coordinates (default forward)
    hip_z           explicit hip height; default: lowest ankle rests on the ground
    tilt            whole-body forward pitch in degrees about tilt_pivot (roll, dead)
    ground          drop the model so its lowest point rests on the ground
    lean, twist     torso pitch forward and turn (+ brings the sword shoulder forward), degrees
    head_tilt       head pitch, + tucks the chin, - throws the head back
    bob_extra       upper-body drop in model units (breathing)
    arm             walk arm swing -1..1 (used when handR/handL are not given)
    handR / handL   hand targets in torso coordinates (two-bone IK); poleR/poleL bend the elbow
    hand_frame      'torso' (default) or 'body' for the hand targets
    sword           'hand' (default) | None | 'lap' | 'ground';  sword_dir in torso coordinates
    shield          dict(offset=..., normal=...) on the left hand, or dict(body_center=..., normal=...)
    flask           (bottom, top) points in torso coordinates
    flare, phase    cape motion;  cape_wrap 0..1 wraps it round the body;  cape_spread widens it
    plume           plume trailing amount
    """
    global M, N
    M = np.zeros(X.shape, np.uint8)
    def put(mask, mat):
        M[mask] = mat

    # ---- legs, in body coordinates
    legs = {}
    for side, sx in (('R', -1), ('L', 1)):
        Hp = np.array([2.2 * sx, 0.0, 12.0])
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
    hip_z = pose['hip_z'] if 'hip_z' in pose else 12.0 + 1.15 - min(l[2][2] for l in legs.values())
    dz = hip_z - 12.0

    body = fcompose(move((0, 0, dz)), about(rotx(deg(pose.get('tilt', 0.0))), pose.get('tilt_pivot', (0, 0, 9.0))))
    rel_torso = fcompose(move((0, 0, pose.get('bob_extra', 0.0))),
                         about(rotz(deg(pose.get('twist', 0.0))) @ rotx(deg(pose.get('lean', 0.0))), HIP))
    torso = fcompose(body, rel_torso)
    head = fcompose(torso, about(rotx(deg(pose.get('head_tilt', 0.0))), NECK))
    CB, CT, CH = coords(body), coords(torso), coords(head)

    for side in ('R', 'L'):
        Hp, K, A = legs[side]
        put(capsule(CB, Hp, K, 1.55, 1.45), 8)
        put(capsule(CB, K, K + 0.35 * (A - K), 1.45), 8)
        put(capsule(CB, K + 0.35 * (A - K), A, 1.7, 1.6), 9)                     # boot shaft
        fd = np.asarray(pose.get('foot' + side, (0, -1.0, 0)), float)
        fd /= np.linalg.norm(fd)
        lift = A[2] + dz - 1.15
        put(capsule(CB, A - 0.9 * fd + [0, 0, -0.2], A + 2.0 * fd + [0, 0, -0.4 + 0.3 * lift], 1.25), 9)

    # ---- torso, in torso coordinates (same shapes as the walk model), by the chest's weight
    chest = KIT['chest']
    front, back, skirt = {'plate': (1, 2, 2), 'leather': (16, 16, 16), 'cloth': (15, 15, 15)}[chest]
    x, y, z = CT
    cy = torso_cy(z)
    skirt_z0 = 9.0 if chest == 'cloth' else 10
    put((((x / 5.0) ** 2 + ((y - cy) / 3.2) ** 2) < 1) & (z >= skirt_z0) & (z < 13.6), skirt)  # skirt
    if chest == 'cloth':                                                                       # the hem
        put((((x / 5.05) ** 2 + ((y - cy) / 3.25) ** 2) < 1) & (z >= skirt_z0) & (z < skirt_z0 + 0.9), 60)
    put((((x / 4.9) ** 2 + ((y - cy) / 3.15) ** 2) < 1) & (z >= 13.5) & (z < 15), 9)          # belt
    put((np.abs(x) < 0.9) & (y < cy - 2.2) & (y > cy - 3.6) & (z >= 13.5) & (z < 15), 60)     # buckle
    rx = 4.9 + (np.clip(z, 15, 22) - 15) * 0.12
    if chest == 'cloth':
        rx = rx - 0.3
    tor = (((x / rx) ** 2 + ((y - cy) / 3.0) ** 2) < 1) & (z >= 15) & (z < 23)
    tor &= ~((z > 21.5) & (((x / rx) ** 2) > 0.55))
    put(tor & (y < cy + 0.4), front)
    put(tor & (y >= cy + 0.4), back)
    if chest == 'leather':     # crossed straps on the jerkin
        put(tor & (y < cy - 1.6) & (np.abs(np.abs(x) - (z - 15) * 0.55) < 0.45), 60)
    if chest == 'plate':       # a gilt band along the cuirass's lower edge
        put(tor & (y < cy + 0.4) & (z < 15.9), 60)
    neck = 1 if chest == 'plate' else 13
    put((((x / 2.4) ** 2 + ((y - torso_cy(23)) / 2.2) ** 2) < 1) & (z >= 22.5) & (z < 23.6), neck)  # gorget / neck
    if chest == 'cloth':       # the collar's edge
        put((((x / 2.6) ** 2 + ((y - torso_cy(23)) / 2.4) ** 2) < 1) & (z >= 22.5) & (z < 23.0), 60)

    # ---- head, in head coordinates: the bare head always, a helmet over it on its own layer
    hx_, hy_, hz_ = CH
    hcy, hz0, hz1 = HELM_CY, 23.2, 28.4
    ddx, ddy = np.abs(hx_), np.abs(hy_ - hcy)
    skull = ball(CH, (0, hcy, 26.2), 2.75)
    put(skull, 13)
    put(skull & ((hz_ > 26.9) | (hy_ > hcy + 0.6)), 14)                                     # hair
    put(skull & (hy_ < hcy - 2.0) & (ddx > 0.6) & (ddx < 1.6) & (hz_ >= 25.9) & (hz_ < 26.7), 10)  # eyes
    helm = KIT['helm']
    if helm == 'helm':
        box = ((ddx / 3.3) ** 4 + (ddy / 3.3) ** 4 < 1) & (hz_ >= hz0) & (hz_ < hz1)
        dome = (ddx ** 2 + ddy ** 2 + ((hz_ - hz1) * 1.25) ** 2 < 3.3 ** 2) & (hz_ >= hz1)
        put(box | dome, 30)
        put(box & (hy_ < hcy - 2.3) & (ddx < 2.1) & (hz_ >= 26.0) & (hz_ < 27.0), 35)       # eye slit
        put(box & (hy_ < hcy - 2.3) & (hz_ >= 23.2) & (hz_ < 24.0), 36)                      # faceplate band
        put(box & (hz_ >= 27.6) & (hz_ < 28.4), 61)                                          # brow band
        sway = pose.get('plume', 0.0)
        pts = [(0, hcy - 0.6, 30.6), (0, hcy + 0.2, 33.4), (0, hcy + 1.6 + 0.3 * sway, 35.4),
               (0, hcy + 3.4 + 0.6 * sway, 36.0 - 0.2 * sway), (0, hcy + 5.4 + 0.9 * sway, 35.0 - 0.5 * sway)]
        rads = [2.0, 2.3, 2.1, 1.7, 1.1]
        for i in range(len(pts) - 1):
            put(capsule(CH, pts[i], pts[i + 1], rads[i], rads[i + 1]), 33)
        put(capsule(CH, (0, hcy, 30.6), (0, hcy + 0.2, 31.4), 1.2), 61)                     # plume cup
    elif helm == 'cap':        # an open-faced iron cap with a nasal
        cap = ball(CH, (0, hcy, 26.4), 3.25) & (hz_ >= 26.6)
        put(cap, 30)
        put(cap & (hz_ < 27.3), 61)                                                          # its rim
        put(capsule(CH, (0, hcy - 3.0, 27.0), (0, hcy - 3.1, 25.2), 0.45), 30)              # nasal
    elif helm == 'hood':       # a cowl over the head and shoulders, open at the face
        shell = ball(CH, (0, hcy + 0.3, 26.4), 3.6) & ~ball(CH, (0, hcy + 0.3, 26.4), 2.9)
        face = (hy_ < hcy - 1.2) & (ddx < 2.0) & (hz_ > 24.2) & (hz_ < 27.6)
        put(shell & ~face, 31)
        put(shell & ~face & (hy_ < hcy - 1.0) & (ddx < 2.6) & (hz_ > 23.8) & (hz_ < 28.2) &
            ~((hy_ < hcy - 1.6) & (ddx < 2.3) & (hz_ > 23.9) & (hz_ < 27.9)), 61)            # the edge round the face
        put(capsule(CH, (0, hcy + 2.6, 26.0), (0, hcy + 3.4, 23.0), 2.4, 3.0) & (hz_ < 25.6), 31)   # the drape

    # ---- pauldrons: steel on plate, small leather caps on leather, none on cloth
    for sx in (-1, 1):
        if chest == 'cloth':
            break
        c = np.array([5.6 * sx, float(torso_cy(21)) + 0.2, 21.3])
        d2 = (x - c[0]) ** 2 + ((y - c[1]) * 1.1) ** 2 + ((z - c[2]) * 1.2) ** 2
        r = 3.1 if chest == 'plate' else 2.6
        put((d2 < r ** 2) & (z > 19.4), front)
        put((d2 < r ** 2) & (d2 > (r - 0.7) ** 2) & (z > 19.4) & (z < 20.3), 60)            # rim

    # ---- arms (torso coordinates)
    a = pose.get('arm', 0.0)
    arms = {}
    for side, sx in (('R', -1), ('L', 1)):
        S = SHOULDER[sx]
        if 'hand' + side in pose:
            tgt = np.asarray(pose['hand' + side], float)
            if pose.get('hand_frame', 'torso') == 'body':
                tgt = to_local(rel_torso, tgt)
            pole = pose.get('pole' + side, (sx * 1.0, 0.3, -0.6))
            el, hd = two_bone(S, tgt, UPPER_ARM, FOREARM, pole)
        elif sx < 0:   # the walk model's sword arm, driven by the swing amount
            el = np.array((-6.8, float(torso_cy(17)) - 0.2 - 1.0 * a, 16.6 + 0.2 * abs(a)))
            hd = np.array((-7.0, -2.8 - 2.0 * a, 13.6 + 0.6 * max(a, 0)))
        else:
            el = np.array((6.9, float(torso_cy(17)) - 0.2 + 0.4 * a, 16.8))
            hd = np.array((6.3, -3.4 + 0.7 * a, 15.4))
        upper, fore = {'plate': (2, 1), 'leather': (16, 9), 'cloth': (15, 15)}[chest]
        put(capsule(CT, S, el, 1.35), upper)
        put(capsule(CT, el, hd, 1.35, 1.25), fore)
        if chest == 'cloth':   # a cuff at the wrist
            put(capsule(CT, el + 0.8 * (hd - el), el + 0.95 * (hd - el), 1.4), 60)
        arms[side] = (S, el, hd)

    # ---- the weapon (its type's model; daggers come in pairs, the bow sits in the shield hand)
    sword = pose.get('sword', 'hand')
    weapon = KIT['weapon']
    if sword == 'hand' and weapon != 'none':
        sd = np.asarray(pose.get('sword_dir', (-0.30, -0.40 - 0.25 * a, -0.87)), float)
        if 'sword_dir' not in pose and weapon in ('spear', 'staff'):
            # Carried upright at rest: the spear's head and the staff's ember above the shoulder.
            sd = np.array((-0.05, -0.22, 1.0)) if weapon == 'spear' else np.array((0.05, 0.22, -1.0))
        if weapon == 'bow':
            draw_bow(put, CT, arms['L'][2], (0.15, -0.1, 1.0), (0.3, -1.0, 0.0))
        else:
            draw_weapon(put, CT, arms['R'][2], sd)
        if weapon == 'daggers':
            draw_dagger(put, CT, arms['L'][2], sd * np.array([-1.0, 1.0, 1.0]))
    elif sword == 'lap' and weapon != 'none':
        g = pose.get('lap_grip', (-6.6, -4.4, 14.6))
        draw_weapon(put, CB, g, (1.0, 0.04, 0.0), ref=(0, 0, 1.0))

    # ---- shield: only with the sword (sword and board); other weapons leave the hand free
    sh = pose.get('shield', {})
    if weapon != 'sword':
        pass
    elif 'body_center' in sh:
        draw_shield(put, CB, np.asarray(sh['body_center'], float), sh['normal'])
    else:
        sc = arms['L'][2] + np.asarray(sh.get('offset', (1.8, -0.3, 0.0)))
        draw_shield(put, CT, sc, sh.get('normal', (0.55, -0.83, 0.08)))

    # ---- flask
    if 'flask' in pose:
        b, t = (np.asarray(p, float) for p in pose['flask'])
        put(capsule(CT, b, b + 0.75 * (t - b), 1.15), 12)
        put(capsule(CT, b + 0.75 * (t - b), t, 0.5), 12)
        put(capsule(CT, t, t + 0.2 * (t - b), 0.6), 9)                                       # cork

    # ---- cape (torso coordinates)
    wrap, spread = pose.get('cape_wrap', 0.0), pose.get('cape_spread', 0.0)
    flare, ph = pose.get('flare', 0.0), pose.get('phase', 0.0)
    zc0, zc1 = 6.5 + 6.0 * wrap, 23.0
    curv = 1.9 + 5.0 * wrap
    w = (5.8 + (zc1 - z) * 0.14) * (1 + 0.25 * wrap + 0.3 * spread)
    FOLD = 0.45 * np.clip((zc1 - z) / 8, 0, 1)
    yback = (torso_cy(z) * 0.35 + 3.1 + (zc1 - z) * (0.10 + 0.07 * flare)
             - (np.clip(np.abs(x) / w, 0, 1) ** 2) * curv + FOLD * np.sin(x * 1.25 + ph))
    cape = (np.abs(x) < w) & (y > yback) & (y < yback + 1.0 + 1.2 * wrap) & (z >= zc0) & (z < zc1)
    hemz = zc0 + HEM[np.clip(np.floor(x).astype(int) + 16, 0, 31)] + 0.6 * flare
    cape &= z >= hemz
    for (tx, tz, tr) in [(2.3, 10.0, 0.8), (-3.1, 12.5, 0.6)]:
        cape &= ~(((x - tx) ** 2 + (z - tz) ** 2) < tr ** 2)
    put(cape, 3)
    collar = (((x / 5.2) ** 2 + ((y - torso_cy(23) - 0.6) / 3.3) ** 2) < 1) & (z >= 22.3) & (z < 23.6) & (y > torso_cy(23) + 0.3)
    put(collar & (M == 0), 3)
    # cloth normals come from the cape's own shape, turned into world space
    fx = 2 * curv * x / w ** 2 - FOLD * 1.25 * np.cos(x * 1.25 + ph)
    Rt = torso[0]
    ln = (fx, np.ones_like(x), 0.10 + 0.07 * flare + 0 * x)
    CN = np.stack([Rt[i, 0] * ln[0] + Rt[i, 1] * ln[1] + Rt[i, 2] * ln[2] for i in range(3)], -1)

    # ---- drop to the ground (roll, dead)
    shift_k = 0
    if pose.get('ground'):
        ks = np.where((M > 0).any(axis=(0, 1)))[0]
        shift_k = int(ks.min()) - int(round((0.25 - zs[0]) / RES))   # lowest voxel centre at z = 0.25
        M = np.roll(M, -shift_k, axis=2)
        CN = np.roll(CN, -shift_k, axis=2)
        if shift_k < 0:
            M[:, :, :(-shift_k)] = 0
        elif shift_k > 0:
            M[:, :, M.shape[2] - shift_k:] = 0
    drop = -shift_k * RES

    # ---- props placed in the world after landing
    if sword == 'ground' and weapon != 'none':
        hand_w = to_world(torso, arms['R'][2]) + [0, 0, drop]
        g = np.array([hand_w[0] - 1.5, hand_w[1] + 1.0, 0.7])
        draw_weapon(put, (X, Y, Z), g, pose.get('ground_dir', (-0.25, -1.0, 0.0)), ref=(0, 0, 1.0))

    # ---- normals: blurred occupancy gradient, cloth replaced by its analytic normal
    occ = gauss3d((M > 0).astype(float), 1.6)
    gx, gy, gz = np.gradient(occ)
    N = -np.stack([gx, gy, gz], -1)
    N /= (np.linalg.norm(N, axis=-1, keepdims=True) + 1e-9)
    CN /= (np.linalg.norm(CN, axis=-1, keepdims=True) + 1e-9)
    N[M == 3] = CN[M == 3]

    return {'ankles': {k: v[2] for k, v in legs.items()}, 'hip_z': hip_z,
            'hands': {k: to_world(torso, v[2]) + [0, 0, drop] for k, v in arms.items()}}

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
    return img, lvl, out_mat


# ---------------------------------------------------------------- animations
DIRECTIONS = [('down', 0), ('down_right', 45), ('right', 90), ('up_right', 135),
              ('up', 180), ('up_left', 225), ('left', 270), ('down_left', 315)]

STAND = dict(legR=(3, 0), legL=(-3, 0), arm=0.0, flare=0.0, phase=0.0, plume=0.0)

# walk: contact / passing / contact / passing, stride widened from ~8 px to ~13 px
CONTACT_R = dict(legR=(42, 18), legL=(-40, -48), arm=-1.0, flare=1.0, plume=1.0)
CONTACT_L = dict(legR=(-40, -48), legL=(42, 18), arm=1.0, flare=1.0, plume=1.0)
PASS_R = dict(legR=(2, 0), legL=(18, -52), arm=0.0, flare=0.4, plume=0.2)
PASS_L = dict(legR=(18, -52), legL=(2, 0), arm=0.0, flare=0.4, plume=0.2)

TUCKED_SHIELD = dict(offset=(1.4, 0.6, 0.0), normal=(0.92, 0.38, 0.0))
ATTACK_LEGS = dict(legR=(-14, -10), legL=(16, 6))
TUCK = dict(legR=(122, -28), legL=(118, -32), lean=70, head_tilt=40,
            handR=(-3.0, -7.0, 13.0), handL=(3.5, -7.0, 13.5), poleR=(-1, 0.4, -0.3), poleL=(1, 0.4, -0.3),
            sword_dir=(-0.1, 0.65, -0.75),
            shield=dict(offset=(1.2, -0.6, 0.0), normal=(0.5, -0.86, 0.0)), ground=True, tilt_pivot=(0, -3, 13))

def P(*dicts, **kw):
    out = {}
    for d in dicts:
        out.update(d)
    out.update(kw)
    return out

# ---- class-ability casts. The game stretches each to its ability's cast length, so the frame
# listed in CAST_RELEASE lands exactly when the effect hits; fps only sets the default pace.
def forearm_shield(hand, pole, out=(1.0, 0.0, 0.0), along=0.35, lift=1.1):
    """Shield placement for a left-hand target: on the forearm, a little out from it, facing out."""
    el, hd = two_bone(SHOULDER[1], hand, UPPER_ARM, FOREARM, pole)
    f = (el - hd) / np.linalg.norm(el - hd)
    n = np.asarray(out, float)
    n = n - (n @ f) * f
    n /= np.linalg.norm(n)
    return dict(offset=tuple(round(float(v), 2) for v in (el - hd) * along + n * lift),
                normal=tuple(round(float(v), 2) for v in n))

# cast_slam: down on one knee, the sword point driven into the ground in front of him
DOWN_KNEE = dict(hip_z=7.0, kneeL=(2.4, -5.0, 10.6), ankleL=(2.4, -5.4, 6.15),
                 kneeR=(-2.2, 1.6, 6.1), ankleR=(-2.2, 6.6, 6.0), footR=(0, 1.0, -0.25),
                 lean=8, twist=0, hand_frame='body', handR=(-2.8, -8.0, 18.0), poleR=(-1, 0.4, -0.5),
                 sword_dir=(-0.1, -0.38, -0.92), handL=(4.0, -4.6, 13.0), head_tilt=18,
                 shield=dict(offset=(1.4, 0.2, 0.0), normal=(0.9, -0.4, 0.1)))

# cast_throw: a lob with the left (shield) hand; the hand is empty, the game draws the object
TH0, TH1, TH2, TH3 = (5.6, 4.4, 12.2), (3.8, -7.2, 20.0), (2.2, -7.4, 16.4), (5.8, -2.6, 15.0)
PL0, PL1, PL2, PL3 = (1, 0.4, -0.4), (1, 0.2, -0.8), (1, 0.2, -0.8), (1, 0.3, -0.6)

# cast_charge: shield squared to the front (it faces dead ahead with the torso turned -25)
SQUARE = dict(offset=(-0.4, -1.3, 0.0), normal=(0.42, -0.91, 0.0))
CHARGE_BODY = dict(lean=30, twist=-25, head_tilt=22, handL=(2.4, -6.0, 18.6), poleL=(1, 0.6, -0.4), shield=SQUARE,
                   handR=(-6.6, 3.2, 15.0), poleR=(-1, 0.4, -0.6), sword_dir=(-0.15, 0.75, -0.64), plume=1.2, flare=1.2)

# cast_raise: the sword raised straight up beside the helm (the hand can't reach above it)
RAISE_UP = dict(legR=(4, 0), legL=(-4, 0), lean=-6, head_tilt=-14, handR=(-4.4, -1.6, 27.6), poleR=(-1, 0.2, -0.2),
                sword_dir=(0.0, 0.06, 1.0), handL=(6.8, -2.0, 16.0))

ANIMATIONS = [
    # (name, poses, fps, loop)
    ('idle', [P(STAND),
              P(STAND, bob_extra=-1.0, plume=0.4, phase=0.35)], 2, True),
    ('walk', [P(CONTACT_R, phase=0.0), P(PASS_R, phase=0.8),
              P(CONTACT_L, phase=1.6), P(PASS_L, phase=2.4)], 10, True),
    ('attack', [
        # wind back: sword shoulder drawn back, empty hand cocked behind
        P(ATTACK_LEGS, twist=-30, lean=2, handR=(-7.5, 3.5, 19.5), poleR=(-1, 0.6, -0.8),
          handL=(5.2, 2.2, 14.0), poleL=(1, 1, -0.5), shield=TUCKED_SHIELD, sword=None, flare=0.3, plume=0.4),
        # strike: hand extended along the facing at about 13 px (the hit window)
        P(ATTACK_LEGS, twist=20, lean=8, handR=(-3.0, -10.0, 16.0), poleR=(-1, 0.3, -1),
          handL=(5.2, 2.2, 14.0), poleL=(1, 1, -0.5), shield=TUCKED_SHIELD, sword=None, flare=0.8, plume=0.9),
        # follow-through: carried across to the shield side, low
        P(ATTACK_LEGS, twist=40, lean=10, handR=(2.5, -7.0, 13.0), poleR=(-0.6, 0.2, -1),
          handL=(5.2, 2.2, 14.0), poleL=(1, 1, -0.5), shield=TUCKED_SHIELD, sword=None, flare=1.0, plume=1.0, phase=0.6),
    ], 12, False),
    ('roll', [
        P(legR=(62, -45), legL=(56, -48), lean=24, head_tilt=12, handR=(-5.0, -6.5, 13.0), handL=(5.0, -6.0, 14.0),
          sword_dir=(-0.2, 0.5, -0.85), shield=dict(offset=(1.4, -0.6, 0), normal=(0.6, -0.8, 0)),
          flare=0.6),                                                         # crouch
        P(TUCK, tilt=85, cape_wrap=0.7, phase=0.5),                           # tuck, cape wrapped
        P(TUCK, tilt=200, cape_wrap=1.0, phase=1.0),                          # mid-roll
        P(legR=(80, -40), legL=(70, -45), lean=35, head_tilt=10, tilt=-25, ground=True,
          handR=(-5.5, -5.5, 14.0), handL=(5.5, -5.0, 15.0), sword_dir=(-0.2, 0.5, -0.85),
          shield=dict(offset=(1.4, -0.6, 0), normal=(0.6, -0.8, 0)), cape_wrap=0.3, flare=0.5, phase=1.5),  # coming up
    ], 14, False),
    ('drink', [
        P(STAND, sword=None, handR=(-1.6, -6.6, 24.2), poleR=(-1, 0.2, -1),
          flask=((-0.4, -7.2, 23.4), (-0.4, -7.2, 26.6))),                     # flask to the eye slit
        P(STAND, sword=None, head_tilt=-22, lean=-6, handR=(-1.6, -6.4, 27.0), poleR=(-1, 0.2, -1),
          flask=((-0.4, -7.6, 29.6), (-0.4, -5.6, 27.0)), plume=0.6),          # tipped, head back
    ], 3, False),
    ('sit', [
        P(hip_z=2.4, lean=12, head_tilt=8,
          kneeR=(-7.0, -3.6, 11.0), ankleR=(2.6, -5.2, 10.6), footR=(1.0, -0.2, 0),
          kneeL=(7.0, -3.6, 11.0), ankleL=(-2.6, -4.4, 11.0), footL=(-1.0, -0.2, 0),
          hand_frame='body', handR=(-4.0, -5.0, 15.6), handL=(5.5, -4.6, 15.2),
          sword='lap', lap_grip=(-6.8, -4.6, 14.6),
          shield=dict(body_center=(9.6, 1.5, 13.8), normal=(0.8, 0.25, 0.55)), flare=-0.6),
    ], 1, True),
    ('dead', [
        P(legR=(-4, 6), legL=(8, 14), tilt=90, tilt_pivot=(0, 0, 16), ground=True, head_tilt=-10,
          handR=(-10.5, -2.5, 23.0), poleR=(-1, 1, 0), handL=(7.8, 0.5, 13.0),
          shield=dict(offset=(1.2, 0.0, 0.0), normal=(1.0, 0.1, -0.2)),
          sword='ground', cape_spread=1.0, flare=-0.8),
    ], 1, False),
    ('hurt', [
        P(legR=(-18, -12), legL=(10, 4), lean=-18, head_tilt=-16, twist=-8,
          handR=(-9.0, -1.5, 18.5), poleR=(-1, 1, -0.5), sword_dir=(-0.5, 0.3, -0.8),
          handL=(8.5, -2.5, 18.0), shield=dict(offset=(1.6, -0.6, 0.4), normal=(0.5, -0.85, 0.2)),
          flare=-0.4, plume=-0.5),
    ], round(1000 / 233, 2), False),
    ('cast_slam', [
        # 0 gather: crouched, sword drawn back up over the right shoulder, shield braced
        P(legR=(52, -44), legL=(46, -52), lean=20, twist=-24, head_tilt=10, handR=(-6.0, 2.2, 22.4), poleR=(-1, 0.6, -0.6),
          sword_dir=(-0.15, 0.55, 0.82), handL=(4.4, -5.2, 17.4), shield=dict(offset=(-0.4, -1.0, 0.0), normal=(0.25, -0.97, 0.0)),
          flare=0.3, plume=0.3),
        # 1 apex: up on the toes, sword high above the helm
        P(legR=(6, 0), legL=(-4, 0), hip_z=13.4, footR=(0, -0.6, -0.8), footL=(0, -0.6, -0.8), lean=-6, twist=-8, head_tilt=-10,
          handR=(-4.4, -1.2, 27.4), poleR=(-1, 0.2, -0.3), sword_dir=(0.0, 0.18, 0.98), handL=(6.6, -2.4, 16.6),
          shield=dict(offset=(1.6, 0.0, 0.0), normal=(0.75, -0.65, 0.1)), flare=0.6, plume=0.6),
        P(DOWN_KNEE, flare=1.8, cape_spread=0.4, phase=1.0, plume=1.2),         # 2 RELEASE: knee down, cape flared
        P(DOWN_KNEE, flare=0.8, cape_spread=0.2, phase=1.4, plume=0.6),         # 3 hold: the cape settling
        # 4 recover: rising from the knee, the sword coming up out of the ground
        P(hip_z=9.6, kneeL=(2.4, -4.4, 8.9), ankleL=(2.4, -4.8, 3.55), kneeR=(-2.2, 0.4, 6.4), ankleR=(-2.2, 4.4, 3.55),
          footR=(0, 1.0, -0.4), lean=14, head_tilt=6, hand_frame='body', handR=(-3.4, -6.0, 18.4), poleR=(-1, 0.4, -0.5),
          sword_dir=(-0.1, -0.45, -0.89), handL=(5.4, -3.6, 15.4), shield=dict(offset=(1.6, -0.2, 0.0), normal=(0.75, -0.65, 0.1)),
          flare=0.4, phase=1.8),
    ], 15, False),
    ('cast_throw', [
        P(legR=(10, 4), legL=(-16, -10), lean=-6, twist=30, head_tilt=4, handL=TH0, poleL=PL0,
          shield=forearm_shield(TH0, PL0), flare=0.2),                             # 0 reach back, weight on the back foot
        P(legR=(30, 12), legL=(-22, -30), lean=8, twist=-20, handL=TH1, poleL=PL1,
          shield=forearm_shield(TH1, PL1), flare=0.7, plume=0.5),                  # 1 RELEASE: hand open at the shoulder, stepping
        P(legR=(30, 12), legL=(-26, -40), lean=16, twist=-30, head_tilt=4, handL=TH2, poleL=PL2,
          shield=forearm_shield(TH2, PL2), flare=0.9, plume=0.7),                  # 2 follow-through, leaning in
        P(legR=(12, 4), legL=(-6, -4), lean=4, twist=-8, handL=TH3, poleL=PL3,
          shield=forearm_shield(TH3, PL3), flare=0.4),                             # 3 recover
    ], 17, False),
    ('cast_charge', [
        P(legR=(-22, -36), legL=(38, -28), lean=22, twist=-25, head_tilt=16, handL=(2.6, -5.6, 18.0), poleL=(1, 0.6, -0.4),
          shield=SQUARE, handR=(-6.6, 3.0, 15.4), poleR=(-1, 0.4, -0.6), sword_dir=(-0.15, 0.75, -0.64),
          flare=0.4, plume=0.4),                                                   # 0 brace: low, shield squared, sword hand back
        P(CHARGE_BODY, legR=(-42, -76), legL=(48, 22), phase=0.4),                # 1 RELEASE / run A (the game loops 1-2)
        P(CHARGE_BODY, legR=(48, 22), legL=(-42, -76), phase=1.2),                # 2 run B
    ], 12, False),
    ('cast_push', [
        P(legR=(12, -6), legL=(10, -8), lean=12, bob_extra=-1.2, head_tilt=15,
          handR=(-2.8, -4.0, 18.6), poleR=(-1, 0.2, -1), sword_dir=(-0.05, 0.1, 0.99),
          handL=(2.8, -4.4, 18.8), poleL=(1, 0.2, -1), shield=dict(offset=(-0.5, -1.0, 0.0), normal=(0.1, -1.0, 0.0)),
          flare=0.2),                                                              # 0 gather: arms drawn in, hunched
        P(legR=(-14, -10), legL=(20, 6), lean=-8, head_tilt=-12,
          handR=(-12.4, -0.5, 19.0), poleR=(0, 1, -1), sword_dir=(-0.45, 0.05, -0.89),
          handL=(2.2, -7.6, 19.4), poleL=(1, 0.4, -0.6), shield=dict(offset=(-0.4, -1.2, 0.0), normal=(0.05, -1.0, 0.05)),
          flare=2.2, plume=1.6, phase=1.2),                                        # 1 RELEASE: shield out, sword arm wide
        P(legR=(-6, -4), legL=(8, 2), lean=2, handR=(-7.6, -1.6, 15.0), handL=(6.0, -3.4, 15.4),
          flare=0.8, plume=0.6, phase=1.6),                                        # 2 recover
    ], 15, False),
    ('cast_raise', [
        P(legR=(4, 0), legL=(-4, 0), lean=10, head_tilt=28, bob_extra=-0.6,
          handR=(1.5, -4.8, 13.2), poleR=(-1, 0.3, -0.5), sword_dir=(0.85, -0.25, -0.45),
          handL=(5.2, -3.2, 14.5)),                                                # 0 gather: head bowed, sword low across
        P(legR=(4, 0), legL=(-4, 0), lean=2, head_tilt=6, handR=(-3.0, -3.0, 22.0), poleR=(-1, 0.4, -0.4),
          sword_dir=(0.2, -0.35, 0.92), handL=(5.8, -2.8, 15.2), flare=0.4),     # 1 rise
        P(RAISE_UP, flare=1.4, phase=0.8, plume=0.8),                              # 2 RELEASE: sword up, head back, cape lifting
        P(RAISE_UP, bob_extra=-0.4, head_tilt=-11, flare=0.9, phase=1.0, plume=0.5),   # 3 hold until the cast ends
    ], 10, False),
]

# Every animation is fitted: the sword tip and trailing foot reach below the ground line
# in some directions (idle and walk included). The shift is (0, 0) wherever nothing clips.
FIT = {name for name, *_ in ANIMATIONS}

# pivots in pixels relative to the anchor (x right, y down)
PIVOTS = {'swing': [0, -13]}   # body centre: where the game draws the sword arc

# the RELEASE frame of each cast, counted from 0 within the animation (written as `release`)
CAST_RELEASE = {'cast_slam': 2, 'cast_throw': 1, 'cast_charge': 1, 'cast_push': 1, 'cast_raise': 2}

def project(p_world, theta):
    """Pixel position of a world point relative to the anchor (24, 48), x right, y down, fit not applied."""
    w = rot(np.asarray(p_world, float)[None], theta)[0]
    sx = w[0]
    sy = w[1] * np.sin(PHI) + w[2] * np.cos(PHI)
    return sx, (FOOT_ROW - sy) - H

# ---------------------------------------------------------------- fitting
def screen_extent(theta):
    occ = np.argwhere(M > 0)
    p = np.stack([xs[occ[:, 0]], ys[occ[:, 1]], zs[occ[:, 2]]], -1)
    w = rot(p, theta)
    sx = w[:, 0]
    sy = w[:, 1] * np.sin(PHI) + w[:, 2] * np.cos(PHI)
    return sx.min(), sx.max(), sy.min(), sy.max()

def whole_px(v):
    """Round a shift to whole pixels, away from zero, so the silhouette still fits and the
    game can undo the shift exactly."""
    return float(np.sign(v) * np.ceil(abs(v) - 1e-9))


def fit_shift(extents):
    """Smallest whole-pixel shift that keeps a silhouette inside the 48x48 frame.

    Returns (dx, dsy): screen pixels right and up. The game draws the animation at
    (-dx, +dsy) from the anchor (the JSON `offset`), so the body stays where it lies.
    """
    x0, x1 = min(e[0] for e in extents), max(e[1] for e in extents)
    y0, y1 = min(e[2] for e in extents), max(e[3] for e in extents)
    lim_x, lo_y, hi_y = 22.0, -1.0, 43.5
    dx = 0.0
    if x1 - x0 > 2 * lim_x:
        dx = float(round(-(x0 + x1) / 2))
    elif x1 > lim_x:
        dx = whole_px(lim_x - x1)
    elif x0 < -lim_x:
        dx = whole_px(-lim_x - x0)
    dsy = 0.0
    if y0 < lo_y:
        dsy = whole_px(lo_y - y0)
    elif y1 > hi_y:
        dsy = whole_px(hi_y - y1)
    return dx, dsy

def render_shifted(theta, dx, dy):
    """Render with the model moved by (dx, dy) in world space.

    The voxels are not moved: the grid's origin is offset for this one render, so
    nothing can be pushed off the edge of the grid and lost.
    """
    global xs, ys
    if dx == 0 and dy == 0:
        return render(np.degrees(theta))
    v = rot(np.array([[dx, dy, 0.0]]), -theta)[0]
    xs0, ys0 = xs, ys
    xs, ys = xs0 + v[0], ys0 + v[1]
    try:
        return render(np.degrees(theta))
    finally:
        xs, ys = xs0, ys0

# ---------------------------------------------------------------- kits and layers
# Every kit renders the same rows in the same order, so every sheet shares player.json's frame layout
# (the layer sheets say `"layout": "player"`). Each kit is rendered whole and cut into layers: a layer keeps
# only its materials' visible pixels (plus their outline), so whatever stood in front of a piece in the render
# already hides it, in every direction. The game stacks: body, legs, chest trim, helmet, helmet trim, weapon.
BODY = dict(helm='none', weapon='none')
WEARER = dict(chest='leather', helm='none', weapon='none')
KITS = {
    'cloth':   (dict(BODY, chest='cloth'),   {'player': 'all', 'player_legs': 'legs', 'player_trim_cloth': 'trim60'}),
    'leather': (dict(BODY, chest='leather'), {'player_leather': 'all', 'player_trim_leather': 'trim60'}),
    'plate':   (dict(BODY, chest='plate'),   {'player_plate': 'all', 'player_trim_plate': 'trim60'}),
    'hood':    (dict(WEARER, helm='hood'),   {'player_hood': 'helm', 'player_hood_trim': 'trim61'}),
    'cap':     (dict(WEARER, helm='cap'),    {'player_cap': 'helm', 'player_cap_trim': 'trim61'}),
    'helm':    (dict(WEARER, helm='helm'),   {'player_helm': 'helm', 'player_helm_trim': 'trim61'}),
    **{w: (dict(WEARER, weapon=w), {f'player_{w}': 'weapon'})
       for w in ('sword', 'spear', 'hammer', 'daggers', 'bow', 'staff')},
}

def neighbors_in(mask):
    out = np.zeros_like(mask)
    for di, dj in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        out |= np.pad(mask, 1)[1 - di:1 - di + mask.shape[0], 1 - dj:1 - dj + mask.shape[1]]
    return out

def cut(kind, img, lvl, mat):
    """One layer out of a composed frame."""
    if kind == 'all':
        return img
    out = np.zeros_like(img)
    if kind in ('trim60', 'trim61'):
        sel = mat == int(kind[4:])
    elif kind == 'legs':                       # the trousers, in grays for the game to tint
        sel = mat == 8
        for l in range(4):
            s2 = sel & (lvl == l)
            out[s2, :3] = GRAY[l]
            out[s2, 3] = 255
        return out
    else:
        group = HELM_MATS if kind == 'helm' else WEAPON_MATS
        sel = np.isin(mat, list(group))
        sel = sel | ((mat == 0) & (img[..., 3] > 0) & neighbors_in(sel))   # and the outline round it
    out[sel] = img[sel]
    return out

def kit_extents(name):
    """Pass 1: every pose's screen extent in every direction, for the shared fit."""
    KIT.update(KITS[name][0])
    ext = {}
    for anim, poses, _fps, _loop in ANIMATIONS:
        for pose in poses:
            build(pose)
            for d, ang in DIRECTIONS:
                ext.setdefault(f'{anim}/{d}', []).append([float(v) for v in screen_extent(np.radians(ang))])
    return name, ext

def kit_render(args):
    """Pass 2: render the kit with the shared shifts and write its layers. Returns the cast_throw pivots."""
    name, shifts, out_dir = args
    KIT.update(KITS[name][0])
    outputs = KITS[name][1]
    rows = {sheet: [] for sheet in outputs}
    throw = {}
    for anim, poses, _fps, _loop in ANIMATIONS:
        for fi, pose in enumerate(poses):
            info = build(pose)
            if anim == 'cast_throw' and fi == CAST_RELEASE[anim]:
                throw_hand = info['hands']['L']            # the open hand at release
                for d, ang in DIRECTIONS:
                    throw[d] = [int(round(v)) for v in project(throw_hand, np.radians(ang))]
            frames = {sheet: [] for sheet in outputs}
            for d, ang in DIRECTIONS:
                dx, dsy = shifts[f'{anim}/{d}']
                img, lvl, mat = compose(*render_shifted(np.radians(ang), dx, dsy / np.sin(PHI)))
                for sheet, kind in outputs.items():
                    frames[sheet].append(Image.fromarray(cut(kind, img, lvl, mat), 'RGBA'))
            for sheet in outputs:
                rows[sheet].append(frames[sheet])
    for sheet, sheet_rows in rows.items():
        im = Image.new('RGBA', (W * 8, H * len(sheet_rows)), (0, 0, 0, 0))
        for r, imgs in enumerate(sheet_rows):
            for c, fr in enumerate(imgs):
                im.paste(fr, (c * W, r * H))
        im.save(os.path.join(out_dir, f'{sheet}.png'))
        if sheet != 'player':
            with open(os.path.join(out_dir, f'{sheet}.json'), 'w', encoding='utf-8', newline='\n') as f:
                f.write(json.dumps({'image': f'{sheet}.png', 'layout': 'player'}, indent=2) + '\n')
    print(f'{name}: {", ".join(outputs)}', flush=True)
    return name, throw

# ---------------------------------------------------------------- export
def generate(out_dir='.', kits=None):
    from multiprocessing import Pool
    names = list(kits or KITS)
    os.makedirs(out_dir, exist_ok=True)
    with Pool(min(len(KITS), os.cpu_count() or 4)) as pool:
        # The fit is shared by every kit (always measured over all of them), so the layers line up.
        merged = {}
        for _name, ext in pool.map(kit_extents, list(KITS)):
            for key, es in ext.items():
                merged.setdefault(key, []).extend(es)
        shifts = {key: fit_shift(es) for key, es in merged.items()}
        throws = dict(pool.map(kit_render, [(n, shifts, out_dir) for n in names]))

    meta_anims = {}
    row = 0
    for anim, poses, fps, loop in ANIMATIONS:
        for c, (d, _) in enumerate(DIRECTIONS):
            entry = {'frames': [(row + i) * 8 + c for i in range(len(poses))], 'fps': fps, 'loop': loop}
            dx, dsy = shifts[f'{anim}/{d}']
            if dx or dsy:
                entry['offset'] = [int(-dx), int(dsy)]   # undo the fit shift in game
            if anim in CAST_RELEASE:
                entry['release'] = CAST_RELEASE[anim]
            if anim == 'cast_throw' and 'cloth' in throws:
                # as for the archer's arrows: where the thrown object leaves the hand, per direction
                entry['pivots'] = {'release': throws['cloth'][d]}
            meta_anims[f'{anim}_{d}'] = entry
        row += len(poses)
    if 'cloth' in throws:
        meta = {'image': 'player.png', 'frameWidth': W, 'frameHeight': H, 'anchor': [0.5, 1],
                'pivots': PIVOTS, 'frames': {}, 'animations': meta_anims}
        with open(os.path.join(out_dir, 'player.json'), 'w', encoding='utf-8', newline='\n') as f:
            json.dump(meta, f, indent=2)
            f.write('\n')
    return names


if __name__ == '__main__':
    default_out = Path(__file__).resolve().parents[2] / 'assets' / 'sprites'
    out = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1] in KITS else str(default_out)
    only = [a for a in sys.argv[1:] if a in KITS] or None
    print('wrote', generate(out, only))
