/**
 * The UI kit's 9-slice pieces (assets/ui, cut by tools/art/ui_kit.py), which styles.css draws.
 * A browser only fetches a CSS image the first time a rule using it applies, so a state image (a
 * button's hover, a selected slot) would arrive just after the hover and the frame would blink
 * out for a moment. Fetching every piece at boot puts them in the cache before any UI shows.
 * Production builds inline pieces under 4 KB (all of them today), so this matters on the dev
 * server and for any larger piece added later.
 */
const PIECES = import.meta.glob<string>('/assets/ui/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

/** Piece name (its file name without `.png`) to URL. */
export const UI_KIT_URLS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(PIECES).map(([path, url]) => [path.slice('/assets/ui/'.length, -'.png'.length), url]),
);

/** Fetches and decodes every piece. A piece that fails only loses its preload, never the boot. */
export async function preloadUiKit(): Promise<void> {
  await Promise.all(
    Object.values(UI_KIT_URLS).map(async (url) => {
      const img = new Image();
      img.src = url;
      try {
        await img.decode();
      } catch {
        console.warn(`UI kit piece failed to preload: ${url}`);
      }
    }),
  );
}
