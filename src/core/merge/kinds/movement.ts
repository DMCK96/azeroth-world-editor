import { movementsOf, type WorldMovementEdit } from '../../world/layer';
import { listKind } from './list-kind';

/** How an NPC moves, changed in the 3D view. */
export const movementKind = listKind<WorldMovementEdit>({
  key: 'movement',
  label: 'Movement',
  list: (doc) => movementsOf(doc.world),
  keyOf: (m) => String(m.guid),
  put: (doc, movements) => ({ ...doc, world: { ...doc.world, movements } }),
  describe: (m) => `${m.name} (${m.guid}) movement`,
  fields: (m) => Object.fromEntries(Object.entries(m.current).map(([k, v]) => [k, String(v)])),
  comparable: (m) => m.current,
  identity: (key) => `creature:${key}`,
});
