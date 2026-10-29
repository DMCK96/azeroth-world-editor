import { respawnsOf, type WorldRespawnEdit } from '../../world/layer';
import { listKind } from './list-kind';

/** A database spawn's respawn time, changed in the 3D view. */
export const respawnKind = listKind<WorldRespawnEdit>({
  key: 'respawn',
  label: 'Respawn times',
  list: (doc) => respawnsOf(doc.world),
  keyOf: (r) => `${r.kind}:${r.guid}`,
  put: (doc, respawns) => ({ ...doc, world: { ...doc.world, respawns } }),
  describe: (r) => `${r.name} (${r.kind} ${r.guid}) respawn ${r.current}s`,
  fields: (r) => ({ seconds: String(r.current) }),
  comparable: (r) => r.current,
  identity: (key) => key,
});
