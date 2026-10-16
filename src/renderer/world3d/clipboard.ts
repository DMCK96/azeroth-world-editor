import type { Placement } from '@core/world/layer';
import type { SpawnEvents } from '@core/entities/model';
import type { SpawnInfo } from './scene/spawn/SpawnManager';

/**
 * The 3D view's clipboard: spawns copied in the view, kept for the app's session (a map switch keeps
 * them, a restart does not). Each keeps its offset from the copied group's centre and how it faces,
 * so a paste puts the group down as it was laid out.
 */

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
}

let entries: ClipEntry[] = [];

const mean = (values: number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length;

/** Spawns as clipboard entries, without copying them (a duplicate leaves what was copied alone) */
export function entriesOf(spawns: readonly SpawnInfo[]): ClipEntry[] {
  if (spawns.length === 0) return [];
  const anchor = {
    x: mean(spawns.map((s) => s.placement.x)),
    y: mean(spawns.map((s) => s.placement.y)),
    z: mean(spawns.map((s) => s.placement.z)),
  };
  return spawns.map((s) => ({
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
  }));
}

/** Copies spawns, replacing what was copied before */
export function copySpawns(spawns: readonly SpawnInfo[]): ClipEntry[] {
  if (spawns.length > 0) entries = entriesOf(spawns);
  return entries;
}

export const clipEntries = (): readonly ClipEntry[] => entries;

export function clearClipboard(): void {
  entries = [];
}

/**
 * Where each entry lands with the group's anchor at `at`, on the map being viewed. Each keeps its
 * offset from the anchor in height too; nothing is snapped to the floor.
 */
export function layoutAt(list: readonly ClipEntry[], at: { x: number; y: number; z: number }, map: number): { entry: ClipEntry; at: Placement; map: number }[] {
  return list.map((entry) => ({
    entry,
    at: { x: at.x + entry.dx, y: at.y + entry.dy, z: at.z + entry.dz, orientation: entry.orientation, rotation: entry.rotation },
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
