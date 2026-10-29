import type { MergeDocument } from './doc';
import type { MergeKind } from './kind';
import { MERGE_KINDS } from './kinds';
import { planMerge, type Choice, type Choices, type Decision, type MergeInputs, type MergePlan, type PlanEntry } from './plan';
import { checkReferences } from './references';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyKind = MergeKind<any>;

/** Thrown by `applyMerge` while a conflict has neither a choice nor a default. */
export class UnsettledConflictError extends Error {
  readonly decisionIds: string[];
  constructor(decisionIds: string[]) {
    super(`These conflicts need a choice before the merge can be applied: ${decisionIds.join(', ')}`);
    this.name = 'UnsettledConflictError';
    this.decisionIds = decisionIds;
  }
}

/** An item, or the removal of one, that a side's file has and the result does not. */
export interface Dropped {
  from: 'mine' | 'theirs';
  what: 'item' | 'removal';
  kind: string;
  label: string;
  key: string;
  line: string;
}

/** How many items of a kind the result holds, by where each came from. */
export interface SummaryRow {
  kind: string;
  label: string;
  common: number;
  fromMine: number;
  fromTheirs: number;
  renumbered: number;
  total: number;
}

export interface MergePreview {
  twoWay: boolean;
  summary: SummaryRow[];
  dropped: Dropped[];
  decisions: Decision[];
  entries: PlanEntry[];
  settled: boolean;
  warnings: string[];
}

/** Everything a merge resolves to, before the result is built */
interface Resolved {
  plan: MergePlan;
  /** The plan over the renumbered theirs, which the result is built from */
  plan2: MergePlan;
  /** Theirs with every keep-both collision moved to its new key */
  theirs2: MergeDocument;
  /** Decision ids that have a choice or a default */
  settledIds: Set<string>;
  /** Decision ids with neither, in plan order */
  unsettled: string[];
  /** The choice each decision of either plan resolves to; unsettled ones count as mine */
  picks: Map<string, Choice>;
  /** `${kind}|${key}` of the items theirs holds at a keep-both collision's new key */
  renumbered: Set<string>;
}

/** `quest|7` as its kind and key */
const splitId = (id: string): [string, string] => {
  const at = id.indexOf('|');
  return [id.slice(0, at), id.slice(at + 1)];
};

function resolve(inputs: MergeInputs, choices: Choices, kinds: readonly AnyKind[]): Resolved {
  const byKind = new Map(kinds.map((kind) => [kind.key, kind]));
  const plan = planMerge(inputs, kinds);
  const settledIds = new Set<string>();
  const unsettled: string[] = [];
  const picks = new Map<string, Choice>();

  // A choice that is not one of the decision's options is ignored, like one for no decision at all
  const settle = (decision: Decision): void => {
    if (picks.has(decision.id)) return;
    const own = Object.prototype.hasOwnProperty.call(choices, decision.id) ? choices[decision.id] : undefined;
    const choice = own !== undefined && decision.options.includes(own) ? own : (decision.default ?? undefined);
    if (choice === undefined) {
      unsettled.push(decision.id);
      picks.set(decision.id, 'mine');
      return;
    }
    settledIds.add(decision.id);
    picks.set(decision.id, choice);
  };
  for (const decision of plan.decisions) settle(decision);

  // Keep-both collisions move theirs to the plan's new key, in decision order
  let theirs2 = inputs.theirs;
  const renumbered = new Set<string>();
  for (const decision of plan.decisions) {
    if (decision.type !== 'collision' || picks.get(decision.id) !== 'both' || decision.newKey === null) continue;
    const [kindKey, key] = splitId(decision.id);
    const kind = byKind.get(kindKey);
    if (!kind?.renumber) continue;
    theirs2 = kind.renumber(theirs2, key, decision.newKey);
    renumbered.add(`${kindKey}|${decision.newKey}`);
  }

  const plan2 = theirs2 === inputs.theirs ? plan : planMerge({ ...inputs, theirs: theirs2 }, kinds);
  // A decision the renumber leaves in place keeps its choice; one it brings up is settled on its own
  const first = new Map(plan.decisions.map((d) => [d.id, d]));
  for (const decision of plan2.decisions) {
    if (first.has(decision.id)) continue;
    settle(decision);
  }
  return { plan, plan2, theirs2, settledIds, unsettled, picks, renumbered };
}

/** Which side an entry's item comes from; a keep-both left in the second plan has no new key and keeps mine */
function sideFor(entry: PlanEntry, picks: Map<string, Choice>): 'mine' | 'theirs' {
  if (entry.decisionId !== null) return picks.get(entry.decisionId) === 'theirs' ? 'theirs' : 'mine';
  return entry.outcome === 'take-theirs' ? 'theirs' : 'mine';
}

/** The result: mine, with each kind written again where its resolved items differ from mine's */
function build(inputs: MergeInputs, r: Resolved, kinds: readonly AnyKind[]): MergeDocument {
  let doc = inputs.mine;
  for (const kind of kinds) {
    const mine = kind.items(inputs.mine);
    const theirs = kind.items(r.theirs2);
    const items = new Map<string, unknown>();
    for (const entry of r.plan2.entries) {
      if (entry.kind !== kind.key) continue;
      const item = sideFor(entry, r.picks) === 'theirs' ? theirs.get(entry.key) : mine.get(entry.key);
      if (item !== undefined) items.set(entry.key, item);
    }
    const unchanged = items.size === mine.size && [...items].every(([key, item]) => mine.get(key) === item);
    if (!unchanged) doc = kind.write(doc, items);
  }
  return structuredClone(doc);
}

