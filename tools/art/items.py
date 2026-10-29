"""Items sprite generator.

Writes items.png and items.json to <repo>/assets/sprites (or the directory given).

Usage: pnpm art items

16x16 inventory icons, one named frame each, anchor [0.5, 1]. numpy + Pillow only, no
randomness. Icons are authored as pixel grids (organic items) or drawn geometrically
(swords, rings). Light comes from the upper left like the character sprites: unshaded
pixels are lit by their exposed edges, and every icon gets the same selective 1 px outline
(a darkened shade of the material it borders).

Grid characters: each material has three - the lowercase letter is shaded automatically,
the uppercase letter forces the highlight, and its symbol forces the shadow. '.' is empty.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

DEFAULT_OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'sprites')
S = 16

# ---------------------------------------------------------------- materials
# name: (auto, highlight, shadow chars), (highlight, base, shadow, deep)
MATERIALS = {
    'ashwood': ('aA1', ('#d8cdb4', '#b8aa8e', '#8e8068', '#5e5444')),
    'bark':    ('kK2', ('#8a8070', '#6a6254', '#4a443a', '#2e2a24')),
    'cap':     ('cC3', ('#a07a8e', '#7a5668', '#553c4a', '#33232d')),
    'cream':   ('eE4', ('#e0d6bc', '#bfb497', '#8f866e', '#5e5848')),
    'glow':    ('gG5', ('#f0ffc0', '#b8f070', '#6cb84c', '#2f6b3a')),
    'iron':    ('iI6', ('#c9ced3', '#9da2a8', '#5f646b', '#34373c')),   # the player's steel
    'rust':    ('rR7', ('#bd703a', '#9a5a2e', '#6b3c1e', '#4a2713')),   # the hollow's rust
    'bone':    ('bB8', ('#e7dec4', '#c8c0a8', '#8a8470', '#5f5a49')),   # the archer's bone
    'gel':     ('sS9', ('#c4f0a0', '#7cc25a', '#4f8a3e', '#2c5428')),
    'leather': ('lL0', ('#6e5442', '#4f3c30', '#33271f', '#1c1511')),
    'brass':   ('yY!', ('#ecd096', '#d0a85c', '#9a7536', '#5c4220')),   # the player's gold
    'jacket':  ('pP@', ('#857a64', '#665c4c', '#453e33', '#2a251f')),
    'mail':    ('mM#', ('#a3a7ad', '#7d8187', '#55585e', '#2e3034')),
    'ruby':    ('vV$', ('#ff9a8a', '#c8352a', '#86201a', '#4a100c')),
    'azure':   ('uU%', ('#b6f2ff', '#4cb8d8', '#2a7494', '#163e52')),
    'cloth':   ('wW^', ('#f4efe0', '#d8cfb8', '#a89e86', '#6e6656')),
    'glass':   ('xX&', ('#eef4f4', '#a9b8bc', '#6e7c82', '#3e474c')),
    'ember':   ('oO*', ('#ffd27a', '#ff9a30', '#c4691c', '#7a3e10')),   # the player's flask
    'stone':   ('tT(', ('#cfc6b4', '#948a78', '#655d50', '#3a352d')),
    'breath':  ('qQ)', ('#d0f6ff', '#6ec8e8', '#3a8aae', '#1d4c62')),
}

def hx(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

CHAR = {}                      # char -> (material, forced level or None)
RAMP = {}
for name, (chars, ramp) in MATERIALS.items():
    RAMP[name] = [hx(c) for c in ramp]
    CHAR[chars[0]] = (name, None)
    CHAR[chars[1]] = (name, 0)
    CHAR[chars[2]] = (name, 2)
CHAR['z'] = ('void', 3)
RAMP['void'] = [hx('#111111')] * 4

# ---------------------------------------------------------------- authored icons
ICONS = {}

ICONS['ashwood'] = [   # a pale ash log on the diagonal, end grain towards the viewer
    "................",
    "................",
    "..........kkk...",
    "........kkKKkk..",
    "......kkKKkkk2k.",
    ".....kKKkk2kkk2.",
    "....kKkkkkkk22..",
    "..aaakkk2kkk2...",
    ".aAAaakkkkk22...",
    ".aA1a1akk22.....",
    ".a1aa1ak22......",
    ".aa11aak2.......",
    "..aaaa22........",
    "................",
    "................",
    "................",
]
ICONS['fungal_cap'] = [
    "................",
    "................",
    "......cccc......",
    "....cCCECCcc....",
    "...cCCCCCcEcc...",
    "..cCECCcccccc3..",
    "..cCCcccEcc3c3..",
    "..ccccccccc333..",
    "...3333333333...",
    "......eEe4......",
    "......eEe4......",
    "......eEe4......",
    ".....eEee44.....",
    ".....e4444......",
    "................",
    "................",
]
ICONS['glowspore'] = [
    "................",
    "................",
    ".........gg.....",
    "........gGGg....",
    "........gGgg....",
    "...gg....g55....",
    "..gGGg...k......",
    "..gGg5...k..gg..",
    "...g55..k..gGGg.",
    "....k...k..gGg5.",
    "....k..k...kg55.",
    ".....k.k..k.....",
    "......kkkk......",
    ".....kkkkkk.....",
    "................",
    "................",
]
ICONS['iron_scrap'] = [
    "................",
    "................",
    "................",
    ".......iiI......",
    "......iIIii.....",
    ".....iIiiri6....",
    "....iIiirri6....",
    "...iIiiiii66....",
    "..iIiri6666.....",
    "..iirr6.........",
    "...i66...iiI....",
    "........iIrii...",
    ".......iIiii6...",
    "........666.....",
    "................",
    "................",
]
ICONS['bone_shard'] = [   # a jagged splinter of bone
    "................",
    "................",
    "..........bb....",
    ".........bBb8...",
    "........bBBb8...",
    ".......bBbb88...",
    "......bBbbb8....",
    ".....bBbb888....",
    "....bBbbb88.....",
    "....bbbb88......",
    "...bBb888.......",
    "...bb88.........",
    "..b8b...........",
    "..8.............",
    "................",
    "................",
]
ICONS['slime_gel'] = [
    "................",
    "................",
    "................",
    "................",
    "......ssss......",
    "....sSSssss.....",
    "...sSSsssssss...",
    "...sSssSsssss9..",
    "..sSsssssssss9..",
    "..ssssssss9s99..",
    "..sssssssss999..",
    "...s9999999999..",
    "....99999999....",
    "................",
    "................",
    "................",
]
ICONS['padded_jacket'] = [
    "................",
    "................",
    ".....pp..pp.....",
    "...ppPPppPPpp...",
    "..pPPPPp.pPppp..",
    "..pPpppp.ppppp..",
    "..pPpPpplpPpp@..",
    "..ppp@ppl@pp@@..",
    "...pPpppl@pp@...",
    "...p@pppl@pp@...",
    "...pPpPpl@pp@...",
    "...ppp@pp@@p@...",
    "...pp@@@@@@@@...",
    "................",
    "................",
    "................",
]
ICONS['iron_mail'] = [
    "................",
    "................",
    ".....mm..mm.....",
    "...mmMMmmMMmm...",
    "..mMMmMm.mMmmm..",
    "..mMmMmm.mmmm#..",
    "..mmMmMmmmMm##..",
    "..m#mMmMmMmm#...",
    "...mMmMmMmM##...",
    "...m#mMmMmm#....",
    "...mMmMmMmM#....",
    "...m#m#m#m##....",
    "...##########...",
    "................",
    "................",
    "................",
]
ICONS['bandage'] = [
    "................",
    "................",
    "................",
    "................",
    ".....wwwww......",
    "....wWWWWww.....",
    "...wWw^^^Www....",
    "...wW^www^ww^...",
    "...ww^w^w^ww^...",
    "...wW^www^w^^...",
    "....ww^^^ww^....",
    ".....w^^^^^wwW..",
    "...........wwww.",
    ".............^^.",
    "................",
    "................",
]
ICONS['potion_ember'] = [   # round flask, like the player's own
    "................",
    "......llll......",
    "......lLl0......",
    ".......xX.......",
    ".......xx&......",
    ".....xxxxx&.....",
    "....xXooooox&...",
    "...xXOOoooooo&..",
    "...xOOoooooo*&..",
    "...xOoooooo**&..",
    "...xoooooo***&..",
    "....xo****xx&...",
    ".....xx&&&&.....",
    "................",
    "................",
    "................",
]
ICONS['potion_stone'] = [   # squat square bottle
    "................",
    "................",
    "......llll......",
    "......l00l......",
    "......xXx&......",
    "....xxxxxxx&....",
    "...xXTTtttttx&..",
    "...xTTttttttx&..",
    "...xTtttttt(x&..",
    "...xttttttt(x&..",
    "...xtttttt((x&..",
    "...xt((((((x&&..",
    "...xx&&&&&&&&...",
    "................",
    "................",
    "................",
]
ICONS['potion_breath'] = [  # tall slender vial
    "................",
    ".......ll.......",
    ".......lL.......",
    "......xXx&......",
    "......xXx&......",
    "......xQq&......",
    ".....xQqqq&.....",
    ".....xQqqq&.....",
    ".....xQqq)&.....",
    ".....xQqq)&.....",
    ".....xqqq)&.....",
    ".....xqq))&.....",
    ".....xq)))&.....",
    "......x&&&......",
    "................",
    "................",
]
ICONS['bone_cleaver'] = [
    "................",
    "................",
    "........bbbb....",
    ".......bBBBbb...",
    "......bBbbbbb8..",
    ".....bBbbbbb88..",
    "....bBbbbbb88...",
    "....bbbbbb88....",
    "....8bbbb88.....",
    "....l888888.....",
    "...lL0..........",
    "..lL0...........",
    ".lL0............",
    ".y0.............",
    "................",
    "................",
]

# ---------------------------------------------------------------- generated icons
def blank():
    return [['.'] * S for _ in range(S)]

def sword(tip_row, guard, chipped):
    """A sword on the diagonal: tip at the top right, crossguard at right angles, hilt at the bottom left."""
    g = blank()
    for y in range(tip_row, 10):
        g[y][15 - y] = 'I'                                 # lit edge (upper left)
        if y > tip_row:
            g[y][16 - y] = 'i' if y < 8 else '6'           # blade body
    if chipped:
        g[6][9] = '.'                                      # a bite out of the edge
        g[8][8] = 'r'                                      # and a spot of rust
    gl, gd = guard.upper(), guard
    for k, (x, y) in enumerate([(3, 8), (4, 9), (5, 10), (6, 11), (7, 12)]):
        g[y][x] = gl if k < 2 else gd                      # crossguard
    g[11][4] = 'l'                                         # grip
    g[12][3] = 'L'
    g[13][2] = gl                                          # pommel
    g[13][1] = gd
    g[14][1] = gd
    g[14][2] = gd
    return [''.join(r) for r in g]

def ring(band, gem):
    g = blank()
    cx, cy = 7.5, 9.5
    for y in range(S):
        for x in range(S):
            dx, dy = x - cx, y - cy
            o = (dx / 5.6) ** 2 + (dy / 3.6) ** 2
            i_ = (dx / 3.4) ** 2 + ((dy + 0.4) / 1.6) ** 2
            if o < 1 and i_ > 1:
                g[y][x] = band
    # setting and gem on top of the band
    for (x, y, c) in [(6, 5, band), (9, 5, band), (6, 6, band), (9, 6, band),
                      (7, 3, gem.upper()), (8, 3, gem), (6, 4, gem.upper()), (7, 4, gem.upper()),
                      (8, 4, gem), (9, 4, gem), (7, 5, gem), (8, 5, gem), (7, 6, gem), (8, 6, gem)]:
        g[y][x] = c
    shadow = {'y': '!', 'i': '6', 'v': '$', 'u': '%'}
    g[6][8] = shadow[gem]
    g[5][8] = shadow[gem]
    return [''.join(r) for r in g]

ICONS['chipped_sword'] = sword(tip_row=2, guard='y', chipped=True)
ICONS['iron_sword'] = sword(tip_row=1, guard='i', chipped=False)
ICONS['ring_vigor'] = ring('y', 'v')     # gold band, ruby
ICONS['ring_breath'] = ring('i', 'u')    # iron band, azure stone

ORDER = ['ashwood', 'fungal_cap', 'glowspore', 'iron_scrap', 'bone_shard', 'slime_gel',
         'chipped_sword', 'iron_sword', 'bone_cleaver', 'padded_jacket', 'iron_mail',
         'ring_vigor', 'ring_breath', 'bandage', 'potion_ember', 'potion_stone', 'potion_breath']

# ---------------------------------------------------------------- shading and outline
def paint(rows):
    assert len(rows) == S and all(len(r) == S for r in rows), 'icons are 16 x 16'
    mat = [[None] * S for _ in range(S)]
    lvl = [[1] * S for _ in range(S)]
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch == '.':
                continue
            m, forced = CHAR[ch]
            mat[y][x] = m
            lvl[y][x] = forced
    def same(x, y, m):
        return 0 <= x < S and 0 <= y < S and mat[y][x] == m
    img = np.zeros((S, S, 4), np.uint8)
    for y in range(S):
        for x in range(S):
            m = mat[y][x]
            if m is None:
                continue
            L = lvl[y][x]
            if L is None:                                      # lit by its exposed edges
                lit = not same(x, y - 1, m) or not same(x - 1, y, m)
                dark = not same(x, y + 1, m) or not same(x + 1, y, m)
                L = 0 if lit and not dark else 2 if dark and not lit else 1
            img[y, x, :3] = RAMP[m][L]
            img[y, x, 3] = 255
    out = img.copy()
    for y in range(S):                                         # selective outline
        for x in range(S):
            if mat[y][x] is not None:
                continue
            for dx, dy in ((0, 1), (1, 0), (0, -1), (-1, 0)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < S and 0 <= ny < S and mat[ny][nx] is not None:
                    deep = RAMP[mat[ny][nx]][3]
                    out[y, x, :3] = tuple(int(c * 0.55) for c in deep)
                    out[y, x, 3] = 255
                    break
    return out

def generate(out_dir=None, name='items', cols=8):
    out_dir = out_dir or DEFAULT_OUT
    rows_n = (len(ORDER) + cols - 1) // cols
    sheet = Image.new('RGBA', (cols * S, rows_n * S), (0, 0, 0, 0))
    frames = {}
    for i, key in enumerate(ORDER):
        sheet.paste(Image.fromarray(paint(ICONS[key]), 'RGBA'), ((i % cols) * S, (i // cols) * S))
        frames[key] = i
    os.makedirs(out_dir, exist_ok=True)
    sheet.save(os.path.join(out_dir, f'{name}.png'))
    meta = {'image': f'{name}.png', 'frameWidth': S, 'frameHeight': S, 'anchor': [0.5, 1],
            'frames': frames, 'animations': {}}
    with open(os.path.join(out_dir, f'{name}.json'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(meta, indent=2) + '\n')
    return sheet, meta

if __name__ == '__main__':
    sheet, meta = generate(sys.argv[1] if len(sys.argv) > 1 else None)
    print('sheet', sheet.size, len(meta['frames']), 'icons')
