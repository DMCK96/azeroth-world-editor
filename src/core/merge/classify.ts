export type Outcome = 'unchanged' | 'take-mine' | 'take-theirs' | 'take-either' | 'conflict' | 'collision';

/**
 * The three-way table for one item. Never called with all three undefined.
 * With no base, two different items are a collision when the kind lets keys
 * collide (they can be renumbered apart), otherwise a conflict.
 */
export function classify<T>(
  base: T | undefined,
  mine: T | undefined,
  theirs: T | undefined,
  same: (a: T, b: T) => boolean,
  canCollide: boolean,
): Outcome {
  const eq = (x: T | undefined, y: T | undefined): boolean => (x === undefined || y === undefined ? x === y : same(x, y));
  if (base !== undefined) {
    const mineSame = eq(base, mine);
    const theirsSame = eq(base, theirs);
    if (mineSame && theirsSame) return 'unchanged';
    if (theirsSame) return 'take-mine';
    if (mineSame) return 'take-theirs';
    return eq(mine, theirs) ? 'take-either' : 'conflict';
  }
  if (theirs === undefined) return 'take-mine';
  if (mine === undefined) return 'take-theirs';
  if (same(mine, theirs)) return 'take-either';
  return canCollide ? 'collision' : 'conflict';
}
