import type { CustomItem } from '../../entities/model';
import { stableJson } from '../stable';
import { listKind } from './list-kind';

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
});