/** Merges two projects over their base with the choices given; throws while a conflict is unsettled. Changes no input. */
export function applyMerge(inputs: MergeInputs, choices: Choices, kinds: readonly AnyKind[] = MERGE_KINDS): MergeDocument {
  const r = resolve(inputs, choices, kinds);
  if (r.unsettled.length > 0) throw new UnsettledConflictError(r.unsettled);
  return build(inputs, r, kinds);
}

function summaryOf(r: Resolved, kinds: readonly AnyKind[], inputs: MergeInputs): SummaryRow[] {
  const rows: SummaryRow[] = [];
  for (const kind of kinds) {
    const mine = kind.items(inputs.mine);
    const theirs = kind.items(r.theirs2);
    const row: SummaryRow = { kind: kind.key, label: kind.label, common: 0, fromMine: 0, fromTheirs: 0, renumbered: 0, total: 0 };
    for (const entry of r.plan2.entries) {
      if (entry.kind !== kind.key) continue;
      const side = sideFor(entry, r.picks);
      if ((side === 'mine' ? mine : theirs).get(entry.key) === undefined) continue;
      if (r.renumbered.has(`${kind.key}|${entry.key}`)) row.renumbered += 1;
      else if (entry.decisionId === null && (entry.outcome === 'unchanged' || entry.outcome === 'take-either')) row.common += 1;
      else if (side === 'mine') row.fromMine += 1;
      else row.fromTheirs += 1;
    }
    row.total = row.common + row.fromMine + row.fromTheirs + row.renumbered;
    if (row.total > 0) rows.push(row);
  }
  return rows;
}

function droppedOf(r: Resolved, kinds: readonly AnyKind[], inputs: MergeInputs): Dropped[] {
  const byKind = new Map(kinds.map((kind) => [kind.key, kind]));
  const dropped: Dropped[] = [];
  for (const decision of r.plan2.decisions) {
    const pick = r.picks.get(decision.id);
    if (pick !== 'mine' && pick !== 'theirs') continue;
    const loser = pick === 'mine' ? 'theirs' : 'mine';
    for (const id of decision.entryIds) {
      const [kindKey, key] = splitId(id);
      const kind = byKind.get(kindKey)!;
      const items = { mine: kind.items(inputs.mine).get(key), theirs: kind.items(r.theirs2).get(key) };
      const lost = items[loser];
      const won = items[pick];
      const at = { from: loser, kind: kind.key, label: kind.label, key } as const;
      if (lost !== undefined) dropped.push({ ...at, what: 'item', line: kind.describe(lost) });
      else if (won !== undefined) dropped.push({ ...at, what: 'removal', line: `Removal of ${kind.describe(won)}` });
    }
  }
  return dropped;
}

/**
 * Items the losing side of a collision settled as mine or theirs keeps in the result that still name
 * the colliding key, which in the result is the winner's different item.
 */
function staleReferences(r: Resolved, kinds: readonly AnyKind[], inputs: MergeInputs): string[] {
  const byKey = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true });
  const lost = { mine: new Set<string>(), theirs: new Set<string>() };
  for (const decision of r.plan2.decisions) {
    const pick = r.picks.get(decision.id);
    if (decision.type !== 'collision' || (pick !== 'mine' && pick !== 'theirs')) continue;
    lost[pick === 'mine' ? 'theirs' : 'mine'].add(decision.id);
  }
  if (lost.mine.size === 0 && lost.theirs.size === 0) return [];

  const warnings: string[] = [];
  for (const kind of kinds) {
    if (!kind.references) continue;
    const docs = { mine: kind.items(inputs.mine), theirs: kind.items(r.theirs2) };
    const rows: { key: string; line: string }[] = [];
    for (const entry of r.plan2.entries) {
      if (entry.kind !== kind.key) continue;
      // An item both sides hold alike is not the losing side's alone
      if (entry.decisionId === null && (entry.outcome === 'unchanged' || entry.outcome === 'take-either')) continue;
      const side = sideFor(entry, r.picks);
      const ids = lost[side];
      if (ids.size === 0) continue;
      const item = docs[side].get(entry.key);
      if (item === undefined) continue;
      const named = new Set(kind.references(item).map((ref) => `${ref.kind}|${ref.key}`));
      for (const id of named) {
        if (!ids.has(id)) continue;
        const [refKind, refKey] = splitId(id);
        rows.push({ key: entry.key, line: `${kind.describe(item)} comes from ${side} and points at ${refKind} ${refKey}, which in the result is a different item` });
      }
    }
    rows.sort((a, b) => byKey(a.key, b.key));
    warnings.push(...rows.map((row) => row.line));
  }
  return warnings;
}

/** What merging with these choices would give, what it drops and what it warns about. Never throws on an unsettled conflict: it counts as mine. */
export function previewMerge(inputs: MergeInputs, choices: Choices, kinds: readonly AnyKind[] = MERGE_KINDS): MergePreview {
  const r = resolve(inputs, choices, kinds);
  const result = build(inputs, r, kinds);
  const sources = [inputs.base, inputs.mine, inputs.theirs, r.theirs2].filter((d): d is MergeDocument => d !== null);
  const known = new Set(r.plan.decisions.map((d) => d.id));
  return {
    twoWay: r.plan.twoWay,
    summary: summaryOf(r, kinds, inputs),
    dropped: droppedOf(r, kinds, inputs),
    decisions: [...r.plan.decisions, ...r.plan2.decisions.filter((d) => !known.has(d.id))],
    entries: r.plan.entries,
    settled: r.unsettled.length === 0,
    warnings: [...r.plan.warnings, ...staleReferences(r, kinds, inputs), ...checkReferences(result, sources, kinds)],
  };
}
