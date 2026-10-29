import type { CustomObject } from '../../entities/model';
import { stableJson } from '../stable';
import { renameEntry } from './entry-refs';
import { listKind } from './list-kind';
import { freeAbove } from './refs';

/** A project-owned object, keyed by entry. */
export const objectKind = listKind<CustomObject>({
  key: 'object',
  label: 'Objects',
  canCollide: true,
  allocated: (e) => e.origin.kind === 'new',
  list: (doc) => doc.entities.objects,
  keyOf: (e) => String(e.entry),
  put: (doc, objects) => ({ ...doc, entities: { ...doc.entities, objects } }),
  describe: (e) => `Object ${e.entry} ${e.name}`,
  fields: (e) => Object.fromEntries(Object.entries(e).map(([name, value]) => [name, stableJson(value)])),
  renumber: (doc, from, to) => renameEntry(doc, 'object', Number(from), Number(to)),
  freeKey: (_from, docs) => freeAbove(docs.flatMap((d) => d.entities.objects.map((e) => e.entry))),
});
