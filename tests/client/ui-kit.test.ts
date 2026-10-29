import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UI_KIT_URLS } from '../../src/client/ui/ui-kit';

const css = readFileSync(join(__dirname, '../../src/client/ui/styles.css'), 'utf8');
const referenced = [...css.matchAll(/url\('\/assets\/ui\/([\w-]+)\.png'\)/g)].flatMap((m) =>
  m[1] ? [m[1]] : [],
);

describe('UI kit', () => {
  it('finds the pieces the stylesheet uses', () => {
    // Guards the regex: if styles.css changes its url() style, this test must change with it.
    expect(referenced.length).toBeGreaterThan(10);
  });

  it('preloads every piece styles.css draws, so no state image arrives late', () => {
    // A name missing here is either a typo (no frame at all) or a piece that would load on first use.
    const missing = [...new Set(referenced)].filter((name) => !(name in UI_KIT_URLS));
    expect(missing).toEqual([]);
  });

  it('includes the state images that only show on interaction', () => {
    for (const name of ['button_hover', 'button_pressed', 'button_disabled', 'tab_on', 'slot_on']) {
      expect(UI_KIT_URLS[name], name).toBeTypeOf('string');
    }
  });
});
