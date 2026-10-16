import type { IdConflict } from '@core/ids/kinds/kind';
import type { Result } from './result';

export type { IdConflict } from '@core/ids/kinds/kind';

/** The ids the project allocated for itself, checked against the world database */
export interface IdsApi {
  /** The project's ids that the database now holds something different at; none when no database is connected */
  idConflicts(): Promise<Result<IdConflict[]>>;
  /** Gives every clashing id a free one, everywhere the project uses it, as one undo step; returns how many it changed */
  resolveIdConflicts(): Promise<Result<{ renamed: number }>>;
}
