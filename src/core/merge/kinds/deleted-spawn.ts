import { deletesOf, type WorldDeletedSpawn } from '../../world/layer';
import { listKind } from './list-kind';

const keyOf = (d: WorldDeletedSpawn): string => `${d.kind}:${d.guid}`;

/** A database spawn deleted in the 3D view. */
export const deletedSpawnKind = listKind<WorldDeletedSpawn>({
  key: 'deleted-spawn',
  label: 'Deleted spawns',
  removesIdentity: true,
  list: (doc) => deletesOf(doc.world),
  keyOf,
  put: (doc, deletes) => ({ ...doc, world: { ...doc.world, deletes } }),
  describe: (d) => `${d.name} (${d.kind} ${d.guid}) deleted`,
  fields: (d) => ({ spawn: String(d.guid) }),
  // Two deletions of the same spawn are the same, whatever rows were kept
  comparable: (d) => ({ kind: d.kind, guid: d.guid }),
  identity: (key) => key,
});
