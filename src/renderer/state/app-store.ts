import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { Api } from '@shared/ipc';
import { createKit } from './app/kit';
import type { AppState } from './app/types';
import { createShellSlice } from './app/shell';
import { createConnectionSlice } from './app/connection';
import { createQuestSlice } from './app/quest';
import { createCanvasSlice } from './app/canvas';
import { createRotationsSlice } from './app/rotations';
import { createWorldSlice } from './app/world';
import { createExportSlice } from './app/export';
import { createProjectSlice } from './app/project';
import { createIdsSlice } from './app/ids';
import { createHistorySlice } from './app/history';
import { createFocusSlice } from './app/focus';
import { createLinksEditSlice } from './app/links-edit';

export type { AppState } from './app/types';

export type AppStore = UseBoundStore<StoreApi<AppState>>;

/**
 * The whole renderer's state, built once per `<App>` around one `Api`.
 *
 * `opts.saveDelayMs` (default 400) is the debounce before an edit is sent to the open project; `0` in
 * tests still defers to a timer (via `setTimeout`), so `flushSave` is what tests call to force it.
 *
 * Each area is a slice under `app/`, made from the API, the store's set and get, and the `Kit` the
 * slices share; a new area is a new slice spread in here and added to `AppState`.
 */
export function createAppStore(api: Api, opts: { saveDelayMs?: number } = {}): AppStore {
  const kit = createKit(api, opts);
  return create<AppState>((set, get) => {
    const args = { api, kit, set, get };
    return {
      ...createShellSlice(args),
      ...createConnectionSlice(args),
      ...createQuestSlice(args),
      ...createCanvasSlice(args),
      ...createRotationsSlice(args),
      ...createWorldSlice(args),
      ...createExportSlice(args),
      ...createProjectSlice(args),
      ...createIdsSlice(args),
      ...createHistorySlice(args),
      ...createFocusSlice(args),
      ...createLinksEditSlice(args),
    };
  });
}
