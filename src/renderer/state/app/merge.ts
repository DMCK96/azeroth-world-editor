import type { Choice, Choices, MergePreviewResult } from '@shared/ipc';
import { MERGE_STALE_MESSAGE } from '@shared/ipc/merge';
import type { SliceArgs } from './types';

/** Merging another project file (theirs, with the base both started from) into the open one */
export interface MergeSlice {
  merge: {
    /** The merge dialog shows */
    open: boolean;
    theirsPath: string | null;
    /** Null for a two-way merge */
    basePath: string | null;
    /** What the merge would give with the files and choices below; null until theirs is chosen, or when the preview failed */
    preview: MergePreviewResult | null;
    /** The answer to each decision, by its id */
    choices: Choices;
    /** A preview or the merge itself is under way */
    busy: boolean;
  };
  /** Shows the dialog with nothing chosen yet */
  openMerge(): void;
  /** Asks for theirs or the base in the open dialog, forgets the choices made for the old files, then previews again */
  pickMergeFile(role: 'theirs' | 'base'): Promise<void>;
  /** Merges without a base (two-way), then previews again */
  clearMergeBase(): Promise<void>;
  /** Settles one decision, then previews again with every choice made */
  chooseMerge(decisionId: string, choice: Choice): Promise<void>;
  /** Sends what is pending, then opens the merged project as a new unsaved one; a failure keeps the dialog open and says why */
  applyMerge(): Promise<void>;
  closeMerge(): void;
}

const closed: MergeSlice['merge'] = { open: false, theirsPath: null, basePath: null, preview: null, choices: {}, busy: false };

export function createMergeSlice({ api, set, get }: SliceArgs): MergeSlice {
  // Each preview, and each change that makes one out of date, takes a number; a preview only lands while it holds the latest, so a slow one cannot overwrite a newer one
  let latest = 0;
  // The message the last failed preview showed
  let shownError: string | null = null;
  const patch = (over: Partial<MergeSlice['merge']>): void => set((s) => ({ merge: { ...s.merge, ...over } }));

  /** Asks for the preview of the files and choices as they are now */
  async function refresh(): Promise<void> {
    const mine = ++latest;
    if (get().merge.theirsPath === null) {
      patch({ preview: null, busy: false });
      return;
    }
    patch({ busy: true });
    // An edit still waiting out its delay belongs in mine, or the preview's fingerprint is stale before apply
    await get().flushAll();
    if (mine !== latest) return;
    const { theirsPath, basePath, choices } = get().merge;
    if (theirsPath === null) return;
    const result = await api.mergePreview({ theirsPath, basePath }, choices);
    if (mine !== latest) return;
    if (!result.ok) {
      shownError = result.error.message;
      set({ error: shownError });
      patch({ preview: null, busy: false });
      return;
    }
    // A preview that now works takes back what the last failed one said, and nothing else
    if (shownError !== null && get().error === shownError) set({ error: null });
    shownError = null;
    patch({ preview: result.value, busy: false });
  }

  return {
    merge: closed,
    openMerge() {
      latest++;
      shownError = null;
      // An earlier message has had its banner; the dialog shows only what the merge says
      set({ merge: { ...closed, open: true }, error: null });
    },
    async pickMergeFile(role) {
      const picked = await api.mergePickFile();
      if (!picked.ok) {
        set({ error: picked.error.message });
        return;
      }
      // Cancelled, or the dialog was closed while the file dialog was up
      if (picked.value === null || !get().merge.open) return;
      patch(role === 'theirs' ? { theirsPath: picked.value, choices: {} } : { basePath: picked.value, choices: {} });
      await refresh();
    },
    async clearMergeBase() {
      patch({ basePath: null, choices: {} });
      await refresh();
    },
    async chooseMerge(decisionId, choice) {
      set((s) => ({ merge: { ...s.merge, choices: { ...s.merge.choices, [decisionId]: choice } } }));
      await refresh();
    },
    async applyMerge() {
      const { preview, theirsPath, basePath, choices, busy } = get().merge;
      if (!preview?.settled || theirsPath === null || busy) return;
      latest++;
      patch({ busy: true });
      // An edit still waiting out its delay belongs in mine before it is merged
      await get().flushAll();
      const result = await api.mergeApply({ theirsPath, basePath }, choices, preview.fingerprint);
      if (!result.ok) {
        // Includes the user keeping the open project's unsaved changes: the dialog stays, so nothing chosen is lost
        set({ error: result.error.message });
        patch({ busy: false });
        // A file or mine changed since the preview: preview again with the same choices, so the user can merge again
        if (result.error.message === MERGE_STALE_MESSAGE) await refresh();
        return;
      }
      set({ merge: closed });
      await get().projectSwitched();
    },
    closeMerge() {
      latest++;
      set({ merge: closed });
    },
  };
}
