/**
 * Sprite sheets from assets/sprites: each `<name>.png` with its `<name>.json`
 * sidecar (see src/content/sprite-sheet.ts). Lookups go through the Assets
 * object every frame, so a hot-reloaded sheet shows up without touching views.
 */
import { ImageSource, Rectangle, Texture } from 'pixi.js';
import { SpriteSheetSchema, type SpriteSheetDef } from '../content/sprite-sheet';

const SHEET_JSON = import.meta.glob<unknown>('/assets/sprites/*.json', { eager: true, import: 'default' });
const SHEET_PNG = import.meta.glob<string>('/assets/sprites/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

export interface Anim {
  textures: Texture[];
  fps: number;
  loop: boolean;
  /** Sprite offset from the anchor in pixels (see SpriteSheetSchema). */
  offset: readonly [number, number];
  pivots: Readonly<Record<string, readonly [number, number]>>;
  /** For a cast pose, the frame its effect lands on (see SpriteSheetSchema). */
  release: number | undefined;
}

/** Where a named frame sits in its sheet's PNG, for drawing it outside Pixi (DOM icons). */
export interface FrameRect {
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
  sheetW: number;
  sheetH: number;
}

export class SpriteSheet {
  readonly frames: Texture[] = [];
  readonly named = new Map<string, Texture>();
  readonly anims = new Map<string, Anim>();

  constructor(
    readonly name: string,
    readonly def: SpriteSheetDef,
    private readonly source: ImageSource,
    readonly url: string,
  ) {
    const cols = Math.floor(source.width / def.frameWidth);
    const rows = Math.floor(source.height / def.frameHeight);
    for (let i = 0; i < cols * rows; i++) {
      const frame = new Rectangle(
        (i % cols) * def.frameWidth,
        Math.floor(i / cols) * def.frameHeight,
        def.frameWidth,
        def.frameHeight,
      );
      this.frames.push(new Texture({ source, frame }));
    }
    for (const [key, index] of Object.entries(def.frames)) {
      const tex = this.frames[index];
      if (tex) this.named.set(key, tex);
    }
    for (const [key, a] of Object.entries(def.animations)) {
      const textures = a.frames
        .map((f) => (typeof f === 'number' ? this.frames[f] : this.named.get(f)))
        .filter((t) => t !== undefined);
      if (textures.length > 0)
        this.anims.set(key, {
          textures,
          fps: a.fps,
          loop: a.loop,
          offset: a.offset,
          pivots: a.pivots,
          release: a.release,
        });
    }
  }

  frameRect(key: string): FrameRect | undefined {
    const index = this.def.frames[key];
    const tex = index === undefined ? undefined : this.frames[index];
    if (!tex) return undefined;
    const { x, y, width: w, height: h } = tex.frame;
    return { url: this.url, x, y, w, h, sheetW: this.source.width, sheetH: this.source.height };
  }

  /** An animation, or a named still frame wrapped as a one-frame animation. */
  anim(key: string): Anim | undefined {
    const anim = this.anims.get(key);
    if (anim) return anim;
    const still = this.named.get(key);
    return still
      ? { textures: [still], fps: 1, loop: false, offset: [0, 0], pivots: {}, release: undefined }
      : undefined;
  }
}

async function loadImage(url: string): Promise<ImageSource> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return new ImageSource({ resource: img, scaleMode: 'nearest' });
}

const nameOf = (path: string) => /([^/]+)\.(json|png)$/.exec(path)?.[1] ?? path;

export class Assets {
  private readonly sheets = new Map<string, SpriteSheet>();
  /** Bumped whenever a sheet is (re)loaded so cached renders (chunks) can rebuild. */
  version = 0;

  private constructor() {}

  static async load(): Promise<Assets> {
    const assets = new Assets();
    await Promise.all(
      Object.entries(SHEET_JSON).map(async ([path, raw]) => {
        const name = nameOf(path);
        const pngUrl = SHEET_PNG[path.replace(/\.json$/, '.png')];
        if (!pngUrl) throw new Error(`Sprite sheet ${path} has no matching PNG`);
        assets.sheets.set(
          name,
          new SpriteSheet(name, SpriteSheetSchema.parse(raw), await loadImage(pngUrl), pngUrl),
        );
      }),
    );
    return assets;
  }

  sheet(name: string): SpriteSheet | undefined {
    return this.sheets.get(name);
  }

  /** Placeholder for anything missing, so broken art is visible rather than fatal. */
  get missingTexture(): Texture {
    return Texture.WHITE;
  }

  /** Dev hot reload: re-fetch a sheet's JSON and PNG from the server. */
  async reload(name: string): Promise<void> {
    const bust = `?t=${Date.now()}`;
    const raw: unknown = await (
      await fetch(`/assets/sprites/${name}.json${bust}`, { cache: 'no-store' })
    ).json();
    const def = SpriteSheetSchema.parse(raw);
    const url = `/assets/sprites/${def.image}${bust}`;
    this.sheets.set(name, new SpriteSheet(name, def, await loadImage(url), url));
    this.version++;
  }

  static sheetNameFromPath(path: string): string {
    return nameOf(path);
  }
}
