import { describe, expect, it } from 'vitest';
import { idsAbove } from '../../src/core/ids/free';

describe('idsAbove', () => {
  it('starts above the larger of the database maximum and every id the project uses', () => {
    expect(idsAbove(10, [12, 7], 2)).toEqual([13, 14]);
    expect(idsAbove(20, [12, 7], 1)).toEqual([21]);
  });
  it('starts at 1 when there is nothing', () => {
    expect(idsAbove(0, [], 3)).toEqual([1, 2, 3]);
  });
  it('returns nothing for a count of 0', () => {
    expect(idsAbove(5, [], 0)).toEqual([]);
  });
});
