import type { WorldAddedSpawn } from '../../world/layer';
import { listKind } from './list-kind';

/** A spawn placed in the 3D view, keyed by kind and guid. */
export const placedSpawnKind = listKind<WorldAddedSpawn>({
  key: 'placed-spawn',
  label: 'Placed spawns',
  canCollide: true,
  list: (doc) => doc.world.added,
  keyOf: (s) => `${s.kind}:${s.guid}`,
  put: (doc, added) => ({ ...doc, world: { ...doc.world, added } }),
  describe: (s) => `${s.name} (${s.kind} ${s.guid}) placed`,
  fields: (s) => ({
    entry: String(s.entry),
    map: String(s.map),
    x: String(s.placement.x),
    y: String(s.placement.y),
    z: String(s.placement.z),
    orientation: String(s.placement.orientation),
  }),
  references: (s) => [{ kind: s.kind === 'creature' ? 'npc' : 'object', key: String(s.entry) }],
});
