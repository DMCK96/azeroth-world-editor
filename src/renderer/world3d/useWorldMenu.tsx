import { useEffect, useRef, useState } from 'react';
import type { Api, GroupMove, QuestSpawnGroup, SpawnGroup } from '@shared/ipc';
import type { Placement, WorldLayer } from '@core/world/layer';
import type { Dock } from '@core/map/transport-docks';
import { IDLE, type Movement } from '@core/world/movement';
import type { Role, RoleTarget } from '@core/modules/quest-roles';
import type { World3D } from './world3d';
import type { SpawnInfo } from './scene/spawn/SpawnManager';
import type { EditPoint, SpawnEdit, SpawnRef } from './edits';
import type { ProjectEntities } from '@core/entities/model';
import { AI_WRITING, editsProject, lockEdits, type At, type MenuAction, type MenuEditorTab, type MenuGroup, type MenuSpawn, type MenuTarget, type QuestMenuInfo } from './menu/model';
import { buildMenu, NEEDS_GROUND } from './menu/section';
import { subjectOf } from './menu/subject';
import { aboardVessel } from './frame-edit';
import { clipEntries, duplicateOffset, entriesOf, keepEntries, layoutAt, pasteable, type ClipEntry, type ClipPoint } from './clipboard';
import { placementAt } from './placing';
import { WorldContextMenu } from './WorldContextMenu';
import { WanderDialog } from './WanderDialog';
import { PointDialog, type PointResult, type PointTarget } from './PointDialog';
import { patrolOf } from '@core/map/patrol';
import { RespawnDialog } from './RespawnDialog';
import { NpcQuestsDialog } from './NpcQuestsDialog';
import { EventDialog } from './EventDialog';
import type { GameEvent } from '../controls/EventPicker';
import type { SpawnEvents } from '@core/entities/model';
import { GroupDialog } from './GroupDialog';
import { PlaceDialog, type Chosen } from './PlaceDialog';
import { useHistorySteps } from '../state/history-context';
import { AiLock } from '../components/AiLock';
import { newSpawnGuids } from './spawn-guid';
import { getPreferencesSnapshot } from '../preferences/store';

export const NO_LONGER_HERE = 'That spawn is no longer here';
export const COPIED_COORDINATES = 'Copied .go xyz to the clipboard';

/** What the right-click menu needs of the view round it */
export interface WorldMenuDeps {
  world: React.RefObject<World3D | null>;
  api: Api | null;
  map: number;
  /** Sends an edit as the view sends any: the quest's own to the quest, the rest to the world layer, in order; whether it was kept */
  send(edit: SpawnEdit): Promise<boolean>;
  /** Why the last edit that was not kept was refused, taken once; null when there was no reason said */
  failure(): string | null;
  takeLayer(layer: WorldLayer): void;
  setNote(note: string | null): void;
  /** The server's floor nearest a height at a place, or null when it has none there */
  floorZ(x: number, y: number, nearZ: number): Promise<number | null>;
  /** A place in the view as a spawn's row stores it (vessel-local on a transport) */
  toRow(at: Placement): Placement;
  /** Lists the stops of a vessel right-clicked: a docked one with its dock, or the view's own */
  onVessel?(dock: Dock | null): void;
  /** The view shows a vessel, where walking paths are drawn but not edited */
  vessel: boolean;
  placing: boolean;
  stopPlacing(): void;
  clearSelection(): void;
  /** Gives the keyboard back to the view */
  focusView(): void;
  /** The middle of the view in the window, where Ctrl+V pastes when the pointer has not been over it */
  viewCentre(): { x: number; y: number };
  /** Paths started in this view, which the database does not have */
  newPaths: Set<number>;
  /** Whether a path is one the database does not have (started here, or before a restart) */
  isNewPath(pathId: number): boolean;
  quest?: QuestMenuInfo;
  /** The quests of the open quest's chain, the open one among them */
  chainIds?: number[];
  onOwnEdit?(edit: SpawnEdit): boolean | void;
  /** Gives a spawn's NPC or object a part in the open quest, or takes it away; says why when it could not */
  onQuestRole?(role: Role, target: RoleTarget, on: boolean): string | null;
  onNewQuest?(giver: { entry: number; name: string }, after: boolean): void;
  /** Opens a quest the database has, as picking it in the quest dock does */
  onOpenQuest?(id: number): void;
  onShowSpawns?(groups: QuestSpawnGroup[], scope: 'quest' | 'chain'): void;
  /** Makes a new project NPC or object with one spawn at `at`, as one step */
  onCreateEntity?(what: 'creature' | 'object', at: Placement): Promise<void>;
  /** Opens the editor on one of the project's NPCs or objects */
  onEditEntity?(kind: 'creature' | 'object', entry: number, tab?: MenuEditorTab): void;
  /** Makes a project object lootable, or no longer */
  onSetLootable?(entry: number, on: boolean): Promise<void>;
  /** The project's NPCs, objects and items: whether a right-clicked spawn's NPC or object is the project's own */
  entities: ProjectEntities;
}

