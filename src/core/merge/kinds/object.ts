import type { CustomObject } from '../../entities/model';
import { stableJson } from '../stable';
import { listKind } from './list-kind';

/** A project-owned object, keyed by entry. */
export const objectKind = listKind<CustomObject>({
  key: 'object',
  label: 'Objects',
  canCollide: true,
  list: (doc) => doc.entities.objects,
  keyOf: (e) => String(e.entry),
  put: (doc, objects) => ({ ...doc, entities: { ...doc.entities, objects } }),
  describe: (e) => `Object ${e.entry} ${e.name}`,
  fields: (e) => Object.fromEntries(Object.entries(e).map(([name, value]) => [name, stableJson(value)])),
});
