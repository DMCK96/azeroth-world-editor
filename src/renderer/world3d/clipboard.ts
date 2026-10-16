import type { Placement } from '@core/world/layer';
import type { SpawnEvents } from '@core/entities/model';
import type { SpawnInfo } from './scene/spawn/SpawnManager';

/**
 * The 3D view's clipboard: spawns copied in the view, kept for the app's session (a map switch keeps
 * them, a restart does not). Each keeps its offset from the copied group's centre and how it faces,
 * so a paste puts the group down as it was laid out.
 */

/** A point of a copied NPC's path, as an offset from the NPC and what it keeps that the view does not edit */
export interface ClipPoint {
  dx: number;
  dy: number;
  dz: number;
  carry?: unknown;
}

export interface ClipEntry {
  kind: 'creature' | 'object';
  entry: number;
  name: string;
  own: boolean;
  /** Offset from the copied group's anchor (its centre), in yards */
  dx: number;
  dy: number;
  dz: number;
  orientation: number;
  rotation: [number, number, number, number] | null;
  /** Seconds before it respawns */
  respawnSecs: number;
  /** Its wander circle in yards; 0 for none, and for an NPC that walks a path */
  wander: number;
  /** An NPC's own game events; 'npc' follows its NPC (and an object's is always that) */
  spawnEvents: SpawnEvents;
  /** The path an NPC walks, which its copy walks too, as its own path; absent for one that does not walk */
  route?: ClipPoint[];
}

let entries: ClipEntry[] = [];

const mean = (values: number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length;

/** Spawns as clipboard entries, without copying them (a duplicate leaves what was copied alone) */
export function entriesOf(spawns: readonly SpawnInfo[], routeOf?: (guid: number) => { points: readonly { x: number; y: number; z: number; carry?: unknown }[] } | null): ClipEntry[] {
  if (spawns.length === 0) return [];
  const anchor = {
    x: mean(spawns.map((s) => s.placement.x)),
    y: mean(spawns.map((s) => s.placement.y)),
    z: mean(spawns.map((s) => s.placement.z)),
  };
  return spawns.map((s) => {
    const route = s.kind === 'creature' && s.pathId > 0 ? routeOf?.(s.guid) : null;
    return {
    kind: s.kind,
    entry: s.entry,
    name: s.name,
    own: s.own,
    dx: s.placement.x - anchor.x,
    dy: s.placement.y - anchor.y,
    dz: s.placement.z - anchor.z,
    orientation: s.placement.orientation,
    rotation: s.placement.rotation,
    respawnSecs: s.respawnSecs,
    wander: s.pathId > 0 ? 0 : s.wander,
    spawnEvents: s.kind === 'creature' && s.spawnEvents !== undefined ? s.spawnEvents : 'npc',
    ...(route && route.points.length > 0 ? { route: route.points.map((p) => ({ dx: p.x - s.placement.x, dy: p.y - s.placement.y, dz: p.z - s.placement.z, ...(p.carry !== undefined ? { carry: structuredClone(p.carry) } : {}) })) } : {}),
    };
  });
}

/** Copies spawns, replacing what was copied before */
export function copySpawns(spawns: readonly SpawnInfo[], routeOf?: Parameters<typeof entriesOf>[1]): ClipEntry[] {
  if (spawns.length > 0) entries = entriesOf(spawns, routeOf);
  return entries;
}

export const clipEntries = (): readonly ClipEntry[] => entries;

export function clearClipboard(): void {
  entries = [];
}

/**
 * Where each entry lands with the group's anchor at `at`, on the map being viewed. Each is at the
 * paste point's height: the caller drops each onto the floor where it lands.
 */
export function layoutAt(list: readonly ClipEntry[], at: { x: number; y: number; z: number }, map: number): { entry: ClipEntry; at: Placement; map: number }[] {
  return list.map((entry) => ({
    entry,
    at: { x: at.x + entry.dx, y: at.y + entry.dy, z: at.z, orientation: entry.orientation, rotation: entry.rotation },
    map,
  }));
}

/** Which entries can be pasted: every one, since the project's NPCs and objects belong to the project, not to a quest */
export function pasteable(list: readonly ClipEntry[]): { entries: ClipEntry[]; blocked: null } {
  return { entries: [...list], blocked: null };
}

/** Where a duplicate goes: two yards to the right of a camera looking along `direction` (X north, Y west) */
export function duplicateOffset(direction: { x: number; y: number }): { x: number; y: number } {
  const length = Math.hypot(direction.x, direction.y) || 1;
  const clean = (v: number): number => Math.round(v * 1e9) / 1e9 + 0;
  return { x: clean((direction.y / length) * 2), y: clean((-direction.x / length) * 2) };
}