type Put = { kind: 'creature' | 'object'; entry: number; own: boolean; at: Placement; respawnSecs?: number; wander?: number; spawnEvents?: SpawnEvents; route?: ClipPoint[] };

const refOf = (s: { kind: 'creature' | 'object'; guid: number; entry: number; own: boolean }): SpawnRef => ({ kind: s.kind, guid: s.guid, entry: s.entry, own: s.own });
const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;
/** A spawn's kind as spawn groups name it */
const poolKind = (kind: 'creature' | 'object'): 'npc' | 'object' => (kind === 'object' ? 'object' : 'npc');

/** Spawns whose respawn time the dialog changes: what each is, its name, and its time when known */
type RespawnTarget = { ref: SpawnRef; name: string; respawnSecs: number | null };
const respawnTargetOf = (s: MenuSpawn): RespawnTarget => ({ ref: refOf(s), name: s.name, respawnSecs: s.respawnSecs });
/** NPC spawns whose own game events the dialog changes, and what each follows now */
type EventsTarget = { ref: SpawnRef; name: string; events: SpawnEvents; now: MenuSpawn['eventsNow'] };

/** A spawn group open in the dialog: the members by name, and the other groups on its map */
type GroupEdit = { group: SpawnGroup; names: Map<string, string>; groupsOnMap: { id: number; name: string }[]; events: { id: number; name: string }[]; nested: boolean };

/**
 * The 3D view's right-click menu: what it offers for a right-clicked target, and what each item does.
 * Placing, pasting and removing are recorded as one undo step each; movement goes through the view's
 * edits like a move does. Ctrl+C, Ctrl+V and Ctrl+D copy, paste and duplicate.
 */
