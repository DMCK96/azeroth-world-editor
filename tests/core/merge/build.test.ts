import { describe, expect, it } from 'vitest';
import { applyMerge, previewMerge, UnsettledConflictError } from '../../../src/core/merge/build';
import { newNpc } from '../../../src/core/entities/model';
import { docOf, emptyDoc, placed, quest } from './helpers';

const withQuests = (...q: ReturnType<typeof quest>[]) => docOf({ quests: q });
const ids = (d: { quests: { questId: number }[] }) => d.quests.map((q) => q.questId).sort((a, b) => a - b);
const title = (d: ReturnType<typeof withQuests>, id: number) => d.quests.find((q) => q.questId === id)!.aggregate.values['quest_template.LogTitle'];
const at = (x: number) => ({ x, y: 0, z: 0, orientation: 0, rotation: null });
const deleted = (guid: number) => ({ kind: 'creature', guid, entry: 1, name: 'Wolf', map: 0, placement: at(0), rows: [] }) as never;
const movement = (guid: number) => ({ guid, entry: 1, name: 'Wolf', map: 0, addonRow: false, original: { type: 0 }, current: { type: 1 } }) as never;
const worldOf = (part: object) => docOf({ world: { spawns: [], routes: [], added: [], ...part } as never });

describe('applyMerge', () => {
  it('unions work done on either side', () => {
    const base = withQuests(quest(1));
    const out = applyMerge({ base, mine: withQuests(quest(1), quest(2)), theirs: withQuests(quest(1), quest(3)) }, {});
    expect(ids(out)).toEqual([1, 2, 3]);
  });

  it('applies removals made on one side', () => {
    const base = withQuests(quest(1), quest(2));
    expect(ids(applyMerge({ base, mine: withQuests(quest(1)), theirs: base }, {}))).toEqual([1]);
    expect(ids(applyMerge({ base, mine: base, theirs: withQuests(quest(2)) }, {}))).toEqual([2]);
  });

  it('refuses while a conflict has no choice, naming it', () => {
    const base = withQuests(quest(1, 'a'));
    const inputs = { base, mine: withQuests(quest(1, 'b')), theirs: withQuests(quest(1, 'c')) };
    try { applyMerge(inputs, {}); throw new Error('did not throw'); } catch (e) {
      expect(e).toBeInstanceOf(UnsettledConflictError);
      expect((e as UnsettledConflictError).decisionIds).toEqual(['quest|1']);
    }
  });

  it('takes the side chosen for a conflict', () => {
    const base = withQuests(quest(1, 'a'));
    const inputs = { base, mine: withQuests(quest(1, 'b')), theirs: withQuests(quest(1, 'c')) };
    expect(title(applyMerge(inputs, { 'quest|1': 'mine' }), 1)).toBe('b');
    expect(title(applyMerge(inputs, { 'quest|1': 'theirs' }), 1)).toBe('c');
  });

  it('ignores a choice for something that is not a decision', () => {
    const d = withQuests(quest(1));
    expect(ids(applyMerge({ base: d, mine: d, theirs: d }, { 'quest|99': 'theirs' }))).toEqual([1]);
  });

  it('keeps mine\'s canvas position when the other side only edited the quest', () => {
    const base = withQuests(quest(1, 'a', { x: 0, y: 0 }));
    const out = applyMerge({ base, mine: withQuests(quest(1, 'a', { x: 400, y: 7 })), theirs: withQuests(quest(1, 'a', { x: 0, y: 0 })) }, {});
    expect(out.quests[0]).toMatchObject({ x: 400, y: 7 });
  });

  it('keeps both on a collision by default, renumbering theirs and rewriting what refers to it', () => {
    const grp = { id: 1, name: 'g', map: 0, maxActive: 1, members: [{ type: 'quest', questId: 60001 }], event: null, origin: { kind: 'new' } } as never;
    const mine = withQuests(quest(60001, 'mine'));
    const theirs = docOf({ quests: [quest(60001, 'theirs')], world: { spawns: [], routes: [], added: [], groups: [grp] } });
    const out = applyMerge({ base: emptyDoc(), mine, theirs }, {});
    expect(ids(out)).toEqual([60001, 60002]);
    expect(title(out, 60001)).toBe('mine');
    expect(title(out, 60002)).toBe('theirs');
    expect((out.world.groups![0]!.members[0] as any).questId).toBe(60002);
  });

  it('keeps both of a collision that only shows once another collision is renumbered', () => {
    const npc = (name: string) => ({ ...newNpc(90001), name });
    const side = (name: string) => docOf({ entities: { npcs: [npc(name)], objects: [], items: [] }, world: { spawns: [], routes: [], added: [placed(700, 90001)] } });
    const inputs = { base: emptyDoc(), mine: side('Mine'), theirs: side('Theirs') };
    const out = applyMerge(inputs, {});
    expect(out.world.added.map((a) => [a.guid, a.entry])).toEqual([[700, 90001], [701, 90002]]);
    const preview = previewMerge(inputs, {});
    expect(preview.decisions.map((d) => [d.id, d.newKey])).toEqual([['npc|90001', '90002'], ['placed-spawn|creature:700', 'creature:701']]);
    expect(preview.settled).toBe(true);
    expect(preview.dropped).toEqual([]);
    expect(preview.summary.find((r) => r.kind === 'placed-spawn')).toMatchObject({ fromMine: 1, renumbered: 1, total: 2 });
  });

  it('uses distinct new ids for several collisions', () => {
    const out = applyMerge({ base: emptyDoc(), mine: withQuests(quest(10, 'm1'), quest(11, 'm2')), theirs: withQuests(quest(10, 't1'), quest(11, 't2')) }, {});
    expect(ids(out)).toEqual([10, 11, 12, 13]);
  });

  it('keeps only mine, or only theirs, when the collision is settled that way', () => {
    const inputs = { base: emptyDoc(), mine: withQuests(quest(60001, 'mine')), theirs: withQuests(quest(60001, 'theirs')) };
    expect(title(applyMerge(inputs, { 'quest|60001': 'mine' }), 60001)).toBe('mine');
    expect(ids(applyMerge(inputs, { 'quest|60001': 'mine' }))).toEqual([60001]);
    expect(title(applyMerge(inputs, { 'quest|60001': 'theirs' }), 60001)).toBe('theirs');
  });

  it('settles a linked spawn decision for all of its entries', () => {
    const inputs = { base: worldOf({}), mine: worldOf({ deletes: [deleted(5)] }), theirs: worldOf({ movements: [movement(5)] }) };
    const mine = applyMerge(inputs, { 'spawn|creature:5': 'mine' });
    expect(mine.world.deletes).toHaveLength(1);
    expect(mine.world.movements ?? []).toHaveLength(0);
    const theirs = applyMerge(inputs, { 'spawn|creature:5': 'theirs' });
    expect(theirs.world.deletes ?? []).toHaveLength(0);
    expect(theirs.world.movements).toHaveLength(1);
  });

  it('merges two projects that are the same, and two empty ones, to the same project', () => {
    const d = withQuests(quest(1), quest(2));
    expect(applyMerge({ base: d, mine: d, theirs: d }, {})).toEqual(d);
    expect(applyMerge({ base: emptyDoc(), mine: emptyDoc(), theirs: emptyDoc() }, {})).toEqual(emptyDoc());
  });

  it('does not change any input', () => {
    const mine = withQuests(quest(60001, 'm'));
    const theirs = withQuests(quest(60001, 't'));
    const before = JSON.stringify([mine, theirs]);
    applyMerge({ base: emptyDoc(), mine, theirs }, {});
    expect(JSON.stringify([mine, theirs])).toBe(before);
  });

  it('merges placed spawns by kind and guid', () => {
    const out = applyMerge({ base: null, mine: worldOf({ added: [placed(5, 1, 0)] }), theirs: worldOf({ added: [placed(6, 1, 0)] }) }, {});
    expect(out.world.added.map((s) => s.guid)).toEqual([5, 6]);
  });
});

