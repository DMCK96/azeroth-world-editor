import type { MergeDocument } from './doc';
import type { MergeKind } from './kind';
import { MERGE_KINDS } from './kinds';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyKind = MergeKind<any>;

const byKey = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true });

/**
 * References in the result to project items that a source has but the result does not, such as a
 * group naming a quest dropped when its conflict went the other way. A reference to something no
 * source has belongs to the database and cannot be checked here.
 */
export function checkReferences(result: MergeDocument, sources: readonly MergeDocument[], kinds: readonly AnyKind[] = MERGE_KINDS): string[] {
  const byKind = new Map(kinds.map((kind) => [kind.key, kind]));
  const inResult = new Map<string, Set<string>>();
  const inSources = new Map<string, Set<string>>();
  const keysOf = (cache: Map<string, Set<string>>, kindKey: string, docs: readonly MergeDocument[]): Set<string> => {
    let keys = cache.get(kindKey);
    if (!keys) {
      const kind = byKind.get(kindKey)!;
      keys = new Set(docs.flatMap((doc) => [...kind.items(doc).keys()]));
      cache.set(kindKey, keys);
    }
    return keys;
  };

  const warnings: string[] = [];
  for (const kind of kinds) {
    if (!kind.references) continue;
    const items = kind.items(result);
    for (const key of [...items.keys()].sort(byKey)) {
      const item = items.get(key);
      for (const ref of kind.references(item)) {
        if (!byKind.has(ref.kind)) continue;
        if (keysOf(inResult, ref.kind, [result]).has(ref.key)) continue;
        if (!keysOf(inSources, ref.kind, sources).has(ref.key)) continue;
        warnings.push(`${kind.describe(item)} points at ${ref.kind} ${ref.key}, which is not in the result`);
      }
    }
  }
  return warnings;
}
