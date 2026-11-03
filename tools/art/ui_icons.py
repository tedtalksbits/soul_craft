"""Menu icon generator: stat, attribute and action glyphs for the character screen (docs/power-and-stash.md and the
UI mood board: every stat an icon plus a number, every verb an icon plus a key, with the words in hover text).

Writes ui_icons.png/.json to <repo>/assets/sprites (or the directory given).

Usage: pnpm art ui_icons

16x16 tintable glyphs, like the class sigils (icons.py): off-white and grays with a 1 px dark outline added around
each shape, no color of their own. Menus tint them (ember for Power, dim ash for labels), so a palette change never
means redrawing an icon.

Each glyph is a text grid: '#' off-white, '+' light gray, '=' mid gray, '.' empty. Rows may be shorter than 16; they
are centered and padded. The outline is added automatically around the shape.
"""
import json
import os
import sys

from PIL import Image

DEFAULT_OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'sprites')
S = 16
SHADES = {'#': (0xf2, 0xf2, 0xf2), '+': (0xc0, 0xc0, 0xc6), '=': (0x8c, 0x8c, 0x94)}
OUTLINE = (0x14, 0x14, 0x16)

ICONS = {}

# ---------------------------------------------------------------- stats
ICONS['power'] = [          # an ember diamond: Power
    '',
    '#',
    '#+#',
    '#+++#',
    '#++#++#',
    '#++#=#++#',
    '#++#===#++#',
    '#++#=#++#',
    '#++#++#',
    '#+++#',
    '#+#',
    '#',
]
ICONS['power_max'] = [      # the diamond hollow: Max Power
    '',
    '#',
    '#.#',
    '#...#',
    '#.....#',
    '#...#...#',
    '#...###...#',
    '#...#...#',
    '#.....#',
    '#...#',
    '#.#',
    '#',
]
ICONS['attack'] = [         # an upright sword
    '#',
    '#+',
    '#+',
    '#+',
    '#+',
    '#+',
    '#+',
    '#+',
    '##########',
    '++++++++++',
    '=+',
    '=+',
    '====',
]
ICONS['armor'] = [          # a heater shield
    '',
    '##########',
    '#++++++++#',
    '#+######+#',
    '#+######+#',
    '#+##==##+#',
    '#+######+#',
    '#+####+#',
    '#+####+#',
    '#+##+#',
    '#++#',
    '##',
]
ICONS['health'] = [         # a heart
    '',
    '',
    '###...###',
    '#####.#####',
    '##+########',
    '##+########',
    '#+########',
    '#########',
    '#######',
    '#####',
    '###',
    '#',
]
ICONS['stamina'] = [        # a bolt
    '......####',
    '.....####.',
    '....####..',
    '...####...',
    '..####....',
    '.########.',
    '....####..',
    '...####...',
    '..####....',
    '.###......',
    '##........',
    '#.........',
]
ICONS['level'] = [          # a rising chevron over a bar
    '',
    '##',
    '####',
    '######',
    '###..###',
    '###....###',
    '##..##..##',
    '..####..',
    '.######.',
    '###..###',
    '',
    '##########',
]
ICONS['crit'] = [           # a star burst
    '#',
    '#',
    '#.#.#',
    '.###.',
    '#########',
    '.###.',
    '#.#.#',
    '#',
    '#',
]
ICONS['ability'] = [        # a rune in a ring
    '',
    '######',
    '##....##',
    '#...#....#',
    '#...##...#',
    '#..####..#',
    '#...##...#',
    '#...#....#',
    '##....##',
    '######',
]
ICONS['healing'] = [        # a flask
    '',
    '####',
    '#..#',
    '#..#',
    '##..##',
    '#......#',
    '#++++++#',
    '#++##++#',
    '#++++++#',
    '########',
]
ICONS['souls'] = [          # a wisp
    '',
    '#',
    '##',
    '.##',
    '..###',
    '.#####',
    '#######',
    '##+++##',
    '##+++##',
    '.#####',
    '..###',
]
ICONS['speed'] = [          # a boot
    '',
    '####',
    '####',
    '####',
    '####',
    '####',
    '#####',
    '#########',
    '##########',
    '++++++++++',
]
ICONS['might'] = [          # a fist
    '',
    '.########',
    '##.##.##.#',
    '##.##.##.#',
    '##########',
    '#######..#',
    '##########',
    '.########',
    '.#######',
    '..######',
]
ICONS['attunement'] = [     # an eye
    '',
    '',
    '..######..',
    '.##....##.',
    '##..##..##',
    '#..####..#',
    '##..##..##',
    '.##....##.',
    '..######..',
]

