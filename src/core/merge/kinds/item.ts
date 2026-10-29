import type { CustomItem } from '../../entities/model';
import { stableJson } from '../stable';
import { renameEntry } from './entry-refs';
import { listKind } from './list-kind';
import { freeAbove } from './refs';

/** A project-owned item, keyed by entry. */
export const itemKind = listKind<CustomItem>({
  key: 'item',
  label: 'Items',
  canCollide: true,
  list: (doc) => doc.entities.items,
  keyOf: (e) => String(e.entry),
  put: (doc, items) => ({ ...doc, entities: { ...doc.entities, items } }),
  describe: (e) => `Item ${e.entry} ${e.name}`,
  fields: (e) => Object.fromEntries(Object.entries(e).map(([name, value]) => [name, stableJson(value)])),
  renumber: (doc, from, to) => renameEntry(doc, 'item', Number(from), Number(to)),
  freeKey: (_from, docs) => freeAbove(docs.flatMap((d) => d.entities.items.map((e) => e.entry))),
});
