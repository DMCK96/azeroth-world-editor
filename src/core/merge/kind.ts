import type { MergeDocument } from './doc';

export interface FieldDiff {
  field: string;
  from: string | null;
  to: string | null;
}

/** An item of `kind` with `key`, pointed at. */
export interface Ref {
  kind: string;
  key: string;
}

/** One kind of mergeable item. New kinds are new files that plug in. */
export interface MergeKind<T = unknown> {
  readonly key: string;                 // 'quest'
  readonly label: string;               // 'Quests'
  readonly canCollide: boolean;
  /** Set on the one kind whose items are removals of an identity (deleted database spawns). */
  readonly removesIdentity?: boolean;
  items(doc: MergeDocument): Map<string, T>;
  same(a: T, b: T): boolean;
  describe(item: T): string;
  diff(a: T | null, b: T | null): FieldDiff[];
  identity?(key: string, item: T): string;
  references?(item: T): Ref[];
  write(doc: MergeDocument, items: Map<string, T>): MergeDocument;
  /** Collidable kinds only. The document with the item at `from` moved to `to`, and every reference to it rewritten. */
  renumber?(doc: MergeDocument, from: string, to: string): MergeDocument;
  /** Collidable kinds only. A key of the same shape as `from` that no document in `docs` uses. */
  freeKey?(from: string, docs: readonly MergeDocument[]): string;
}
