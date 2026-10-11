const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/;

/** `MAJOR.MINOR.PATCH` with an optional leading v; anything else (a pre-release suffix, junk) is not a release version */
export function parseVersion(text: string): [number, number, number] | null {
  const m = VERSION.exec(text);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** The version without its leading v, or null when it is not one */
export function normalizeVersion(text: string): string | null {
  const parts = parseVersion(text);
  return parts ? parts.join('.') : null;
}

/** Negative when `a` is older, zero when equal, positive when newer; compared as numbers, so 0.10.0 is newer than 0.9.0 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left) throw new RangeError(`Not a version: ${a}`);
  if (!right) throw new RangeError(`Not a version: ${b}`);
  for (let i = 0; i < 3; i++) {
    const diff = left[i]! - right[i]!;
    if (diff !== 0) return diff;
  }
  return 0;
}
