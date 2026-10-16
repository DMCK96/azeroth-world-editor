import type { WorldDb } from '../db/world-db';
import { claimKey, type IdConflict, type IdKind, type IdRename, type ProjectIds } from './kinds/kind';

/**
 * The project's ids that the database now holds something different at, over any kinds. A kind that
 * fails is skipped so one broken table never hides the others, or blocks opening a project.
 */
export async function findConflicts(db: WorldDb, project: ProjectIds, kinds: readonly IdKind[]): Promise<IdConflict[]> {
  const found: IdConflict[] = [];
  for (const kind of kinds) {
    try {
      const seen = new Set<string>();
      const claims = kind.claims(project).filter((c) => {
        const key = claimKey(c.scope, c.id);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (claims.length === 0) continue;
      const holders = await kind.holders(db, claims);
      for (const claim of claims) {
        const database = holders.get(claimKey(claim.scope, claim.id));
        if (!database || kind.isSameThing(claim, database)) continue;
        const { scope, id, ...mine } = claim;
        found.push({ kind: kind.key, scope, scopeLabel: kind.scopeLabel(scope), id, mine, database });
      }
    } catch {
      // This kind cannot be checked now; the others still are
    }
  }
  const order = (key: string): number => kinds.findIndex((k) => k.key === key);
  return found.sort((a, b) => order(a.kind) - order(b.kind) || (a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : 0) || a.id - b.id);
}

/** Where each conflicting id goes: one request per kind and scope for as many free ids as it has clashes */
export async function planRenumber(db: WorldDb, project: ProjectIds, kinds: readonly IdKind[], conflicts: readonly IdConflict[]): Promise<IdRename[]> {
  const groups = new Map<string, IdConflict[]>();
  for (const c of conflicts) {
    const key = `${c.kind}\u0000${c.scope}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const renames: IdRename[] = [];
  for (const group of groups.values()) {
    const first = group[0]!;
    const kind = kinds.find((k) => k.key === first.kind);
    if (!kind) continue;
    const free = await kind.freeIds(db, project, first.scope, group.length);
    group.forEach((c, i) => renames.push({ kind: c.kind, scope: c.scope, from: c.id, to: free[i]! }));
  }
  return renames;
}

/** The project with every rename applied, each by its own kind */
export function applyRenames(project: ProjectIds, kinds: readonly IdKind[], renames: readonly IdRename[]): ProjectIds {
  return renames.reduce((next, r) => {
    const kind = kinds.find((k) => k.key === r.kind);
    return kind ? kind.rename(next, r.scope, r.from, r.to) : next;
  }, project);
}
