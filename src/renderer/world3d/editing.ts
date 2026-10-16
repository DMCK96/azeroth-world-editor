import * as THREE from 'three';
import type { Placement } from '@core/world/layer';
import { IDLE, type Movement } from '@core/world/movement';
import type { EditPoint, SpawnEdit, SpawnRef } from './edits';
import { Gizmo, placementOf, SNAP_PROBE, type GizmoChange, type GizmoMode, type GizmoTurns } from './scene/edit/Gizmo';
import { DEFAULT_SNAP_KEY, snapKeyHeld, type SnapKey } from './scene/edit/snap-key';
import { legIndex, MIN_ROUTE_POINTS } from './scene/edit/route';
import { afterRouteChange, EMPTY_SELECTION, type Selection } from './scene/edit/selection';
import { FALLOFF_DEFAULT, falloffWeights, stepRadius, type Falloff } from './scene/edit/falloff';
import { centreOf, movedBy, sharedHeading, turnedAbout, turnQuaternion } from './scene/edit/group';

/**
 * Editing in the 3D view: one gizmo on the middle of what is selected (NPCs, objects, points of
 * routes), moving or turning all of it together; with falloff, the other points of those routes
 * nearby follow by a share. Delete takes picked points out and a click inserts one. Each gesture's
 * edits (whole placements and whole routes) are emitted together, for the view's host to store as one
 * step of the project's history; the world draws them at once and keeps them until the host says.
 * Undo is the project's: an undo hands the view a new layer, and `layerChanged` follows it.
 */

/** How far above the drawn ground a thing lifted on the Z arrow must stand to count as held there */
const RAISED = 0.5;
/** The gizmo handle that slides a thing along the ground (the yellow square): the only one that follows the ground and drops to the server floor */
const GROUND_AXIS = 'XY';
/** How far the server's floor may be from the surface a thing was snapped to and still be taken: a farther one is another level, not that surface */
export const SNAP_FLOOR_TOLERANCE = 1;
const raisedKey = (kind: 'creature' | 'object', guid: number): string => `${kind}:${guid}`;
export const NOT_SNAPPED = 'The height is from the drawn ground, not the server.';
export const TOO_SHORT = 'A route keeps at least two points.';
export const PICK_POINT_FIRST = 'Pick a point of the route first, or click on one of its legs.';
export const TOO_FEW_POINTS = 'A path needs at least two points';

type Kind = 'creature' | 'object';
type At = { x: number; y: number; z: number };

/** What the editor needs of the world it edits */
export interface EditingWorld {
  camera: THREE.Camera;
  dom: HTMLElement;
  scene: THREE.Scene;
  /** The terrain and buildings, which a moved spawn stands on */
  ground(): THREE.Object3D[];
  /** The ground under a place on screen, or null for sky */
  pickGround(ndcX: number, ndcY: number): THREE.Vector3 | null;
  /** The ray from the camera through a place on screen */
  rayAt(ndcX: number, ndcY: number): THREE.Ray;
  findSpawn(kind: Kind, guid: number): THREE.Object3D | null;
  /** Whether a spawn stands aboard a docked vessel, whose deck is its floor, not the server's under the vessel */
  aboard?(kind: Kind, guid: number): boolean;
  spawnRoute(guid: number): { pathId: number; own: boolean; entry: number; points: EditPoint[] } | null;
  pickRoutePoint(ray: THREE.Ray, guid: number): number | null;
  /** Draws a route as edited until the host stores it */
  setPendingRoute(guid: number, points: EditPoint[]): void;
  /** Moves a drawn route to points being dragged */
  previewRoute(guid: number, points: EditPoint[]): void;
  /** Takes an NPC's route and wander circle to where it is being dragged */
  previewHome(guid: number, at: At): void;
  /** Draws an NPC's movement as edited until the host stores it; null draws it as stored again */
  setPendingMovement(guid: number, movement: Movement | null): void;
  /** How a drawn NPC moves, as the view has it; null when it is not drawn */
  spawnMovement(guid: number): Movement | null;
}

