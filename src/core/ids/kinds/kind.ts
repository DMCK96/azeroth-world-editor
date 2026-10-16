import type { WorldDb } from '../../db/world-db';
import type { ProjectEntities } from '../../entities/model';
import type { WorldLayer } from '../../world/layer';

/** Everything of a project that holds ids it allocated itself */
export interface ProjectIds {
  entities: ProjectEntities;
  world: WorldLayer;
}

/** What stands at an id: in the database, or in the project */
export interface IdHolder {
  entry: number;
  name: string;
  map: number;
  x: number;
  y: number;
  z: number;
}

/** One id the project allocated for itself, and what it stands for. `scope` tells ids of one kind apart (a creature guid from an object guid). */
export interface IdClaim extends IdHolder {
  scope: string;
  id: number;
}

/** The key of an id in `IdKind.holders`' result */
export const claimKey = (scope: string, id: number): string => `${scope}:${id}`;

/** A project id the database holds something different at */
export interface IdConflict {
  kind: string;
  scope: string;
  scopeLabel: string;
  id: number;
  mine: IdHolder;
  database: IdHolder;
}

/** One id to change to another */
export interface IdRename {
  kind: string;
  scope: string;
  from: number;
  to: number;
}

/**
 * One kind of id the project allocates (spawn guids, entry ids, quest ids). The check and the dialog know
 * only this interface, so a new kind is a new file listed in `kinds/index.ts`.
 */
export interface IdKind {
  /** Names the kind in a conflict and in a rename */
  readonly key: string;
  /** What a scope of this kind is called in the dialog */
  scopeLabel(scope: string): string;
  /** The ids the project allocated for itself */
  claims(project: ProjectIds): IdClaim[];
  /** What the database holds at the claimed ids, by `claimKey`; an id it holds nothing at is absent */
  holders(db: WorldDb, claims: readonly IdClaim[]): Promise<Map<string, IdHolder>>;
  /** Whether the database's holder is the project's own claim (an exported patch already applied), not a clash */
  isSameThing(claim: IdClaim, holder: IdHolder): boolean;
  /** The project with one id changed to another everywhere it is used. Returns a new value; never changes the one given. */
  rename(project: ProjectIds, scope: string, from: number, to: number): ProjectIds;
  /** `count` ids that collide with neither the database nor the project */
  freeIds(db: WorldDb, project: ProjectIds, scope: string, count: number): Promise<number[]>;
}
