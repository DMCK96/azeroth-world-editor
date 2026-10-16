import type { IdConflict } from '@shared/ipc';
import type { SliceArgs } from './types';

/** The project's ids that the database now holds something different at, and the offer to renumber them */
export interface IdsSlice {
  /** What the last check found; the dialog shows while this is not empty */
  idConflicts: IdConflict[];
  /** Asks which of the project's ids the database now holds something different at. Fails quietly: a check that cannot run shows nothing. */
  checkIdConflicts(): Promise<void>;
  /** Gives every clashing id a free one (one undo step), then shows the project as it now is */
  resolveIdConflicts(): Promise<void>;
  /** Leaves the ids as they are; asked again only when a project is next opened or a database connected */
  dismissIdConflicts(): void;
}

export function createIdsSlice({ api, set, get }: SliceArgs): IdsSlice {
  return {
    idConflicts: [],
    async checkIdConflicts() {
      const result = await api.idConflicts();
      set({ idConflicts: result.ok ? result.value : [] });
    },
    async resolveIdConflicts() {
      const result = await api.resolveIdConflicts();
      if (!result.ok) {
        set({ error: result.error.message });
        return;
      }
      set({ idConflicts: [] });
      await Promise.all([get().loadEntities(), get().loadLayer(), get().loadProjectState()]);
    },
    dismissIdConflicts() {
      set({ idConflicts: [] });
    },
  };
}
