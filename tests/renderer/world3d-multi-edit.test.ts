// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

const gizmos = vi.hoisted(() => [] as any[]);
vi.mock('../../src/renderer/world3d/scene/edit/Gizmo', async (importActual) => {
  const actual = await importActual<typeof import('../../src/renderer/world3d/scene/edit/Gizmo')>();
  class FakeGizmo {
    events: any;
    hovered = false;
    dragging = false;
    at: THREE.Vector3 | null = null;
    turns: string | null = null;
    quaternion: THREE.Quaternion | null = null;
    mode = 'move';
    constructor(_camera: unknown, _dom: unknown, _scene: unknown, _ground: unknown, events: any) {
      this.events = events;
      gizmos.push(this);
    }
    get attached() {
      return this.at !== null;
    }
    attach(at: THREE.Vector3, q: THREE.Quaternion, turns: string) {
      this.at = at.clone();
      this.quaternion = q.clone();
      this.turns = turns;
    }
    detach() {
      this.at = null;
      this.turns = null;
    }
    setMode(mode: string) {
      this.mode = mode;
    }
    groundAt() {
      return 0;
    }
    dispose() {}
  }
  return { ...actual, Gizmo: FakeGizmo };
});

import { Editor, NOT_SNAPPED, PICK_POINT_FIRST, TOO_SHORT, type EditingWorld } from '../../src/renderer/world3d/editing';
import type { EditPoint, SpawnEdit } from '../../src/renderer/world3d/edits';
import { EMPTY_SELECTION, type Selection } from '../../src/renderer/world3d/scene/edit/selection';
import type { Falloff } from '../../src/renderer/world3d/scene/edit/falloff';

type Route = { pathId: number; own: boolean; entry: number; points: EditPoint[] };
const sel = (s: Partial<Selection>): Selection => ({ ...EMPTY_SELECTION, ...s });
const line = (pathId: number, xs: number[], y = 0): Route => ({ pathId, own: false, entry: 1, points: xs.map((x) => ({ x, y, z: 0 })) });
const key = (code: string) => new KeyboardEvent('keydown', { code });

function setup(opts: { snapTolerance?: number; routes?: Record<number, Route>; floor?: number | null; aboard?: number[]; answers?: Record<number, boolean | Promise<boolean>> } = {}) {
  const spawns = new Map<string, THREE.Object3D>();
  const npc = (guid: number, x: number, y: number, facing = 0) => {
    const o = new THREE.Object3D();
    o.position.set(x, y, 0);
    o.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), facing);
    o.userData.spawn = { kind: 'creature', guid, entry: 100 + guid, own: false };
    spawns.set(`creature:${guid}`, o);
    return o;
  };
  const drop = (guid: number) => spawns.delete(`creature:${guid}`);
  const routes = new Map(Object.entries(opts.routes ?? {}).map(([g, r]) => [Number(g), r]));
  const pending: [number, EditPoint[]][] = [];
  const previews: [number, EditPoint[]][] = [];
  const homes: [number, { x: number; y: number; z: number }][] = [];
  const movements: [number, unknown][] = [];
  let groundAt: THREE.Vector3 | null = null;
  // A path started in the view: its id, so the first pending route of an NPC with none makes it
  let lastPathId = 0;
  const world: EditingWorld = {
    camera: new THREE.PerspectiveCamera(),
    dom: document.createElement('canvas'),
    scene: new THREE.Scene(),
    ground: () => [],
    pickGround: () => groundAt?.clone() ?? null,
    rayAt: () => new THREE.Ray(),
    findSpawn: (kind, guid) => spawns.get(`${kind}:${guid}`) ?? null,
    aboard: (_kind, guid) => opts.aboard?.includes(guid) ?? false,
    spawnRoute: (guid) => routes.get(guid) ?? null,
    pickRoutePoint: () => null,
    setPendingRoute: (guid, points) => {
      pending.push([guid, points]);
      const route = routes.get(guid);
      if (route) routes.set(guid, { ...route, points });
      else if (lastPathId > 0) routes.set(guid, { pathId: lastPathId, own: false, entry: 100 + guid, points });
    },
    previewRoute: (guid, points) => previews.push([guid, points]),
    previewHome: (guid, at) => homes.push([guid, at]),
    setPendingMovement: (guid, m) => {
      movements.push([guid, m]);
      if (m?.type === 'path' && m.pathId) lastPathId = m.pathId;
    },
    spawnMovement: () => null,
  };
  const edits: SpawnEdit[] = [];
  const gestures: SpawnEdit[][] = [];
  const notices: (string | null)[] = [];
  const asked: number[] = [];
  const selections: Selection[] = [];
  const falloffs: Falloff[] = [];
  const floorZ = vi.fn(async () => (opts.floor === undefined ? 1 : opts.floor));
  const deletes = vi.fn();
  const editor = new Editor(world, {
    onDeleteSpawns: deletes,
    snapTolerance: opts.snapTolerance === undefined ? undefined : () => opts.snapTolerance!,
    onGesture: (g) => {
      gestures.push(g);
      edits.push(...g);
    },
    floorZ,
    onNotice: (m) => notices.push(m),
    onSelection: (s) => selections.push(s),
    onFalloff: (f) => falloffs.push(f),
    beforeRouteEdit: (_spawn, pathId) => {
      asked.push(pathId);
      return Promise.resolve(opts.answers?.[pathId] ?? true);
    },
  });
  const gizmo = gizmos.at(-1);
  const change = (delta: [number, number, number] = [0, 0, 0], angle = 0) => ({ delta: new THREE.Vector3(...delta), angle, quaternion: new THREE.Quaternion(), axis: 'XY' });
  const drag = async (delta?: [number, number, number], angle?: number, lifted = false) => {
    editor.update();
    gizmo.events.started();
    gizmo.events.moved(change(delta, angle));
    await gizmo.events.ended(lifted);
  };
  const pendingMovement = (guid: number) => movements.filter(([g]) => g === guid).at(-1)?.[1];
  const pendingRoute = (guid: number) => pending.filter(([g]) => g === guid).at(-1)?.[1];
  return { editor, world, deletes, edits, gestures, pendingMovement, pendingRoute, notices, asked, selections, falloffs, floorZ, gizmo, npc, drop, drag, change, pending, previews, homes, movements, setGround: (v: THREE.Vector3 | null) => { groundAt = v; } };
}

