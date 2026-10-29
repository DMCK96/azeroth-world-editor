import { describe, expect, it } from 'vitest';
import { notCarriedOver } from '../../../src/core/merge/not-carried';

const meta = (name: string, a = 60000, b = 99999, outputDir = 'C:\\out') => ({ name, idRangeStart: a, idRangeEnd: b, outputDir });
const FIXED = [
  'The canvas view (where it is panned and how far it is zoomed) is yours; the one saved in theirs or the base is not used.',
  'The undo history of every file starts over in the result.',
  'Canvas positions, last export paths, import snapshots and fidelity reports come from the side whose quest is kept.',
  'The result is a new unsaved project; none of the three files is changed.',
];

describe('notCarriedOver', () => {
  it('always ends with the fixed lines', () => {
    expect(notCarriedOver(meta('A'), meta('A'), null, [])).toEqual(FIXED);
  });
  it('names their project settings when they differ from yours', () => {
    const lines = notCarriedOver(meta('A'), meta('B', 70000, 79999, 'D:\\x'), null, []);
    expect(lines[0]).toBe('Their project name (B), output folder and id range 70000-79999 are not used; the result keeps yours.');
  });
  it('mentions the base only when its name differs', () => {
    expect(notCarriedOver(meta('A'), meta('A'), meta('A'), [])).toEqual(FIXED);
    expect(notCarriedOver(meta('A'), meta('A'), meta('Old'), [])[0]).toMatch(/base.*Old/i);
  });
  it('counts ids that fall outside your id range', () => {
    const lines = notCarriedOver(meta('A', 60000, 60100), meta('A', 60000, 60100), null, [60050, 70000, 70001]);
    expect(lines[0]).toBe('2 ids in the result are outside your id range 60000-60100.');
  });
});
