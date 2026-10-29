import { classify, type Outcome } from './classify';
import type { MergeDocument } from './doc';
import type { FieldDiff, MergeKind } from './kind';
import { MERGE_KINDS } from './kinds';

export type Choice = 'mine' | 'theirs' | 'both';
export type Choices = Record<string, Choice>; // keyed by Decision.id

export interface MergeInputs { base: MergeDocument | null; mine: MergeDocument; theirs: MergeDocument }

export interface PlanEntry {
  decisionId: string | null;   // null when nothing needs deciding
  kind: string;                // kind key
  label: string;               // kind label
  key: string;
  outcome: Outcome;
  base: string | null;         // describe() of each side's item, null when absent
  mine: string | null;
  theirs: string | null;
  diff: FieldDiff[];           // mine against theirs
}

export interface Decision {
  id: string;                  // `${kind}|${key}`, or `spawn|${identity}` for a linked decision
  type: 'conflict' | 'collision';
  label: string;
  entryIds: string[];          // `${kind}|${key}` of the entries it settles
  options: Choice[];           // conflict: ['mine','theirs']; collision: ['both','mine','theirs']
  default: Choice | null;      // collision: 'both'; conflict: null
  newKey: string | null;       // collision: the key theirs takes under 'both'
  rewrites: string[];          // collision: describe() of theirs' items rewritten because of the renumber
}

export interface MergePlan {
  twoWay: boolean;
  entries: PlanEntry[];
  decisions: Decision[];
  warnings: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyKind = MergeKind<any>;

/** One key of one kind with each side's item, while the plan is built */
interface Row {
  kind: AnyKind;
  key: string;
  base: unknown;
  mine: unknown;
  theirs: unknown;
  entry: PlanEntry;
}

const byKey = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true });
const entryId = (kind: string, key: string): string => `${kind}|${key}`;

/** The kind's items in the document; a kind that fails is named in the error */
function itemsOf(kind: AnyKind, doc: MergeDocument | null): Map<string, unknown> {
  if (doc === null) return new Map();
  try {
    return kind.items(doc);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`The ${kind.key} items could not be read: ${message}`);
  }
}

const describeOf = (kind: AnyKind, item: unknown): string | null => (item === undefined ? null : kind.describe(item));

/** Whether the project allocated every present item's key, so they may be renumbered apart */
const allAllocated = (kind: AnyKind, items: unknown[]): boolean =>
  items.every((item) => item === undefined || !kind.allocated || kind.allocated(item));

function decisionFor(kind: AnyKind, key: string, type: 'conflict' | 'collision'): Decision {
  const collision = type === 'collision';
  return {
    id: entryId(kind.key, key),
    type,
    label: kind.label,
    entryIds: [entryId(kind.key, key)],
    options: collision ? ['both', 'mine', 'theirs'] : ['mine', 'theirs'],
    default: collision ? 'both' : null,
    newKey: null,
    rewrites: [],
  };
}

/** Which side a change comes from: one side, or both (a conflict); null when it needs no side */
function sideOf(outcome: Outcome): 'mine' | 'theirs' | 'both' | null {
  if (outcome === 'take-mine') return 'mine';
  if (outcome === 'take-theirs') return 'theirs';
  if (outcome === 'conflict') return 'both';
  return null;
}

/**
 * A deletion of a spawn on one side and a change to the same spawn from the other cannot both be
 * taken: each such group becomes one conflict over all its entries.
 */
function linkSpawns(rows: Row[], decisions: Map<string, Decision>): void {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    if (!row.kind.identity || row.entry.outcome === 'unchanged') continue;
    const item = row.mine ?? row.theirs ?? row.base;
    const identity = row.kind.identity(row.key, item);
    groups.set(identity, [...(groups.get(identity) ?? []), row]);
  }
  for (const [identity, group] of groups) {
    const linked = group.some((removal) => {
      if (!removal.kind.removesIdentity || (removal.mine === undefined) === (removal.theirs === undefined)) return false;
      const side = sideOf(removal.entry.outcome);
      if (side === null) return false;
      // A conflicting removal takes the side that holds it
      const from = side === 'both' ? (removal.mine !== undefined ? 'mine' : 'theirs') : side;
      return group.some((other) => {
        if (other.kind === removal.kind) return false;
        const otherSide = sideOf(other.entry.outcome);
        return otherSide === 'both' || (otherSide !== null && otherSide !== from);
      });
    });
    if (!linked) continue;
    const id = `spawn|${identity}`;
    const entryIds = group.map((r) => entryId(r.kind.key, r.key));
    for (const row of group) {
      decisions.delete(entryId(row.kind.key, row.key));
      row.entry.decisionId = id;
      row.entry.outcome = 'conflict';
    }
    decisions.set(id, { id, type: 'conflict', label: 'Spawns', entryIds, options: ['mine', 'theirs'], default: null, newKey: null, rewrites: [] });
  }
}