const placed = (edits: SpawnEdit[]) => edits.map((e) => (e.kind === 'place' ? [e.spawn.guid, e.to.x, e.to.y, e.to.z] : null));

describe('moving and turning a selection in the 3D view', () => {
  it('Delete with spawns selected asks the host to delete them, and edits no route points', () => {
    const t = setup({ routes: { 1: line(50, [0, 10, 20]) } });
    t.npc(1, 0, 0);
    t.npc(2, 10, 0);
    t.editor.setSelection(sel({ spawns: [{ kind: 'creature', guid: 1 }, { kind: 'creature', guid: 2 }] }));
    expect(t.editor.keyDown(key('Delete'))).toBe(true);
    expect(t.deletes).toHaveBeenCalledTimes(1);
    expect(t.edits).toEqual([]);
  });

  it('Delete with route points picked deletes the points, not the spawns, even when spawns are selected too', async () => {
    const t = setup({ routes: { 7: line(50, [0, 10, 20, 30]) } });
    t.npc(7, -5, 0);
    t.editor.setSelection(sel({ spawns: [{ kind: 'creature', guid: 7 }], points: [{ guid: 7, index: 1 }], routes: [7] }));
    expect(t.editor.keyDown(key('Delete'))).toBe(true);
    await vi.waitFor(() => expect(t.edits).toHaveLength(1));
    expect(t.deletes).not.toHaveBeenCalled();
  });

  it('Delete while a path is being drawn deletes nothing, and the path goes on', () => {
    const t = setup();
    t.npc(1, 0, 0);
    t.editor.setSelection(sel({ spawns: [{ kind: 'creature', guid: 1 }] }));
    t.editor.startPath(1, 77, { x: 0, y: 0, z: 0 });
    expect(t.editor.keyDown(key('Delete'))).toBe(true);
    expect(t.deletes).not.toHaveBeenCalled();
    expect(t.editor.drawing).not.toBeNull();
  });

  it('Delete with nothing selected deletes nothing, and the key is still used', () => {
    const t = setup();
    expect(t.editor.keyDown(key('Delete'))).toBe(true);
    expect(t.deletes).not.toHaveBeenCalled();
  });

  it('moves every selected spawn by the drag, drops each on the server floor, as one gesture', async () => {
    const t = setup({ floor: 1 });
    t.npc(1, 0, 0);
    t.npc(2, 10, 0);
    t.editor.setSelection(sel({ spawns: [{ kind: 'creature', guid: 1 }, { kind: 'creature', guid: 2 }] }));
    t.editor.update();
    expect(t.gizmo.at.toArray()).toEqual([5, 0, 0]);
    expect(t.gizmo.turns).toBe('z');
    await t.drag([0, 4, 0]);
    expect(t.floorZ).toHaveBeenCalledTimes(2);
    expect(t.gestures).toHaveLength(1);
    expect(placed(t.gestures[0]!)).toEqual([[1, 0, 4, 1], [2, 10, 4, 1]]);
  });

  it('a move along the ground keeps the height of an NPC lifted on the Z arrow, and does not drop it to the server floor', async () => {
    const t = setup({ floor: 1 });
    t.npc(1, 0, 0);
    t.editor.setSelection(sel({ spawns: [{ kind: 'creature', guid: 1 }] }));
    t.editor.update();
    t.gizmo.events.started();
    t.gizmo.events.moved({ ...t.change([0, 0, 30]), axis: 'Z' });
    await t.gizmo.events.ended(true);
    expect(placed(t.gestures[0]!)).toEqual([[1, 0, 0, 30]]);
    await t.drag([0, 4, 0]);
    expect(t.floorZ).not.toHaveBeenCalled();
    expect(placed(t.gestures[1]!)).toEqual([[1, 0, 4, 30]]);
  });

  it('an NPC that merely stands above the drawn ground, never lifted, still follows the ground and drops to the server floor', async () => {
    const t = setup({ floor: 1 });
    t.npc(1, 0, 0).position.z = 30;
    t.editor.setSelection(sel({ spawns: [{ kind: 'creature', guid: 1 }] }));
    await t.drag([0, 4, 0]);
    expect(t.floorZ).toHaveBeenCalledTimes(1);
    expect(placed(t.gestures[0]!)).toEqual([[1, 0, 4, 1]]);
  });

  it('leaves a spawn aboard a docked vessel on its deck: the continent’s floor under the vessel is not its floor', async () => {
    const t = setup({ floor: -50, aboard: [2] });
    t.npc(1, 0, 0);
    t.npc(2, 10, 0);
    t.editor.setSelection(sel({ spawns: [{ kind: 'creature', guid: 1 }, { kind: 'creature', guid: 2 }] }));
    t.editor.update();
    await t.drag([0, 4, 0]);
    expect(t.floorZ).toHaveBeenCalledTimes(1);
    expect(placed(t.gestures[0]!)).toEqual([[1, 0, 4, -50], [2, 10, 4, 0]]);
    expect(t.notices.at(-1)).toBeNull();
  });

  it('an arrow (red, green) moves a thing freely: it neither follows the ground nor drops to the server floor, only the yellow handle does', async () => {
    const t = setup({ floor: -50 });
    t.npc(1, 0, 0);
    t.editor.setSelection(sel({ spawns: [{ kind: 'creature', guid: 1 }] }));
    t.editor.update();
    for (const axis of ['X', 'Y']) {
      t.gizmo.events.started();
      t.gizmo.events.moved({ ...t.change([0, 4, 0]), axis });
      await t.gizmo.events.ended(false);
    }
    expect(t.floorZ).not.toHaveBeenCalled();
    expect(placed(t.gestures[0]!)).toEqual([[1, 0, 4, 0]]);
  });

  describe('which way the handles face', () => {
    const heading = (q: THREE.Quaternion) => {
      const v = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      return Math.atan2(v.y, v.x);
    };
    const both = [{ kind: 'creature' as const, guid: 1 }, { kind: 'creature' as const, guid: 2 }];

    it('follow what a group all faces the same way, as they do one thing', () => {
      const t = setup();
      t.npc(1, 0, 0, 1);
      t.npc(2, 10, 0, 1);
      t.editor.setSelection(sel({ spawns: both }));
      t.editor.update();
      expect(heading(t.gizmo.quaternion)).toBeCloseTo(1, 6);
    });

    it('stay on the world axes when they face different ways', () => {
      const t = setup();
      t.npc(1, 0, 0, 1);
      t.npc(2, 10, 0, 2);
      t.editor.setSelection(sel({ spawns: both }));
      t.editor.update();
      expect(t.gizmo.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-9);
    });

    it('stay on the world axes with route points among them, which face nowhere', () => {
      const t = setup({ routes: { 1: line(7, [0, 5, 10]) } });
      t.npc(1, 0, 0, 1);
      t.editor.setSelection(sel({ spawns: [{ kind: 'creature', guid: 1 }], points: [{ guid: 1, index: 1 }] }));
      t.editor.update();
      expect(t.gizmo.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-9);
    });

    it('are taken again when a turn leaves them facing a new way together', async () => {
      const t = setup();
      t.npc(1, 0, 0, 1);
      t.npc(2, 10, 0, 1);
      t.editor.setSelection(sel({ spawns: both }));
      t.editor.setMode('rotate');
      await t.drag(undefined, 0.5);
      t.editor.update();
      expect(heading(t.gizmo.quaternion)).toBeCloseTo(1.5, 6);
    });
  });

  it('the editor keeps no history: Ctrl+Z and Ctrl+Y are left to the app when no path is drawn', () => {
    const t = setup();
    expect(t.editor.keyDown(new KeyboardEvent('keydown', { code: 'KeyZ', ctrlKey: true }))).toBe(false);
    expect(t.editor.keyDown(new KeyboardEvent('keydown', { code: 'KeyY', ctrlKey: true }))).toBe(false);
    expect('undo' in t.editor).toBe(false);
  });

  it('moves picked route points as a block, leaving the rest of the route where it was', async () => {
    const t = setup({ routes: { 7: line(50, [0, 10, 20, 30]) }, floor: 0 });
    t.npc(7, -5, 0);
    t.editor.setSelection(sel({ points: [{ guid: 7, index: 1 }, { guid: 7, index: 2 }], routes: [7] }));
    await t.drag([0, 4, 0]);
    expect(t.edits).toHaveLength(1);
    expect(t.edits[0]).toMatchObject({ kind: 'route', pathId: 50, spawn: { guid: 7 } });
    expect((t.edits[0] as any).points.map((p: EditPoint) => [p.x, p.y])).toEqual([[0, 0], [10, 4], [20, 4], [30, 0]]);
  });

  it('with falloff on, the rest of the route follows by a share that falls with distance', async () => {
    const t = setup({ routes: { 7: line(50, [0, 5, 10, 20]) }, floor: 0 });
    t.npc(7, -5, 0);
    t.editor.setFalloff({ on: true, radius: 10 });
    t.editor.setSelection(sel({ points: [{ guid: 7, index: 0 }], routes: [7] }));
    await t.drag([0, 4, 0]);
    expect((t.edits[0] as any).points.map((p: EditPoint) => p.y)).toEqual([4, 2, 0, 0]);
  });

  it('the wheel during a falloff drag grows the radius and the curve follows at once; otherwise the wheel is the camera\'s', () => {
    const t = setup({ routes: { 7: line(50, [0, 5, 10, 20]) }, floor: 0 });
    t.npc(7, -5, 0);
    expect(t.editor.wheel(-100)).toBe(false);
    t.editor.setFalloff({ on: true, radius: 10 });
    t.editor.setSelection(sel({ points: [{ guid: 7, index: 0 }], routes: [7] }));
    t.editor.update();
    t.gizmo.events.started();
    t.gizmo.events.moved(t.change([0, 4, 0]));
    expect(t.previews.at(-1)![1][2]!.y).toBe(0);
    expect(t.editor.wheel(-100)).toBe(true);
    expect(t.editor.falloff.radius).toBeCloseTo(11, 9);
    expect(t.previews.at(-1)![1][2]!.y).toBeGreaterThan(0);
    expect(t.falloffs.at(-1)!.radius).toBeCloseTo(11, 9);
  });

  it('R turns the group round its centre: positions swing and facings turn, with no floor drop', async () => {
    const t = setup();
    t.npc(1, 0, 0);
    t.npc(2, 10, 0);
    t.editor.setSelection(sel({ spawns: [{ kind: 'creature', guid: 1 }, { kind: 'creature', guid: 2 }] }));
    t.editor.setMode('rotate');
    await t.drag(undefined, Math.PI / 2);
    expect(t.floorZ).not.toHaveBeenCalled();
    const to = t.edits.map((e) => (e.kind === 'place' ? [e.to.x, e.to.y, e.to.orientation] : []));
    expect(to[0]![0]).toBeCloseTo(5, 6);
    expect(to[0]![1]).toBeCloseTo(-5, 6);
    expect(to[0]![2]).toBeCloseTo(Math.PI / 2, 6);
    expect(to[1]![0]).toBeCloseTo(5, 6);
    expect(to[1]![1]).toBeCloseTo(5, 6);
    expect(to[1]![2]).toBeCloseTo(Math.PI / 2, 6);
  });

  it('a drag released where it started makes no gesture', async () => {
    const t = setup();
    t.npc(1, 0, 0);
    t.editor.setSelection(sel({ spawns: [{ kind: 'creature', guid: 1 }] }));
    await t.drag();
    expect(t.gestures).toEqual([]);
    expect(t.floorZ).not.toHaveBeenCalled();
  });

  it('a spawn redrawn during a drag is followed by guid, and one gone by the end is left out', async () => {
    const t = setup({ floor: 0 });
    t.npc(1, 0, 0);
    t.npc(2, 10, 0);
    t.editor.setSelection(sel({ spawns: [{ kind: 'creature', guid: 1 }, { kind: 'creature', guid: 2 }] }));
    t.editor.update();
    t.gizmo.events.started();
    // The area was redrawn: a new object stands for spawn 1
    const redrawn = t.npc(1, 0, 0);
    t.gizmo.events.moved(t.change([0, 4, 0]));
    expect(redrawn.position.y).toBe(4);
    t.drop(2);
    await t.gizmo.events.ended(false);
    expect(placed(t.edits)).toEqual([[1, 0, 4, 0]]);
  });
});

