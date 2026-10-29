import { idsAbove } from '../ids/free';
import { spawnGuidKind } from '../ids/kinds/spawn-guid';
import type { MergeDocument } from './doc';
import type { Choice, MergePlan, PlanEntry } from './plan';

/**
 * Spawn guids are allocated inside NPCs and objects as well as by the 3D view's placed spawns, so two
 * projects from one base hand the same next guid to different spawns. No kind keys on an NPC's spawn,
 * so the plan cannot see that clash: here each spawn of theirs the result takes, at a guid mine uses
 * for something else, moves to a free guid through the spawn-guid rename, which follows everything
 * that names it.
 */

export interface SpreadGuids {
  /** Theirs with the clashing spawns moved; the same document when none clash */
  doc: MergeDocument;
  /** One line per move, for the preview */
  moves: string[];
  /** `placed-spawn|${scope}:${guid}` of the placed spawns of theirs that moved */
  movedPlaced: string[];
}

type Scope = 'creature' | 'gameobject';

/** Which side the result takes an entry's item from, as the build decides it */
const takesTheirs = (entry: PlanEntry | undefined, picks: Map<string, Choice>): boolean =>
  entry !== undefined && (entry.decisionId !== null ? picks.get(entry.decisionId) === 'theirs' : entry.outcome === 'take-theirs');

/** What holds each guid in the document, as `npc:entry`, `object:entry` or `placed`, by `${scope}:${guid}` */
function ownersOf(doc: MergeDocument): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  const add = (scope: Scope, guid: number, owner: string): void => {
    const at = `${scope}:${guid}`;
    owners.set(at, (owners.get(at) ?? new Set()).add(owner));
  };
  for (const n of doc.entities.npcs) for (const s of n.spawns) add('creature', s.guid, `npc:${n.entry}`);
  for (const o of doc.entities.objects) for (const s of o.spawns) add('gameobject', s.guid, `object:${o.entry}`);
  for (const a of doc.world.added) add(a.kind, a.guid, 'placed');
  return owners;
}

/** Theirs with each spawn the result takes from it moved off a guid mine holds for something else */
export function spreadSpawnGuids(base: MergeDocument | null, mine: MergeDocument, theirs: MergeDocument, plan: MergePlan, picks: Map<string, Choice>): SpreadGuids {
  const entries = new Map(plan.entries.map((e) => [`${e.kind}|${e.key}`, e]));
  const mineOwners = ownersOf(mine);
  const baseAdded = new Set((base?.world.added ?? []).map((a) => `${a.kind}:${a.guid}`));
  const clashes = (scope: Scope, guid: number, owner: string): boolean => [...(mineOwners.get(`${scope}:${guid}`) ?? [])].some((o) => o !== owner);

  // Every spawn this tool moves, found on theirs as it stands, in document order
  const wanted: { scope: Scope; guid: number; line: string; placed: boolean }[] = [];
  for (const [list, kindKey, scope, noun] of [
    [theirs.entities.npcs, 'npc', 'creature', 'NPC'],
    [theirs.entities.objects, 'object', 'gameobject', 'Object'],
  ] as const) {
    for (const e of list) {
      if (!takesTheirs(entries.get(`${kindKey}|${e.entry}`), picks)) continue;
      for (const s of e.spawns) {
        if (clashes(scope, s.guid, `${kindKey}:${e.entry}`)) wanted.push({ scope, guid: s.guid, line: `Their ${noun} ${e.entry} ${e.name} spawn`, placed: false });
      }
    }
  }
  for (const a of theirs.world.added) {
    const key = `${a.kind}:${a.guid}`;
    // A placed spawn the base had is the same spawn on both sides; only a new one can clash
    if (baseAdded.has(key) || !takesTheirs(entries.get(`placed-spawn|${key}`), picks)) continue;
    if (clashes(a.kind, a.guid, 'placed')) wanted.push({ scope: a.kind, guid: a.guid, line: `Their ${a.name} (${a.kind} ${a.guid}) placed spawn`, placed: true });
  }
  if (wanted.length === 0) return { doc: theirs, moves: [], movedPlaced: [] };

  const docs = [base, mine, theirs].filter((d): d is MergeDocument => d !== null);
  const used = { creature: [] as number[], gameobject: [] as number[] };
  for (const d of docs) for (const c of spawnGuidKind.claims(d)) used[c.scope as Scope].push(c.id);

  let doc = theirs;
  const moves: string[] = [];
  const movedPlaced: string[] = [];
  for (const { scope, guid, line, placed } of wanted) {
    const to = idsAbove(0, used[scope], 1)[0]!;
    used[scope].push(to);
    const { entities, world } = spawnGuidKind.rename({ entities: doc.entities, world: doc.world }, scope, guid, to);
    doc = { ...doc, entities, world };
    moves.push(`${line} at guid ${guid} moves to guid ${to}, as mine uses ${guid}`);
    if (placed) movedPlaced.push(`placed-spawn|${scope}:${to}`);
  }
  return { doc, moves, movedPlaced };
}
