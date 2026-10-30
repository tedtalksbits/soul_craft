import { describe, expect, it } from 'vitest';
import { compassDirection } from '../../src/client/ui/travel';

describe('compass direction', () => {
  it('names the eight directions in screen space, where down is south', () => {
    expect(compassDirection(0, -10)).toBe('N');
    expect(compassDirection(10, -10)).toBe('NE');
    expect(compassDirection(10, 0)).toBe('E');
    expect(compassDirection(10, 10)).toBe('SE');
    expect(compassDirection(0, 10)).toBe('S');
    expect(compassDirection(-10, 10)).toBe('SW');
    expect(compassDirection(-10, 0)).toBe('W');
    expect(compassDirection(-10, -10)).toBe('NW');
  });
});
