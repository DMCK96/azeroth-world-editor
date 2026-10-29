import type { WorldSpawnEdit } from '../../world/layer';
import { listKind } from './list-kind';

const keyOf = (s: WorldSpawnEdit): string => `${s.kind}:${s.guid}`;

/** A database spawn moved or turned in the 3D view. */
export const spawnEditKind = listKind<WorldSpawnEdit>({
  key: 'spawn-edit',
  label: 'Moved spawns',
  list: (doc) => doc.world.spawns,
  keyOf,
  put: (doc, spawns) => ({ ...doc, world: { ...doc.world, spawns } }),
  describe: (s) => `${s.name} (${s.kind} ${s.guid}) moved`,
  fields: ({ current: c }) => ({ x: String(c.x), y: String(c.y), z: String(c.z), orientation: String(c.orientation) }),
  comparable: (s) => s.current,
  identity: (key) => key,
});