export interface EditingOptions {
  /** One gesture's edits, to be stored as one step */
  onGesture?(edits: SpawnEdit[]): void;
  /** A gesture has started on its way (waiting for the floor or a question); undo waits until the release is called */
  onGestureStart?(): () => void;
  /** The server's floor nearest a height at a place, or null when it has none there */
  floorZ?(x: number, y: number, nearZ: number): Promise<number | null>;
  /** Asked once per route before the first change to a world route; false leaves it as it was */
  beforeRouteEdit?(spawn: SpawnRef, pathId: number): Promise<boolean>;
  onNotice?(message: string | null): void;
  /** Told when the editor itself changed the selection (a delete or an insert) */
  onSelection?(selection: Selection): void;
  /** Told when falloff was switched or its radius changed by a key or the wheel */
  onFalloff?(falloff: Falloff): void;
  /** Told when the gizmo changed between move and rotate (buttons or the G and R keys) */
  onMode?(mode: GizmoMode): void;
  /** Asked to delete the selected NPCs and objects: Delete with spawns selected and no route points picked */
  onDeleteSpawns?(): void;
  /** Told when a new path starts or stops being drawn, and how many points it has */
  onDrawing?(drawing: { guid: number; points: number } | null): void;
  /** The key that snaps a drag to the surface under it while held (the user's preference); Alt when absent */
  snapKey?(): SnapKey;
}

/** A spawn being dragged, as it stood when the drag began */
type DraggedSpawn = { kind: Kind; guid: number; start: THREE.Vector3; quaternion: THREE.Quaternion; before: Placement };
/** A route with picked points being dragged: its points as they stood, and as they are now */
type DraggedRoute = { guid: number; before: EditPoint[]; current: EditPoint[]; picked: Set<number> };

/**
 * A new path being drawn for an NPC: drawn in the view as it grows and sent only when finished, so the
 * whole path is one step. `was` is how the NPC moved before
 */
type Drawing = { guid: number; pathId: number; ref: SpawnRef; points: EditPoint[]; was: Movement };

type Drag = {
  spawns: DraggedSpawn[];
  routes: DraggedRoute[];
  centre: THREE.Vector3;
  /** Each falloff point's share of a move, by `guid:index` */
  weights: Map<string, number>;
  last: GizmoChange | null;
  /** Whether the snap key was held at the last move */
  snapped: boolean;
};

const pointKey = (guid: number, index: number) => `${guid}:${index}`;

/** Which of a route's points are picked */
const pickedOf = (selection: Selection, guid: number) => new Set(selection.points.filter((p) => p.guid === guid).map((p) => p.index));

