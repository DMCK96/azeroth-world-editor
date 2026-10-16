import type { StoreApi } from 'zustand';
import type { Api } from '@shared/ipc';
import type { Kit } from './kit';
import type { CanvasSlice } from './canvas';
import type { ConnectionSlice } from './connection';
import type { ExportSlice } from './export';
import type { FocusSlice } from './focus';
import type { LinksEditSlice } from './links-edit';
import type { HistorySlice } from './history';
import type { IdsSlice } from './ids';
import type { ProjectSlice } from './project';
import type { QuestSlice } from './quest';
import type { RotationsSlice } from './rotations';
import type { ShellSlice } from './shell';
import type { WorldSlice } from './world';

/** The whole renderer's state: every slice's */
export interface AppState
  extends ShellSlice,
    ConnectionSlice,
    QuestSlice,
    CanvasSlice,
    RotationsSlice,
    WorldSlice,
    ExportSlice,
    ProjectSlice,
    IdsSlice,
    HistorySlice,
    FocusSlice,
    LinksEditSlice {}

/** What each slice is made with: the API, what the slices share, and the store's own set and get */
export interface SliceArgs {
  api: Api;
  kit: Kit;
  set: StoreApi<AppState>['setState'];
  get: StoreApi<AppState>['getState'];
}
