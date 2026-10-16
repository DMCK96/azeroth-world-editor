import * as THREE from 'three';
import DbManager from './scene/db/DbManager';
import MapManager from './scene/map/MapManager';
import TextureManager from './scene/texture/TextureManager';
import { WorldControls, type ClickKeys, type Tool } from './controls';
import { CharacterTexture } from './scene/character/CharacterTexture';
import { getAssetUrl } from './scene/asset';
import { floorHeightBelow } from './scene/spawn/ground-probe';
import { spawnLocalBounds, type PickedSpawn, type SpawnSource, type SpawnStatus, type SpawnVisibility } from './scene/spawn/SpawnManager';
import type { ViewSpawns } from '@core/db/view-spawns';
import type { EntityLooks } from '@core/entities/view-spawns';
import { clearProblems, onProblems } from './scene/diagnostics';
import { ASSET_BASE_URL } from '@core/client/asset-url';
import type { WorldLayer } from '@core/world/layer';
import { Editor, NOT_SNAPPED } from './editing';
import { combine, EMPTY_SELECTION, isEmpty, withoutDeleted, type Hit, type Modifier, type Selection } from './scene/edit/selection';
import { boxHits, type Rect } from './scene/edit/box';
import type { Falloff } from './scene/edit/falloff';
import type { SpawnEdit, SpawnRef } from './edits';
import { placementAt, type PlaceRequest, type PlaceTarget } from './placing';
import type { MenuTarget } from './menu/model';
import type { Movement } from '@core/world/movement';
import type { SpawnInfo } from './scene/spawn/SpawnManager';
import { MarkerLayer, type MarkerDrawing } from './scene/marker/MarkerLayer';
import type { Frame } from '@core/map/transport-frame';
import type { Dock } from '@core/map/transport-docks';
import type { RouteLine as RouteData } from '@core/map/transport-view';
import { buildRouteLines, disposeRouteLines } from './scene/transport/RouteLine';
import { frameStats } from '../debug/frame-stats';
import type { SnapKey } from './scene/edit/snap-key';

/**
 * The 3D world: the game's own terrain, props and models for one map, read from the client's
 * archives through `awe-wow://`, drawn with Three.js by Wowser's scene classes. World units are
 * the server's (yards, X north, Y west, Z up), so a spawn's `position_x/y/z` is its place here.
 */

export interface World3DOptions {
  container: HTMLElement;
  /** The client folder of the map's terrain, e.g. `azeroth`. */
  directory: string;
  /** The map whose NPCs and objects are drawn: the terrain's own, or a transport's */
  map: number;
  /** The terrain's map, for its light and fog; `map` by default */
  hostMap?: number;
  /** On a transport, where its vessel stands: the spawns' rows are vessel-local, drawn through this */
  frame?: Frame;
  /** The vessel drawn at the frame */
  vessel?: { displayId: number } | null;
  /** The transport's route over the terrain, with its stops */
  route?: RouteData[];
  /** The one building of a map without terrain tiles (a dungeon stored as a single building), drawn in their place. */
  wmo?: { path: string; doodadSet: number };
  /** Where the camera starts looking. */
  start: { x: number; y: number; z: number };
  /** Told when the terrain around the camera changes to another area. */
  onArea?(name: string): void;
  /** Told once, when the first piece of the world has loaded and drawn. */
  onReady?(): void;
  /** Told what could not be loaded (a model, a terrain tile) while the rest still draws; the whole list each time. */
  onProblems?(problems: readonly string[]): void;
  onError?(message: string): void;
  /** Where the world's NPCs and objects come from; none draws none. */
  spawns?: SpawnSource;
  /** Told which NPC or object was clicked, or null when a click hit neither (or Esc cleared it). */
  onSelect?(spawn: PickedSpawn | null): void;
  /** Told each gesture made in the view: its whole placements and routes, to store as one step. */
  onGesture?(edits: SpawnEdit[]): void;
  /** A gesture has started on its way to the host; undo waits until the release is called. */
  onGestureStart?(): () => void;
  /** The server's floor nearest a height at a place, or null when it has none there. */
  floorZ?(x: number, y: number, nearZ: number): Promise<number | null>;
  /** Asked once per route before the first change to a world route that is not the quest's. */
  beforeRouteEdit?(spawn: SpawnRef, pathId: number): Promise<boolean>;
  /** Told something about the last edit worth saying (a height not from the server), or null. */
  onNotice?(message: string | null): void;
  /** Told each click that placed the NPC or object being placed (see `setPlacing`). */
  onPlace?(request: PlaceRequest): void;
  /** Told when Esc ended placing. */
  onPlaceEnd?(): void;
  /** Told how much is selected, after every change of the selection. */
  onSelection?(summary: SelectionSummary): void;
  /** Told when Tab flipped between Camera and Select. */
  onTool?(tool: Tool): void;
  /** Told each time the author moves the camera (a drag, the wheel, the flying keys), as it happens. */
  onCameraInput?(): void;
  /** Told when falloff was switched or its radius changed by a key or the wheel. */
  onFalloff?(falloff: Falloff): void;
  /** Told when the gizmo changed between move and rotate (buttons or the G and R keys). */
  onMode?(mode: 'move' | 'rotate'): void;
  /** Told when a new path starts or stops being drawn, and how many points it has. */
  onDrawing?(drawing: { guid: number; points: number } | null): void;
  /** Asked for the right-click menu: what was right-clicked (selected first), and where in the window. */
  onContextMenu?(target: MenuTarget, client: { x: number; y: number }): void;
  /** Ctrl+C, Ctrl+V or Ctrl+D pressed on the view: copy, paste, duplicate; true when it was used. */
  onShortcut?(code: 'KeyC' | 'KeyV' | 'KeyD'): boolean;
  /** Asked to delete the selected NPCs and objects: the Delete key with spawns selected and no route points picked. */
  onDeleteSpawns?(): void;
  /** The key that, held during a drag, snaps what is dragged to the surface under it; asked at each drag, so a changed preference applies at once. Alt when absent. */
  snapKey?(): SnapKey;
  /** Told which quest marker was clicked, or null when it was let go (the host's own `selectMarker` is not told back). */
  onMarkerSelect?(id: string | null): void;
  /** Told where a quest marker was dragged to, on the server's floor when it has one there. */
  onMarkerMove?(id: string, to: { x: number; y: number; z: number }): void;
}

