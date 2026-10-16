/**
 * The next free ids above the database and the project: one more than the larger of the database's
 * highest id and every id the project already uses. The rule behind `allocateIds` and the renumber of
 * clashing ids, so the two always agree.
 */
export function idsAbove(dbMax: number, used: readonly number[], count: number): number[] {
  const base = Math.max(dbMax, ...used, 0);
  return Array.from({ length: count }, (_, i) => base + i + 1);
}
