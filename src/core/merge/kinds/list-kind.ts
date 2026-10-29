import type { MergeDocument } from '../doc';
import type { FieldDiff, MergeKind, Ref } from '../kind';
import { stableJson } from '../stable';

export interface ListKindSpec<T> {
  key: string;
  label: string;
  canCollide?: boolean;
  removesIdentity?: boolean;
  list(doc: MergeDocument): readonly T[];
  keyOf(item: T): string;
  put(doc: MergeDocument, items: T[]): MergeDocument;
  describe(item: T): string;
  fields(item: T): Record<string, string>;
  /** What counts as the item's value when two are compared; the item itself when absent. */
  comparable?(item: T): unknown;
  identity?(key: string, item: T): string;
  references?(item: T): Ref[];
  renumber?: MergeKind<T>['renumber'];
  freeKey?: MergeKind<T>['freeKey'];
}

const byKey = (a: [string, unknown], b: [string, unknown]): number => a[0].localeCompare(b[0], undefined, { numeric: true });

/** A kind whose items are the entries of one list in the document. */
export function listKind<T>(spec: ListKindSpec<T>): MergeKind<T> {
  const comparable = (item: T): unknown => (spec.comparable ? spec.comparable(item) : item);
  const kind: MergeKind<T> = {
    key: spec.key,
    label: spec.label,
    canCollide: spec.canCollide ?? false,
    items: (doc) => new Map(spec.list(doc).map((item) => [spec.keyOf(item), item])),
    same: (a, b) => stableJson(comparable(a)) === stableJson(comparable(b)),
    describe: spec.describe,
    diff(a, b): FieldDiff[] {
      const from = a ? spec.fields(a) : {};
      const to = b ? spec.fields(b) : {};
      const names = [...Object.keys(from), ...Object.keys(to).filter((n) => !(n in from))];
      return names
        .filter((field) => from[field] !== to[field])
        .map((field) => ({ field, from: from[field] ?? null, to: to[field] ?? null }));
    },
    write: (doc, items) => spec.put(doc, [...items].sort(byKey).map(([, item]) => item)),
    ...(spec.removesIdentity !== undefined && { removesIdentity: spec.removesIdentity }),
    ...(spec.identity && { identity: spec.identity }),
    ...(spec.references && { references: spec.references }),
    ...(spec.renumber && { renumber: spec.renumber }),
    ...(spec.freeKey && { freeKey: spec.freeKey }),
  };
  return kind;
}
