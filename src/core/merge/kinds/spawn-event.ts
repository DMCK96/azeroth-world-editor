import { spawnEventsOf, type WorldEventEdit } from '../../world/layer';
import { stableJson } from '../stable';
import { listKind } from './list-kind';

/** The game events a database NPC spawn follows of its own, changed in the 3D view. */
export const spawnEventKind = listKind<WorldEventEdit>({
  key: 'spawn-event',
  label: 'Spawn game events',
  list: (doc) => spawnEventsOf(doc.world),
  keyOf: (e) => String(e.guid),
  put: (doc, spawnEvents) => ({ ...doc, world: { ...doc.world, spawnEvents } }),
  describe: (e) => `${e.name} (${e.guid}) game events`,
  fields: (e) => ({ rule: stableJson(e.current) }),
  comparable: (e) => e.current,
  identity: (key) => `creature:${key}`,
});
