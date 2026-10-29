import { describe, expect, it } from 'vitest';
import { newNpc, type CustomNpc } from '../../../src/core/entities/model';
import { planMerge } from '../../../src/core/merge/plan';
import { docOf, emptyDoc, quest } from './helpers';

const withQuests = (...q: ReturnType<typeof quest>[]) => docOf({ quests: q });
const at = (x: number) => ({ x, y: 0, z: 0, orientation: 0, rotation: null });
const spawnEdit = (guid: number, x: number) => ({ kind: 'creature', guid, entry: 1, name: 'Wolf', map: 0, original: at(0), current: at(x) }) as never;
const deleted = (guid: number) => ({ kind: 'creature', guid, entry: 1, name: 'Wolf', map: 0, placement: at(0), rows: [] }) as never;
const worldOf = (part: object) => docOf({ world: { spawns: [], routes: [], added: [], ...part } as never });
const withNpcs = (...npcs: CustomNpc[]) => docOf({ entities: { ...emptyDoc().entities, npcs } });
const existingNpc = (entry: number, name: string): CustomNpc => ({
  ...newNpc(entry),
  name,
  origin: { kind: 'existing', original: {}, sharedLoot: 0, spawnCount: 0, locked: [] },
});

describe('planMerge', () => {
  it('has nothing to decide for two identical projects, or two empty ones', () => {
    const d = withQuests(quest(1), quest(2));
    expect(planMerge({ base: d, mine: d, theirs: d }).decisions).toEqual([]);
    expect(planMerge({ base: emptyDoc(), mine: emptyDoc(), theirs: emptyDoc() }).decisions).toEqual([]);
  });

  it('takes a change made on one side without asking', () => {
    const base = withQuests(quest(1, 'a'));
    const plan = planMerge({ base, mine: withQuests(quest(1, 'b')), theirs: base });
    expect(plan.decisions).toEqual([]);
    expect(plan.entries.find((e) => e.key === '1')!.outcome).toBe('take-mine');
  });

  it('asks about a quest edited on both sides, with no default, and shows the difference', () => {
    const base = withQuests(quest(1, 'a'));
    const plan = planMerge({ base, mine: withQuests(quest(1, 'b')), theirs: withQuests(quest(1, 'c')) });
    expect(plan.decisions).toHaveLength(1);
    const d = plan.decisions[0]!;
    expect(d).toMatchObject({ id: 'quest|1', type: 'conflict', options: ['mine', 'theirs'], default: null, newKey: null });
    const entry = plan.entries.find((e) => e.decisionId === 'quest|1')!;
    expect(entry.diff.map((f) => f.field)).toEqual(['quest_template.LogTitle']);
    expect(entry.mine).toBe('Quest 1: b');
    expect(entry.theirs).toBe('Quest 1: c');
    expect(entry.base).toBe('Quest 1: a');
  });

  it('does not call a quest moved on the canvas a conflict when the other side edited it', () => {
    const base = withQuests(quest(1, 'a', { x: 0, y: 0 }));
    const plan = planMerge({ base, mine: withQuests(quest(1, 'a', { x: 400, y: 0 })), theirs: withQuests(quest(1, 'b', { x: 0, y: 0 })) });
    expect(plan.decisions).toEqual([]);
    expect(plan.entries.find((e) => e.key === '1')!.outcome).toBe('take-theirs');
  });

  it('calls two different quests added under one id a collision, defaulting to keep both, with the id theirs would take', () => {
    const plan = planMerge({ base: emptyDoc(), mine: withQuests(quest(60001, 'a')), theirs: withQuests(quest(60001, 'b'), quest(60005, 'c')) });
    const d = plan.decisions.find((x) => x.id === 'quest|60001')!;
    expect(d).toMatchObject({ type: 'collision', options: ['both', 'mine', 'theirs'], default: 'both', newKey: '60006' });
  });

  it('gives successive collisions of one kind distinct new keys', () => {
    const plan = planMerge({
      base: emptyDoc(),
      mine: withQuests(quest(60001, 'a'), quest(60002, 'a')),
      theirs: withQuests(quest(60001, 'b'), quest(60002, 'b')),
    });
    expect(plan.decisions.map((d) => d.newKey)).toEqual(['60003', '60004']);
  });

  it('lists what keep-both rewrites on their side', () => {
    const grp = { id: 1, name: 'g', map: 0, maxActive: 1, members: [{ type: 'quest', questId: 60001 }], event: null, origin: { kind: 'new' } } as never;
    const theirs = docOf({ quests: [quest(60001, 'b')], world: { spawns: [], routes: [], added: [], groups: [grp] } });
    const plan = planMerge({ base: emptyDoc(), mine: withQuests(quest(60001, 'a')), theirs });
    expect(plan.decisions[0]!.rewrites).toEqual(['Group 1 g']);
  });

  it('merges without a base: everything on one side is an add, and says the direction is unknown', () => {
    const plan = planMerge({ base: null, mine: withQuests(quest(1)), theirs: withQuests(quest(2)) });
    expect(plan.twoWay).toBe(true);
    expect(plan.decisions).toEqual([]);
    expect(plan.warnings.join(' ')).toMatch(/no base/i);
  });

  it('without a base, a database spawn moved differently on both sides is a conflict', () => {
    const plan = planMerge({ base: null, mine: worldOf({ spawns: [spawnEdit(7, 1)] }), theirs: worldOf({ spawns: [spawnEdit(7, 2)] }) });
    expect(plan.decisions.map((d) => [d.id, d.type])).toEqual([['spawn-edit|creature:7', 'conflict']]);
  });

  it('without a base, an existing NPC edited differently on both sides is a conflict, never a collision', () => {
    const plan = planMerge({ base: null, mine: withNpcs(existingNpc(500, 'a')), theirs: withNpcs(existingNpc(500, 'b')) });
    expect(plan.decisions).toHaveLength(1);
    expect(plan.decisions[0]).toMatchObject({ id: 'npc|500', type: 'conflict', options: ['mine', 'theirs'], default: null, newKey: null });
    expect(plan.entries.find((e) => e.kind === 'npc')!.outcome).toBe('conflict');
  });

  it('without a base, two new NPCs under one entry are a collision', () => {
    const plan = planMerge({ base: null, mine: withNpcs({ ...newNpc(500), name: 'a' }), theirs: withNpcs({ ...newNpc(500), name: 'b' }) });
    expect(plan.decisions).toHaveLength(1);
    expect(plan.decisions[0]).toMatchObject({ id: 'npc|500', type: 'collision', options: ['both', 'mine', 'theirs'], default: 'both' });
  });

  it('turns a deletion on one side and an edit of the same spawn on the other into one linked conflict', () => {
    const base = worldOf({ spawns: [] });
    const mine = worldOf({ deletes: [deleted(5)] });
    const theirs = worldOf({ movements: [{ guid: 5, entry: 1, name: 'Wolf', map: 0, addonRow: false, original: { type: 0 }, current: { type: 1 } }] });
    const plan = planMerge({ base, mine, theirs });
    expect(plan.decisions).toHaveLength(1);
    expect(plan.decisions[0]).toMatchObject({ id: 'spawn|creature:5', type: 'conflict', options: ['mine', 'theirs'], default: null });
    expect(plan.decisions[0]!.entryIds.sort()).toEqual(['deleted-spawn|creature:5', 'movement|5']);
    expect(plan.entries.filter((e) => e.decisionId === 'spawn|creature:5').map((e) => e.outcome)).toEqual(['conflict', 'conflict']);
  });

  it('does not link a deletion to an edit of the same spawn made on the same side', () => {
    const plan = planMerge({ base: worldOf({}), mine: worldOf({ deletes: [deleted(5)], spawns: [spawnEdit(5, 1)] }), theirs: worldOf({}) });
    expect(plan.decisions).toEqual([]);
  });

  it('does not link a deletion to edits of other spawns', () => {
    const plan = planMerge({ base: worldOf({}), mine: worldOf({ deletes: [deleted(5)] }), theirs: worldOf({ spawns: [spawnEdit(6, 1)] }) });
    expect(plan.decisions).toEqual([]);
  });

  it('warns that the base may be the wrong file when it shares almost nothing with either side', () => {
    const base = withQuests(quest(1), quest(2), quest(3), quest(4));
    const plan = planMerge({ base, mine: withQuests(quest(90)), theirs: withQuests(quest(91)) });
    expect(plan.warnings.join(' ')).toMatch(/may be the wrong file/i);
  });

  it('does not warn for a base that most of the items came from', () => {
    const base = withQuests(quest(1), quest(2));
    expect(planMerge({ base, mine: withQuests(quest(1), quest(2), quest(3)), theirs: base }).warnings).toEqual([]);
  });

  it('orders decisions by kind order then key, and entries the same way', () => {
    const plan = planMerge({ base: emptyDoc(), mine: docOf({ quests: [quest(2, 'a'), quest(1, 'a')] }), theirs: docOf({ quests: [quest(2, 'b'), quest(1, 'b')] }) });
    expect(plan.decisions.map((d) => d.id)).toEqual(['quest|1', 'quest|2']);
    expect(plan.entries.map((e) => e.key)).toEqual(['1', '2']);
  });

  it('places a kind that throws in the error, naming the kind', () => {
    const bad = { key: 'bad', label: 'Bad', canCollide: false, items: () => { throw new Error('boom'); } } as never;
    expect(() => planMerge({ base: null, mine: emptyDoc(), theirs: emptyDoc() }, [bad])).toThrow(/bad.*boom/i);
  });

  it('is generic: a kind it has never heard of is classified like any other', () => {
    const fake = {
      key: 'fake', label: 'Fakes', canCollide: false,
      items: (d: any) => new Map((d.fake ?? []).map((n: number) => [String(n), n])),
      same: (a: number, b: number) => a === b, describe: (n: number) => `fake ${n}`, diff: () => [], write: (d: any) => d,
    } as never;
    const mk = (fake: number[]) => ({ ...emptyDoc(), fake }) as never;
    const plan = planMerge({ base: mk([]), mine: mk([1]), theirs: mk([2]) }, [fake]);
    expect(plan.entries.map((e) => [e.key, e.outcome])).toEqual([['1', 'take-mine'], ['2', 'take-theirs']]);
  });
});
