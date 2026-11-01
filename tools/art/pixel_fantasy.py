"""Import Pixel Fantasy V0.05 Body 1 into Soul Craft's layered animation contract.

Requires the locally owned generator, not its executable. Native pixels are kept;
the client draws them at 1/2 scale. Source layout: walk/diagonal walk/run/diagonal
run in rows 0..3, matching raised-arm poses in rows 4..7. Missing actions are
explicit adaptations, never a fallback to the previous character.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
from PIL import Image, ImageDraw
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets/sprites'
SIZE = 96
DIRECTIONS = {
    'down': (0, 0, math.pi / 2), 'down_right': (0, 3, math.pi / 4),
    'right': (2, 0, 0), 'up_right': (2, 3, -math.pi / 4),
    'up': (3, 0, -math.pi / 2), 'up_left': (3, 3, -3 * math.pi / 4),
    'left': (1, 0, math.pi), 'down_left': (1, 3, 3 * math.pi / 4),
}
ANIMATIONS = {
    'idle': ([1, 1], 2, True), 'walk': ([0, 1, 2, 1], 9, True),
    'attack': ([1, 1, 1, 2, 1], 18, False),
    'roll': ([1, 1, 1, 1], 14, False), 'drink': ([1, 1], 3, False),
    'sit': ([1], 1, True), 'dead': ([1], 1, False), 'hurt': ([1], 4, False),
    'cast_slam': ([1, 1, 1, 1, 1], 15, False),
    'cast_throw': ([1, 1, 1, 1], 17, False),
    'cast_charge': ([1, 0, 2], 12, False),
    'cast_push': ([1, 1, 1], 15, False), 'cast_raise': ([1, 1, 1, 1], 10, False),
}
RELEASE = {'cast_slam': 2, 'cast_throw': 1, 'cast_charge': 1, 'cast_push': 1, 'cast_raise': 2}
SOURCE_FILES = {
    'body': 'Body/PF_1.png', 'legs': 'Bottom/Body1/PF_3.png',
    'boots': 'Shoes/Body1/PF_2.png', 'cloth': 'Top1/Body1/PF_4.png',
    'leather': 'Top1/Body1/PF_3.png', 'plate': 'Top1/Body1/PF_6.png',
    'bare': 'Top1/Body1/PF_1.png', 'shoulders': 'Accessory/Body1/PF_5.png',
    'short_front': 'FrontHair/Body1/PF_1.png', 'short_back': 'RearHair/Body1/PF_1_1.png',
    'short_over': 'RearHair/Body1/PF_1_2.png',
    'swept_front': 'FrontHair/Body1/PF_3.png', 'swept_back': 'RearHair/Body1/PF_3_1.png',
    'swept_over': 'RearHair/Body1/PF_3_2.png', 'beard': 'FacialHair/Body1/PF_1.png',
    'eyes': 'Eyes/Body1/PF_1_1.png',
}

def neutral(image, skin=False, colors=None):
    """Replace the supplied palette, preserving its drawn shading and outline."""
    pixels = np.array(image.convert('RGBA'))
    source = [(25, 6, 87), (63, 59, 147)]
    source += [(192, 139, 76), (228, 193, 156), (246, 220, 175)] if skin else [(110, 121, 166), (161, 179, 198)]
    values = [36, 65, 139, 206, 255] if skin else [35, 80, 163, 255]
    for i, rgb in enumerate(source):
        mask = np.all(pixels[..., :3] == rgb, axis=-1)
        pixels[mask, :3] = colors[i] if colors else (values[i],) * 3
    return Image.fromarray(pixels)

def cell(sheet, row, column):
    image = Image.new('RGBA', (SIZE, SIZE))
    image.alpha_composite(sheet.crop((column * 48, row * 96, column * 48 + 48, row * 96 + 96)), (24, 0))
    return image

def combine(*images):
    result = Image.new('RGBA', (SIZE, SIZE))
    for image in images: result.alpha_composite(image)
    return result

def adapt(image, pose, frame, direction):
    """Apply identical transforms to every part, preserving registration."""
    if pose == 'roll':
        cropped = image.crop((8, 18, 88, 94))
        tuck = cropped.resize((52, 48), Image.Resampling.NEAREST)
        tuck = tuck.rotate([0, 90, 180, 270][frame], Image.Resampling.NEAREST)
        out = Image.new('RGBA', (SIZE, SIZE))
        out.alpha_composite(tuck, ((SIZE - tuck.width) // 2, 90 - tuck.height))
        return out
    if pose == 'dead':
        rotated = image.rotate(90 if direction in ('left', 'up_left', 'down_left') else -90,
                               Image.Resampling.NEAREST, center=(48, 58))
        out = Image.new('RGBA', (SIZE, SIZE))
        out.alpha_composite(rotated, (0, 22))
        return out
    if pose == 'sit' or (pose == 'cast_slam' and frame >= 2):
        out = Image.new('RGBA', (SIZE, SIZE))
        out.alpha_composite(image.crop((0, 0, SIZE, 64)), (0, 22))
        out.alpha_composite(image.crop((0, 64, SIZE, 96)).resize((SIZE, 10), Image.Resampling.NEAREST), (0, 86))
        return out
    if pose == 'hurt':
        return image.rotate(-8, Image.Resampling.NEAREST, center=(48, 88))
    return image

def headwear(body, kind, direction):
    pixels = np.array(body)
    # The central head pixels remain below the raised hands on the supplied rig.
    occupied = np.where(pixels[20:44, 44:52, 3].any(axis=1))[0]
    top = int(occupied[0] + 20) if len(occupied) else 26
    image = Image.new('RGBA', (SIZE, SIZE)); d = ImageDraw.Draw(image)
    light, middle, dark = {'hood': ('#a5a38d', '#65766c', '#293b39'),
                          'cap': ('#c2a278', '#886845', '#332d2d'),
                          'helm': ('#d4dedd', '#899daa', '#293b4b')}[kind]
    d.polygon([(39, top+2), (43, top-1), (53, top-1), (58, top+4),
               (58, top+15), (54, top+20), (41, top+19), (37, top+13), (37, top+5)], fill=dark)
    d.polygon([(40, top+4), (44, top+1), (52, top+1), (55, top+5),
               (55, top+14), (51, top+17), (41, top+15)], fill=middle)
    d.line([(41,top+3),(45,top+1),(51,top+1)], fill=light, width=2)
    if kind == 'cap':
        d.rectangle((34, top+10, 62, 96), fill=(0,0,0,0))
        d.line((38,top+9,58,top+9), fill=dark, width=2)
    elif 'up' not in direction:
        if kind == 'hood': d.rectangle((41,top+8,54,top+16), fill=(0,0,0,0))
        else: d.line((40,top+10,55,top+10), fill='#111b25', width=2)
    return image

def hand_grip(parts, direction, raised):
    """Locate the drawn fist on this exact source frame, rather than the direction.

    The full-sleeve reference separates exposed fists from the arm. Pants/boots
    exclude the legs. The near hand of a profile walks several pixels per frame.
    When the far fist is covered by the body, retain a point inside that silhouette.
    """
    body = np.array(parts['body'])
    skin = np.zeros(body.shape[:2], bool)
    for rgb in [(246,220,175),(228,193,156),(192,139,76)]:
        skin |= np.all(body[...,:3] == rgb, axis=-1) & (body[...,3] > 0)
    exposed = skin.copy()
    for layer in ['cloth','legs','boots']:
        exposed &= np.array(parts[layer])[...,3] == 0
    lo, hi = (18,45) if raised else (50,74)
    exposed[:lo] = False; exposed[hi:] = False
    hand_x = {'down':37, 'down_right':39, 'right':46, 'up_right':57,
              'up':58, 'up_left':58, 'left':51, 'down_left':40}[direction]
    target = np.array((hand_x, 30 if raised else 64), float)
    candidates = []
    while exposed.any():
        y,x = np.argwhere(exposed)[0]
        todo = [(int(y),int(x))]; points = []; exposed[y,x] = False
        while todo:
            y,x = todo.pop(); points.append((x,y))
            for ny,nx in [(y-1,x),(y+1,x),(y,x-1),(y,x+1)]:
                if 0 <= ny < SIZE and 0 <= nx < SIZE and exposed[ny,nx]:
                    exposed[ny,nx] = False; todo.append((ny,nx))
        if 3 <= len(points) <= 60:
            center = np.mean(points,axis=0)
            distance = np.sum((center-target)**2)
            if distance < 144:
                candidates.append((distance - min(20,len(points))*2, points, center))
    if candidates:
        _,points,center = min(candidates,key=lambda candidate: candidate[0])
        # Use an actual flesh pixel so rounding cannot put the grip in a gap.
        return np.array(min(points,key=lambda pt: np.sum((np.array(pt)-center)**2)),float)
    covered = skin & (np.array(parts['cloth'])[...,3] == 0)
    covered[:lo] = False; covered[hi:] = False
    points = np.argwhere(covered)[:,::-1]
    if len(points): return points[np.argmin(np.sum((points-target)**2,axis=1))].astype(float)
    raise ValueError(f'No hand pixels in source frame: {direction}, raised={raised}')

def sword(pose, frame, direction, raised, grip):
    image = Image.new('RGBA', (SIZE, SIZE)); d = ImageDraw.Draw(image)
    if pose in ('drink', 'sit', 'dead', 'roll'): return image
    base = DIRECTIONS[direction][2]
    right = grip[0] >= 48
    if pose == 'attack': angle = base + [-1.05, -.7, -.35, .45, .8][frame]
    elif raised: angle = -math.pi / 2
    else: angle = math.pi / 2 + (-.16 if right else .16)
    vector = np.array((math.cos(angle), math.sin(angle)))
    side = np.array((-vector[1], vector[0]))
    point = lambda v: tuple(int(round(x)) for x in v)
    tip = grip + vector * 27; guard = grip + vector * 4
    d.line([point(grip-vector*3),point(tip)],fill='#202c38',width=5)
    d.line([point(guard),point(tip)],fill='#b4c6ce',width=3)
    d.line([point(guard+side),point(tip)],fill='#e1e8df',width=1)
    d.line([point(guard-side*5),point(guard+side*5)],fill='#443a2d',width=4)
    d.line([point(guard-side*4),point(guard+side*4)],fill='#c6a66b',width=2)
    d.line([point(grip-vector*2),point(grip+vector*2)],fill='#694f38',width=2)
    return image

def preview():
    target = ROOT / 'output/character-preview'
    target.mkdir(parents=True, exist_ok=True)
    parts = [('sword_back',0xffffff), ('skin_bare',0xd4a574), ('short_back',0x89694c),
             ('legs',0x9da99d), ('cloth',0xffffff), ('short',0x89694c), ('sword_front',0xffffff)]
    atlases = []
    for layer,tint in parts:
        pixels = np.array(Image.open(OUT/f'pf_{layer}.png'))
        rgb = np.array([(tint>>16)&255,(tint>>8)&255,tint&255])
        pixels[...,:3] = (pixels[...,:3].astype(float)*rgb/255).astype(np.uint8)
        atlases.append(Image.fromarray(pixels))
    metadata = json.loads((OUT/'pf_cloth.json').read_text())['animations']
    result = Image.new('RGB',(1152,len(ANIMATIONS)*154),'#3b4448')
    labels = ImageDraw.Draw(result)
    for row,pose in enumerate(ANIMATIONS):
        for column,direction in enumerate(DIRECTIONS):
            entry = metadata[f'{pose}_{direction}']
            frame = entry['frames'][entry.get('release',len(entry['frames'])//2)]
            x,y = frame%8*SIZE,frame//8*SIZE
            cell_image = Image.new('RGBA',(SIZE,SIZE),'#3b4448')
            for atlas in atlases: cell_image.alpha_composite(atlas.crop((x,y,x+SIZE,y+SIZE)))
            result.paste(cell_image.resize((144,144),Image.Resampling.NEAREST).convert('RGB'),(column*144,row*154))
        labels.text((3,row*154),pose,fill='white')
    result.save(target/'pf-actions.png')


def publish(temporary, target):
    # Windows may let Vite's open image handle block replacement. Retain the
    # normal write path as a fallback so regeneration still works during dev.
    try:
        temporary.replace(target)
    except PermissionError:
        target.write_bytes(temporary.read_bytes())
        temporary.unlink()


def main(source):
    sheets = {key: Image.open(source / path).convert('RGBA') for key, path in SOURCE_FILES.items()}
    shades = {
        'cloth': [(30,39,39),(55,75,70),(106,130,116),(166,184,156)],
        'leather': [(37,32,31),(72,52,40),(125,85,51),(185,140,86)],
        'plate': [(29,39,53),(59,77,99),(113,142,162),(191,209,209)],
        'bare': [(33,36,36),(65,68,64),(112,117,102),(172,178,146)],
    }
    layers = {name: [] for name in ['legs','cloth','leather','plate','bare',
        'skin_bare','short_back','swept_back','short','swept','beard',
        'hood','cap','helm','sword_front','sword_back']}
    animations = {}; row_index = 0
    for pose, (sequence, fps, loop) in ANIMATIONS.items():
        for frame, step in enumerate(sequence):
            for direction, (source_row, column, angle) in DIRECTIONS.items():
                raised = pose in ('drink', 'cast_raise', 'cast_throw', 'cast_push') or (pose in ('attack','cast_slam') and frame in (0,1))
                r = source_row + 4 if raised else source_row
                c = column + step + (6 if pose == 'cast_charge' and frame > 0 else 0)
                parts = {key: cell(sheet, r, c) for key, sheet in sheets.items()}
                skin = neutral(combine(parts['body'],parts['eyes']), skin=True)
                rendered = {'skin_bare': skin}
                rendered['legs'] = combine(neutral(parts['legs']), neutral(parts['boots'], colors=[(28,29,33),(50,43,37),(92,72,52),(144,114,74)]))
                for outfit in shades:
                    image = combine(parts[outfit], parts['shoulders']) if outfit == 'plate' else parts[outfit]
                    rendered[outfit] = neutral(image, colors=shades[outfit])
                    if pose == 'drink':
                        flask = ImageDraw.Draw(rendered[outfit])
                        flask.polygon([(32,24),(37,21),(47,32),(41,38)], fill='#362d28')
                        flask.polygon([(34,25),(37,24),(44,32),(41,35)], fill='#d49343')
                        flask.line((35,25,41,31), fill='#f1cb75', width=2)
                for hair in ['short','swept']:
                    rendered[f'{hair}_back'] = neutral(parts[f'{hair}_back'])
                    rendered[hair] = neutral(combine(parts[f'{hair}_front'],parts[f'{hair}_over']))
                rendered['beard'] = neutral(parts['beard'])
                for kind in ['hood','cap','helm']: rendered[kind] = headwear(parts['body'], kind, direction)
                weapon = sword(pose, frame, direction, raised, hand_grip(parts, direction, raised))
                for side in ['front','back']:
                    rendered[f'sword_{side}'] = weapon if (side == 'back') == ('up' in direction) else Image.new('RGBA',(SIZE,SIZE))
                for layer, image in rendered.items(): layers[layer].append(adapt(image, pose, frame, direction))
        for index, direction in enumerate(DIRECTIONS):
            entry = {'frames': [(row_index+i)*8+index for i in range(len(sequence))], 'fps': fps, 'loop': loop}
            if pose in RELEASE: entry['release'] = RELEASE[pose]
            animations[f'{pose}_{direction}'] = entry
        row_index += len(sequence)
    for name, frames in layers.items():
        atlas = Image.new('RGBA',(SIZE*8,SIZE*row_index))
        for i,image in enumerate(frames): atlas.alpha_composite(image, (i%8*SIZE,i//8*SIZE))
        temporary = ROOT / 'output/character-preview'
        temporary.mkdir(parents=True, exist_ok=True)
        png_temp = temporary / f'.pf_{name}.png.tmp'
        atlas.save(png_temp, format='PNG')
        publish(png_temp, OUT / f'pf_{name}.png')
        json_temp = temporary / f'.pf_{name}.json.tmp'
        json_temp.write_text(json.dumps({'image':f'pf_{name}.png','frameWidth':SIZE,
            'frameHeight':SIZE,'anchor':[.5,1],'pivots':{'swing':[0,-18]},'frames':{},'animations':animations},indent=2)+'\n')
        publish(json_temp, OUT/f'pf_{name}.json')
    manifest = {path: hashlib.sha256((source/path).read_bytes()).hexdigest() for path in SOURCE_FILES.values()}
    (Path(__file__).with_name('pixel_fantasy_sources.json')).write_text(json.dumps({'pack':'Pixel Fantasy Character Generator V0.05','body':1,'files':manifest},indent=2)+'\n')
    preview()
    print(f'Imported Body 1: {len(layers)} layers, {row_index*8} frames each; eight directions.')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,default=Path.home()/'Downloads/PFCharGen_v0.05_Windows/Pixel Fantasy - Character Generator V0.05/img/pictures/Sprite/SpritePage1')
    main(parser.parse_args().source)