describe('route edits on several routes at once', () => {
  it('a route answered no goes back, and the rest of the gesture stands as one gesture', async () => {
    const a = line(50, [0, 10]);
    const b = line(60, [0, 10], 20);
    const t = setup({ routes: { 7: a, 8: b }, floor: 0, answers: { 60: false } });
    t.npc(7, -5, 0);
    t.npc(8, -5, 20);
    t.editor.setSelection(sel({ points: [{ guid: 7, index: 0 }, { guid: 8, index: 0 }], routes: [7, 8] }));
    await t.drag([1, 0, 0]);
    expect(t.edits.map((e) => e.kind === 'route' && e.pathId)).toEqual([50]);
    expect(t.pending).toContainEqual([8, b.points]);
    expect(t.gestures).toHaveLength(1);
  });

  it('asks about one shared route at a time', async () => {
    let release!: (yes: boolean) => void;
    const first = new Promise<boolean>((resolve) => (release = resolve));
    const t = setup({ routes: { 7: line(50, [0, 10]), 8: line(60, [0, 10], 20) }, floor: 0, answers: { 50: first, 60: true } });
    t.npc(7, -5, 0);
    t.npc(8, -5, 20);
    t.editor.setSelection(sel({ points: [{ guid: 7, index: 0 }, { guid: 8, index: 0 }], routes: [7, 8] }));
    const done = t.drag([1, 0, 0]);
    await vi.waitFor(() => expect(t.asked).toEqual([50]));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(t.asked).toEqual([50]);
    release(true);
    await done;
    expect(t.asked).toEqual([50, 60]);
    expect(t.edits.map((e) => e.kind === 'route' && e.pathId)).toEqual([50, 60]);
  });

  it('Delete removes every picked point, leaving a route that would fall below two as it was', async () => {
    const t = setup({ routes: { 7: line(50, [0, 10, 20]), 8: line(60, [0, 10, 20, 30], 20) } });
    t.npc(7, -5, 0);
    t.npc(8, -5, 20);
    t.editor.setSelection(sel({ points: [{ guid: 7, index: 0 }, { guid: 7, index: 1 }, { guid: 8, index: 2 }], routes: [7, 8] }));
    expect(t.editor.keyDown(key('Delete'))).toBe(true);
    await vi.waitFor(() => expect(t.edits).toHaveLength(1));
    expect(t.edits[0]).toMatchObject({ kind: 'route', pathId: 60 });
    expect((t.edits[0] as any).points.map((p: EditPoint) => p.x)).toEqual([0, 10, 30]);
    expect(t.notices).toContain(TOO_SHORT);
    expect(t.editor.selection.points).toEqual([{ guid: 7, index: 0 }, { guid: 7, index: 1 }]);
    expect(t.selections.at(-1)!.points).toEqual([{ guid: 7, index: 0 }, { guid: 7, index: 1 }]);
  });

  it('a click on a leg of an active route puts a new point there and picks it', async () => {
    const t = setup({ routes: { 7: { pathId: 50, own: false, entry: 1, points: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10, y: 10, z: 0 }] } } });
    t.npc(7, -5, 0);
    t.world.pickGround = () => new THREE.Vector3(5, 1, 0);
    t.editor.setSelection(sel({ routes: [7] }));
    expect(t.editor.insertPoint(0, 0)).toBe(true);
    await vi.waitFor(() => expect(t.edits).toHaveLength(1));
    expect((t.edits[0] as any).points.map((p: EditPoint) => [p.x, p.y])).toEqual([[0, 0], [5, 1], [10, 0], [10, 10]]);
    expect(t.editor.selection.points).toEqual([{ guid: 7, index: 1 }]);
  });

  it('with several active routes and no leg near, a new point goes after the last picked one; with none picked, nothing is added', async () => {
    const t = setup({ routes: { 7: line(50, [0, 10]), 8: line(60, [0, 10, 20], 20) } });
    t.npc(7, -5, 0);
    t.npc(8, -5, 20);
    t.world.pickGround = () => new THREE.Vector3(50, 50, 0);
    t.editor.setSelection(sel({ routes: [7, 8] }));
    expect(t.editor.insertPoint(0, 0)).toBe(true);
    expect(t.notices).toContain(PICK_POINT_FIRST);
    expect(t.edits).toEqual([]);
    t.editor.setSelection(sel({ points: [{ guid: 7, index: 0 }, { guid: 8, index: 1 }], routes: [7, 8] }));
    t.editor.insertPoint(0, 0);
    await vi.waitFor(() => expect(t.edits).toHaveLength(1));
    expect(t.edits[0]).toMatchObject({ pathId: 60 });
    expect((t.edits[0] as any).points.map((p: EditPoint) => p.x)).toEqual([0, 10, 50, 20]);
  });

  it('O switches falloff and [ ] change its radius, each told to the host', () => {
    const t = setup();
    expect(t.editor.keyDown(key('KeyO'))).toBe(true);
    expect(t.falloffs.at(-1)).toEqual({ on: true, radius: 10 });
    t.editor.keyDown(key('BracketRight'));
    expect(t.falloffs.at(-1)!.radius).toBeCloseTo(11, 9);
    t.editor.keyDown(key('BracketLeft'));
    expect(t.falloffs.at(-1)!.radius).toBeCloseTo(9.9, 9);
    t.editor.keyDown(key('KeyO'));
    expect(t.falloffs.at(-1)!.on).toBe(false);
  });
});

