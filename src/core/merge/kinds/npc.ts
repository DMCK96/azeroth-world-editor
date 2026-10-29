import type { CustomNpc } from '../../entities/model';
import { stableJson } from '../stable';
import { renameEntry } from './entry-refs';
import { listKind } from './list-kind';
import { freeAbove } from './refs';

/** A project-owned NPC, keyed by entry. */
export const npcKind = listKind<CustomNpc>({
  key: 'npc',
  label: 'NPCs',
  canCollide: true,
  list: (doc) => doc.entities.npcs,
  keyOf: (e) => String(e.entry),
  put: (doc, npcs) => ({ ...doc, entities: { ...doc.entities, npcs } }),
  describe: (e) => `NPC ${e.entry} ${e.name}`,
  fields: (e) => Object.fromEntries(Object.entries(e).map(([name, value]) => [name, stableJson(value)])),
  renumber: (doc, from, to) => renameEntry(doc, 'npc', Number(from), Number(to)),
  freeKey: (_from, docs) => freeAbove(docs.flatMap((d) => d.entities.npcs.map((e) => e.entry))),
});
