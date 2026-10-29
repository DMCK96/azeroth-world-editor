/** The project settings the merge reports on: each file's own, which the result does not take from theirs or the base */
export interface MetaLine {
  name: string;
  idRangeStart: number;
  idRangeEnd: number;
  outputDir: string;
}

const FIXED = [
  'The canvas view (where it is panned and how far it is zoomed) is yours; the one saved in theirs or the base is not used.',
  'The undo history of every file starts over in the result.',
  'Canvas positions, last export paths, import snapshots and fidelity reports come from the side whose quest is kept.',
  'The result is a new unsaved project; none of the three files is changed.',
];

/** `a`, `a and b`, `a, b and c` */
const listOf = (parts: string[]): string =>
  parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

/** What the merged project does not carry over from the three files, one line each. */
export function notCarriedOver(mine: MetaLine, theirs: MetaLine, base: MetaLine | null, mergedIds: number[]): string[] {
  const lines: string[] = [];

  const differing: string[] = [];
  if (theirs.name !== mine.name) differing.push(`project name (${theirs.name})`);
  if (theirs.outputDir !== mine.outputDir) differing.push('output folder');
  if (theirs.idRangeStart !== mine.idRangeStart || theirs.idRangeEnd !== mine.idRangeEnd) {
    differing.push(`id range ${theirs.idRangeStart}-${theirs.idRangeEnd}`);
  }
  if (differing.length > 0) {
    lines.push(`Their ${listOf(differing)} ${differing.length === 1 ? 'is' : 'are'} not used; the result keeps yours.`);
  }

  if (base !== null && base.name !== mine.name) lines.push(`The base file's name (${base.name}) is not used.`);

  const outside = mergedIds.filter((id) => id < mine.idRangeStart || id > mine.idRangeEnd).length;
  if (outside > 0) lines.push(`${outside} ids in the result are outside your id range ${mine.idRangeStart}-${mine.idRangeEnd}.`);

  return [...lines, ...FIXED];
}
