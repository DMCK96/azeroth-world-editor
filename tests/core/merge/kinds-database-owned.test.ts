import { describe, expect, it } from 'vitest';
import { spawnEditKind } from '../../../src/core/merge/kinds/spawn-edit';
import { routeKind } from '../../../src/core/merge/kinds/route';
import { movementKind } from '../../../src/core/merge/kinds/movement';
import { respawnKind } from '../../../src/core/merge/kinds/respawn';
import { spawnEventKind } from '../../../src/core/merge/kinds/spawn-event';
import { deletedSpawnKind } from '../../../src/core/merge/kinds/deleted-spawn';
import { docOf, emptyDoc } from './helpers';

const at = (x: number) => ({ x, y: 0, z: 0, orientation: 0, rotation: null });
const edit = (guid: number, x: number) => ({ kind: 'creature', guid, entry: 1, name: 'Wolf', map: 0, original: at(0), current: at(x) }) as never;
const world = (part: object) => docOf({ world: { spawns: [], routes: [], added: [], ...part } as never });

describe('spawn-edit kind', () => {
  it('keys a moved database spawn by kind and guid, and shares that as its identity', () => {
    const items = spawnEditKind.items(world({ spawns: [edit(7, 3)] }));
    expect([...items.keys()]).toEqual(['creature:7']);
    expect(spawnEditKind.identity!('creature:7', items.get('creature:7')!)).toBe('creature:7');
  });
  it('compares where the spawn now stands, not where it started', () => {
    const a = edit(7, 3) as any;
    const b = { ...a, original: at(99) };
    expect(spawnEditKind.same(a, b)).toBe(true);
    expect(spawnEditKind.same(a, edit(7, 4))).toBe(false);
  });
  it('writes the given items back in place of its own', () => {
    const doc = world({ spawns: [edit(7, 3)] });
    const out = spawnEditKind.write(doc, new Map([['creature:8', edit(8, 1)]]));
    expect(out.world.spawns.map((s) => s.guid)).toEqual([8]);
    expect(doc.world.spawns.map((s) => s.guid)).toEqual([7]);
  });
  it('diffs the fields that differ and only those', () => {
    const d = spawnEditKind.diff(edit(7, 3), edit(7, 4));
    expect(d.map((f) => f.field)).toEqual(['x']);
    expect(d[0]).toMatchObject({ from: '3', to: '4' });
  });
});

describe('the other database-owned kinds', () => {
  it('route is keyed by path id and compares its current points', () => {
    const r = (pathId: number, x: number) => ({ pathId, walkers: 1, original: [], current: [{ x, y: 0, z: 0, rest: {} }] }) as never;
    expect([...routeKind.items(world({ routes: [r(5, 1)] })).keys()]).toEqual(['5']);
    expect(routeKind.same(r(5, 1), { ...(r(5, 1) as any), walkers: 9 })).toBe(true);
    expect(routeKind.same(r(5, 1), r(5, 2))).toBe(false);
  });
  it('movement and spawn events are keyed by guid and share a creature identity', () => {
    const m = { guid: 4, entry: 1, name: 'n', map: 0, addonRow: false, original: { type: 0 }, current: { type: 1 } } as never;
    const items = movementKind.items(world({ movements: [m] }));
    expect([...items.keys()]).toEqual(['4']);
    expect(movementKind.identity!('4', items.get('4')!)).toBe('creature:4');
    const e = { guid: 4, entry: 1, name: 'n', map: 0, original: [], current: { rule: 1 } } as never;
    const events = spawnEventKind.items(world({ spawnEvents: [e] }));
    expect(spawnEventKind.identity!('4', events.get('4')!)).toBe('creature:4');
  });
  it('respawn is keyed by kind and guid and compares the current time', () => {
    const r = (current: number) => ({ kind: 'creature', guid: 2, entry: 1, name: 'n', map: 0, original: 300, current }) as never;
    expect([...respawnKind.items(world({ respawns: [r(60)] })).keys()]).toEqual(['creature:2']);
    expect(respawnKind.same(r(60), r(60))).toBe(true);
    expect(respawnKind.same(r(60), r(90))).toBe(false);
  });
  it('a deleted spawn removes its identity, and two deletions of the same spawn are the same', () => {
    const d = (rows: object[]) => ({ kind: 'creature', guid: 3, entry: 1, name: 'n', map: 0, placement: at(0), rows }) as never;
    expect(deletedSpawnKind.removesIdentity).toBe(true);
    const items = deletedSpawnKind.items(world({ deletes: [d([])] }));
    expect([...items.keys()]).toEqual(['creature:3']);
    expect(deletedSpawnKind.identity!('creature:3', items.get('creature:3')!)).toBe('creature:3');
    expect(deletedSpawnKind.same(d([]), d([{ table: 'creature', row: {} }]))).toBe(true);
  });
  it('reads nothing from a world layer that lacks the optional lists', () => {
    for (const k of [movementKind, respawnKind, spawnEventKind, deletedSpawnKind]) expect(k.items(emptyDoc()).size).toBe(0);
  });
});