export class Editor {
  readonly #world: EditingWorld;
  readonly #options: EditingOptions;
  readonly #gizmo: Gizmo;
  /** How many points each route with picked points had when last seen, to know when a new layer reshaped it */
  readonly #lengths = new Map<number, number>();
  /** Each world route's answer to "change it for every spawn that walks it?" */
  readonly #answers = new Map<number, Promise<boolean>>();
  #selection: Selection = EMPTY_SELECTION;
  #falloff: Falloff = { on: false, radius: FALLOFF_DEFAULT };
  #mode: GizmoMode = 'move';
  #drag: Drag | null = null;
  /** NPCs and objects lifted off the ground on the Z arrow in this session: a move along the ground keeps their height */
  #raised = new Set<string>();
  #drawing: Drawing | null = null;
  /** An AI client is writing: nothing can be edited, but the view still moves */
  #locked = false;
  /** Where the gizmo was last put, so it is put again only when that changes */
  #attached: { at: THREE.Vector3; quaternion: THREE.Quaternion; turns: GizmoTurns } | null = null;
  /** Whether the snap key is down, as the last pointer event said */
  #snap = false;
  readonly #track = (event: PointerEvent): void => {
    this.#snap = snapKeyHeld(event, this.#options.snapKey?.() ?? DEFAULT_SNAP_KEY);
    this.#gizmo.snap = this.#snap;
  };

  constructor(world: EditingWorld, options: EditingOptions) {
    this.#world = world;
    this.#options = options;
    // In the capture phase, so the key is known before the gizmo's own move handler runs
    if (typeof window !== 'undefined') {
      window.addEventListener('pointermove', this.#track, true);
      window.addEventListener('pointerdown', this.#track, true);
    }
    this.#gizmo = new Gizmo(world.camera, world.dom, world.scene, world.ground, {
      started: () => this.#started(),
      moved: (change) => this.#moved(change),
      ended: (lifted) => this.#ended(lifted),
    });
  }

  /** Whether a press is the gizmo's, so the camera leaves it alone */
  get blocked(): boolean {
    return this.#gizmo.hovered || this.#gizmo.dragging;
  }

  /**
   * While locked, no edit can begin: the gizmo is taken away (a drag under way is dropped, putting what it
   * moved back), route points cannot be inserted or deleted, and a path being drawn waits to be finished
   */
  setLocked(locked: boolean): void {
    this.#locked = locked;
    if (!locked) return;
    this.cancelDrag();
    this.#gizmo.detach();
    this.#attached = null;
  }

  /** Whether the gizmo is being dragged: a right-click then belongs to the drag, not the menu */
  get dragging(): boolean {
    return this.#gizmo.dragging || this.#drag !== null;
  }

  get selection(): Selection {
    return this.#selection;
  }

  /** What the host selected; the editor tells it back only about changes it makes itself */
  setSelection(selection: Selection): void {
    this.#selection = selection;
    this.#rememberLengths();
  }

  /**
   * The view drew a new layer or new own spawns (an undo, or an answer): what was pending is gone, so a
   * path being drawn is drawn again, and picked points of a route that gained or lost points are let
   * go, since they would name other points now
   */
  layerChanged(): void {
    const drawing = this.#drawing;
    if (drawing) this.#drawPending(drawing);
    const kept = this.#selection.points.filter((p) => {
      const route = this.#world.spawnRoute(p.guid);
      const known = this.#lengths.get(p.guid);
      return !!route && p.index < route.points.length && (known === undefined || known === route.points.length);
    });
    if (kept.length !== this.#selection.points.length) this.#select({ ...this.#selection, points: kept });
    this.#rememberLengths();
  }

  #rememberLengths(): void {
    this.#lengths.clear();
    for (const p of this.#selection.points) {
      const route = this.#world.spawnRoute(p.guid);
      if (route) this.#lengths.set(p.guid, route.points.length);
    }
  }

  /** Draws a route as edited, remembering its shape for `layerChanged` */
  #pend(guid: number, points: EditPoint[]): void {
    this.#world.setPendingRoute(guid, points);
    if (this.#lengths.has(guid)) this.#lengths.set(guid, points.length);
  }

  get falloff(): Falloff {
    return this.#falloff;
  }

  setFalloff(falloff: Falloff): void {
    this.#falloff = { ...falloff };
  }

  setMode(mode: GizmoMode): void {
    const changed = mode !== this.#mode;
    this.#mode = mode;
    this.#gizmo.setMode(mode);
    if (changed) this.#options.onMode?.(mode);
  }

  /**
   * A new route point where a click lands (Shift-click in Camera mode, Alt-click in Select mode): on
   * the nearest leg of an active route, else after the last picked point. True when the click was used.
   */
  insertPoint(ndcX: number, ndcY: number): boolean {
    if (this.#locked) return true;
    const { points } = this.#selection;
    const routes = this.#selection.routes.filter((guid) => this.#world.spawnRoute(guid) !== null);
    if (routes.length === 0) return false;
    const ground = this.#world.pickGround(ndcX, ndcY);
    if (!ground) return true;

    let target: { guid: number; index: number } | null = null;
    for (const guid of routes) {
      const route = this.#world.spawnRoute(guid);
      const index = route ? legIndex(route.points, ground) : null;
      if (index !== null) {
        target = { guid, index };
        break;
      }
    }
    if (!target && routes.length === 1) {
      const guid = routes[0]!;
      const route = this.#world.spawnRoute(guid);
      const last = points.filter((p) => p.guid === guid).at(-1);
      if (route) target = { guid, index: last ? last.index + 1 : route.points.length };
    }
    if (!target && points.length > 0) {
      const last = points.at(-1)!;
      target = { guid: last.guid, index: last.index + 1 };
    }
    if (!target) {
      this.#options.onNotice?.(PICK_POINT_FIRST);
      return true;
    }

    const route = this.#world.spawnRoute(target.guid);
    if (!route) return true;
    const { guid, index } = target;
    const after = [...route.points.slice(0, index), { x: ground.x, y: ground.y, z: ground.z }, ...route.points.slice(index)];
    const moved = afterRouteChange(this.#selection, guid, { kind: 'insert', index });
    this.#select({ ...moved, points: [{ guid, index }] });
    void this.#commit([this.#routeEdit(guid, route.points)], [this.#routeEdit(guid, after)]);
    return true;
  }

  /** The new path being drawn, and how many points it has; null when none is */
  get drawing(): { guid: number; points: number } | null {
    return this.#drawing ? { guid: this.#drawing.guid, points: this.#drawing.points.length } : null;
  }

  /**
   * Starts a new path for a drawn NPC at a point: it is drawn walking that path, which has the one
   * point. Another path being drawn is finished first. Nothing is sent until the path is finished
   */
  startPath(guid: number, pathId: number, first: At): void {
    if (this.#locked) return;
    if (this.#drawing) this.finishPath();
    const ref = this.#ref('creature', guid);
    if (!ref) return;
    // A path made here is this NPC's alone: there is nobody to ask about changing it
    this.#answers.set(pathId, Promise.resolve(true));
    const was = this.#world.spawnMovement(guid) ?? IDLE;
    this.#drawing = { guid, pathId, ref, points: [{ x: first.x, y: first.y, z: first.z }], was };
    this.#drawPending(this.#drawing);
    this.#tellDrawing();
  }

  /** While a path is drawn, a click on the ground adds a point at its end; true when the click was the path's */
  appendPoint(ndcX: number, ndcY: number): boolean {
    const drawing = this.#drawing;
    if (!drawing) return false;
    if (this.#locked) return true;
    const ground = this.#world.pickGround(ndcX, ndcY);
    if (!ground) return true;
    drawing.points = [...drawing.points, { x: ground.x, y: ground.y, z: ground.z }];
    this.#drawPending(drawing);
    this.#tellDrawing();
    return true;
  }

  /**
   * Drops a drag under way without an edit: everything dragged goes back where it was drawn before it.
   * An undo arriving mid-drag does this first, so the drag cannot land on top of what the undo put back
   */
  cancelDrag(): void {
    const drag = this.#drag;
    if (!drag) return;
    this.#drag = null;
    for (const spawn of drag.spawns) {
      const object = this.#world.findSpawn(spawn.kind, spawn.guid);
      if (!object) continue;
      object.position.copy(spawn.start);
      object.quaternion.copy(spawn.quaternion);
      object.updateMatrixWorld(true);
      if (spawn.kind === 'creature') this.#world.previewHome(spawn.guid, { x: spawn.start.x, y: spawn.start.y, z: spawn.start.z });
    }
    for (const route of drag.routes) this.#world.previewRoute(route.guid, route.before);
  }

  /** Takes back the path's last point; taking back its first cancels the path */
  undoPoint(): void {
    const drawing = this.#drawing;
    if (!drawing) return;
    if (drawing.points.length <= 1) {
      this.cancelPath();
      return;
    }
    drawing.points = drawing.points.slice(0, -1);
    this.#drawPending(drawing);
    this.#tellDrawing();
  }

  /** Ends the path being drawn and sends it as one gesture; one with fewer than two points is cancelled, as no NPC can walk it */
  finishPath(): void {
    const drawing = this.#drawing;
    if (!drawing || this.#locked) return;
    if (drawing.points.length < MIN_ROUTE_POINTS) {
      this.cancelPath();
      this.#options.onNotice?.(TOO_FEW_POINTS);
      return;
    }
    this.#drawing = null;
    this.#tellDrawing();
    this.#options.onGesture?.([{ kind: 'movement', spawn: drawing.ref, to: this.#walks(drawing) }, this.#pathEdit(drawing, drawing.points)]);
  }

  /** Puts back how the NPC was drawn before the path was started; nothing was sent */
  cancelPath(): void {
    const drawing = this.#drawing;
    if (!drawing) return;
    this.#drawing = null;
    this.#world.setPendingRoute(drawing.guid, []);
    this.#world.setPendingMovement(drawing.guid, drawing.was);
    this.#tellDrawing();
  }

  #walks(drawing: Drawing): Movement {
    return { type: 'path', wander: 0, pathId: drawing.pathId };
  }

  #drawPending(drawing: Drawing): void {
    this.#world.setPendingMovement(drawing.guid, this.#walks(drawing));
    this.#world.setPendingRoute(drawing.guid, drawing.points);
  }

  #pathEdit(drawing: Drawing, points: EditPoint[]): SpawnEdit {
    return { kind: 'route', spawn: drawing.ref, pathId: drawing.pathId, points };
  }

  #tellDrawing(): void {
    this.#options.onDrawing?.(this.drawing);
  }

  /** A wheel turn during a falloff drag grows or shrinks the radius; true when it was used */
  wheel(deltaY: number): boolean {
    const drag = this.#drag;
    if (!drag || !this.#falloff.on || this.#selection.points.length === 0) return false;
    this.#setFalloff({ ...this.#falloff, radius: stepRadius(this.#falloff.radius, deltaY < 0 ? 1 : -1) });
    drag.weights = this.#weights(drag.routes);
    if (drag.last) this.#moved(drag.last);
    return true;
  }

  /** The editing keys; true when the key was one of them */
  keyDown(event: KeyboardEvent): boolean {
    const ctrl = event.ctrlKey || event.metaKey;
    // Deleting points and finishing a path are edits
    if (this.#locked && (event.code === 'Delete' || event.code === 'Enter')) return true;
    // While a path is drawn, Enter finishes it and Ctrl+Z takes back its last point; redo waits until it is finished
    if (this.#drawing && event.code === 'Enter') {
      this.finishPath();
      return true;
    }
    if (this.#drawing && ctrl && event.code === 'KeyZ' && !event.shiftKey) {
      this.undoPoint();
      return true;
    }
    if (this.#drawing && ctrl && (event.code === 'KeyY' || event.code === 'KeyZ')) return true;
    // Otherwise undo and redo are the project's, handled by the app
    if (ctrl) return false;
    switch (event.code) {
      case 'KeyG':
        this.setMode('move');
        return true;
      case 'KeyR':
        this.setMode('rotate');
        return true;
      case 'Delete':
        // Picked route points are deleted first; with none picked, the selected spawns are
        // While a path is drawn the NPC it is for cannot be deleted from under it
        if (this.#selection.points.length === 0 && this.#selection.spawns.length > 0 && !this.#drawing) this.#options.onDeleteSpawns?.();
        else this.#deletePoints();
        return true;
      case 'KeyO':
        this.#setFalloff({ ...this.#falloff, on: !this.#falloff.on });
        return true;
      case 'BracketRight':
        this.#setFalloff({ ...this.#falloff, radius: stepRadius(this.#falloff.radius, 1) });
        return true;
      case 'BracketLeft':
        this.#setFalloff({ ...this.#falloff, radius: stepRadius(this.#falloff.radius, -1) });
        return true;
    }
    return false;
  }

  /** Every frame: keeps the gizmo on the middle of what is selected, which a redraw may have replaced */
  update(): void {
    if (this.#locked) {
      if (this.#gizmo.attached) this.#gizmo.detach();
      this.#attached = null;
      return;
    }
    if (this.#drag || this.#gizmo.dragging) return;
    // While a path is drawn the NPC cannot be dragged: a move would land among the path's undo steps
    if (this.#drawing) {
      if (this.#gizmo.attached) this.#gizmo.detach();
      this.#attached = null;
      return;
    }
    const spawns = this.#selection.spawns.flatMap((s) => {
      const object = this.#world.findSpawn(s.kind, s.guid);
      return object ? [{ kind: s.kind, object }] : [];
    });
    const points = this.pointPositions();
    if (spawns.length + points.length === 0) {
      if (this.#gizmo.attached) this.#gizmo.detach();
      this.#attached = null;
      return;
    }
    const at = centreOf([...spawns.map((s) => s.object.position), ...points]);
    const centre = new THREE.Vector3(at.x, at.y, at.z);
    const single = spawns.length === 1 && points.length === 0 ? spawns[0]! : null;
    const turns: GizmoTurns = single?.kind === 'object' ? 'all' : spawns.length === 0 && this.#mode === 'move' ? 'none' : 'z';
    // One thing's handles follow how it is turned; several do when they all face the same way, else they sit on the world axes
    const heading = points.length === 0 ? sharedHeading(spawns.map((s) => s.object.quaternion.toArray() as [number, number, number, number])) : null;
    const quaternion = single ? single.object.quaternion.clone() : new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), heading ?? 0);
    const was = this.#attached;
    if (was && was.turns === turns && was.at.distanceTo(centre) < 1e-6 && was.quaternion.angleTo(quaternion) < 1e-6 && this.#gizmo.attached) return;
    this.#attached = { at: centre, quaternion, turns };
    this.#gizmo.attach(centre, quaternion, turns);
    this.#gizmo.setMode(this.#mode);
  }

  dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', this.#track, true);
      window.removeEventListener('pointerdown', this.#track, true);
    }
    this.#gizmo.dispose();
  }

  /** Where the picked points are drawn: where a drag has them, else as the route has them */
  pointPositions(): At[] {
    const drag = this.#drag;
    return this.#selection.points.flatMap((p) => {
      const dragged = drag?.routes.find((r) => r.guid === p.guid)?.current[p.index];
      if (dragged) return [{ x: dragged.x, y: dragged.y, z: dragged.z }];
      const point = this.#world.spawnRoute(p.guid)?.points[p.index];
      return point ? [{ x: point.x, y: point.y, z: point.z }] : [];
    });
  }

  #select(selection: Selection): void {
    this.#selection = selection;
    this.#options.onSelection?.(selection);
  }

  #setFalloff(falloff: Falloff): void {
    this.#falloff = falloff;
    this.#options.onFalloff?.({ ...falloff });
  }

  /** An NPC's spawn as an edit names it, read from what is drawn */
  #ref(kind: Kind, guid: number): SpawnRef | null {
    const data = this.#world.findSpawn(kind, guid)?.userData.spawn;
    return data ? { kind: data.kind, guid: data.guid, entry: data.entry, own: data.own } : null;
  }

  /**
   * A route edit for an NPC's route; callers check first that the route is drawn. The NPC is named from
   * the route, which is drawn however far the NPC itself has been left behind.
   */
  #routeEdit(guid: number, points: EditPoint[]): SpawnEdit {
    const route = this.#world.spawnRoute(guid)!;
    return { kind: 'route', spawn: { kind: 'creature', guid, entry: route.entry, own: route.own }, pathId: route.pathId, points };
  }

  /** Each other point of the dragged routes' share of a move, with falloff on */
  #weights(routes: DraggedRoute[]): Map<string, number> {
    if (!this.#falloff.on || this.#mode !== 'move') return new Map();
    const selected = routes.flatMap((r) => r.before.filter((_, i) => r.picked.has(i)));
    const others = routes.flatMap((r) => r.before.flatMap((p, i) => (r.picked.has(i) ? [] : [{ key: pointKey(r.guid, i), x: p.x, y: p.y }])));
    return falloffWeights(selected, others, this.#falloff.radius);
  }

  #started(): void {
    const spawns = this.#selection.spawns.flatMap((s): DraggedSpawn[] => {
      const object = this.#world.findSpawn(s.kind, s.guid);
      return object ? [{ kind: s.kind, guid: s.guid, start: object.position.clone(), quaternion: object.quaternion.clone(), before: placementOf(object, s.kind) }] : [];
    });
    const guids = [...new Set(this.#selection.points.map((p) => p.guid))];
    const routes = guids.flatMap((guid): DraggedRoute[] => {
      const route = this.#world.spawnRoute(guid);
      if (!route) return [];
      const before = route.points.map((p) => ({ ...p }));
      return [{ guid, before, current: before, picked: pickedOf(this.#selection, guid) }];
    });
    const centre = this.#attached?.at.clone() ?? new THREE.Vector3();
    this.#gizmo.keepHeight = spawns.some((s) => this.#raised.has(raisedKey(s.kind, s.guid)));
    this.#drag = { spawns, routes, centre, weights: this.#weights(routes), last: null, snapped: false };
  }

  /** The drag so far, applied to everything selected (found again by guid: a redraw may have replaced it) */
  #moved(change: GizmoChange): void {
    const drag = this.#drag;
    if (!drag) return;
    drag.last = change;
    const turning = this.#mode === 'rotate' && this.#attached?.turns !== 'none';
    // Only the yellow plane handle follows the ground (a thing lifted on the Z arrow keeps its height above it); the arrows move
    // freely, unless the snap key is held: then every handle puts the thing on the surface nearest where it was dragged
    const snapping = this.#snap;
    drag.snapped = snapping;
    const onGround = (p: At, start: At, keepHeight: boolean): At => {
      if (turning || (change.axis !== GROUND_AXIS && !snapping)) return p;
      const clearance = keepHeight && !snapping ? Math.max(0, start.z - (this.#gizmo.groundAt(start.x, start.y, start.z) ?? start.z)) : 0;
      const ground = this.#gizmo.groundAt(p.x, p.y, p.z - clearance, snapping ? SNAP_PROBE : undefined);
      return { ...p, z: ground === null ? p.z : ground + clearance };
    };
    const moved = (start: At, weight: number, keepHeight = false): At =>
      turning ? turnedAbout(start, drag.centre, change.angle) : onGround(movedBy(start, change.delta, weight), start, keepHeight);

    for (const spawn of drag.spawns) {
      const object = this.#world.findSpawn(spawn.kind, spawn.guid);
      if (!object) continue;
      const to = moved(spawn.start, 1, this.#raised.has(raisedKey(spawn.kind, spawn.guid)));
      object.position.set(to.x, to.y, to.z);
      if (turning) {
        const q = this.#attached?.turns === 'all' ? change.quaternion : new THREE.Quaternion(...turnQuaternion(spawn.quaternion.toArray() as [number, number, number, number], change.angle));
        object.quaternion.copy(q);
      }
      object.updateMatrixWorld(true);
      if (spawn.kind === 'creature') this.#world.previewHome(spawn.guid, to);
    }

    for (const route of drag.routes) {
      route.current = route.before.map((p, i) => {
        const weight = route.picked.has(i) ? 1 : turning ? 0 : (drag.weights.get(pointKey(route.guid, i)) ?? 0);
        return weight === 0 ? p : { ...p, ...moved(p, weight) };
      });
      this.#world.previewRoute(route.guid, route.current);
    }
  }

  async #ended(lifted: boolean): Promise<void> {
    const drag = this.#drag;
    const change = drag?.last;
    // A redraw since the last move may have put fresh objects back where they were stored
    if (drag) this.#snap = drag.snapped;
    if (change) this.#moved(change);
    const snapped = drag?.snapped ?? false;
    this.#drag = null;
    const attached = this.#attached;
    // A lone object tilted on its X or Y ring has turned, though not about Z
    const tilted = !!change && attached?.turns === 'all' && change.quaternion.angleTo(attached.quaternion) > 1e-9;
    if (!drag || !change || (change.delta.lengthSq() === 0 && change.angle === 0 && !tilted)) return;
    // An undo waits until this gesture is sent: the floor and any question come first
    const release = this.#options.onGestureStart?.();
    try {
      const moving = this.#mode === 'move' || this.#attached?.turns === 'none';

      const spawns = drag.spawns.flatMap((s) => {
        const object = this.#world.findSpawn(s.kind, s.guid);
        return object ? [{ ...s, object }] : [];
      });
      const routes = drag.routes.map((r) => ({ ...r, changed: r.current.flatMap((p, i) => (p === r.before[i] ? [] : [i])) }));
      // A lift on the Z arrow is remembered, so later moves along the ground do not drop the thing back down
      if (moving && snapped) {
        // Put on a surface, so nothing is held above it any more
        for (const s of spawns) this.#raised.delete(raisedKey(s.kind, s.guid));
      } else if (moving && lifted) {
        for (const s of spawns) {
          const { x, y, z } = s.object.position;
          const key = raisedKey(s.kind, s.guid);
          if (z - (this.#gizmo.groundAt(x, y, z) ?? z) > RAISED) this.#raised.add(key);
          else this.#raised.delete(key);
        }
      }
      // Drawn where they were dragged from now on, while the server's floor and any question are awaited,
      // so the gizmo stays with them and a quick second drag starts from there
      for (const r of routes) if (r.changed.length > 0) this.#pend(r.guid, r.current);

      // Dropped along the ground: onto the server's floor nearest where each thing was dragged, when it has one
      if (moving && (snapped || (!lifted && change.axis === GROUND_AXIS)) && this.#options.floorZ) {
        const floorZ = this.#options.floorZ;
        // A snapped thing keeps the surface it was put on unless the server's floor is that same surface
        const serverFloor = (floor: number | null, z: number): number | null => (floor !== null && snapped && Math.abs(floor - z) > SNAP_FLOOR_TOLERANCE ? null : floor);
        const asks = [
          ...spawns.map(async (s) => {
            if (this.#world.aboard?.(s.kind, s.guid)) return true;
            // One the user lifted keeps its height rather than dropping to the floor
            if (this.#raised.has(raisedKey(s.kind, s.guid))) return true;
            const floor = serverFloor(await floorZ(s.object.position.x, s.object.position.y, s.object.position.z), s.object.position.z);
            if (floor !== null) s.object.position.z = floor;
            return floor !== null;
          }),
          ...routes.flatMap((r) =>
            r.changed.map(async (i) => {
              const p = r.current[i]!;
              const floor = serverFloor(await floorZ(p.x, p.y, p.z), p.z);
              if (floor !== null) r.current[i] = { ...p, z: floor };
              return floor !== null;
            }),
          ),
        ];
        const unfloored = (await Promise.all(asks)).filter((found) => !found).length;
        this.#options.onNotice?.(unfloored === 0 ? null : unfloored === 1 ? NOT_SNAPPED : `${unfloored} of them: the height is from the drawn ground, not the server.`);
      }

      const before: SpawnEdit[] = [];
      const after: SpawnEdit[] = [];
      for (const s of spawns) {
        // A move puts the NPC where it was dragged to, so what it was lifted onto the ground by no longer applies
        if (moving) s.object.userData.lift = 0;
        s.object.updateMatrixWorld(true);
        const spawn = this.#ref(s.kind, s.guid);
        if (!spawn) continue;
        before.push({ kind: 'place', spawn, to: s.before });
        after.push({ kind: 'place', spawn, to: placementOf(s.object, s.kind) });
      }
      for (const r of routes) {
        if (r.changed.length === 0) continue;
        before.push(this.#routeEdit(r.guid, r.before));
        after.push(this.#routeEdit(r.guid, r.current));
      }
      await this.#commit(before, after);
    } finally {
      release?.();
    }
  }

  /** Delete: every picked point out of its route; a route that would be too short to walk is left as it was */
  #deletePoints(): void {
    let selection = this.#selection;
    const before: SpawnEdit[] = [];
    const after: SpawnEdit[] = [];
    for (const guid of [...new Set(selection.points.map((p) => p.guid))]) {
      const route = this.#world.spawnRoute(guid);
      if (!route) continue;
      const picked = pickedOf(selection, guid);
      const left = route.points.filter((_, i) => !picked.has(i));
      if (left.length < MIN_ROUTE_POINTS) {
        this.#options.onNotice?.(TOO_SHORT);
        continue;
      }
      selection = afterRouteChange(selection, guid, { kind: 'delete', indexes: [...picked] });
      before.push(this.#routeEdit(guid, route.points));
      after.push(this.#routeEdit(guid, left));
    }
    if (after.length === 0) return;
    this.#select(selection);
    void this.#commit(before, after);
  }

  /**
   * One gesture's edits: a world route others walk is asked about first (one question at a time, once
   * per route); one answered no is drawn back and left out. The rest are drawn and emitted as one
   * gesture.
   */
  async #commit(before: SpawnEdit[], after: SpawnEdit[]): Promise<void> {
    // An undo waits while a shared route is asked about
    const release = this.#options.onGestureStart?.();
    try {
      const kept: number[] = [];
      for (let i = 0; i < after.length; i++) {
        const edit = after[i]!;
        if (edit.kind === 'route' && !edit.spawn.own) {
          let answer = this.#answers.get(edit.pathId);
          if (!answer) {
            answer = this.#options.beforeRouteEdit?.(edit.spawn, edit.pathId) ?? Promise.resolve(true);
            this.#answers.set(edit.pathId, answer);
          }
          if (!(await answer)) {
            const was = before[i]!;
            if (was.kind === 'route') this.#pend(was.spawn.guid, was.points);
            continue;
          }
        }
        kept.push(i);
      }
      if (kept.length === 0) return;
      const done = kept.map((i) => after[i]!);
      for (const edit of done) if (edit.kind === 'route') this.#pend(edit.spawn.guid, edit.points);
      this.#options.onGesture?.(done);
    } finally {
      release?.();
    }
  }
}