# ---------------------------------------------------------------- actions and inputs
ICONS['mouse_left'] = [     # a mouse, its left button lit
    '..######..',
    '.###=+++#.',
    '####=+++##',
    '####=+++##',
    '##########',
    '#++++++++#',
    '#++++++++#',
    '#++++++++#',
    '#++++++++#',
    '.#++++++#.',
    '..######..',
]
ICONS['mouse_right'] = [    # a mouse, its right button lit
    '..######..',
    '.#+++=###.',
    '##+++=####',
    '##+++=####',
    '##########',
    '#++++++++#',
    '#++++++++#',
    '#++++++++#',
    '#++++++++#',
    '.#++++++#.',
    '..######..',
]
ICONS['equip'] = [          # an arrow into a slot
    '',
    '##',
    '##',
    '##',
    '##',
    '########',
    '.######.',
    '..####..',
    '...##...',
    '',
    '#........#',
    '##########',
]
ICONS['inspect'] = [        # a lens
    '',
    '..####.....',
    '.#....#....',
    '#......#...',
    '#......#...',
    '#......#...',
    '.#....#....',
    '..#####....',
    '......###..',
    '.......###.',
    '........###',
]
ICONS['junk'] = [           # a cross in a coin
    '',
    '######',
    '##++++##',
    '#+#++#+#',
    '#++##++#',
    '#++##++#',
    '#+#++#+#',
    '##++++##',
    '######',
]
ICONS['lock'] = [           # a padlock
    '',
    '####',
    '#..#',
    '#....#',
    '#....#',
    '##########',
    '##########',
    '####==####',
    '####==####',
    '##########',
    '##########',
]
ICONS['dismantle'] = [      # a hammer
    '',
    '########',
    '########',
    '###',
    '###',
    '+#',
    '+#',
    '+#',
    '+#',
    '+#',
    '==',
]
ICONS['infuse'] = [         # a flame
    '',
    '#',
    '##',
    '.###',
    '.####',
    '######',
    '###+###',
    '##+=+##',
    '##+=+##',
    '.#####.',
]
ICONS['stash'] = [          # a chest
    '',
    '',
    '.########.',
    '##########',
    '#++++++++#',
    '##########',
    '####==####',
    '#++#==#++#',
    '#++++++++#',
    '##########',
]
ICONS['bag'] = [            # a drawstring pouch
    '',
    '..#..#..',
    '..####..',
    '...==...',
    '.######.',
    '#++++++#',
    '#+####+#',
    '#+####+#',
    '#++++++#',
    '.######.',
]
ICONS['all'] = [            # four squares: everything
    '',
    '',
    '####.####',
    '####.####',
    '####.####',
    '####.####',
    '',
    '####.####',
    '####.####',
    '####.####',
    '####.####',
]
ICONS['best'] = [           # a star
    '#',
    '###',
    '###',
    '###########',
    '.#########.',
    '..#######..',
    '..###.###..',
    '.###...###.',
    '.#.......#.',
]
ICONS['details'] = [        # an open book
    '',
    '',
    '####..####',
    '#++##.##++#',
    '#++##.##++#',
    '#++##.##++#',
    '#++##.##++#',
    '#++##.##++#',
    '##########',
]
ORDER = list(ICONS)


def grid(rows):
    """Centers a glyph's rows in the 16x16 frame."""
    rows = [r.rstrip() for r in rows]
    width = max((len(r) for r in rows), default=0)
    top = (S - len(rows)) // 2
    left = (S - width) // 2
    out = [['.'] * S for _ in range(S)]
    for y, row in enumerate(rows):
        pad = (width - len(row)) // 2
        for x, ch in enumerate(row):
            if ch != '.' and 0 <= top + y < S and 0 <= left + pad + x < S:
                out[top + y][left + pad + x] = ch
    return out


def paint(rows):
    cells = grid(rows)
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    px = img.load()
    for y in range(S):
        for x in range(S):
            ch = cells[y][x]
            if ch in SHADES:
                px[x, y] = (*SHADES[ch], 255)
    for y in range(S):                                         # the outline, around every shape
        for x in range(S):
            if cells[y][x] in SHADES:
                continue
            if any(0 <= x + dx < S and 0 <= y + dy < S and cells[y + dy][x + dx] in SHADES
                   for dx, dy in ((0, 1), (1, 0), (0, -1), (-1, 0))):
                px[x, y] = (*OUTLINE, 255)
    return img


def generate(out_dir=None, name='ui_icons', cols=8):
    out_dir = out_dir or DEFAULT_OUT
    rows_n = (len(ORDER) + cols - 1) // cols
    sheet = Image.new('RGBA', (cols * S, rows_n * S), (0, 0, 0, 0))
    frames = {}
    for i, key in enumerate(ORDER):
        sheet.paste(paint(ICONS[key]), ((i % cols) * S, (i // cols) * S))
        frames[key] = i
    os.makedirs(out_dir, exist_ok=True)
    sheet.save(os.path.join(out_dir, f'{name}.png'))
    meta = {'image': f'{name}.png', 'frameWidth': S, 'frameHeight': S, 'anchor': [0.5, 0.5],
            'frames': frames, 'animations': {}}
    with open(os.path.join(out_dir, f'{name}.json'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(meta, indent=2) + '\n')
    return sheet, meta


if __name__ == '__main__':
    sheet, meta = generate(sys.argv[1] if len(sys.argv) > 1 else None)
    print('sheet', sheet.size, len(meta['frames']), 'icons')
