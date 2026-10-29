"""UI kit generator.

Cuts the DOM UI's 9-slice pieces out of one PixelLab sheet and derives their states.

Writes <repo>/assets/ui/*.png (or the directory given).

Usage: pnpm art ui_kit

The source, assets/ui/source/kit.png, is PixelLab output and is never edited. It was made with
create_ui_asset (256x256, seed 21) from an explicit `pieces` layout, so every piece sits at a known
spot with blank labels; the 14-colour palette below was passed as `palette`, so every pixel is
already one of ours. To change a piece's look, generate a new sheet with the same layout and replace
the source; to change a colour, change the state maps here.

Each piece is cropped at its layout box, its centre (inside the slice) is flattened to one colour
so CSS can stretch it, and states are palette shifts along our own ramps, so a state can never
disagree with its base piece. The CSS (src/client/ui/styles.css) shows everything at 2x like the
item icons: a piece's border width there is twice its slice here.
"""
import os
import sys

from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
SOURCE = os.path.join(ROOT, 'assets', 'ui', 'source', 'kit.png')
DEFAULT_OUT = os.path.join(ROOT, 'assets', 'ui')

# The palette the sheet was generated with, keyed by the letters used in the maps below.
PALETTE = {
    'o': '#070708',  # outline
    ',': '#0c0a09',  # panel shadow
    '.': '#17130f',  # panel interior
    'b': '#241d17',  # dark leather
    'B': '#3a2f25',
    'w': '#5a4636',
    'i': '#2e3034',  # iron ramp
    'I': '#4a4e54',
    's': '#6f747b',
    'S': '#9da2a8',
    'g': '#8a6a3a',  # brass ramp
    'G': '#d0a85c',
    'E': '#f0b866',
    'W': '#ece4d2',
}
RGB = {k: tuple(int(v[i:i + 2], 16) for i in (1, 3, 5)) for k, v in PALETTE.items()}
KEY = {v: k for k, v in RGB.items()}

# name: (box x0, y0, x1, y1 inclusive on the sheet, slice, centre colour or None to keep)
PIECES = {
    'panel': (8, 8, 128, 88, 20, '.'),
    'dialog': (8, 160, 248, 248, 20, '.'),
    'button': (144, 8, 216, 36, 7, 'B'),
    'tab': (144, 48, 216, 76, 6, 'b'),
    'slot': (228, 8, 252, 32, 5, 'b'),
    'keycap': (228, 44, 252, 68, 4, 'i'),
    'plaque': (8, 100, 168, 124, 12, 'b'),
    'divider': (8, 136, 208, 143, 0, None),
    'scroll_thumb': (220, 88, 228, 112, 4, None),
    'scroll_track': (240, 88, 248, 152, 4, None),
}

LIGHTER = {'.': 'b', 'b': 'B', 'B': 'w', 'i': 'I', 'I': 's', 's': 'S', 'g': 'G', 'G': 'E'}
DARKER = {'b': '.', 'B': 'b', 'w': 'B', 'I': 'i', 's': 'I', 'S': 's', 'G': 'g', 'E': 'G'}
DULL = {**DARKER, 'g': 'i', 'G': 'I', 'E': 'I'}  # brass goes to iron
BRASS = {'i': 'g', 'I': 'g', 's': 'G', 'S': 'E', 'B': 'g', 'w': 'G'}  # iron rim becomes brass

# name: (base piece, frame colour map, centre colour or None to keep the base's)
STATES = {
    'button_hover': ('button', LIGHTER, None),
    'button_pressed': ('button', DARKER, 'b'),
    'button_disabled': ('button', DULL, 'b'),
    'tab_on': ('tab', BRASS, None),
    'slot_on': ('slot', BRASS, None),
}


def cut(sheet, box, s, centre):
    x0, y0, x1, y1 = box
    im = sheet.crop((x0, y0, x1 + 1, y1 + 1))
    if centre and s:
        px = im.load()
        for y in range(s, im.height - s):
            for x in range(s, im.width - s):
                px[x, y] = RGB[centre] + (255,)
    return im


def recolour(base, s, cmap, centre):
    """Apply cmap outside the centre (the frame); set the centre to `centre` if given."""
    im = base.copy()
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            p = px[x, y]
            if not p[3]:
                continue
            inside = s <= x < im.width - s and s <= y < im.height - s
            if inside:
                if centre:
                    px[x, y] = RGB[centre] + (255,)
                continue
            k = KEY.get(p[:3])
            if k in cmap:
                px[x, y] = RGB[cmap[k]] + (255,)
    return im


def generate(out_dir=None):
    out_dir = out_dir or DEFAULT_OUT
    sheet = Image.open(SOURCE).convert('RGBA')
    stray = {p[:3] for _, p in sheet.getcolors(1 << 16) if p[3]} - set(RGB.values())
    if stray:
        raise SystemExit(f'source has colours outside the palette: {sorted(stray)}')
    pieces = {}
    for name, (*box, s, centre) in PIECES.items():
        pieces[name] = cut(sheet, box, s, centre)
    for name, (base, cmap, centre) in STATES.items():
        pieces[name] = recolour(pieces[base], PIECES[base][4], cmap, centre)
    for name, im in pieces.items():
        im.save(os.path.join(out_dir, f'{name}.png'), optimize=True)
    return pieces


if __name__ == '__main__':
    for name, im in generate(sys.argv[1] if len(sys.argv) > 1 else None).items():
        print(f'{name}: {im.width}x{im.height}')