describe('previewMerge', () => {
  it('lists what is dropped, from which file, and how many items each side gives', () => {
    const base = withQuests(quest(1, 'a'));
    const inputs = { base, mine: withQuests(quest(1, 'b'), quest(2)), theirs: withQuests(quest(1, 'c'), quest(3)) };
    const p = previewMerge(inputs, { 'quest|1': 'mine' });
    expect(p.settled).toBe(true);
    expect(p.dropped).toEqual([{ from: 'theirs', what: 'item', kind: 'quest', label: 'Quests', key: '1', line: 'Quest 1: c' }]);
    expect(p.summary.find((r) => r.kind === 'quest')).toMatchObject({ fromMine: 2, fromTheirs: 1, total: 3 });
  });

  it('shows a removal that was overridden as a removal on the losing side', () => {
    const base = withQuests(quest(1, 'a'));
    const inputs = { base, mine: emptyDoc(), theirs: withQuests(quest(1, 'c')) };
    const p = previewMerge(inputs, { 'quest|1': 'theirs' });
    expect(p.dropped).toEqual([{ from: 'mine', what: 'removal', kind: 'quest', label: 'Quests', key: '1', line: 'Removal of Quest 1: c' }]);
  });

  it('reports unsettled conflicts without throwing, and counts them as mine', () => {
    const base = withQuests(quest(1, 'a'));
    const p = previewMerge({ base, mine: withQuests(quest(1, 'b')), theirs: withQuests(quest(1, 'c')) }, {});
    expect(p.settled).toBe(false);
    expect(p.decisions).toHaveLength(1);
  });

  it('drops nothing, and renumbers one item, for keep both', () => {
    const p = previewMerge({ base: emptyDoc(), mine: withQuests(quest(5, 'm')), theirs: withQuests(quest(5, 't')) }, {});
    expect(p.dropped).toEqual([]);
    expect(p.summary.find((r) => r.kind === 'quest')).toMatchObject({ fromMine: 1, renumbered: 1, total: 2 });
  });

  it('warns about a reference left pointing at something dropped', () => {
    const grp = { id: 1, name: 'g', map: 0, maxActive: 1, members: [{ type: 'quest', questId: 7 }], event: null, origin: { kind: 'new' } } as never;
    const theirs = docOf({ quests: [quest(7, 't')], world: { spawns: [], routes: [], added: [], groups: [grp] } });
    // Mine removed quest 7 while theirs edited it and grouped it; keeping mine's removal drops it
    const p = previewMerge({ base: withQuests(quest(7, 'a')), mine: emptyDoc(), theirs }, { 'quest|7': 'mine' });
    expect(p.warnings.join(' ')).toMatch(/Group 1 g points at quest 7/);
  });
  describe('a collision settled one way', () => {
    const group = (questId: number) => ({ id: 1, name: 'g', map: 0, maxActive: 1, members: [{ type: 'quest', questId }], event: null, origin: { kind: 'new' } }) as never;
    const withGroup = (q: ReturnType<typeof quest>[], g: never) => docOf({ quests: q, world: { spawns: [], routes: [], added: [], groups: [g] } });
    const line = (from: string) => `Group 1 g comes from ${from} and points at quest 60001, which in the result is a different item`;

    it("warns that theirs' reference now points at mine's different item", () => {
      const inputs = { base: emptyDoc(), mine: withQuests(quest(60001, 'mine')), theirs: withGroup([quest(60001, 'theirs')], group(60001)) };
      expect(previewMerge(inputs, { 'quest|60001': 'mine' }).warnings).toContain(line('theirs'));
    });

    it('does not warn for keep both, which rewrites the reference', () => {
      const inputs = { base: emptyDoc(), mine: withQuests(quest(60001, 'mine')), theirs: withGroup([quest(60001, 'theirs')], group(60001)) };
      const p = previewMerge(inputs, { 'quest|60001': 'both' });
      expect(p.warnings.join(' ')).not.toMatch(/different item/);
    });

    it("warns that mine's reference now points at theirs' different item", () => {
      const inputs = { base: emptyDoc(), mine: withGroup([quest(60001, 'mine')], group(60001)), theirs: withQuests(quest(60001, 'theirs')) };
      const before = JSON.stringify(inputs);
      expect(previewMerge(inputs, { 'quest|60001': 'theirs' }).warnings).toContain(line('mine'));
      expect(JSON.stringify(inputs)).toBe(before);
    });

    it('does not warn for a losing-side item that names something else', () => {
      const inputs = { base: emptyDoc(), mine: withQuests(quest(60001, 'mine')), theirs: withGroup([quest(60001, 'theirs'), quest(60005, 'x')], group(60005)) };
      const p = previewMerge(inputs, { 'quest|60001': 'mine' });
      expect(p.warnings.join(' ')).not.toMatch(/different item/);
    });
  });
});
