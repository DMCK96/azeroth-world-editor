import type { IdConflict } from '@shared/ipc';
import type { SliceArgs } from './types';

/** The project's ids that the database now holds something different at, and the offer to renumber them */
export interface IdsSlice {
  /** What the last check found; the dialog shows while this is not empty */
  idConflicts: IdConflict[];
  /** Asks which of the project's ids the database now holds something different at. A check that cannot run shows nothing, and says why in the console. */
  checkIdConflicts(): Promise<void>;
  /** Sends what is pending, gives every clashing id a free one (one undo step), then shows the project as it now is */
  resolveIdConflicts(): Promise<void>;
  /** Leaves the ids as they are; asked again only when a project is next opened or a database connected */
  dismissIdConflicts(): void;
}

export function createIdsSlice({ api, set, get }: SliceArgs): IdsSlice {
  // Each check, and each answer the user gives, takes a number; a check only counts while it holds the latest, so a slow one cannot undo a newer answer or bring the dialog back
  let latest = 0;
  return {
    idConflicts: [],
    async checkIdConflicts() {
      const mine = ++latest;
      const result = await api.idConflicts();
      if (mine !== latest) return;
      if (!result.ok) console.warn('The id check could not run:', result.error.message);
      set({ idConflicts: result.ok ? result.value : [] });
    },
    async resolveIdConflicts() {
      latest++;
      // An edit still waiting out its delay would otherwise be sent with the old ids, or overwritten by the reload below
      await get().flushAll();
      const result = await api.resolveIdConflicts();
      if (!result.ok) {
        set({ error: result.error.message });
        return;
      }
      set({ idConflicts: [] });
      await Promise.all([get().loadEntities(), get().loadLayer(), get().loadProjectState()]);
    },
    dismissIdConflicts() {
      latest++;
      set({ idConflicts: [] });
    },
  };
}