/** How much is selected: NPCs, objects, and route points with how many routes they are on */
/** A spawn group as the view draws it: its centre, its spawn members, and where each member stands */
export type GroupDrawing = {
  centre: { x: number; y: number; z: number };
  members: { kind: 'creature' | 'object'; guid: number }[];
  points: { x: number; y: number; z: number }[];
};

export type SelectionSummary = { creatures: number; objects: number; points: number; routes: number };

/** A transport as the view draws it at one stop: the vessel's frame, the vessel, and its route */
export type TransportScene = { frame: Frame; vessel: { displayId: number } | null; route: RouteData[] };

/** Which of the world's scenery is drawn */
export type Scenery = { buildings: boolean; doodads: boolean };

export interface World3D {
  /** Moves the camera to look at a world point; `close` stands near it (a few yards, to see one NPC or object) rather than far. */
  lookAt(x: number, y: number, z: number, close?: boolean): void;
  /** Where the camera is and which way it looks (a unit vector). */
  camera(): { position: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number } };
  /** Shows or hides buildings and doodads (trees, fences, carts); hidden ones are not hit by clicks either. */
  setScenery(scenery: Scenery): void;
  /** Shows or hides NPCs, objects and their paths, without unloading them. */
  setSpawnVisibility(visibility: SpawnVisibility): void;
  /** Whether a kind of spawn was capped, or why none could be read. */
  spawnStatus(): SpawnStatus;
  /** The looks of edited existing NPCs and objects, drawn on their database spawns. */
  setLooks(looks: EntityLooks): void;
  /** The open quest's own NPCs and objects, drawn with the world's in place of their database rows. */
  setOwnSpawns(spawns: ViewSpawns): void;
  /** Selects one spawn (outlined while it is drawn, its route active), or clears the selection. */
  select(spawn: { kind: 'creature' | 'object'; guid: number } | null): void;
  /** What a left-drag does: orbit (Camera) or draw a selection box (Select). */
  setTool(tool: Tool): void;
  /** Whether nearby route points follow a move, and how far. */
  setFalloff(falloff: Falloff): void;
  /** Draws the world layer's edits over the database's spawns and routes. */
  setWorldLayer(layer: WorldLayer): void;
  /** Every spawn under each top-level layer group with an event, through all its levels, by group id. */
  setGroupSpawns(byGroup: ReadonlyMap<number, readonly { kind: 'npc' | 'object'; guid: number }[]>): void;
  /** Whether the gizmo moves or rotates. */
  setMode(mode: 'move' | 'rotate'): void;
  /** While locked (an AI client is writing) the camera still moves, but nothing can be moved, rotated, placed or deleted here. */
  setEditLocked(locked: boolean): void;
  /** Starts placing an existing NPC or object (each click on the ground places one), or stops with null. */
  setPlacing(target: PlaceTarget | null): void;
  /** Starts drawing a new path for a drawn NPC, its first point at `first`; each click then adds a point. */
  startPath(guid: number, pathId: number, first: { x: number; y: number; z: number }): void;
  /** Ends the path being drawn (one of fewer than two points is cancelled). */
  finishPath(): void;
  /** Puts back everything the path being drawn changed. */
  cancelPath(): void;
  /** Drops a drag under way, putting what was dragged back, with no edit */
  cancelDrag(): void;
  /** Takes back the last point of the path being drawn. */
  undoPoint(): void;
  /** Rings the spawns a quest uses, under each that is drawn; null takes the rings away. */
  setMarked(spawns: { kind: 'creature' | 'object'; guid: number }[] | null): void;
  /** Shows a spawn group: rings under its drawn members and thin lines from its centre to each member; null takes it away. */
  setGroupView(view: GroupDrawing | null): void;
  /** The selected spawns, as the menu describes them. */
  selectedSpawns(): SpawnInfo[];
  /** Selects these spawns (a paste selects what it put down). */
  selectSpawns(spawns: { kind: 'creature' | 'object'; guid: number }[]): void;
  /** Draws an NPC's movement as edited until the host stores it; null draws it as stored again. */
  setPendingMovement(guid: number, movement: Movement | null): void;
  /** How a drawn NPC moves, as the view has it; null when it is not drawn. */
  spawnMovement(guid: number): Movement | null;
  /** The ground under a place in the window, or null for sky. */
  groundAt(client: { x: number; y: number }): { x: number; y: number; z: number } | null;
  /** Where the pointer last was over the view, or null. */
  lastPointer(): { x: number; y: number } | null;
  /** The vessels that stop on this terrain, drawn with their passengers while the camera is near them. */
  setDocks(docks: readonly Dock[]): void;
  /** Whether those docked vessels are drawn and picked at all. */
  setDocksEnabled(enabled: boolean): void;
  /** Whether the NPCs walk their paths and wander circles (they start standing). */
  setMovementPlaying(playing: boolean): void;
  /** Sends every walking NPC home; whether they walk on is unchanged. */
  resetMovement(): void;
  /** The frame of the docked vessel a spawn is drawn on (its row is local to it), or null when it is not on one. */
  frameOfSpawn(kind: 'creature' | 'object', guid: number): Frame | null;
  /** A spawn still in the view (loaded, though perhaps too far to be drawn), or null. */
  spawnOf(kind: 'creature' | 'object', guid: number): SpawnInfo | null;
  /** A drawn NPC's route as the view has it, or null when it has none. */
  routeOf(guid: number): { pathId: number; points: { x: number; y: number; z: number; carry?: unknown }[] } | null;
  /** The point the camera looks at and turns round. */
  target(): { x: number; y: number; z: number };
  /** Draws the open quest's positions as markers in place of the last ones; none takes them away. */
  setMarkers(markers: readonly MarkerDrawing[]): void;
  /** Selects a quest marker (letting go of any spawns) or none; false when it is not drawn. */
  selectMarker(id: string | null): boolean;
  /** Moves the transport to another stop on the same terrain (or shows another of the map's routes) */
  setTransport(transport: TransportScene): void;
  dispose(): void;
}

