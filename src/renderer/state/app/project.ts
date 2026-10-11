import type { ProjectState, RecentProject, RecoveryEntry } from '@shared/ipc';
import { EMPTY_WORLD } from '@core/world/layer';
import type { SliceArgs } from './types';

/** The project file: its state, new, open, save, rename, recent projects and recovery */
export interface ProjectSlice {
  project: ProjectState;
  /** Goes up by one each time a different project is loaded (New, Open, Restore). */
  projectEpoch: number;
  recent: RecentProject[];
  recoveries: RecoveryEntry[];
  /** The first read of the recovery copies has finished (found some or none), so dialogs can queue behind it. */
  recoveriesLoaded: boolean;
  loadProjectState(): Promise<void>;
  /** Sends the debounced edit and any queued moves now, so nothing typed is left behind. */
  flushAll(): Promise<void>;
  newProject(name: string): Promise<void>;
  openProject(path?: string): Promise<void>;
  saveProject(): Promise<void>;
  saveProjectAs(): Promise<void>;
  renameProject(name: string): Promise<void>;
  loadRecent(): Promise<void>;
  forgetRecent(path: string): Promise<void>;
  loadRecoveries(): Promise<void>;
  /** Restores one crash copy and discards every other one listed: only one project can be open. */
  restoreRecovery(id: string): Promise<void>;
  discardRecovery(id: string): Promise<void>;
}

export function createProjectSlice({ api, kit, set, get }: SliceArgs): ProjectSlice {
  /**
   * A different project is open: nothing the editor or the canvas kit.holds belongs to it any more.
   * Queued moves and viewport changes were for the old canvas, so they are dropped, not sent.
   */
  async function switchedProject(): Promise<void> {
    if (kit.saveTimer) {
      clearTimeout(kit.saveTimer);
      kit.saveTimer = null;
    }
    if (kit.entitiesTimer) {
      clearTimeout(kit.entitiesTimer);
      kit.entitiesTimer = null;
    }
    kit.entitiesPending = false;
    kit.pendingMoves.clear();
    kit.pendingViewport = null;
    set({
      open: null,
      screen: 'pick',
      links: null,
      dirty: false,
      preview: null,
      exportResult: null,
      projectPatch: null,
      exportError: null,
      historyNote: null,
      worldLayer: null,
      layer: EMPTY_WORLD,
    });
    get().setFocus(null);
    await get().loadNodes();
    await get().loadEntities();
    await get().loadLayer();
    // Last, so the canvas applies the new project's viewport rather than the old one's.
    set((s) => ({ projectEpoch: s.projectEpoch + 1 }));
  }

  return {
    project: { name: '', filePath: null, dirty: false, idRangeStart: 60000, idRangeEnd: 99999, outputDir: '', viewport: { x: 0, y: 0, zoom: 1 } },
    projectEpoch: 0,
    recent: [],
    recoveries: [],
    recoveriesLoaded: false,
    async loadProjectState() {
      const { token, result } = await kit.readProject();
      if (result.ok && token === kit.projectToken) set({ project: result.value });
    },
    async flushAll() {
      await get().flushSave();
      await get().flushEntities();
      await get().flushMoves();
    },
    async newProject(name) {
      await get().flushAll();
      const result = await api.newProject(name);
      if (!result.ok) {
        set({ error: result.error.message });
        return;
      }
      if (result.value.done) await switchedProject();
    },
    async openProject(path) {
      await get().flushAll();
      const result = path === undefined ? await api.openProject() : await api.openProject(path);
      if (!result.ok) {
        set({ error: result.error.message });
        return;
      }
      if (result.value.done) await switchedProject();
      // An older project's quest NPCs were moved into the project; what that had to say is shown
      if (result.value.warnings && result.value.warnings.length > 0) set({ error: result.value.warnings.join(' ') });
    },
    async saveProject() {
      await get().flushAll();
      const result = await api.saveProject();
      if (!result.ok) set({ error: result.error.message });
      await Promise.all([get().loadProjectState(), get().loadRecent()]);
    },
    async saveProjectAs() {
      await get().flushAll();
      const result = await api.saveProjectAs();
      if (!result.ok) set({ error: result.error.message });
      await Promise.all([get().loadProjectState(), get().loadRecent()]);
    },
    async renameProject(name) {
      await get().flushAll();
      const result = await api.renameProject(name);
      if (!result.ok) set({ error: result.error.message });
      await get().loadProjectState();
    },
    async loadRecent() {
      const result = await api.recentProjects();
      if (result.ok) set({ recent: result.value });
    },
    async forgetRecent(path) {
      const result = await api.forgetRecent(path);
      if (!result.ok) set({ error: result.error.message });
      await get().loadRecent();
    },
    async loadRecoveries() {
      const result = await api.recoveries();
      // A failed read still ends the wait: nothing was found to offer.
      set(result.ok ? { recoveries: result.value, recoveriesLoaded: true } : { recoveriesLoaded: true });
    },
    async restoreRecovery(id) {
      await get().flushAll();
      const result = await api.restoreRecovery(id);
      if (!result.ok) {
        set({ error: result.error.message });
        return;
      }
      const others = get().recoveries.filter((r) => r.id !== id);
      await Promise.all(others.map((r) => api.discardRecovery(r.id)));
      set({ recoveries: [] });
      await switchedProject();
    },
    async discardRecovery(id) {
      const result = await api.discardRecovery(id);
      if (!result.ok) {
        set({ error: result.error.message });
        return;
      }
      set((s) => ({ recoveries: s.recoveries.filter((r) => r.id !== id) }));
    },
  };
}