/**
 * The key each collision's theirs takes under keep-both, and what that renumber rewrites on their
 * side. Collisions are renumbered in turn, so successive new keys are distinct; choices do not matter.
 */
function settleCollisions(collisions: Row[], decisions: Map<string, Decision>, inputs: MergeInputs, kinds: readonly AnyKind[]): void {
  const fixed = [inputs.base, inputs.mine, inputs.theirs].filter((d): d is MergeDocument => d !== null);
  const renumbered: MergeDocument[] = [];
  let theirsSoFar = inputs.theirs;
  for (const row of collisions) {
    const { kind, key } = row;
    if (!kind.freeKey || !kind.renumber) continue;
    const decision = decisions.get(entryId(kind.key, key))!;
    const newKey = kind.freeKey(key, [...fixed, ...renumbered]);
    const after = kind.renumber(theirsSoFar, key, newKey);
    const rewrites: string[] = [];
    for (const other of kinds) {
      const before = itemsOf(other, theirsSoFar);
      const now = itemsOf(other, after);
      for (const k of [...before.keys()].sort(byKey)) {
        if (other === kind && (k === key || k === newKey)) continue;
        if (!now.has(k) || other.same(before.get(k), now.get(k))) continue;
        rewrites.push(other.describe(now.get(k)));
      }
    }
    decision.newKey = newKey;
    decision.rewrites = rewrites;
    renumbered.push(after);
    theirsSoFar = after;
  }
}

/** Warnings about the base: none chosen, or one that shares too little with either side */
function warningsFor(inputs: MergeInputs, kinds: readonly AnyKind[]): string[] {
  if (inputs.base === null) {
    return ['No base was chosen, so the merge cannot tell which side changed an item; items on both sides that differ are asked about.'];
  }
  let total = 0;
  let shared = 0;
  for (const kind of kinds) {
    const mine = itemsOf(kind, inputs.mine);
    const theirs = itemsOf(kind, inputs.theirs);
    for (const key of itemsOf(kind, inputs.base).keys()) {
      total += 1;
      if (mine.has(key) || theirs.has(key)) shared += 1;
    }
  }
  return total > 0 && shared < total / 2
    ? ['The base shares little with either project, so it may be the wrong file.']
    : [];
}

/** What merging two projects over their common base would do, and what needs deciding. */
export function planMerge(inputs: MergeInputs, kinds: readonly AnyKind[] = MERGE_KINDS): MergePlan {
  const rows: Row[] = [];
  const decisions = new Map<string, Decision>();
  const collisions: Row[] = [];

  for (const kind of kinds) {
    const base = itemsOf(kind, inputs.base);
    const mine = itemsOf(kind, inputs.mine);
    const theirs = itemsOf(kind, inputs.theirs);
    const keys = [...new Set([...base.keys(), ...mine.keys(), ...theirs.keys()])].sort(byKey);
    for (const key of keys) {
      const [b, m, t] = [base.get(key), mine.get(key), theirs.get(key)];
      const canCollide = kind.canCollide && allAllocated(kind, [m, t]);
      const outcome = classify(b, m, t, (x, y) => kind.same(x, y), canCollide);
      const needsDecision = outcome === 'conflict' || outcome === 'collision';
      const entry: PlanEntry = {
        decisionId: needsDecision ? entryId(kind.key, key) : null,
        kind: kind.key,
        label: kind.label,
        key,
        outcome,
        base: describeOf(kind, b),
        mine: describeOf(kind, m),
        theirs: describeOf(kind, t),
        diff: outcome === 'unchanged' ? [] : kind.diff(m ?? null, t ?? null),
      };
      const row: Row = { kind, key, base: b, mine: m, theirs: t, entry };
      rows.push(row);
      if (needsDecision) decisions.set(entryId(kind.key, key), decisionFor(kind, key, outcome));
      if (outcome === 'collision') collisions.push(row);
    }
  }

  linkSpawns(rows, decisions);
  settleCollisions(collisions, decisions, inputs, kinds);

  // Decisions in the order of the first entry each settles: kind order, then key
  const ordered: Decision[] = [];
  const seen = new Set<string>();
  for (const { entry } of rows) {
    if (entry.decisionId === null || seen.has(entry.decisionId)) continue;
    seen.add(entry.decisionId);
    ordered.push(decisions.get(entry.decisionId)!);
  }

  return { twoWay: inputs.base === null, entries: rows.map((r) => r.entry), decisions: ordered, warnings: warningsFor(inputs, kinds) };
}