// The game's colours (light bands, vertex colours) are used as they are, as wowserhq's own viewer
// (spelunker) does. With Three's colour management on, every `new THREE.Color(hex)` was taken as sRGB
// and darkened to linear, and the raw scene shaders never brightened it back: the whole world was
// drawn too dark and too red (a #FF8300 sun lost more than half its green)
THREE.ColorManagement.enabled = false;

/** The camera's first distance from its target, in yards: behind, beside and above. */
const START_OFFSET = new THREE.Vector3(-30, -30, 30);
/** Where the camera stands to look at one NPC or object: a few yards away and a little above */
const CLOSE_OFFSET = new THREE.Vector3(-7, -7, 4);
/** A client's maps run ±17066 yards from the middle. */
const WORLD_EDGE = 17066;
const NEAR = 0.5;
const FOV = 60;
const SELECTED_COLOUR = 0xffd34d;
/** The falloff ring: how round it is drawn, and how far above the ground, so it does not sink into it */
const RING_SEGMENTS = 48;
const RING_LIFT = 0.2;
/** The ring under a spawn a quest uses: a warm gold, apart from the selection's outline, and its size in yards */
const MARK_COLOUR = 0xf2c14e;
const MARK_RADIUS = 1.5;
/** A shown spawn group's rings and lines: a cool blue, apart from the quest's gold rings */
const GROUP_COLOUR = 0x6fb7ff;

const HOST = { baseUrl: ASSET_BASE_URL, normalizePath: true };
/** Textures and database tables are the same for every map, so every world shares them (and their workers). */
let shared: { textures: TextureManager; databases: DbManager; characterTexture: CharacterTexture } | null = null;
/**
 * The managers every world shares, made once: textures and tables are the same for every map, and so
 * are dressed NPCs' body textures, which are registered with the shared texture manager (one builder
 * per world would build and register every outfit again each time a world opens, and never free them)
 */
export const sharedManagers = (): NonNullable<typeof shared> => {
  if (!shared) {
    const textures = new TextureManager({ host: HOST });
    const characterTexture = new CharacterTexture({
      read: async (path) => {
        const response = await fetch(getAssetUrl(HOST, path));
        return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
      },
      register: (path, texture) => textures.register(path, texture),
    });
    shared = { textures, databases: new DbManager({ host: HOST }), characterTexture };
  }
  return shared;
};

/** Frees what a world drew; each step on its own, so one failing cannot stop the rest. */
function release(root: THREE.Object3D): void {
  root.traverse((object) => {
    const drawn = object as THREE.Mesh;
    try {
      drawn.geometry?.dispose();
      for (const material of Array.isArray(drawn.material) ? drawn.material : drawn.material ? [drawn.material] : []) material.dispose();
    } catch {
      // Already freed.
    }
  });
}

