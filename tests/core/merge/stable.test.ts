import { describe, expect, it } from 'vitest';
import { stableJson } from '../../../src/core/merge/stable';

describe('stableJson', () => {
  it('ignores key order, at any depth', () => {
    expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe(stableJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
  it('keeps array order', () => {
    expect(stableJson([1, 2])).not.toBe(stableJson([2, 1]));
  });
  it('tells different values apart', () => {
    expect(stableJson({ a: 1 })).not.toBe(stableJson({ a: '1' }));
    expect(stableJson(null)).not.toBe(stableJson({}));
  });
  it('treats a missing key and an undefined key as the same', () => {
    expect(stableJson({ a: 1, b: undefined })).toBe(stableJson({ a: 1 }));
  });
});
