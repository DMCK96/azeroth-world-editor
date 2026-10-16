import { describe, expect, it } from 'vitest';
import { applyRenames, findConflicts, planRenumber } from '../../src/core/ids/conflicts';
import { claimKey, type IdClaim, type IdHolder, type IdKind, type ProjectIds } from '../../src/core/ids/kinds/kind';
import { EMPTY_ENTITIES } from '../../src/core/entities/model';
import { EMPTY_WORLD } from '../../src/core/world/layer';
import type { WorldDb } from '../../src/core/db/world-db';

const project: ProjectIds = { entities: EMPTY_ENTITIES, world: EMPTY_WORLD };
const db = {} as WorldDb;
const holder = (entry: number): IdHolder => ({ entry, name: `n${entry}`, map: 0, x: 0, y: 0, z: 0 });
const claim = (scope: string, id: number, entry = 1): IdClaim => ({ scope, id, ...holder(entry) });

interface Fake extends IdKind {
  renamed: [string, number, number][];
  freed: [string, number][];
}

/** `taken` is what the fake database holds, by `scope:id` */
function fakeKind(key: string, claims: IdClaim[], taken: Record<string, IdHolder>, throws = false): Fake {
  const renamed: [string, number, number][] = [];
  const freed: [string, number][] = [];
  return {
    key,
    noun: 'thing',
    renamed,
    freed,
    scopeLabel: (scope) => `label ${scope}`,
    claims: () => claims,
    holders: async () => {
      if (throws) throw new Error('boom');
      return new Map(Object.entries(taken));
    },
    isSameThing: (c, h) => c.entry === h.entry,
    rename: (p, scope, from, to) => {
      renamed.push([scope, from, to]);
      return p;
    },
    freeIds: async (_db, _p, scope, count) => {
      freed.push([scope, count]);
      return Array.from({ length: count }, (_, i) => 1000 + i);
    },
  };
}

describe('findConflicts', () => {
  it('reports a claimed id the database holds with something different', async () => {
    const kind = fakeKind('fake', [claim('a', 5, 1)], { [claimKey('a', 5)]: holder(2) });
    expect(await findConflicts(db, project, [kind])).toEqual([
      { kind: 'fake', noun: 'thing', scope: 'a', scopeLabel: 'label a', id: 5, mine: holder(1), database: holder(2) },
    ]);
  });

  it("does not report the project's own row", async () => {
    const kind = fakeKind('fake', [claim('a', 5, 1)], { [claimKey('a', 5)]: holder(1) });
    expect(await findConflicts(db, project, [kind])).toEqual([]);
  });

  it('does not report a claim the database holds nothing at', async () => {
    const kind = fakeKind('fake', [claim('a', 5)], {});
    expect(await findConflicts(db, project, [kind])).toEqual([]);
  });

  it('skips a kind that throws and still checks the others', async () => {
    const bad = fakeKind('bad', [claim('a', 5)], {}, true);
    const good = fakeKind('good', [claim('a', 7, 1)], { [claimKey('a', 7)]: holder(2) });
    const found = await findConflicts(db, project, [bad, good]);
    expect(found.map((c) => [c.kind, c.id])).toEqual([['good', 7]]);
  });

  it('says which kind it skipped and why, when asked', async () => {
    const bad = fakeKind('bad', [claim('a', 5)], {}, true);
    const skipped: [string, string][] = [];
    await findConflicts(db, project, [bad], (key, error) => skipped.push([key, (error as Error).message]));
    expect(skipped).toEqual([['bad', 'boom']]);
  });

  it('reports an id claimed twice once', async () => {
    const kind = fakeKind('fake', [claim('a', 5, 1), claim('a', 5, 1)], { [claimKey('a', 5)]: holder(2) });
    expect(await findConflicts(db, project, [kind])).toHaveLength(1);
  });

  it('orders by kind, then scope, then id', async () => {
    const first = fakeKind('first', [claim('b', 1), claim('a', 9), claim('a', 3)], {
      [claimKey('b', 1)]: holder(2), [claimKey('a', 9)]: holder(2), [claimKey('a', 3)]: holder(2),
    });
    const second = fakeKind('second', [claim('a', 2)], { [claimKey('a', 2)]: holder(2) });
    const found = await findConflicts(db, project, [first, second]);
    expect(found.map((c) => `${c.kind}/${c.scope}/${c.id}`)).toEqual(['first/a/3', 'first/a/9', 'first/b/1', 'second/a/2']);
  });
});

describe('planRenumber', () => {
  it('asks each kind and scope once for as many free ids as it has conflicts, in conflict order', async () => {
    const kind = fakeKind('fake', [], {});
    const conflicts = [
      { kind: 'fake', noun: 'thing', scope: 'a', scopeLabel: '', id: 3, mine: holder(1), database: holder(2) },
      { kind: 'fake', noun: 'thing', scope: 'a', scopeLabel: '', id: 5, mine: holder(1), database: holder(2) },
      { kind: 'fake', noun: 'thing', scope: 'b', scopeLabel: '', id: 1, mine: holder(1), database: holder(2) },
    ];
    const renames = await planRenumber(db, project, [kind], conflicts);
    expect(renames).toEqual([
      { kind: 'fake', scope: 'a', from: 3, to: 1000 },
      { kind: 'fake', scope: 'a', from: 5, to: 1001 },
      { kind: 'fake', scope: 'b', from: 1, to: 1000 },
    ]);
    expect(kind.freed).toEqual([['a', 2], ['b', 1]]);
  });

  it('plans nothing for no conflicts', async () => {
    expect(await planRenumber(db, project, [fakeKind('fake', [], {})], [])).toEqual([]);
  });
});

describe('applyRenames', () => {
  it('hands each rename to its kind, in order, and ignores a kind it does not know', () => {
    const kind = fakeKind('fake', [], {});
    applyRenames(project, [kind], [
      { kind: 'fake', scope: 'a', from: 3, to: 1000 },
      { kind: 'gone', scope: 'a', from: 4, to: 1001 },
      { kind: 'fake', scope: 'b', from: 1, to: 1000 },
    ]);
    expect(kind.renamed).toEqual([['a', 3, 1000], ['b', 1, 1000]]);
  });
});
