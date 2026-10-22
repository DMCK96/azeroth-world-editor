import type { WoodcuttingTree } from '@core/world/woodcutting';
import type { Result } from './result';

export type { WoodcuttingTree } from '@core/world/woodcutting';

/** Woodcutting trees, a Conquest of Azeroth / Ascension feature: the database has them or it does not */
export interface WoodcuttingApi {
  /** The woodcutting trees the database has, by entry; none when it has none. */
  worldWoodcuttingTrees(): Promise<Result<WoodcuttingTree[]>>;
  /** The entry of the woodcutting tree spawn nearest a place on a map (the database's and the ones placed in the view); null when none is near. */
  worldNearestWoodcuttingTree(map: number, x: number, y: number): Promise<Result<number | null>>;
}