describe('where the picked points are drawn', () => {
  it('as the route has them, following a drag', () => {
    const t = setup({ routes: { 7: line(50, [0, 10]) } });
    t.npc(7, -5, 0);
    t.editor.setSelection(sel({ points: [{ guid: 7, index: 1 }], routes: [7] }));
    expect(t.editor.pointPositions()).toEqual([{ x: 10, y: 0, z: 0 }]);
    t.editor.update();
    t.gizmo.events.started();
    t.gizmo.events.moved(t.change([0, 3, 0]));
    expect(t.editor.pointPositions()).toEqual([{ x: 10, y: 3, z: 0 }]);
  });
});

describe('the selection after an undo changed the layer', () => {
  it('keeps the picked points that the route still has, so the move can be tried again at once', async () => {
    const t = setup({ routes: { 7: line(50, [0, 10, 20]) }, floor: 0 });
    t.npc(7, -5, 0);
    t.editor.setSelection(sel({ points: [{ guid: 7, index: 1 }, { guid: 7, index: 2 }], routes: [7] }));
    await t.drag([0, 4, 0]);
    // The undo hands back the layer with the route as it was
    t.world.setPendingRoute(7, line(50, [0, 10, 20]).points);
    t.editor.layerChanged();
    expect(t.editor.selection.points).toEqual([{ guid: 7, index: 1 }, { guid: 7, index: 2 }]);
  });

  it('drops a picked point an undo takes out of the route', async () => {
    const t = setup({ routes: { 7: line(50, [0, 10]) } });
    t.npc(7, -5, 0);
    t.world.pickGround = () => new THREE.Vector3(5, 1, 0);
    t.editor.setSelection(sel({ routes: [7] }));
    t.editor.insertPoint(0, 0);
    await vi.waitFor(() => expect(t.edits).toHaveLength(1));
    expect(t.editor.selection.points).toEqual([{ guid: 7, index: 1 }]);
    t.editor.setSelection(sel({ points: [{ guid: 7, index: 2 }], routes: [7] }));
    t.world.setPendingRoute(7, line(50, [0, 10]).points);
    t.editor.layerChanged();
    expect(t.editor.selection.points).toEqual([]);
  });
});

