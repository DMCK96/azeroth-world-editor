import { beforeEach, describe, expect, it } from 'vitest';
import { clearClipboard, clipEntries, copySpawns, duplicateOffset, entriesOf, layoutAt, pasteable } from '../../src/renderer/world3d/clipboard';
import type { SpawnInfo } from '../../src/renderer/world3d/scene/spawn/SpawnManager';

const spawn = (guid: number, x: number, y: number, over: Partial<SpawnInfo> = {}): SpawnInfo => ({ kind: 'creature', guid, entry: 1423, name: 'Guard', own: false, added: false, pathId: 0, wander: 0, map: 1, group: null, respawnSecs: 300,
  placement: { x, y, z: 10, orientation: 0.5, rotation: null }, ...over });

describe('the 3D view’s clipboard', () => {
  beforeEach(() => clearClipboard());

  it('keeps each spawn’s respawn time and wander; a path walker’s wander is 0', () => {
    const [a, b] = entriesOf([spawn(1, 0, 0, { respawnSecs: 60, wander: 5 }), spawn(2, 0, 0, { respawnSecs: 300, wander: 0, pathId: 801 })]);
    expect([a!.respawnSecs, a!.wander]).toEqual([60, 5]);
    expect([b!.respawnSecs, b!.wander]).toEqual([300, 0]);
  });

  it('keeps the path a walker follows, as offsets from the NPC, so its copy can walk one of its own', () => {
    const route = { points: [{ x: 3, y: 0, z: 10 }, { x: 3, y: 8, z: 11, carry: { delay: 4 } }] };
    const [walker, stander] = entriesOf([spawn(1, 0, 0, { pathId: 801 }), spawn(2, 0, 0)], (guid) => (guid === 1 ? route : null));
    expect(walker!.route).toEqual([{ dx: 3, dy: 0, dz: 0 }, { dx: 3, dy: 8, dz: 1, carry: { delay: 4 } }]);
    expect(stander).not.toHaveProperty('route');
  });

  it('keeps an NPC spawn’s own game events; one that follows its NPC, or an object, keeps none', () => {
    const [a, b, c] = entriesOf([spawn(1, 0, 0, { spawnEvents: null }), spawn(2, 0, 0, { spawnEvents: 'npc' }), spawn(3, 0, 0, { kind: 'object' })]);
    expect([a!.spawnEvents, b!.spawnEvents, c!.spawnEvents]).toEqual([null, 'npc', 'npc']);
  });

  it('keeps each spawn’s offset from the group’s centre, and its facing and turn', () => {
    const entries = copySpawns([spawn(1, 0, 0), spawn(2, 10, 0, { kind: 'object', placement: { x: 10, y: 0, z: 10, orientation: 0.5, rotation: [0, 0, 1, 0] } })]);
    expect(entries.map((e) => [e.dx, e.dy, e.orientation, e.rotation])).toEqual([[-5, 0, 0.5, null], [5, 0, 0.5, [0, 0, 1, 0]]]);
    expect(clipEntries()).toEqual(entries);
  });

  it('a copy replaces what was there', () => {
    copySpawns([spawn(1, 0, 0)]);
    copySpawns([spawn(2, 0, 0), spawn(3, 0, 0)]);
    expect(clipEntries()).toHaveLength(2);
  });

  it('lays a group out round the paste point, on the map being viewed', () => {
    const entries = copySpawns([spawn(1, 0, 0), spawn(2, 10, 4)]);
    const laid = layoutAt(entries, { x: 100, y: 200, z: 50 }, 0);
    expect(laid.map((l) => [l.at.x, l.at.y, l.at.z, l.map])).toEqual([[95, 198, 50, 0], [105, 202, 50, 0]]);
    expect(laid[0]!.at.orientation).toBe(0.5);
  });

  it('copies what each spawn is and how it faces, with no quest attached', () => {
    const [entry] = entriesOf([spawn(1, 0, 0, { own: true })]);
    expect(entry).not.toHaveProperty('questId');
    expect(entry).toMatchObject({ kind: 'creature', entry: 1423, own: true, dx: 0, dy: 0, dz: 0 });
  });

  it('every copied spawn can be pasted, whichever quest is open', () => {
    const list = copySpawns([spawn(1, 0, 0, { own: true }), spawn(2, 0, 0)]);
    expect(pasteable(list)).toEqual({ entries: list, blocked: null });
  });

  it('a duplicate goes two yards to the camera’s right', () => {
    // Looking north (+X), right is -Y (Y runs west)
    expect(duplicateOffset({ x: 1, y: 0 })).toEqual({ x: 0, y: -2 });
    const d = duplicateOffset({ x: 3, y: 3 });
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(2);
  });
});
