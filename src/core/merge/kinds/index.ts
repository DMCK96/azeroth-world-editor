import type { MergeKind } from '../kind';
import { deletedSpawnKind } from './deleted-spawn';
import { groupKind } from './group';
import { itemKind } from './item';
import { movementKind } from './movement';
import { npcKind } from './npc';
import { objectKind } from './object';
import { placedSpawnKind } from './placed-spawn';
import { questKind } from './quest';
import { respawnKind } from './respawn';
import { routeKind } from './route';
import { spawnEditKind } from './spawn-edit';
import { spawnEventKind } from './spawn-event';

/** Every kind of mergeable item, in the order the merge reads them. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const MERGE_KINDS: readonly MergeKind<any>[] = [
  questKind, npcKind, objectKind, itemKind, placedSpawnKind, groupKind,
  spawnEditKind, routeKind, movementKind, respawnKind, spawnEventKind, deletedSpawnKind,
];