export function createWorld3D(options: World3DOptions): World3D {
  const { container } = options;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.domElement.className = 'world3d__canvas';
  container.appendChild(renderer.domElement);

  // The game's colours are already what it shows; no conversion on the way out
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  // No Three lights: terrain, models, buildings and liquids all light themselves from the map's light
  const scene = new THREE.Scene();
  // Never moved: if it were worked out each frame, it would force every object under it to be too
  scene.matrixAutoUpdate = false;
  const camera = new THREE.PerspectiveCamera(FOV, 1, NEAR, 1000);
  // Z is up in the game's world, and the orbit controls turn about the camera's up axis.
  camera.up.set(0, 0, 1);

  // What is under a place on screen, for orbiting round it and for how far a wheel notch moves: the
  // terrain and buildings only (models and liquid are thin or see-through)
  const raycaster = new THREE.Raycaster();
  // What a click can land on: the terrain, and the buildings while they are shown
  let scenery: Scenery = { buildings: true, doodads: true };
  const clickable = (group: THREE.Object3D): boolean => group.name === 'terrain' || (group.name === 'buildings' && scenery.buildings);
  const pick = (x: number, y: number): THREE.Vector3 | null => {
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
    return raycaster.intersectObjects(solid(), true)[0]?.point ?? null;
  };
  // What is selected: spawns, points of active routes, and the routes being worked on
  let selection: Selection = EMPTY_SELECTION;
  /**
   * A new selection, drawn and told about. `tell` also tells the host which one spawn is selected
   * (or none); a selection the host made itself (`select`) is not told back.
   */
  const setSelection = (next: Selection, tell = true): void => {
    // A spawn or point picked lets go of a quest marker: one thing has the handles at a time
    if (!isEmpty(next)) dropMarker();
    selection = next;
    editor.setSelection(next);
    manager.setActiveRoutes(next.routes);
    manager.markRoutePoints(next.points);
    refreshEscape();
    options.onSelection?.({
      creatures: next.spawns.filter((s) => s.kind === 'creature').length,
      objects: next.spawns.filter((s) => s.kind === 'object').length,
      points: next.points.length,
      routes: new Set(next.points.map((p) => p.guid)).size,
    });
    if (!tell) return;
    const one = next.spawns.length === 1 && next.points.length === 0 ? next.spawns[0]! : null;
    options.onSelect?.(one ? manager.pickedSpawn(one.kind, one.guid) : null);
  };
  // While placing, a click puts the chosen NPC or object on the ground instead of selecting anything
  let placing: PlaceTarget | null = null;
  /** An AI client is writing: the view moves, but nothing can be edited */
  let editLocked = false;
  let tool: Tool = 'camera';
  const refreshEscape = (): void => {
    renderer.domElement.dataset.selection = !isEmpty(selection) || placing || markers.selected !== null ? 'on' : '';
    renderer.domElement.style.cursor = placing ? 'crosshair' : tool === 'select' ? 'default' : '';
  };
  const applyTool = (next: Tool): void => {
    tool = next;
    controls.setMode(next);
    refreshEscape();
  };
  const place = async (x: number, y: number): Promise<void> => {
    const target = placing;
    const ground = target ? pick(x, y) : null;
    if (!target || editLocked) return;
    if (!ground) {
      options.onNotice?.('Click the ground or a building to place it.');
      return;
    }
    const at = placementAt(ground, camera.position, target.kind);
    // Onto the server's floor nearest where it was clicked, as a moved spawn is
    const floor = options.floorZ ? await options.floorZ(at.x, at.y, at.z) : at.z;
    options.onNotice?.(floor === null ? NOT_SNAPPED : null);
    if (placing === target) options.onPlace?.({ target, at: { ...at, z: floor ?? at.z } });
  };
  /** What is under a place on screen: a point of an active route first, else the nearest spawn nothing solid stands in front of */
  const hitAt = (x: number, y: number): Hit => {
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
    const ray = raycaster.ray.clone();
    let nearest: { guid: number; index: number; distance: number } | null = null;
    for (const guid of selection.routes) {
      const index = manager.pickRoutePoint(ray, guid);
      const at = index === null ? null : manager.spawnRoute(guid)?.points[index];
      if (index === null || !at) continue;
      const distance = ray.origin.distanceTo(new THREE.Vector3(at.x, at.y, at.z));
      if (!nearest || distance < nearest.distance) nearest = { guid, index, distance };
    }
    if (nearest) return { points: [{ guid: nearest.guid, index: nearest.index }] };
    const ground = pick(x, y);
    const spawn = manager.pickSpawn(ray, ground ? ground.distanceTo(camera.position) : Infinity);
    return { spawns: spawn ? [{ kind: spawn.kind, guid: spawn.guid }] : [] };
  };
  const modifierOf = (keys: ClickKeys): Modifier => (keys.ctrl ? 'remove' : keys.shift ? 'add' : 'replace');
  // Plain clicks in a row that hit nothing: a click on nothing keeps the selection, two (a double-click) clear it
  let misses = 0;
  const click = (x: number, y: number, keys: ClickKeys): void => {
    const missed = misses;
    misses = 0;
    // While a path is drawn, each click on the ground is its next point
    if (editor.appendPoint(x, y)) return;
    if (placing) {
      void place(x, y);
      return;
    }
    // A new route point: Shift-click in Camera mode, Alt-click in Select mode
    if ((tool === 'camera' ? keys.shift : keys.alt) && editor.insertPoint(x, y)) return;
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
    const marker = markers.pick(raycaster.ray);
    if (marker) {
      if (!isEmpty(selection)) setSelection(EMPTY_SELECTION);
      markers.select(marker);
      refreshEscape();
      options.onMarkerSelect?.(marker);
      return;
    }
    const hit = hitAt(x, y);
    if ('points' in hit) options.onNotice?.(null);
    const caught = 'spawns' in hit ? hit.spawns : hit.points;
    if (caught.length === 0 && !keys.shift && !keys.ctrl && !keys.alt) misses = missed + 1;
    setSelection(combine(selection, hit, tool === 'select' ? modifierOf(keys) : 'replace'));
  };
  const doubleClick = (): void => {
    if (misses >= 2) dropMarker();
    if (misses >= 2 && !isEmpty(selection)) setSelection(EMPTY_SELECTION);
    misses = 0;
  };
  // A box drawn in Select mode: the route points or spawns inside it, by where they land on screen
  const box = (rect: Rect, keys: ClickKeys): void => {
    if (placing) return;
    const project = (at: { x: number; y: number; z: number }) => new THREE.Vector3(at.x, at.y, at.z).project(camera);
    setSelection(combine(selection, boxHits(manager.selectionCandidates(camera.position), project, rect), modifierOf(keys)));
  };
  // A right-click: what it hit is selected first (unless it is already), then the menu is asked for
  const contextClick = (x: number, y: number, client: { x: number; y: number }): void => {
    // The gizmo only takes left presses: hovering it never stops the menu, only a drag of it does
    if (editor.dragging || markers.dragging) return;
    const hit = hitAt(x, y);
    const ground = pick(x, y);
    if ('spawns' in hit && hit.spawns.length > 0) {
      const [spawn] = hit.spawns;
      const selected = selection.spawns.some((s) => s.kind === spawn!.kind && s.guid === spawn!.guid);
      if (!selected) setSelection(combine(EMPTY_SELECTION, hit, 'replace'));
    }
    // A vessel under the pointer (its deck is ground, so it is as near as the ground there)
    const vessel = manager.pickVessel(raycaster.ray, ground ? ground.distanceTo(camera.position) + 0.01 : Infinity);
    const spawnHit = 'spawns' in hit && hit.spawns.length > 0 ? manager.spawnInfo(hit.spawns[0]!.kind, hit.spawns[0]!.guid) : null;
    const pointHit = 'points' in hit && hit.points.length > 0 ? hit.points[0]! : null;
    options.onContextMenu?.(
      {
        ground: ground ? { x: ground.x, y: ground.y, z: ground.z } : null,
        hit: spawnHit ? { type: 'spawn', spawn: spawnHit } : pointHit ? { type: 'point', guid: pointHit.guid, index: pointHit.index } : null,
        selection: selectedInfo(),
        vessel: vessel ? { dock: vessel.dock } : null,
      },
      client,
    );
  };
  const selectedInfo = (): SpawnInfo[] => selection.spawns.flatMap((s) => manager.spawnInfo(s.kind, s.guid) ?? []);
  const controls = new WorldControls(camera, renderer.domElement, {
    pick,
    onClick: click,
    onDoubleClick: doubleClick,
    onBox: box,
    onWheel: (deltaY) => editor.wheel(deltaY),
    onModeChange: (next) => {
      applyTool(next);
      options.onTool?.(next);
    },
    blocked: () => editor.blocked || markers.blocked,
    onContextClick: (x, y, client) => contextClick(x, y, client),
    onCameraInput: () => options.onCameraInput?.(),
  });
  // A vessel's deck is ground too, so a click or a drag lands on it: the view's own, and each docked one
  const solid = (): THREE.Object3D[] => [...manager.root.children.filter(clickable), manager.decor, ...manager.dockDecor];
  // The open quest's positions: a marker let go after a drag along the ground lands on the server's floor there
  const markers = new MarkerLayer(camera, renderer.domElement, scene, solid, {
    moved: async (id, at, lifted) => {
      const release = options.onGestureStart?.();
      try {
        const floor = !lifted && options.floorZ ? await options.floorZ(at.x, at.y, at.z) : at.z;
        options.onNotice?.(floor === null ? NOT_SNAPPED : null);
        options.onMarkerMove?.(id, { ...at, z: floor ?? at.z });
      } finally {
        release?.();
      }
    },
  });
  /** Lets go of the selected quest marker, and says so */
  const dropMarker = (): void => {
    if (markers.selected === null) return;
    markers.select(null);
    refreshEscape();
    options.onMarkerSelect?.(null);
  };
  const editor = new Editor(
    {
      camera,
      dom: renderer.domElement,
      scene,
      ground: solid,
      pickGround: pick,
      rayAt: (x, y) => {
        raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
        return raycaster.ray.clone();
      },
      findSpawn: (kind, guid) => manager.findSpawn(kind, guid),
      aboard: (kind, guid) => manager.frameOfSpawn(kind, guid) !== null,
      spawnRoute: (guid) => manager.spawnRoute(guid),
      pickRoutePoint: (ray, guid) => manager.pickRoutePoint(ray, guid),
      setPendingRoute: (guid, points) => manager.setPendingRoute(guid, points),
      previewRoute: (guid, points) => manager.previewRoute(guid, points),
      previewHome: (guid, at) => manager.previewHome(guid, at),
      setPendingMovement: (guid, movement) => manager.setPendingMovement(guid, movement),
      spawnMovement: (guid) => manager.movement(guid),
    },
    {
      onGesture: options.onGesture,
      onGestureStart: options.onGestureStart,
      floorZ: options.floorZ,
      beforeRouteEdit: options.beforeRouteEdit,
      onNotice: options.onNotice,
      // A delete or an insert changed the picked points
      onSelection: (next) => setSelection(next, false),
      onFalloff: (next) => options.onFalloff?.(next),
      onMode: (mode) => options.onMode?.(mode),
      onDeleteSpawns: () => options.onDeleteSpawns?.(),
      snapKey: () => options.snapKey?.() ?? 'alt',
      onDrawing: (drawing) => options.onDrawing?.(drawing),
    },
  );
  // A new layer or new own spawns drop what was drawn as pending: the editor draws a path being drawn
  // again at once, and lets go of picked points once the routes are drawn as they now are
  const followLayer = (redrawn: void | Promise<void>): void => {
    editor.layerChanged();
    void Promise.resolve(redrawn).then(() => editor.layerChanged());
  };
  // The editing keys, on the view itself so they only act while it has focus; a key used here goes
  // no further (Esc that clears a selection must not also close the screen or the quest editor)
  const onKeyDown = (event: KeyboardEvent): void => {
    // Copy, paste and duplicate belong to the view's host; only while the view has the keys
    const ctrl = event.ctrlKey || event.metaKey;
    if (ctrl && !event.shiftKey && !event.altKey && (event.code === 'KeyC' || event.code === 'KeyV' || event.code === 'KeyD') && options.onShortcut?.(event.code)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    // Esc finishes a path being drawn first
    if (event.code === 'Escape' && editor.drawing) {
      editor.finishPath();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const used = event.code === 'Escape' ? !isEmpty(selection) || placing !== null || markers.selected !== null : editor.keyDown(event);
    if (event.code === 'Escape' && placing) {
      // Esc stops placing first; a second one clears the selection
      placing = null;
      refreshEscape();
      options.onPlaceEnd?.();
    } else if (event.code === 'Escape' && markers.selected !== null) {
      dropMarker();
    } else if (event.code === 'Escape' && !isEmpty(selection)) {
      setSelection(EMPTY_SELECTION);
    }
    if (used) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  renderer.domElement.addEventListener('keydown', onKeyDown);

  // An outline round each selected spawn (its bounds), and a falloff ring round each picked point,
  // followed every frame: what they are on may be redrawn, move, or leave
  const outlines: THREE.Group[] = [];
  const rings: THREE.LineLoop[] = [];
  const ringGeometry = new THREE.BufferGeometry().setFromPoints(
    Array.from({ length: RING_SEGMENTS }, (_, i) => new THREE.Vector3(Math.cos((i / RING_SEGMENTS) * Math.PI * 2), Math.sin((i / RING_SEGMENTS) * Math.PI * 2), 0)),
  );
  const ringMaterial = new THREE.LineBasicMaterial({ color: SELECTED_COLOUR, depthTest: false });
  /** The pool's first `count` members, made as needed; the rest hidden */
  const pooled = <T extends THREE.Object3D>(pool: T[], count: number, make: () => T): T[] => {
    while (pool.length < count) {
      const made = make();
      scene.add(made);
      pool.push(made);
    }
    pool.forEach((member, i) => (member.visible = i < count));
    return pool.slice(0, count);
  };
  const followSelected = (): void => {
    const drawn = selection.spawns.flatMap((s) => manager.findSpawn(s.kind, s.guid) ?? []);
    // Each outline is the spawn's bounds in its own frame, carried by the spawn's matrix: it turns with the model
    pooled(outlines, drawn.length, () => {
      const box = new THREE.Box3Helper(new THREE.Box3(), SELECTED_COLOUR);
      (box.material as THREE.LineBasicMaterial).depthTest = false;
      box.renderOrder = 1;
      const outline = new THREE.Group();
      outline.matrixAutoUpdate = false;
      outline.userData.box = box;
      outline.add(box);
      return outline;
    }).forEach((outline, i) => {
      const spawn = drawn[i]!;
      spawnLocalBounds(spawn, (outline.userData.box as THREE.Box3Helper).box);
      outline.matrix.copy(spawn.matrixWorld);
      outline.updateMatrixWorld(true);
    });
    const falloff = editor.falloff;
    const points = falloff.on ? editor.pointPositions() : [];
    pooled(rings, points.length, () => {
      const ring = new THREE.LineLoop(ringGeometry, ringMaterial);
      ring.renderOrder = 2;
      return ring;
    }).forEach((ring, i) => {
      const at = points[i]!;
      ring.position.set(at.x, at.y, at.z + RING_LIFT);
      ring.scale.set(falloff.radius, falloff.radius, 1);
      ring.updateMatrixWorld(true);
    });
  };
  // A ring under each spawn a quest uses, while they are shown: re-found each frame, as areas reload
  let marked: { kind: 'creature' | 'object'; guid: number }[] = [];
  const marks: THREE.LineLoop[] = [];
  const markMaterial = new THREE.LineBasicMaterial({ color: MARK_COLOUR, depthTest: false });
  const followMarked = (): void => {
    const drawn = marked.flatMap((s) => manager.findSpawn(s.kind, s.guid) ?? []);
    pooled(marks, drawn.length, () => {
      const ring = new THREE.LineLoop(ringGeometry, markMaterial);
      ring.renderOrder = 2;
      return ring;
    }).forEach((ring, i) => {
      const at = drawn[i]!.position;
      ring.position.set(at.x, at.y, at.z + RING_LIFT);
      ring.scale.set(MARK_RADIUS, MARK_RADIUS, 1);
      ring.updateMatrixWorld(true);
    });
  };
  // A shown spawn group: a ring under each drawn member, re-found each frame, and lines from its centre
  let groupMembers: { kind: 'creature' | 'object'; guid: number }[] = [];
  const groupRings: THREE.LineLoop[] = [];
  const groupMaterial = new THREE.LineBasicMaterial({ color: GROUP_COLOUR, depthTest: false });
  const groupLines = new THREE.LineSegments(new THREE.BufferGeometry(), groupMaterial);
  groupLines.renderOrder = 2;
  groupLines.frustumCulled = false;
  groupLines.visible = false;
  scene.add(groupLines);
  const followGroup = (): void => {
    const drawn = groupMembers.flatMap((s) => manager.findSpawn(s.kind, s.guid) ?? []);
    pooled(groupRings, drawn.length, () => {
      const ring = new THREE.LineLoop(ringGeometry, groupMaterial);
      ring.renderOrder = 2;
      return ring;
    }).forEach((ring, i) => {
      const at = drawn[i]!.position;
      ring.position.set(at.x, at.y, at.z + RING_LIFT);
      ring.scale.set(MARK_RADIUS, MARK_RADIUS, 1);
      ring.updateMatrixWorld(true);
    });
  };
  const showGroup = (view: GroupDrawing | null): void => {
    groupMembers = view ? [...view.members] : [];
    groupLines.geometry.dispose();
    const ends = view ? view.points.flatMap((p) => [new THREE.Vector3(view.centre.x, view.centre.y, view.centre.z + RING_LIFT), new THREE.Vector3(p.x, p.y, p.z + RING_LIFT)]) : [];
    groupLines.geometry = new THREE.BufferGeometry().setFromPoints(ends);
    groupLines.visible = ends.length > 0;
    followGroup();
  };
  const { textures, databases, characterTexture } = sharedManagers();
  // The drawn ground a short way below a point, for standing NPCs on it
  /** Whether a loaded area's terrain or buildings reach over a point; its bounds are worked out once */
  const reaches = (group: THREE.Object3D, x: number, y: number): boolean => {
    let bounds: THREE.Box3 | undefined = group.userData.floorBounds;
    if (!bounds) {
      if (group.children.length === 0) return false;
      bounds = group.userData.floorBounds = new THREE.Box3().setFromObject(group);
    }
    return x >= bounds.min.x && x <= bounds.max.x && y >= bounds.min.y && y <= bounds.max.y;
  };
  const groundBelow = (x: number, y: number, fromZ: number, distance: number): number | null => {
    // Every floor, shown or not: where an NPC stands does not change with what is drawn. Only an
    // area's floors that reach over the point are tried: trying every loaded one took 2 ms a ray.
    const floors = manager.root.children.filter((group) => (group.name === 'terrain' || group.name === 'buildings') && reaches(group, x, y));
    return floorHeightBelow(floors, x, y, fromZ, distance);
  };
  const manager = new MapManager({ host: HOST, textureManager: textures, dbManager: databases, characterTexture, groundBelow, frame: options.frame });
  manager.addEventListener('area:change', (event) => {
    const name = (event as CustomEvent<{ areaName?: string }>).detail.areaName;
    if (name) options.onArea?.(name);
  });
  scene.add(manager.root);
  scene.add(manager.decor);
  let route = buildRouteLines(options.route ?? []);
  scene.add(route);
  let vessel = options.vessel ?? null;
  const showTransport = (next: TransportScene): void => {
    manager.setFrame(next.frame);
    // Another stop only moves the vessel; another route may run another one
    if (next.vessel?.displayId !== vessel?.displayId) manager.setVessel(next.vessel);
    vessel = next.vessel;
    disposeRouteLines(route);
    route.removeFromParent();
    route = buildRouteLines(next.route);
    scene.add(route);
  };
  clearProblems();
  const stopProblems = onProblems((all) => options.onProblems?.([...all]));

  let disposed = false;
  const lookAt = (x: number, y: number, z: number, close = false): void => {
    controls.setView(new THREE.Vector3(x, y, z), close ? CLOSE_OFFSET : START_OFFSET);
    manager.setTarget(clamp(x), clamp(y));
  };
  const clamp = (v: number): number => Math.max(-WORLD_EDGE, Math.min(WORLD_EDGE, v));

  try {
    manager.setSpawnSource(options.spawns ?? null);
    manager.load(options.directory, options.hostMap ?? options.map, options.wmo ?? null, options.map);
    if (vessel) manager.setVessel(vessel);
    lookAt(options.start.x, options.start.y, options.start.z);
  } catch (error) {
    options.onError?.(error instanceof Error ? error.message : String(error));
  }

  const resize = (): void => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  const clock = new THREE.Clock();
  let frame = 0;
  let ready = false;
  const tick = (): void => {
    if (disposed) return;
    frame = requestAnimationFrame(tick);
    const delta = clock.getDelta();
    // Debug mode's frame stats: no clock is read and no renderer.info touched unless it is on
    const sampling = frameStats.on;
    const began = sampling ? performance.now() : 0;
    try {
      controls.update(delta);
      manager.setTarget(clamp(controls.target.x), clamp(controls.target.y));
      camera.far = manager.cameraFar;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      manager.update(delta, camera);
      followSelected();
      followMarked();
      followGroup();
      markers.update();
      editor.update();
      renderer.setClearColor(manager.clearColor);
      const updated = sampling ? performance.now() : 0;
      renderer.render(scene, camera);
      if (sampling) {
        const { render, memory, programs } = renderer.info;
        frameStats.sample({
          deltaSeconds: delta,
          updateMs: updated - began,
          renderMs: performance.now() - updated,
          calls: render.calls,
          triangles: render.triangles,
          geometries: memory.geometries,
          textures: memory.textures,
          programs: programs?.length ?? 0,
          x: camera.position.x,
          y: camera.position.y,
          z: camera.position.z,
        });
      }
      if (!ready && manager.root.children.length > 0) {
        ready = true;
        options.onReady?.();
      }
    } catch (error) {
      options.onError?.(error instanceof Error ? error.message : String(error));
      disposed = true;
    }
  };
  frame = requestAnimationFrame(tick);

  return {
    lookAt,
    setSpawnVisibility: (visibility) => manager.setSpawnVisibility(visibility),
    setScenery(next) {
      scenery = { ...next };
      manager.setScenery(scenery);
    },
    spawnStatus: () => manager.spawnStatus,
    setLooks: (looks) => followLayer(manager.setLooks(looks)),
    setOwnSpawns: (spawns) => followLayer(manager.setOwnSpawns(spawns)),
    select: (spawn) => setSelection(spawn ? combine(EMPTY_SELECTION, { spawns: [spawn] }, 'replace') : EMPTY_SELECTION, false),
    setTool: (next) => applyTool(next),
    setFalloff: (falloff) => editor.setFalloff(falloff),
    setWorldLayer: (layer) => {
      // A spawn the layer deletes is let go of, so no card or gizmo stays on it
      const kept = withoutDeleted(selection, layer);
      if (kept !== selection) setSelection(kept);
      followLayer(manager.setWorldLayer(layer));
    },
    setGroupSpawns: (byGroup) => followLayer(manager.setGroupSpawns(byGroup)),
    setMode: (mode) => editor.setMode(mode),
    setEditLocked: (locked) => {
      editLocked = locked;
      editor.setLocked(locked);
      markers.setLocked(locked);
    },
    setPlacing: (target) => {
      placing = target;
      // Placing starts from nothing selected, so a click never means anything else
      if (target && !isEmpty(selection)) setSelection(EMPTY_SELECTION);
      refreshEscape();
    },
    startPath: (guid, pathId, first) => editor.startPath(guid, pathId, first),
    finishPath: () => editor.finishPath(),
    cancelPath: () => editor.cancelPath(),
    cancelDrag: () => editor.cancelDrag(),
    undoPoint: () => editor.undoPoint(),
    setMarked(spawns) {
      marked = spawns ? [...spawns] : [];
      followMarked();
    },
    setGroupView: (view) => showGroup(view),
    selectedSpawns: () => selectedInfo(),
    selectSpawns: (spawns) => setSelection(spawns.length > 0 ? combine(EMPTY_SELECTION, { spawns }, 'replace') : EMPTY_SELECTION),
    setPendingMovement: (guid, movement) => manager.setPendingMovement(guid, movement),
    spawnMovement: (guid) => manager.movement(guid),
    groundAt(client) {
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      const point = pick(((client.x - rect.left) / rect.width) * 2 - 1, -((client.y - rect.top) / rect.height) * 2 + 1);
      return point ? { x: point.x, y: point.y, z: point.z } : null;
    },
    lastPointer: () => controls.lastPointer,
    spawnOf: (kind, guid) => manager.spawnInfo(kind, guid),
    setDocks: (docks) => manager.setDocks(docks),
    setDocksEnabled: (enabled) => manager.setDocksEnabled(enabled),
    setMovementPlaying: (playing) => manager.setMovementPlaying(playing),
    resetMovement: () => manager.resetMovement(),
    frameOfSpawn: (kind, guid) => manager.frameOfSpawn(kind, guid),
    routeOf(guid) {
      const route = manager.spawnRoute(guid);
      return route ? { pathId: route.pathId, points: route.points } : null;
    },
    target: () => ({ x: controls.target.x, y: controls.target.y, z: controls.target.z }),
    setMarkers: (next) => {
      const was = markers.selected;
      markers.set(next);
      // A marker gone with the redraw (its step deleted, the quest closed) is let go
      if (was !== null && markers.selected === null) options.onMarkerSelect?.(null);
      refreshEscape();
    },
    selectMarker(id) {
      if (id !== null && !isEmpty(selection)) setSelection(EMPTY_SELECTION);
      const found = markers.select(id);
      refreshEscape();
      return found;
    },
    setTransport: showTransport,
    camera() {
      const direction = camera.getWorldDirection(new THREE.Vector3());
      return { position: { ...camera.position }, direction: { x: direction.x, y: direction.y, z: direction.z } };
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      // Nothing here may throw: this runs while React unmounts the view, and a throw would take the whole screen with it.
      for (const step of [() => controls.dispose?.(), () => renderer.domElement.removeEventListener('keydown', onKeyDown), () => editor.dispose(), () => markers.dispose(), stopProblems, () => manager.dispose(), () => release(manager.root), () => release(manager.decor), () => disposeRouteLines(route), () => outlines.forEach(release), () => rings.forEach((ring) => ring.removeFromParent()), () => marks.forEach((ring) => ring.removeFromParent()), () => groupRings.forEach((ring) => ring.removeFromParent()), () => groupLines.removeFromParent(), () => groupLines.geometry.dispose(), () => groupMaterial.dispose(), () => ringGeometry.dispose(), () => ringMaterial.dispose(), () => markMaterial.dispose(), () => renderer.dispose()]) {
        try {
          step();
        } catch (error) {
          console.warn(`3D view cleanup: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      renderer.domElement.remove();
    },
  };
}