describe('findings from the review', () => {
  it('keeps a tilt of one object even when its turn about Z did not change', async () => {
    const t = setup();
    const box = new THREE.Object3D();
    box.userData.spawn = { kind: 'object', guid: 30, entry: 300, own: false };
    t.world.findSpawn = (kind, guid) => (kind === 'object' && guid === 30 ? box : null);
    t.editor.setSelection(sel({ spawns: [{ kind: 'object', guid: 30 }] }));
    t.editor.setMode('rotate');
    t.editor.update();
    expect(t.gizmo.turns).toBe('all');
    t.gizmo.events.started();
    const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.3);
    t.gizmo.events.moved({ delta: new THREE.Vector3(), angle: 0, quaternion: tilt, axis: 'X' });
    await t.gizmo.events.ended(false);
    expect(t.edits).toHaveLength(1);
    expect((t.edits[0] as any).to.rotation[0]).toBeCloseTo(Math.sin(0.15), 6);
  });

  it('edits the route of an NPC too far away to be drawn: drag, delete and insert', async () => {
    // No npc(7): the NPC is out of draw distance, its route still drawn
    const t = setup({ routes: { 7: line(50, [0, 10, 20, 30]) }, floor: 0 });
    t.editor.setSelection(sel({ points: [{ guid: 7, index: 1 }], routes: [7] }));
    await t.drag([0, 4, 0]);
    expect(t.edits[0]).toMatchObject({ kind: 'route', pathId: 50, spawn: { kind: 'creature', guid: 7, entry: 1, own: false } });
    t.editor.keyDown(key('Delete'));
    await vi.waitFor(() => expect(t.edits).toHaveLength(2));
    expect((t.edits[1] as any).points).toHaveLength(3);
    t.world.pickGround = () => new THREE.Vector3(5, 0.5, 0);
    t.editor.insertPoint(0, 0);
    await vi.waitFor(() => expect(t.edits).toHaveLength(3));
    expect((t.edits[2] as any).points).toHaveLength(4);
  });

  it('draws a released route where it was dragged at once, so a quick second drag starts from there', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const t = setup({ routes: { 7: line(50, [0, 10, 20]) } });
    t.npc(7, -5, 0);
    const floor = vi.fn(async () => {
      await held;
      return 0;
    });
    // The world says where routes are drawn: pending ones as they are pending
    const pending = new Map<number, EditPoint[]>();
    const base = t.world.spawnRoute;
    t.world.setPendingRoute = (guid, points) => pending.set(guid, points);
    t.world.spawnRoute = (guid) => {
      const route = base(guid);
      return route && pending.has(guid) ? { ...route, points: pending.get(guid)! } : route;
    };
    const editor = new Editor(t.world, { onGesture: (g) => t.edits.push(...g), floorZ: floor });
    const gizmo = gizmos.at(-1);
    editor.setSelection(sel({ points: [{ guid: 7, index: 1 }], routes: [7] }));
    editor.update();
    gizmo.events.started();
    gizmo.events.moved(t.change([0, 4, 0]));
    const first = gizmo.events.ended(false);
    // Still waiting for the server's floor, the route is already drawn as dragged, and the gizmo stays with it
    expect(t.world.spawnRoute(7)!.points[1]!.y).toBe(4);
    editor.update();
    expect(gizmo.at.y).toBe(4);
    release();
    await first;
  });

  it('saves a spawn redrawn after the last move where it was dragged to', async () => {
    const t = setup({ floor: 0 });
    t.npc(1, 0, 0);
    t.editor.setSelection(sel({ spawns: [{ kind: 'creature', guid: 1 }] }));
    t.editor.update();
    t.gizmo.events.started();
    t.gizmo.events.moved(t.change([0, 4, 0]));
    // A redraw lands while the pointer holds still: a fresh object back at the stored place
    t.npc(1, 0, 0);
    await t.gizmo.events.ended(false);
    expect(placed(t.edits)).toEqual([[1, 0, 4, 0]]);
  });

  it('lets go of a route\'s picked points when an undo changes how many points it has', async () => {
    const t = setup({ routes: { 7: line(50, [0, 10, 20, 30, 40]) } });
    t.npc(7, -5, 0);
    t.editor.setSelection(sel({ points: [{ guid: 7, index: 2 }, { guid: 7, index: 4 }], routes: [7] }));
    t.editor.keyDown(key('Delete'));
    await vi.waitFor(() => expect(t.edits).toHaveLength(1));
    t.editor.setSelection(sel({ points: [{ guid: 7, index: 2 }], routes: [7] }));
    t.world.setPendingRoute(7, line(50, [0, 10, 20, 30, 40]).points);
    t.editor.layerChanged();
    expect(t.editor.selection.points).toEqual([]);
  });

  it('leaves a Shift-click alone when no active route exists (an NPC that stands still)', () => {
    const t = setup();
    t.npc(3, 0, 0);
    t.world.pickGround = () => new THREE.Vector3(1, 1, 0);
    t.editor.setSelection(sel({ spawns: [{ kind: 'creature', guid: 3 }], routes: [3] }));
    expect(t.editor.insertPoint(0, 0)).toBe(false);
    expect(t.notices).toEqual([]);
  });
});

