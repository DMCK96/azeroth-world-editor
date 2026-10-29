import { spawnGuidKind } from '../../ids/kinds/spawn-guid';
import type { WorldAddedSpawn } from '../../world/layer';
import type { MergeDocument } from '../doc';
import { listKind } from './list-kind';
import { freeAbove } from './refs';

/** `creature:5` as its scope and guid */
const parse = (key: string): { scope: string; guid: number } => {
  const at = key.indexOf(':');
  return { scope: key.slice(0, at), guid: Number(key.slice(at + 1)) };
};

/** Every spawn guid of the scope the document uses: placed in the 3D view, and its NPCs' or objects' own */
const guidsOf = (doc: MergeDocument, scope: string): number[] => [
  ...doc.world.added.filter((a) => a.kind === scope).map((a) => a.guid),
  ...(scope === 'creature' ? doc.entities.npcs : doc.entities.objects).flatMap((e) => e.spawns.map((s) => s.guid)),
];

/** The document with the placed spawn moved to another guid, through the spawn-guid rename, which follows everything that names it */
function renamePlaced(doc: MergeDocument, fromKey: string, toKey: string): MergeDocument {
  const from = parse(fromKey);
  const to = parse(toKey);
  const { entities, world } = spawnGuidKind.rename({ entities: doc.entities, world: doc.world }, from.scope, from.guid, to.guid);
  return { ...doc, entities, world };
}

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
  renumber: renamePlaced,
  freeKey: (from, docs) => {
    const { scope } = parse(from);
    return `${scope}:${freeAbove(docs.flatMap((d) => guidsOf(d, scope)))}`;
  },
});
