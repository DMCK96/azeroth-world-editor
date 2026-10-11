import { compareVersions, normalizeVersion } from '../../core/updates/version';
import type { Store } from '../store/store';

const SKIPPED = 'updates.skipped';

/** The version the user chose to skip: no dialog until a newer one is published. Kept per machine in the store. */
export interface UpdateSettings {
  skipped(): string | null;
  /** Records a skipped version; one that is not a version, or is not newer than the one already skipped, changes nothing */
  setSkipped(version: string): void;
}

export function createUpdateSettings(store: Store): UpdateSettings {
  const skipped = (): string | null => {
    const stored = store.settings.get(SKIPPED);
    return stored === null ? null : normalizeVersion(stored);
  };
  return {
    skipped,
    setSkipped(version) {
      const next = normalizeVersion(version);
      if (next === null) return;
      const current = skipped();
      if (current !== null && compareVersions(next, current) <= 0) return;
      store.settings.set(SKIPPED, next);
    },
  };
}