export function useWorldMenu(deps: WorldMenuDeps): {
  open(target: MenuTarget, client: { x: number; y: number }): void;
  shortcut(code: 'KeyC' | 'KeyV' | 'KeyD'): boolean;
  /** Deletes the selected spawns as one undo step: the Delete key */
  deleteSelected(): Promise<void>;
  /** Deletes these spawns as one undo step: the card's Delete button */
  deleteSpawns(spawns: readonly MenuSpawn[]): Promise<void>;
  onDrawing(drawing: { guid: number; points: number } | null): void;
  /** Opens the spawn group dialog on a group */
  editGroup(id: number): void;
  elements: React.JSX.Element;
} {
  const d = useRef(deps);
  d.current = deps;
  // Each action is one step of the project's history, however many changes it makes
  const { runStep, editLocked } = useHistorySteps();
  const step = useRef(runStep);
  step.current = runStep;
  // While an AI client writes, the menu only looks and copies
  const locked = useRef(editLocked);
  locked.current = editLocked;
  const [menu, setMenu] = useState<{ groups: MenuGroup[]; at: { x: number; y: number } } | null>(null);
  const [place, setPlace] = useState<{ what: 'creature' | 'object'; at: At } | null>(null);
  const [wander, setWander] = useState<{ spawn: MenuSpawn } | null>(null);
  /** A route point open in its dialog: whose route, its points as the view has them, and the point */
  const [point, setPoint] = useState<{ ref: SpawnRef; name: string; pathId: number; points: EditPoint[]; target: PointTarget } | null>(null);
  const [npcQuests, setNpcQuests] = useState<{ entry: number; name: string } | null>(null);
  const [respawn, setRespawn] = useState<{ targets: RespawnTarget[] } | null>(null);
  const [spawnEvents, setSpawnEvents] = useState<{ targets: EventsTarget[]; events: readonly GameEvent[] } | null>(null);
  const [groupEdit, setGroupEdit] = useState<GroupEdit | null>(null);
  const [drawing, setDrawing] = useState<{ guid: number; points: number } | null>(null);
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;
  const [marked, setMarked] = useState(false);

  // A menu belongs to the world it was opened on
  useEffect(() => setMenu(null), [deps.map]);
  // A path being drawn, and quest marks, belong to their world: a new map's world starts without them
  useEffect(() => {
    setDrawing(null);
    drawingRef.current = null;
    setMarked(false);
  }, [deps.map]);
  // Marks belong to the quest they were shown for
  const questId = deps.quest?.id ?? null;
  useEffect(() => {
    d.current.world.current?.setMarked(null);
    setMarked(false);
  }, [questId]);

  const open = (target: MenuTarget, client: { x: number; y: number }): void => {
    const { api, map, placing, quest, onNewQuest } = d.current;
    const entries = clipEntries();
    const built = buildMenu(subjectOf(target, d.current.entities), {
      map,
      connected: api !== null,
      clipboard: { count: entries.length, blocked: null },
      placing,
      drawing,
      quest: quest ?? null,
      project: onNewQuest !== undefined,
      marked,
      vessel: aboardVessel(target, d.current.vessel, (kind, guid) => d.current.world.current?.frameOfSpawn(kind, guid) ?? null),
    });
    const groups = locked.current ? lockEdits(built) : built;
    if (groups.length > 0) setMenu({ groups, at: client });
  };

  const floored = async (at: Placement): Promise<Placement> => ({ ...at, z: (await d.current.floorZ(at.x, at.y, at.z)) ?? at.z });
  /** A pasted spawn's place: on the server's floor where it lands, and as high above it as it stood where it was copied */
  const standing = async (at: Placement, clearance = 0): Promise<Placement> => {
    const floor = await d.current.floorZ(at.x, at.y, at.z);
    return floor === null ? at : { ...at, z: floor + clearance };
  };
  const facingCamera = (at: At, kind: 'creature' | 'object'): Placement => placementAt(at, d.current.world.current?.camera().position ?? at, kind);

  /** Puts one spawn down: a quest's own goes to the quest, the rest to the world layer. The edit that did it, or null */
  const putOne = async (put: Put, guid: number | undefined): Promise<SpawnEdit | null> => {
    const { api, map, onOwnEdit, setNote, takeLayer, toRow } = d.current;
    if (!api) return null;
    const at = toRow(put.at);
    if (put.own) {
      if (!onOwnEdit) return null;
      if (guid === undefined) return null;
      const edit: SpawnEdit = { kind: 'presence', spawn: { kind: put.kind, guid, entry: put.entry, own: true }, present: true, at, map };
      return onOwnEdit(edit) === false ? null : edit;
    }
    const result = await api.worldAddSpawn(put.kind === 'object' ? 'gameobject' : 'creature', put.entry, map, at);
    if (!result.ok) {
      setNote(result.error.message);
      return null;
    }
    takeLayer(result.value.layer);
    return { kind: 'presence', spawn: { kind: put.kind, guid: result.value.guid, entry: put.entry, own: false }, present: true, at, map };
  };

  /** Gives a copied NPC the path its original walks, as a path of its own, moved with it */
  const walkCopy = async (spawn: SpawnRef, at: Placement, route: readonly ClipPoint[]): Promise<void> => {
    const { api, send, setNote } = d.current;
    if (!api) return;
    const id = spawn.own ? await api.patrolPathId(spawn.guid) : await api.worldNewPathId(spawn.guid);
    if (!id.ok) {
      setNote(id.error.message);
      return;
    }
    if (!spawn.own) d.current.newPaths.add(id.value);
    const points = route.map((p) => ({ x: at.x + p.dx, y: at.y + p.dy, z: at.z + p.dz, ...(p.carry !== undefined ? { carry: structuredClone(p.carry) } : {}) }));
    await send({ kind: 'movement', spawn, to: { type: 'path', wander: 0, pathId: id.value } });
    await send({ kind: 'route', spawn, pathId: id.value, points });
  };

  /** Puts spawns down one after another, selects them, and makes them one undo step; how many went down */
  const putAll = async (puts: Put[], label?: string): Promise<number> => {
    const done: SpawnEdit[] = [];
    // The project's own spawns get their guids together, before any is put down
    const guids = new Map<Put, number>();
    const { api } = d.current;
    if (api) {
      for (const kind of ['creature', 'object'] as const) {
        const own = puts.filter((p) => p.own && p.kind === kind);
        const made = await newSpawnGuids(api, kind, own.length);
        if ('error' in made) {
          d.current.setNote(made.error);
          continue;
        }
        own.forEach((p, i) => guids.set(p, made.guids[i]!));
      }
    }
    await step.current(async () => {
      for (const put of puts) {
        const edit = await putOne(put, guids.get(put));
        if (!edit) continue;
        done.push(edit);
        if (put.respawnSecs !== undefined && put.respawnSecs !== 300) await d.current.send({ kind: 'respawn', spawn: edit.spawn, secs: put.respawnSecs });
        if (put.kind === 'creature' && put.wander !== undefined && put.wander > 0) await d.current.send({ kind: 'movement', spawn: edit.spawn, to: { type: 'wander', wander: put.wander, pathId: null } });
        if (put.kind === 'creature' && put.spawnEvents !== undefined && put.spawnEvents !== 'npc') await d.current.send({ kind: 'spawnEvents', spawn: edit.spawn, to: put.spawnEvents });
        if (put.kind === 'creature' && put.route !== undefined) await walkCopy(edit.spawn, put.at, put.route);
      }
    }, label);
    const world = d.current.world.current;
    if (done.length > 0 && world) {
      world.selectSpawns(done.map((e) => ({ kind: e.spawn.kind, guid: e.spawn.guid })));
    }
    return done.length;
  };

  const paste = async (entries: readonly ClipEntry[], at: At, verb = 'Paste'): Promise<void> => {
    const { map } = d.current;
    const ok = pasteable(entries);
    if (ok.entries.length === 0) return;
    const laid = await Promise.all(layoutAt(ok.entries, at, map).map(async (l) => ({ kind: l.entry.kind, entry: l.entry.entry, own: l.entry.own, at: await standing(l.at, l.entry.clearance), respawnSecs: l.entry.respawnSecs, wander: l.entry.wander, spawnEvents: l.entry.spawnEvents, route: l.entry.route })));
    await putAll(laid, laid.length === 1 ? `${verb} a spawn` : `${verb} ${laid.length} spawns`);
  };

  /**
   * Gives entries of spawns how high each stood above the server's floor, when that is more than the snap
   * tolerance (the floor and a little above it count as standing on it)
   */
  const addClearance = async (entries: ClipEntry[], spawns: readonly SpawnInfo[]): Promise<ClipEntry[]> => {
    const tolerance = getPreferencesSnapshot().snapTolerance;
    await Promise.all(entries.map(async (entry, i) => {
      const { x, y, z } = spawns[i]!.placement;
      const floor = await d.current.floorZ(x, y, z);
      if (floor !== null && z - floor > tolerance) entry.clearance = z - floor;
    }));
    return entries;
  };

  /** Copies at once, so a paste right after has it; the heights above the floor follow when the floors answer */
  const copy = (): void => {
    const spawns = d.current.world.current?.selectedSpawns() ?? [];
    if (spawns.length === 0) return;
    const kept = keepEntries(entriesOf(spawns, (guid) => d.current.world.current?.routeOf(guid) ?? null));
    void addClearance(kept, spawns);
    d.current.setNote(`Copied ${plural(spawns.length, 'spawn')}`);
  };

  const duplicate = async (): Promise<void> => {
    const world = d.current.world.current;
    const spawns = world?.selectedSpawns() ?? [];
    if (!world || spawns.length === 0) return;
    const mean = (pick: (p: Placement) => number): number => spawns.reduce((sum, s) => sum + pick(s.placement), 0) / spawns.length;
    const off = duplicateOffset(world.camera().direction);
    await paste(await addClearance(entriesOf(spawns, (guid) => world.routeOf(guid)), spawns), { x: mean((p) => p.x) + off.x, y: mean((p) => p.y) + off.y, z: mean((p) => p.z) }, 'Duplicate');
  };

  /** Whether a spawn is still there to act on; says so when it is not */
  const still = (spawn: MenuSpawn): boolean => {
    if (d.current.world.current?.spawnOf(spawn.kind, spawn.guid)) return true;
    d.current.setNote(NO_LONGER_HERE);
    return false;
  };

  /**
   * Deletes spawns as one undo step, asking nothing: a quest's own goes out of the quest, a placed one out
   * of the layer, a database one into the layer's deletes. One that cannot be deleted does not stop the
   * rest; it is named afterwards, since each kept edit clears the note.
   */
  const deleteSpawns = async (spawns: readonly MenuSpawn[]): Promise<void> => {
    const targets = spawns.filter(still);
    if (targets.length === 0) return;
    const failed: MenuSpawn[] = [];
    const reasons: string[] = [];
    const named = (s: MenuSpawn): string => s.name || `${s.kind === 'creature' ? 'NPC' : 'Object'} ${s.entry}`;
    await step.current(async () => {
      for (const spawn of targets) {
        const gone: SpawnEdit = { kind: 'presence', spawn: refOf(spawn), present: false, at: spawn.placement, map: spawn.map };
        if (!(await d.current.send(gone))) {
          failed.push(spawn);
          const why = d.current.failure();
          reasons.push(why ? `${named(spawn)}: ${why}` : named(spawn));
          continue;
        }
        // A quest's own or a placed spawn in a spawn group leaves it in the same step; a database spawn's pool rows go with its delete
        const { api } = d.current;
        if ((spawn.own || spawn.added) && spawn.group !== null && spawn.group !== undefined && api) {
          const dropped = await api.worldDropMember(poolKind(spawn.kind), spawn.guid);
          if (dropped.ok) d.current.takeLayer(dropped.value);
          else d.current.setNote(dropped.error.message);
        }
      }
    }, targets.length === 1 ? `Delete ${named(targets[0]!)}` : `Delete ${targets.length} spawns`);
    if (failed.length === 0) {
      d.current.clearSelection();
      return;
    }
    // The ones that could not be deleted stay selected, and the note says which and why
    d.current.setNote(`Could not delete ${reasons.join(', ')}`);
    d.current.world.current?.selectSpawns(failed.map((s) => ({ kind: s.kind, guid: s.guid })));
  };

  const deleteSelected = (): Promise<void> => deleteSpawns(d.current.world.current?.selectedSpawns() ?? []);

  /** Sends edits the menu made, one after another, as one step */
  const commit = async (edits: SpawnEdit[], label?: string): Promise<void> => {
    await step.current(async () => {
      for (const edit of edits) await d.current.send(edit);
    }, label);
  };

  /** The other spawn groups on the map being viewed, by name; none when they cannot be had */
  const groupsHere = async (except: number): Promise<{ id: number; name: string }[]> => {
    const found = await d.current.api?.worldGroupsOnMap(d.current.map);
    return found?.ok ? found.value.filter((g) => g.id !== except).map((g) => ({ id: g.id, name: g.name })) : [];
  };

  /** The game events a group can follow, and whether the group is a member of another on the map */
  const eventChoices = async (id: number): Promise<{ events: { id: number; name: string }[]; nested: boolean }> => {
    const { api, map } = d.current;
    const [events, onMap] = await Promise.all([api?.gameEvents(), api?.worldGroupsOnMap(map)]);
    return {
      events: events?.ok ? events.value : [],
      nested: onMap?.ok ? onMap.value.some((g) => g.groups.includes(id)) : false,
    };
  };

  /** Opens the dialog on a spawn group, its members named as the view describes them */
  const openGroup = async (id: number): Promise<void> => {
    const { api, setNote } = d.current;
    if (!api) return;
    const [found, view] = await Promise.all([api.worldGroup(id), api.worldGroupView(id)]);
    if (!found.ok || !found.value) {
      setNote(found.ok ? 'That spawn group is no longer there.' : found.error.message);
      return;
    }
    const names = new Map(view.ok && view.value ? view.value.members.map((m) => [m.key, m.name] as const) : []);
    setGroupEdit({ group: found.value, names, groupsOnMap: await groupsHere(id), ...(await eventChoices(id)) });
  };

  /** Saves a group as one step; a refusal says why, keeps the dialog open and leaves no change */
  const saveGroup = async (group: SpawnGroup, moves: GroupMove[]): Promise<void> => {
    const { api, setNote } = d.current;
    if (!api) return;
    let saved = false;
    await step.current(async () => {
      const result = await api.worldSetGroup(group, moves);
      if (!result.ok) {
        setNote(result.error.message);
        return;
      }
      saved = true;
      d.current.takeLayer(result.value);
    }, `Saved spawn group ${group.name || group.id}`);
    if (saved) {
      setGroupEdit(null);
      d.current.focusView();
    }
  };

  /** The respawn dialog for a group's own spawns: a project spawn's time is the project's */
  const respawnGroup = (group: SpawnGroup, names: ReadonlyMap<string, string>): void => {
    const { entities } = d.current;
    const targets = group.members.flatMap((m): RespawnTarget[] => {
      if (m.type !== 'spawn') return [];
      const kind = m.kind === 'object' ? 'object' : 'creature';
      const stored = (kind === 'object' ? entities.objects : entities.npcs).flatMap((e) => e.spawns).find((s) => s.guid === m.guid);
      return [{ ref: { kind, guid: m.guid, entry: m.entry, own: stored !== undefined }, name: names.get(`${m.kind}:${m.guid}`) ?? `Spawn ${m.guid}`, respawnSecs: stored?.respawnSecs ?? null }];
    });
    if (targets.length === 0) {
      d.current.setNote('This group has no spawns of its own.');
      return;
    }
    setRespawn({ targets });
  };

  const run = async (action: MenuAction): Promise<void> => {
    const { world: worldRef, api, setNote } = d.current;
    const world = worldRef.current;
    if (!world) return;
    // The menu may have been opened before the AI client began to write
    if (locked.current && editsProject(action)) {
      setNote(`${AI_WRITING}.`);
      return;
    }
    switch (action.kind) {
      case 'stopPlacing':
        d.current.stopPlacing();
        return;
      case 'finishPath':
        world.finishPath();
        return;
      case 'undoPoint':
        world.undoPoint();
        return;
      case 'cancelPath':
        world.cancelPath();
        return;
      case 'placeHere':
        setPlace({ what: action.what, at: action.at });
        return;
      case 'newEntity':
        await d.current.onCreateEntity?.(action.what, d.current.toRow(await floored(facingCamera(action.at, action.what))));
        return;
      case 'editEntity':
        d.current.onEditEntity?.(action.spawn.kind, action.spawn.entry, action.tab);
        return;
      case 'setLootable':
        await d.current.onSetLootable?.(action.spawn.entry, action.on);
        return;
      case 'copy':
        copy();
        return;
      case 'paste':
        await paste(clipEntries(), action.at);
        return;
      case 'duplicate':
        await duplicate();
        return;
      case 'delete':
        await deleteSpawns(action.spawns);
        return;
      case 'vesselStops':
        d.current.onVessel?.(action.dock);
        return;
      case 'copyCoordinates': {
        const { x, y, z } = action.at;
        try {
          await navigator.clipboard.writeText(`.go xyz ${x.toFixed(2)} ${y.toFixed(2)} ${z.toFixed(2)} ${d.current.map}`);
          setNote(COPIED_COORDINATES);
        } catch (error) {
          setNote(`Could not copy to the clipboard: ${error instanceof Error ? error.message : String(error)}`);
        }
        return;
      }
      case 'startPath': {
        const { spawn } = action;
        if (!api || !still(spawn)) return;
        const id = spawn.own ? await api.patrolPathId(spawn.guid) : await api.worldNewPathId(spawn.guid);
        if (!id.ok) {
          setNote(id.error.message);
          return;
        }
        if (!spawn.own) d.current.newPaths.add(id.value);
        world.startPath(spawn.guid, id.value, action.at);
        return;
      }
      case 'wander':
        if (!still(action.spawn)) return;
        setWander({ spawn: action.spawn });
        return;
      case 'pointSettings': {
        const spawn = world.spawnOf('creature', action.guid);
        const route = world.routeOf(action.guid);
        const at = route?.points[action.index];
        if (!spawn || !route || !at) {
          setNote(NO_LONGER_HERE);
          return;
        }
        // A project NPC's patrol is the project's; a route the database has keeps its row's columns on each point
        const patrol = spawn.own ? patrolOf(d.current.entities, spawn.entry, spawn.guid) : null;
        const target: PointTarget = patrol
          ? { kind: 'patrol', patrol, index: action.index }
          : { kind: 'waypoint', rest: (at.carry as Record<string, string | null> | undefined) ?? {}, index: action.index };
        setPoint({ ref: refOf(spawn), name: spawn.name, pathId: route.pathId, points: route.points, target });
        return;
      }
      case 'respawn':
        if (!action.spawns.every(still)) return;
        setRespawn({ targets: action.spawns.map(respawnTargetOf) });
        return;
      case 'spawnEvents': {
        if (!action.spawns.every(still)) return;
        const read = await api?.gameEvents();
        const targets = action.spawns.map((s): EventsTarget => ({ ref: refOf(s), name: s.name, events: s.spawnEvents === undefined ? 'npc' : s.spawnEvents, now: s.eventsNow }));
        setSpawnEvents({ targets, events: read?.ok ? read.value : [] });
        return;
      }
      case 'groupSpawns': {
        if (!api) return;
        const id = await api.worldNewGroupId();
        if (!id.ok) {
          setNote(id.error.message);
          return;
        }
        const { spawns } = action;
        const group: SpawnGroup = {
          id: id.value,
          name: '',
          map: d.current.map,
          maxActive: 1,
          members: spawns.map((s) => ({ type: 'spawn', kind: poolKind(s.kind), guid: s.guid, entry: s.entry, chance: 0 })),
          event: null,
          origin: { kind: 'new' },
        };
        const names = new Map(spawns.map((s) => [`${poolKind(s.kind)}:${s.guid}`, s.name]));
        setGroupEdit({ group, names, groupsOnMap: await groupsHere(id.value), ...(await eventChoices(id.value)) });
        return;
      }
      case 'editGroup':
        await openGroup(action.id);
        return;
      case 'showGroup': {
        if (!api) return;
        const found = await api.worldGroup(action.id);
        if (!found.ok) {
          setNote(found.error.message);
          return;
        }
        const first = found.value?.members.find((m) => m.type === 'spawn');
        if (!first || first.type !== 'spawn') {
          setNote('This group has no spawns of its own to show.');
          return;
        }
        world.selectSpawns([{ kind: first.kind === 'object' ? 'object' : 'creature', guid: first.guid }]);
        return;
      }
      case 'leaveGroup': {
        const { spawn } = action;
        if (!api || spawn.group === null || spawn.group === undefined) return;
        const found = await api.worldGroup(spawn.group);
        if (!found.ok || !found.value) {
          setNote(found.ok ? 'That spawn group is no longer there.' : found.error.message);
          return;
        }
        const group = found.value;
        const kind = poolKind(spawn.kind);
        const members = group.members.filter((m) => !(m.type === 'spawn' && m.kind === kind && m.guid === spawn.guid));
        await step.current(async () => {
          // A group left with no members is deleted; otherwise no more of it can be up than it has members
          const result =
            members.length === 0
              ? await api.worldDeleteGroup(group.id)
              : await api.worldSetGroup({ ...group, members, maxActive: Math.max(1, Math.min(group.maxActive, members.length)) }, []);
          if (result.ok) d.current.takeLayer(result.value);
          else setNote(result.error.message);
        }, `Took ${spawn.name} out of spawn group ${group.name || group.id}`);
        return;
      }
      case 'removePath': {
        const { spawn } = action;
        if (!still(spawn)) return;
        const ref = refOf(spawn);
        const after: SpawnEdit[] = [{ kind: 'movement', spawn: ref, to: IDLE }];
        // A path made in this view is taken back with it; a database path is left for whoever else walks it
        if (!spawn.own && d.current.isNewPath(spawn.pathId)) after.push({ kind: 'route', spawn: ref, pathId: spawn.pathId, points: [] });
        await commit(after, `Removed the path of ${spawn.name}`);
        return;
      }
      case 'toggleRole': {
        const target: RoleTarget = { kind: action.spawn.kind === 'object' ? 'gameobject' : 'creature', id: action.spawn.entry };
        let why: string | null = null;
        await step.current(async () => {
          why = d.current.onQuestRole?.(action.role, target, action.on) ?? null;
        });
        if (why) setNote(why);
        return;
      }
      case 'newQuest':
        d.current.onNewQuest?.({ entry: action.spawn.entry, name: action.spawn.name }, action.after);
        return;
      case 'findQuests':
        setNpcQuests({ entry: action.spawn.entry, name: action.spawn.name });
        return;
      case 'showSpawns': {
        const { quest, chainIds, map } = d.current;
        if (!api || !quest) return;
        const ids = action.scope === 'quest' ? [quest.id] : (chainIds ?? [quest.id]);
        const result = await api.questSpawnList(ids);
        if (!result.ok) {
          setNote(result.error.message);
          return;
        }
        const here = result.value.flatMap((g) => g.spawns).filter((s) => s.map === map);
        world.setMarked(here.map((s) => ({ kind: s.kind === 'gameobject' ? 'object' : 'creature', guid: s.guid })));
        setMarked(true);
        d.current.onShowSpawns?.(result.value, action.scope);
        return;
      }
      case 'hideSpawns':
        world.setMarked(null);
        setMarked(false);
        return;
    }
  };

  const pick = (action: MenuAction): void => {
    setMenu(null);
    d.current.focusView();
    run(action).catch((error: unknown) => d.current.setNote(error instanceof Error ? error.message : String(error)));
  };

  const shortcut = (code: 'KeyC' | 'KeyV' | 'KeyD'): boolean => {
    const world = d.current.world.current;
    if (!world) return false;
    if (locked.current && code !== 'KeyC') return true;
    // A paste or a duplicate while a path is drawn would land among the path's undo steps
    if (drawingRef.current && code !== 'KeyC') return true;
    if (code === 'KeyC') copy();
    else if (code === 'KeyD') void duplicate();
    else {
      const ground = world.groundAt(world.lastPointer() ?? d.current.viewCentre());
      if (!ground) d.current.setNote(NEEDS_GROUND);
      else void paste(clipEntries(), ground);
    }
    return true;
  };

  const placeOnce = async (chosen: Chosen, at: At): Promise<void> => {
    await putAll([{ kind: chosen.kind, entry: chosen.entry, own: false, at: await floored(facingCamera(at, chosen.kind)) }]);
  };

  const moving = (yards: number): Movement => ({ type: yards > 0 ? 'wander' : 'idle', wander: yards, pathId: null });

  const elements = (
    <>
      {menu && (
        <WorldContextMenu
          groups={menu.groups}
          at={menu.at}
          onPick={pick}
          onClose={() => {
            setMenu(null);
            d.current.focusView();
          }}
        />
      )}
      <AiLock>
      {place && (
        <PlaceDialog
          kind={place.what}
          once
          onPick={(chosen) => {
            const at = place.at;
            setPlace(null);
            d.current.focusView();
            void placeOnce(chosen, at);
          }}
          onClose={() => setPlace(null)}
        />
      )}
      {wander && (
        <WanderDialog
          name={wander.spawn.name}
          initial={wander.spawn.wander}
          onPreview={(yards) => d.current.world.current?.setPendingMovement(wander.spawn.guid, moving(yards))}
          onApply={(yards) => {
            const { spawn } = wander;
            setWander(null);
            d.current.focusView();
            const ref = refOf(spawn);
            void commit([{ kind: 'movement', spawn: ref, to: moving(yards) }]);
          }}
          onClose={() => {
            d.current.world.current?.setPendingMovement(wander.spawn.guid, null);
            setWander(null);
            d.current.focusView();
          }}
        />
      )}
      {point && (
        <PointDialog
          name={point.name}
          target={point.target}
          onApply={(result: PointResult) => {
            const { ref, name, pathId, points, target } = point;
            setPoint(null);
            d.current.focusView();
            // The points stay where they are; the patrol's, or the one point's columns, are what change
            const next = points.map((p, i): EditPoint =>
              result.kind === 'patrol' ? { ...p, carry: result.patrol.points[i] ?? p.carry } : i === target.index ? { ...p, carry: result.rest } : p,
            );
            void commit([{ kind: 'route', spawn: ref, pathId, points: next }], `Point ${target.index + 1} of ${name}`);
          }}
          onClose={() => {
            setPoint(null);
            d.current.focusView();
          }}
        />
      )}
      {groupEdit && (
        <GroupDialog
          // Another group in the dialog starts it afresh
          key={groupEdit.group.id}
          group={groupEdit.group}
          names={groupEdit.names}
          groupsOnMap={groupEdit.groupsOnMap}
          events={groupEdit.events}
          nested={groupEdit.nested}
          check={async (group, moves) => {
            const result = await d.current.api?.worldCheckGroup(group, moves);
            return !result ? { reasons: ['Needs the world database'], notes: [] } : result.ok ? result.value : { reasons: [result.error.message], notes: [] };
          }}
          onSave={(group, moves) => {
            saveGroup(group, moves).catch((error: unknown) => d.current.setNote(error instanceof Error ? error.message : String(error)));
          }}
          onRespawnAll={() => respawnGroup(groupEdit.group, groupEdit.names)}
          onClose={() => {
            setGroupEdit(null);
            d.current.focusView();
          }}
        />
      )}
      {spawnEvents && (
        <EventDialog
          names={spawnEvents.targets.map((t) => t.name)}
          events={spawnEvents.events}
          // What one spawn follows now; several may each follow something else
          now={spawnEvents.targets.length === 1 ? spawnEvents.targets[0]!.now : null}
          // Spawns that follow different events start with nothing chosen
          initial={spawnEvents.targets.every((t) => JSON.stringify(t.events) === JSON.stringify(spawnEvents.targets[0]!.events)) ? spawnEvents.targets[0]!.events : 'mixed'}
          onApply={(to) => {
            const { targets } = spawnEvents;
            setSpawnEvents(null);
            d.current.focusView();
            const label = targets.length === 1 ? `Events of ${targets[0]!.name}` : `Events of ${targets.length} spawns`;
            void commit(targets.map((t) => ({ kind: 'spawnEvents', spawn: t.ref, to })), label);
          }}
          onClose={() => {
            setSpawnEvents(null);
            d.current.focusView();
          }}
        />
      )}
      {npcQuests && d.current.api && (
        <NpcQuestsDialog
          api={d.current.api}
          entry={npcQuests.entry}
          name={npcQuests.name}
          onOpen={(id) => {
            setNpcQuests(null);
            d.current.onOpenQuest?.(id);
          }}
          onClose={() => {
            setNpcQuests(null);
            d.current.focusView();
          }}
        />
      )}
      {respawn && (
        <RespawnDialog
          names={respawn.targets.map((t) => t.name)}
          // Spawns with different (or unknown) times start blank
          initial={respawn.targets.every((t) => t.respawnSecs === respawn.targets[0]!.respawnSecs) ? respawn.targets[0]!.respawnSecs : null}
          onApply={(secs) => {
            const { targets } = respawn;
            setRespawn(null);
            d.current.focusView();
            const label = targets.length === 1 ? `Respawn time of ${targets[0]!.name}` : `Respawn time of ${targets.length} spawns`;
            void commit(targets.map((t) => ({ kind: 'respawn', spawn: t.ref, secs })), label);
          }}
          onClose={() => {
            setRespawn(null);
            d.current.focusView();
          }}
        />
      )}
      </AiLock>
    </>
  );

  const editGroup = (id: number): void => {
    if (locked.current) {
      d.current.setNote(`${AI_WRITING}.`);
      return;
    }
    openGroup(id).catch((error: unknown) => d.current.setNote(error instanceof Error ? error.message : String(error)));
  };

  return { open, shortcut, deleteSelected, deleteSpawns, onDrawing: setDrawing, editGroup, elements };
}
