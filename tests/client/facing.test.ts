import { describe, expect, it } from 'vitest';
import { dir8FromVec, resolveDir8 } from '../../src/client/render/facing';

describe('dir8FromVec', () => {
  it('maps each octant, with screen y pointing down', () => {
    expect(dir8FromVec(1, 0)).toBe('right');
    expect(dir8FromVec(1, 1)).toBe('down_right');
    expect(dir8FromVec(0, 1)).toBe('down');
    expect(dir8FromVec(-1, 1)).toBe('down_left');
    expect(dir8FromVec(-1, 0)).toBe('left');
    expect(dir8FromVec(-1, -1)).toBe('up_left');
    expect(dir8FromVec(0, -1)).toBe('up');
    expect(dir8FromVec(1, -1)).toBe('up_right');
  });
});

describe('resolveDir8', () => {
  it('follows movement', () => {
    expect(resolveDir8('up', 'right', 0.95, 0.95)).toBe('down_right');
  });

  it('keeps a diagonal after stopping while it agrees with the sim facing', () => {
    // Walking down-right leaves the sim facing 'right' (horizontal wins ties).
    expect(resolveDir8('down_right', 'right', 0, 0)).toBe('down_right');
  });

  it('snaps to the sim facing when it no longer agrees, e.g. an aimed attack', () => {
    expect(resolveDir8('down_right', 'up', 0, 0)).toBe('up');
    expect(resolveDir8(undefined, 'left', 0, 0)).toBe('left');
  });
});
