"""Class sigil and ability icon generator.

Writes sigils.png/.json and abilities.png/.json to <repo>/assets/sprites (or the directory given).

Usage: pnpm art icons

16x16 tintable glyphs: off-white and grays with a 1 px dark outline on transparency, no color of
their own. The game tints them with the class's element color (content/classes.json), so a
palette change in content never means redrawing an icon.

The sources in assets/sprites/source/ are PixelLab output and are never edited: each is one
create_1_direction_object review pack (64 candidates at 16 px, 5-color gray palette, grayscale
item icons as the style reference), packed losslessly into an 8-column grid in frame order.
  icons_roll1.png  object 27de482f-a8fc-417e-93ee-3e03d034f801: 5 variants of each of the 12 icons
  icons_roll2.png  object 05c7de13-8b7a-49ad-83ec-e4512db8a257: rerolls for shield_charge, shadowstep
PICKS names the chosen candidate for each icon. To change an icon, pick another candidate or add
a new roll; to change how light the glyphs are, change LIFT.
"""
import json
import os
import sys

from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
SOURCE = os.path.join(ROOT, 'assets', 'sprites', 'source')
DEFAULT_OUT = os.path.join(ROOT, 'assets', 'sprites')
S = 16

OUTLINE = (0x14, 0x14, 0x16)
# Tinting multiplies, so a dark gray stays dark in every element color. The rolls lean dark, so the
# three interior grays move up one step together (off-white stays), keeping the four-step form.
LIFT = {
    (0x4a, 0x4a, 0x50): (0x8c, 0x8c, 0x94),
    (0x8c, 0x8c, 0x94): (0xb8, 0xb8, 0xbe),
    (0xc8, 0xc8, 0xce): (0xde, 0xde, 0xe2),
}
PALETTE = {OUTLINE, (0xf2, 0xf2, 0xf2), *LIFT}

# sheet: [(frame name, source roll, candidate index)]
PICKS = {
    'sigils': [
        ('vanguard', 'icons_roll1', 1),  # heater shield with a cross
        ('stalker', 'icons_roll1', 8),  # crescent and star
        ('ashcaller', 'icons_roll1', 10),  # flame
    ],
    'abilities': [
        ('ground_slam', 'icons_roll1', 15),
        ('shield_charge', 'icons_roll2', 12),
        ('earthshatter', 'icons_roll1', 25),
        ('ash_bomb', 'icons_roll1', 32),
        ('shadowstep', 'icons_roll2', 25),
        ('bladestorm', 'icons_roll1', 42),
        ('fire_pot', 'icons_roll1', 45),
        ('repel', 'icons_roll1', 50),
        ('cinder_storm', 'icons_roll1', 55),
    ],
}


def candidate(roll, index):
    grid = Image.open(os.path.join(SOURCE, f'{roll}.png')).convert('RGBA')
    x, y = (index % 8) * S, (index // 8) * S
    return grid.crop((x, y, x + S, y + S))


def glyph(roll, index):
    im = candidate(roll, index)
    px = im.load()
    for y in range(S):
        for x in range(S):
            p = px[x, y]
            if not p[3]:
                continue
            if p[:3] not in PALETTE:
                raise SystemExit(f'{roll}[{index}] has a color outside the palette: {p}')
            px[x, y] = LIFT.get(p[:3], p[:3]) + (255,)
    return im


def generate(out_dir=None):
    out_dir = out_dir or DEFAULT_OUT
    os.makedirs(out_dir, exist_ok=True)
    sheets = {}
    for name, picks in PICKS.items():
        sheet = Image.new('RGBA', (len(picks) * S, S), (0, 0, 0, 0))
        frames = {}
        for i, (frame, roll, index) in enumerate(picks):
            sheet.paste(glyph(roll, index), (i * S, 0))
            frames[frame] = i
        sheet.save(os.path.join(out_dir, f'{name}.png'))
        meta = {'image': f'{name}.png', 'frameWidth': S, 'frameHeight': S, 'anchor': [0.5, 1],
                'frames': frames, 'animations': {}}
        with open(os.path.join(out_dir, f'{name}.json'), 'w', encoding='utf-8', newline='\n') as f:
            f.write(json.dumps(meta, indent=2) + '\n')
        sheets[name] = sheet
    return sheets


if __name__ == '__main__':
    for name, sheet in generate(sys.argv[1] if len(sys.argv) > 1 else None).items():
        print(f'{name}: {sheet.width}x{sheet.height}')
