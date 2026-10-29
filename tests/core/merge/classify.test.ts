import { describe, expect, it } from 'vitest';
import { classify } from '../../../src/core/merge/classify';

const same = (a: number, b: number): boolean => a === b;
const u = undefined;

describe('classify', () => {
  it.each([
    [1, 1, 1, false, 'unchanged'],
    [1, 2, 1, false, 'take-mine'],
    [1, 1, 2, false, 'take-theirs'],
    [1, 2, 2, false, 'take-either'],
    [1, 2, 3, false, 'conflict'],
    [1, u, 1, false, 'take-mine'],
    [1, 1, u, false, 'take-theirs'],
    [1, u, 2, false, 'conflict'],
    [1, 2, u, false, 'conflict'],
    [1, u, u, false, 'take-either'],
    [u, 1, u, true, 'take-mine'],
    [u, u, 1, true, 'take-theirs'],
    [u, 1, 1, true, 'take-either'],
    [u, 1, 2, true, 'collision'],
    [u, 1, 2, false, 'conflict'],
  ] as const)('base %s, mine %s, theirs %s (collide %s) is %s', (base, mine, theirs, canCollide, expected) => {
    expect(classify<number>(base, mine, theirs, same, canCollide)).toBe(expected);
  });
});