describe('an NPC dragged with its route', () => {
  it('has its route and wander circle follow it while it is dragged', () => {
    const t = setup();
    t.npc(1, 0, 0);
    t.editor.setSelection(sel({ spawns: [{ kind: 'creature', guid: 1 }] }));
    t.editor.update();
    t.gizmo.events.started();
    t.gizmo.events.moved(t.change([3, 4, 0]));
    expect(t.homes.at(-1)).toEqual([1, { x: 3, y: 4, z: 0 }]);
  });
});

describe('drawing a new path', () => {
  const idle = { type: 'idle' as const, wander: 0, pathId: null };
  const walking = { type: 'path' as const, wander: 0, pathId: 803310 };
  const ref = { kind: 'creature' as const, guid: 7, entry: 107, own: false };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('draws the NPC walking a one-point path at once, and sends nothing', () => {
    const t = setup();
    t.npc(7, 0, 0);
    t.editor.startPath(7, 803310, { x: 5, y: 0, z: 0 });
    expect(t.gestures).toEqual([]);
    expect(t.pendingMovement(7)).toEqual(walking);
    expect(t.pendingRoute(7)).toEqual([{ x: 5, y: 0, z: 0 }]);
    expect(t.editor.drawing).toEqual({ guid: 7, points: 1 });
  });

  it('sends nothing while a path is drawn, and Finish sends the movement and the route as one gesture', async () => {
    const t = setup();
    t.npc(7, 0, 0);
    t.editor.startPath(7, 803310, { x: 5, y: 0, z: 0 });
    t.setGround(new THREE.Vector3(9, 0, 0));
    expect(t.editor.appendPoint(0, 0)).toBe(true);
    await settle();
    expect(t.gestures).toEqual([]);
    expect(t.asked).toEqual([]);
    expect(t.editor.drawing).toEqual({ guid: 7, points: 2 });
    t.editor.finishPath();
    expect(t.gestures).toEqual([[
      { kind: 'movement', spawn: ref, to: walking },
      { kind: 'route', spawn: ref, pathId: 803310, points: [{ x: 5, y: 0, z: 0 }, { x: 9, y: 0, z: 0 }] },
    ]]);
    expect(t.editor.drawing).toBeNull();
  });

  it('a click on the sky adds nothing', () => {
    const t = setup();
    t.npc(7, 0, 0);
    t.editor.startPath(7, 803310, { x: 5, y: 0, z: 0 });
    t.setGround(null);
    t.editor.appendPoint(0, 0);
    expect(t.editor.drawing).toEqual({ guid: 7, points: 1 });
  });

  it('Ctrl+Z while drawing takes back the last point; taking back the first cancels; nothing is sent', async () => {
    const t = setup();
    t.npc(7, 0, 0);
    t.editor.startPath(7, 803310, { x: 5, y: 0, z: 0 });
    t.setGround(new THREE.Vector3(9, 0, 0));
    t.editor.appendPoint(0, 0);
    expect(t.editor.keyDown(new KeyboardEvent('keydown', { code: 'KeyZ', ctrlKey: true }))).toBe(true);
    expect(t.editor.drawing).toEqual({ guid: 7, points: 1 });
    expect(t.pendingRoute(7)).toEqual([{ x: 5, y: 0, z: 0 }]);
    expect(t.editor.keyDown(new KeyboardEvent('keydown', { code: 'KeyY', ctrlKey: true }))).toBe(true);
    expect(t.editor.keyDown(new KeyboardEvent('keydown', { code: 'KeyZ', ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(t.editor.drawing).toEqual({ guid: 7, points: 1 });
    t.editor.undoPoint();
    expect(t.editor.drawing).toBeNull();
    expect(t.gestures).toEqual([]);
    expect(t.pendingMovement(7)).toEqual(idle);
    expect(t.pendingRoute(7)).toEqual([]);
  });

  it('finishing with one point cancels, says why, and sends nothing', () => {
    const t = setup();
    t.npc(7, 0, 0);
    t.editor.startPath(7, 803310, { x: 5, y: 0, z: 0 });
    t.editor.finishPath();
    expect(t.editor.drawing).toBeNull();
    expect(t.notices.at(-1)).toBe('A path needs at least two points');
    expect(t.gestures).toEqual([]);
    expect(t.pendingMovement(7)).toEqual(idle);
  });

  it('cancel puts everything back and sends nothing', async () => {
    const t = setup();
    t.npc(7, 0, 0);
    t.editor.startPath(7, 803310, { x: 5, y: 0, z: 0 });
    t.setGround(new THREE.Vector3(9, 0, 0));
    t.editor.appendPoint(0, 0);
    t.editor.cancelPath();
    expect(t.editor.drawing).toBeNull();
    expect(t.gestures).toEqual([]);
    expect(t.pendingMovement(7)).toEqual(idle);
    expect(t.pendingRoute(7)).toEqual([]);
  });

  it('Enter finishes', async () => {
    const t = setup();
    t.npc(7, 0, 0);
    t.editor.startPath(7, 803310, { x: 5, y: 0, z: 0 });
    t.setGround(new THREE.Vector3(9, 0, 0));
    t.editor.appendPoint(0, 0);
    expect(t.editor.keyDown(new KeyboardEvent('keydown', { code: 'Enter' }))).toBe(true);
    expect(t.editor.drawing).toBeNull();
    expect(t.gestures).toHaveLength(1);
  });

  it('a path being drawn is drawn again when a new layer clears what was pending', () => {
    const t = setup();
    t.npc(7, 0, 0);
    t.editor.startPath(7, 803310, { x: 5, y: 0, z: 0 });
    t.world.setPendingMovement(7, null);
    t.editor.layerChanged();
    expect(t.pendingMovement(7)).toEqual(walking);
    expect(t.pendingRoute(7)).toEqual([{ x: 5, y: 0, z: 0 }]);
  });
});

describe('while a path is drawn', () => {
  it('takes the gizmo away, so the NPC cannot be dragged while its path is drawn', () => {
    const t = setup();
    t.npc(7, 0, 0);
    t.editor.setSelection(sel({ spawns: [{ kind: 'creature', guid: 7 }] }));
    t.editor.update();
    expect(t.gizmo.attached).toBe(true);
    t.editor.startPath(7, 803310, { x: 5, y: 0, z: 0 });
    t.editor.update();
    expect(t.gizmo.attached).toBe(false);
  });
});

describe('a drag dropped by an undo', () => {
  it('puts what was dragged back where it was and makes no edit when the gizmo lets go', async () => {
    const t = setup({ floor: 1 });
    const o = t.npc(1, 0, 0);
    t.editor.setSelection(sel({ spawns: [{ kind: 'creature', guid: 1 }] }));
    t.editor.update();
    t.gizmo.events.started();
    t.gizmo.events.moved(t.change([0, 4, 0]));
    expect(o.position.y).toBe(4);
    t.editor.cancelDrag();
    expect(o.position.toArray()).toEqual([0, 0, 0]);
    expect(t.homes.at(-1)).toEqual([1, { x: 0, y: 0, z: 0 }]);
    await t.gizmo.events.ended(false);
    expect(t.edits).toEqual([]);
  });
});

describe('the gizmo mode', () => {
  it('is told once for each real change, from the buttons and from the G and R keys', () => {
    const t = setup();
    const modes: string[] = [];
    const editor = new Editor(t.world, { onMode: (m) => modes.push(m) });
    editor.setMode('move');
    expect(modes).toEqual([]);
    editor.setMode('rotate');
    editor.setMode('rotate');
    expect(editor.keyDown(key('KeyR'))).toBe(true);
    expect(modes).toEqual(['rotate']);
    editor.keyDown(key('KeyG'));
    editor.keyDown(key('KeyG'));
    expect(modes).toEqual(['rotate', 'move']);
  });
});

describe('a gesture on its way', () => {
  it('holds undo from the release until its edits are sent, while the floor is looked up', async () => {
    const t = setup({ floor: 1 });
    const order: string[] = [];
    const editor = new Editor(t.world, {
      onGesture: () => order.push('sent'),
      floorZ: async () => {
        order.push('floor');
        return 1;
      },
      onGestureStart: () => {
        order.push('held');
        return () => order.push('released');
      },
    });
    t.npc(1, 0, 0);
    const gizmo = gizmos.at(-1);
    editor.setSelection(sel({ spawns: [{ kind: 'creature', guid: 1 }] }));
    editor.update();
    gizmo.events.started();
    gizmo.events.moved(t.change([0, 4, 0]));
    await gizmo.events.ended(false);
    // Held before the floor is asked, and every hold let go only once the edits are sent
    expect(order.slice(0, 2)).toEqual(['held', 'floor']);
    expect(order.at(-1)).toBe('released');
    expect(order.indexOf('sent')).toBeLessThan(order.indexOf('released'));
    expect(order.filter((o) => o === 'held')).toHaveLength(order.filter((o) => o === 'released').length);
  });

  it('holds nothing for a drag that changed nothing', async () => {
    const t = setup();
    const held = vi.fn(() => () => {});
    const editor = new Editor(t.world, { onGestureStart: held });
    t.npc(1, 0, 0);
    const gizmo = gizmos.at(-1);
    editor.setSelection(sel({ spawns: [{ kind: 'creature', guid: 1 }] }));
    editor.update();
    gizmo.events.started();
    await gizmo.events.ended(false);
    expect(held).not.toHaveBeenCalled();
  });
});

describe('snapping to a surface with the snap key held', () => {
  const lift = async (t: ReturnType<typeof setup>, axis: string, held: boolean, key = {}) => {
    window.dispatchEvent(new PointerEvent('pointermove', { altKey: held, ...key }));
    t.editor.update();
    t.gizmo.events.started();
    t.gizmo.events.moved({ ...t.change([0, 0, 5]), axis });
    await t.gizmo.events.ended(axis === 'Z');
  };

  it('puts a thing lifted on the Z arrow on the floor under it', async () => {
    const t = setup({ floor: 1 });
    t.npc(1, 0, 0);
    t.editor.setSelection(sel({ spawns: [{ kind: 'creature', guid: 1 }] }));
    await lift(t, 'Z', true);
    expect(placed(t.edits)).toEqual([[1, 0, 0, 1]]);
  });

  it('works on the arrows along the ground too, not only on the yellow square', async () => {
    const t = setup({ floor: 1 });
    t.npc(1, 0, 0);
    t.editor.setSelection(sel({ spawns: [{ kind: 'creature', guid: 1 }] }));
    await lift(t, 'X', true);
    expect(placed(t.edits)).toEqual([[1, 0, 0, 1]]);
  });

  it('without the key a lift on the Z arrow stays where it was put', async () => {
    const t = setup({ floor: 1 });
    t.npc(1, 0, 0);
    t.editor.setSelection(sel({ spawns: [{ kind: 'creature', guid: 1 }] }));
    await lift(t, 'Z', false);
    expect(placed(t.edits)).toEqual([[1, 0, 0, 5]]);
  });

  it('keeps the surface it was snapped to when the server has no floor there, only another level', async () => {
    // The drawn surface under it is at 0; the server knows only a floor 10 yards away
    const t = setup({ floor: 10 });
    t.npc(1, 0, 0);
    t.editor.setSelection(sel({ spawns: [{ kind: 'creature', guid: 1 }] }));
    await lift(t, 'Z', true);
    expect(placed(t.edits)).toEqual([[1, 0, 0, 0]]);
    expect(t.notices.at(-1)).toBe(NOT_SNAPPED);
  });

  it('takes a floor as far away as the tolerance in the preferences allows', async () => {
    const t = setup({ floor: 10, snapTolerance: 12 });
    t.npc(1, 0, 0);
    t.editor.setSelection(sel({ spawns: [{ kind: 'creature', guid: 1 }] }));
    await lift(t, 'Z', true);
    expect(placed(t.edits)).toEqual([[1, 0, 0, 10]]);
  });

  it('snaps route points too', async () => {
    const t = setup({ routes: { 7: line(50, [0, 10]) } });
    t.editor.setSelection(sel({ points: [{ guid: 7, index: 0 }] }));
    window.dispatchEvent(new PointerEvent('pointermove', { altKey: true }));
    t.editor.update();
    t.gizmo.events.started();
    t.gizmo.events.moved({ ...t.change([0, 0, 5]), axis: 'Z' });
    expect(t.previews.at(-1)![1][0]!.z).toBe(0);
  });

  it('follows the chosen key', async () => {
    const t = setup({ floor: 1 });
    t.npc(1, 0, 0);
    t.editor.setSelection(sel({ spawns: [{ kind: 'creature', guid: 1 }] }));
    // Alt is the default: Shift alone does nothing
    await lift(t, 'Z', false, { shiftKey: true });
    expect(placed(t.edits)).toEqual([[1, 0, 0, 5]]);
  });
});
