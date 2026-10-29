"""Knight sprite generator.

Writes knight.png and knight.json to <repo>/assets/sprites (or the directory given).

Usage: pnpm art knight

The knight is a mini-boss: a bulky oath-bound sentinel behind a huge tower shield. Same
conventions as player.py, hollow.py and archer.py: numpy + Pillow only, all randomness seeded,
integer hashing only, the shared renderer unchanged. 8 columns (one per direction: down,
down_right, right, up_right, up, up_left, left, down_left), one row per animation frame,
animations in ANIMATIONS order; frame index = row * 8 + column. The JSON is the engine's format.
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

# material: (highlight, base, shadow, deep); base/shadow from the spec, the rest derived
RAMPS = {
    1:  ('#828690', '#62666e', '#383b40', '#1b1d20'),  # dark steel plate
    2:  ('#5f646a', '#4c5056', '#33363b', '#222428'),  # mail skirt (id 2: compose() dithers it as mail)
    3:  ('#425074', '#34405e', '#222a40', '#151b2b'),  # faded navy tabard and crest
    4:  ('#c1984c', '#9c7a3c', '#6b5226', '#493617'),  # brass trim, rivets, emblem
    5:  ('#5e4a36', '#4a3a2a', '#30251a', '#1e160f'),  # dark oak shield face
    7:  ('#767b83', '#5f646b', '#41454b', '#2c2f35'),  # iron rim and bands
    10: ('#111111', '#111111', '#111111', '#111111'),  # visor
    11: ('#e0e4ea', '#b9bec4', '#858b92', '#61676f'),  # blade
}
RAMPS = {k: [hx(c) for c in v] for k, v in RAMPS.items()}

# ---------------------------------------------------------------- voxel grid
RES = 0.5
xs = np.arange(-20, 20, RES) + RES / 2     # wide: the stunned shield swings out
ys = np.arange(-30, 30, RES) + RES / 2
zs = np.arange(-22, 45, RES) + RES / 2
X, Y, Z = np.meshgrid(xs, ys, zs, indexing='ij')
M = np.zeros(X.shape, np.uint8)
N = np.zeros(X.shape + (3,))

MODEL_SCALE = 1.25      # parts are authored at player proportions, then scaled up to 38-40 px

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

def roty(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])

def unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)

THIGH, SHIN = 5.5, 5.4
UPPER_ARM, FOREARM = 3.8, 3.7
HIP_Z = 12.0
HIP = np.array([0.0, 0.0, HIP_Z])
NECK = np.array([0.0, -0.3, 23.0])
HELM_C = np.array([0.0, -0.6, 26.4])
SHOULDER = {-1: np.array([-6.0, 0.0, 20.6]), 1: np.array([6.0, 0.0, 20.6])}
SHIELD_H, SHIELD_W = 24.0, 12.0          # about 26 px tall on screen after scaling
SWORD_LEN = 13.5

# the shield's resting place, in body coordinates: in front of the body, towards the player
SHIELD_HELD = dict(center=(3.0, -5.6, 15.4), normal=(0.08, -1.0, 0.0), up=(0.0, 0.0, 1.0))

def draw_shield(put, C, center, normal, up):
    """A slightly curved rectangular tower shield: oak face, iron rim and bands, brass rivets."""
    n = unit(normal)
    u = unit(np.asarray(up, float) - (np.asarray(up, float) @ n) * n)
    r = np.cross(u, n)
    x, y, z = C
    dx, dy, dz = x - center[0], y - center[1], z - center[2]
    a = dx * r[0] + dy * r[1] + dz * r[2]                 # across
    b = dx * u[0] + dy * u[1] + dz * u[2]                 # along (up)
    h = dx * n[0] + dy * n[1] + dz * n[2]                 # through
    bow = 0.9 * (2 * a / SHIELD_W) ** 2                     # convex face
    slab = (np.abs(a) < SHIELD_W / 2) & (np.abs(b) < SHIELD_H / 2) & (np.abs(h + bow) < 0.7)
    rim = slab & ((np.abs(a) > SHIELD_W / 2 - 0.9) | (np.abs(b) > SHIELD_H / 2 - 0.9))
    band = slab & (np.abs(b - SHIELD_H * 0.18) < 0.5) & (h + bow > 0)          # iron band on the face (+n)
    put(slab, 5)
    put(rim | band, 7)
    for sa in (-1, 1):
        for sb in (-1, 1):
            rv = center + r * sa * (SHIELD_W / 2 - 0.45) + u * sb * (SHIELD_H / 2 - 0.45) + n * 0.1
            put(ball(C, rv, 0.55), 4)
    return center - n * 1.4                                 # the handle behind the shield

def draw_sword(put, C, grip, bdir):
    bdir = unit(bdir)
    grip = np.asarray(grip, float)
    put(capsule(C, grip - bdir * 1.5, grip + bdir * 0.8, 0.6), 1)               # grip
    put(ball(C, grip - bdir * 1.9, 0.85), 4)                                     # brass pommel
    perp = np.cross(bdir, [0, 0, 1.0])
    if np.linalg.norm(perp) < 1e-3:
        perp = np.cross(bdir, [0, 1.0, 0])
    perp = unit(perp)
    gc = grip + bdir * 1.4
    put(capsule(C, gc - perp * 2.3, gc + perp * 2.3, 0.55), 4)                  # brass crossguard
    put(capsule(C, gc, gc + bdir * SWORD_LEN, 0.95, 0.45), 11)                  # broad blade

def build(pose):
    """Build the knight for one pose. Pose keys:

    legR / legL     (thigh_pitch, shin_pitch[, thigh_abduct, shin_abduct]) degrees, forward +
    kneeR/ankleR... explicit knee/ankle points in body coordinates; footR/footL foot direction
    hip_z           explicit hip height; default: lowest ankle on the ground
    lean, twist, roll   torso pitch forward, turn (- brings the shield shoulder forward), side lean
    head_tilt, head_yaw helm pitch (+ chin down) and turn
    bob_extra       upper-body drop in model units (breathing): the shield stays put
    shield          dict(center, normal, up) in body coordinates; the left hand holds its handle
    handL           left hand target in body coordinates instead of the shield handle (dead)
    handR           sword hand target in body coordinates; blade = blade direction in body coordinates
    sword           'hand' (default) or 'ground' (dropped beside the knight: ground_grip, ground_dir)
    crest           0..1 streams the crest back (charge)
    cut_ground      remove anything below the ground (a shield planted in the earth)
    """
    global M, N
    M = np.zeros(X.shape, np.uint8)
    def put(mask, mat):
        M[mask] = mat

    # ---- legs (body coordinates): wide planted stance, plate greaves and boots
    legs = {}
    for side, sx in (('R', -1), ('L', 1)):
        Hp = np.array([2.6 * sx, 0.0, HIP_Z])
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
    hip_z = pose['hip_z'] if 'hip_z' in pose else HIP_Z + 1.2 - min(l[2][2] for l in legs.values())
    dz = hip_z - HIP_Z

    body = move((0, 0, dz))
    rel_torso = fcompose(move((0, 0, pose.get('bob_extra', 0.0))),
                         about(rotz(deg(pose.get('twist', 0.0))) @ rotx(deg(pose.get('lean', 4.0)))
                               @ roty(deg(pose.get('roll', 0.0))), HIP))
    torso = fcompose(body, rel_torso)
    head = fcompose(torso, about(rotz(deg(pose.get('head_yaw', 0.0))) @ rotx(deg(pose.get('head_tilt', 0.0))), NECK))
    CB, CT, CH = coords(body), coords(torso), coords(head)

    for side in ('R', 'L'):
        Hp, K, A = legs[side]
        put(capsule(CB, Hp, K, 1.9, 1.7), 1)
        put(ball(CB, K, 1.85), 1)                                                     # knee cop
        put(capsule(CB, K, A, 1.6, 1.5), 1)
        fd = unit(pose.get('foot' + side, (0, -1.0, 0)))
        lift = A[2] + dz - 1.2
        put(capsule(CB, A - 0.8 * fd + [0, 0, -0.2], A + 2.2 * fd + [0, 0, -0.5 + 0.3 * lift], 1.35), 1)

    # ---- torso: plate cuirass, mail skirt, navy tabard with brass trim and a worn emblem
    x, y, z = CT
    put((((x / 5.6) ** 2 + (y / 3.8) ** 2) < 1) & (z >= 8.6) & (z < 13.5), 2)          # mail skirt
    rx = 5.2 + np.clip(z - 13, 0, 8) * 0.12
    cuirass = (((x / rx) ** 2 + (y / 3.5) ** 2) < 1) & (z >= 13.0) & (z < 22.6)
    cuirass &= ~((z > 21.4) & ((x / rx) ** 2 > 0.6))
    put(cuirass, 1)
    tab = (np.abs(x) < 3.0) & (z >= 8.0) & (z < 21.8) & ((((x / (rx + 0.3)) ** 2 + (y / 3.8) ** 2) < 1) | (z < 13.0))
    tab &= (np.abs(y) > 2.6) & (np.abs(y) < 4.2)
    put(tab, 3)
    put(tab & ((np.abs(np.abs(x) - 2.75) < 0.3) | (z < 8.6)), 4)                              # brass edging
    emblem = tab & (y < 0) & (((np.abs(x) < 0.45) & (z > 14.5) & (z < 19.5)) | ((np.abs(z - 18.0) < 0.4) & (np.abs(x) < 1.7)))
    put(emblem, 4)
    put((((x / (rx + 0.25)) ** 2 + (y / 3.75) ** 2) < 1) & (z >= 13.0) & (z < 13.9) & (np.abs(y) <= 2.6), 4)   # brass belt
    put((((x / 2.8) ** 2 + ((y + 0.3) / 2.6) ** 2) < 1) & (z >= 22.2) & (z < 23.8), 1)          # gorget

    # ---- pauldrons: broad, layered
    for sx in (-1, 1):
        c = np.array([5.8 * sx, 0.0, 21.0])
        d2 = (x - c[0]) ** 2 + (y - c[1]) ** 2 * 1.05 + ((z - c[2]) * 1.25) ** 2
        put((d2 < 3.4 ** 2) & (z > 19.0), 1)
        put((d2 < 3.4 ** 2) & (d2 > 2.9 ** 2) & (np.abs(z - 19.6) < 0.4), 4)                 # brass edge

    # ---- shield (body coordinates) and the arm that holds it
    sh = pose.get('shield', SHIELD_HELD)
    handle_b = draw_shield(put, CB, np.asarray(sh['center'], float), sh['normal'], sh['up'])
    arms = {}
    tl = to_local(rel_torso, pose['handL'] if 'handL' in pose else handle_b)
    el, hd = two_bone(SHOULDER[1], tl, UPPER_ARM, FOREARM, pose.get('poleL', (1.0, 0.4, -0.6)))
    arms['L'] = (el, hd)
    tr = to_local(rel_torso, pose.get('handR', (-6.4, -1.0, 14.0)))
    el, hd = two_bone(SHOULDER[-1], tr, UPPER_ARM, FOREARM, pose.get('poleR', (-1.0, 0.5, -0.4)))
    arms['R'] = (el, hd)
    for sx, side in ((-1, 'R'), (1, 'L')):
        el, hd = arms[side]
        put(capsule(CT, SHOULDER[sx], el, 1.6, 1.45), 1)
        put(ball(CT, el, 1.5), 1)
        put(capsule(CT, el, hd, 1.45, 1.35), 1)
        put(ball(CT, hd, 1.2), 1)                                                        # gauntlet

    # ---- sword (body coordinates)
    if pose.get('sword', 'hand') == 'hand':
        draw_sword(put, CB, to_world(rel_torso, arms['R'][1]), pose.get('blade', (-0.35, 0.35, -0.87)))

    # ---- great helm: flat top, cross visor, brass rivets, short crest
    hx_, hy_, hz_ = CH
    c = HELM_C
    ddx, ddy = np.abs(hx_ - c[0]), np.abs(hy_ - c[1])
    helm = ((ddx / 3.3) ** 4 + (ddy / 3.4) ** 4 < 1) & (hz_ >= c[2] - 3.2) & (hz_ < c[2] + 3.4)
    put(helm, 1)
    front = helm & (hy_ < c[1] - 2.6)
    put(front & (np.abs(hz_ - (c[2] + 0.5)) < 0.45) & (ddx < 2.4), 10)                  # eye slit
    put(front & (ddx < 0.45) & (hz_ > c[2] - 2.6) & (hz_ < c[2] + 0.5), 10)            # breath slit
    put(helm & (np.abs(hz_ - (c[2] + 2.2)) < 0.4), 4)                                  # brass band
    for ang in np.radians([45, 135, 225, 315]):
        put(ball(CH, c + [3.0 * np.cos(ang) * 1.05, 3.0 * np.sin(ang) * 1.05, -1.2], 0.5), 4)
    cr = pose.get('crest', 0.0)
    put(capsule(CH, c + [0, -1.6, 3.6], c + [0, 1.6 + 2.2 * cr, 4.0 + 0.4 * cr], 0.75), 3)   # short crest
    put(capsule(CH, c + [0, 1.6 + 2.2 * cr, 4.0 + 0.4 * cr], c + [0, 2.6 + 3.6 * cr, 3.5 - 0.8 * cr], 0.6, 0.35), 3)

    if pose.get('sword') == 'ground':
        draw_sword(put, CB, pose['ground_grip'], pose['ground_dir'])
    if pose.get('cut_ground'):
        M[:, :, zs < 0.0] = 0

    occ = gauss3d((M > 0).astype(float), 1.6)
    gx, gy, gz = np.gradient(occ)
    N = -np.stack([gx, gy, gz], -1)
    N /= (np.linalg.norm(N, axis=-1, keepdims=True) + 1e-9)
    return {'ankles': {k: v[2] * MODEL_SCALE for k, v in legs.items()}}

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


# ---------------------------------------------------------------- animations
DIRECTIONS = [('down', 0), ('down_right', 45), ('right', 90), ('up_right', 135),
              ('up', 180), ('up_left', 225), ('left', 270), ('down_left', 315)]

def P(*dicts, **kw):
    out = {}
    for d in dicts:
        out.update(d)
    out.update(kw)
    return out

STAND = dict(legR=(4, 0), legL=(-4, 0))

# the charge: shield shoulder leading, sword trailing, crest streaming back
CHARGE = dict(lean=28, twist=-24, head_tilt=14, crest=1.0,
              shield=dict(center=(2.2, -7.4, 13.4), normal=(0.1, -1.0, 0.15), up=(0.0, 0.15, 0.99)),
              handR=(-6.6, 3.8, 15.0), blade=(-0.25, 0.9, -0.3))

# stunned: shield arm hanging wide and low, body open, helm lolling
STUN_SHIELD_A = dict(center=(9.55, -1.27, 14.0), normal=(0.75, -0.55, 0.35), up=(0.75, 0.3, 0.6))
STUN_SHIELD_B = dict(center=(9.2, -1.6, 13.6), normal=(0.72, -0.6, 0.35), up=(0.7, 0.2, 0.68))
STUN = dict(legR=(12, -16, 14), legL=(-6, -12, 12), lean=10, roll=8, handR=(-6.8, 0.6, 14.4),
            blade=(-0.35, -0.25, -0.9), poleL=(1, 0, -1))

ANIMATIONS = [
    # (name, poses, fps, loop)
    ('idle', [P(STAND),
              P(STAND, bob_extra=-1.0, head_tilt=4)], 2, True),            # heavy breathing; shield rock-still
    ('walk', [P(legR=(36, 14), legL=(-34, -46), roll=-3, twist=4),         # heavy march, shield leading
              P(legR=(2, 0), legL=(16, -44), bob_extra=0.5),
              P(legR=(-34, -46), legL=(36, 14), roll=3, twist=-4),
              P(legR=(16, -44), legL=(2, 0), bob_extra=0.5)], 6, True),
    ('windup', [
        # drops its shoulder behind the shield, sword going back
        P(legR=(-22, -30), legL=(24, -4), lean=14, twist=-12, head_tilt=12,
          shield=dict(center=(2.4, -6.2, 14.4), normal=(0.1, -1.0, 0.12), up=(0.0, 0.12, 1.0)),
          handR=(-6.8, 2.8, 17.2), blade=(-0.28, 0.86, 0.42)),
        # dug in like a bull, sword raised behind
        P(legR=(-32, -44), legL=(34, -12), lean=26, twist=-22, head_tilt=18,
          shield=dict(center=(2.0, -6.3, 13.8), normal=(0.1, -1.0, 0.1), up=(0.0, 0.1, 1.0)),
          handR=(-6.5, 3.8, 19.0), blade=(-0.24, 0.9, 0.36)),
    ], 4, False),
    ('attack', [                                                           # the charge: a looping sprint
        P(CHARGE, legR=(48, 22), legL=(-42, -76), roll=-4),
        P(CHARGE, legR=(14, -64), legL=(20, -24), bob_extra=0.8),
        P(CHARGE, legR=(-42, -76), legL=(48, 22), roll=4),
    ], 12, True),
    ('stunned', [
        P(STUN, shield=STUN_SHIELD_A, head_tilt=30, head_yaw=18),
        P(STUN, shield=STUN_SHIELD_B, head_tilt=34, head_yaw=-16, bob_extra=-0.6, roll=6),
    ], 3, True),
    ('dead', [                                                             # kneeling, slumped over the planted shield
        P(hip_z=6.5, kneeR=(-2.8, -3.0, 6.9), ankleR=(-2.6, 3.0, 6.7), footR=(0, 1.0, -0.3),
          kneeL=(2.8, -3.2, 6.9), ankleL=(2.6, 2.8, 6.7), footL=(0, 1.0, -0.3),
          lean=30, roll=-4, head_tilt=40, head_yaw=10,
          shield=dict(center=(1.5, -9.5, 13.0), normal=(0.0, -0.95, 0.3), up=(0.0, 0.3, 0.95)),
          handL=(1.8, -7.6, 24.2), poleL=(1, 0.5, 0.2), handR=(-6.2, -3.6, 11.8),
          sword='ground', ground_grip=(-7.6, -2.0, 6.1), ground_dir=(-0.2, -1.0, 0.0), cut_ground=True),
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
    lim_x, lo_y, hi_y = 22.0, -1.5, 43.5
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
    sheet, meta, report = generate(sys.argv[1] if len(sys.argv) > 1 else None, 'knight')
    a = build(ANIMATIONS[1][1][0])['ankles']
    report['walk_stride_px'] = round(float(abs(a['R'][1] - a['L'][1])), 1)
    print('sheet', sheet.size, 'pivots', meta['pivots'], report)
