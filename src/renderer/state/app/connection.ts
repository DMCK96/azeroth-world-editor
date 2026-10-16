import type { QuestSummary } from '@core/db/world-db';
import type { ConnectSummary, ProfileRecord, ProfileSave } from '@shared/ipc';
import { draftToSaves, savedDraft, type ConnectionDraft } from '../../connection/draft';
import type { AppState, SliceArgs } from './types';
import { loadHistory } from './history';

/**
 * A table this user may not read is not a table the fork lacks: one is fixed with a `GRANT`, the
 * other by pointing at a different database, so the two are never reported with the same sentence.
 */
const missingTablesMessage = (tables: string[], forbidden: string[] = []): string => {
  const hidden = tables.filter((t) => forbidden.includes(t));
  const absent = tables.filter((t) => !forbidden.includes(t));
  const parts: string[] = [];
  if (absent.length > 0) parts.push(`This database is missing required tables: ${absent.join(', ')}`);
  if (hidden.length > 0) {
    parts.push(`This database user has no permission to read: ${hidden.join(', ')} (ask for SELECT on them)`);
  }
  return parts.join('. ');
};

/** What a connect to a database with blocking drift shows: the login screen and why. */
function blockedBy(summary: ConnectSummary): Pick<AppState, 'error' | 'screen' | 'summary'> {
  return {
    error: missingTablesMessage(summary.drift.missingTables, summary.drift.forbiddenTables ?? []),
    screen: 'connect',
    summary,
  };
}

function dedupeProfiles(profiles: ProfileRecord[], profile: ProfileRecord): ProfileRecord[] {
  const rest = profiles.filter((p) => p.id !== profile.id);
  return [...rest, profile];
}

/** Connection profiles, connecting, and the quest search */
export interface ConnectionSlice {
  profiles: ProfileRecord[];
  /** The profile launch puts on the login screen (seeded from `.env` in development); null when none. */
  startupProfileId: number | null;
  summary: ConnectSummary | null;
  /** Counts the connections made; the per-connection caches (names, reward tables) start again when it moves. */
  connection: number;
  hasDevProfile: boolean;
  results: QuestSummary[];
  loadProfiles(): Promise<void>;
  /** Launch: lists the saved profiles and which one to offer. Connecting is always the user's click. */
  start(): Promise<void>;
  connect(input: ProfileSave): Promise<void>;
  /** Connects with a saved profile and its stored password. */
  connectProfile(profileId: number): Promise<void>;
  /** Shows a connection the main process made on its own (an AI client, through MCP) as a connect from the window would. */
  adoptConnection(summary: ConnectSummary): Promise<void>;
  /**
   * Saves the draft's rows (world, then dev, then removes a dev row the user removed) and reloads the
   * profiles. A failure part way still returns what was saved (`saved`/`original`, null when
   * nothing was), so a retry updates those rows.
   */
  saveConnection(
    draft: ConnectionDraft,
    original: ConnectionDraft,
  ): Promise<
    | { ok: true; worldId: number; saved: ConnectionDraft }
    | { ok: false; error: string; saved: ConnectionDraft | null; original: ConnectionDraft | null }
  >;
  /**
   * Connects with a saved profile from inside the app. Returns the error to show, or null. A failed
   * connect leaves everything as it was; a database with blocking drift goes to the login screen.
   */
  reconnect(profileId: number): Promise<string | null>;
  /** Asks for the server data folder with the native picker; null when cancelled or it failed. */
  chooseServerDataDir(): Promise<string | null>;
  search(text: string): Promise<void>;
}

export function createConnectionSlice({ api, kit, set, get }: SliceArgs): ConnectionSlice {
  return {
    profiles: [],
    startupProfileId: null,
    summary: null,
    connection: 0,
    hasDevProfile: false,
    results: [],
    async loadProfiles() {
      const result = await api.listProfiles();
      if (result.ok) {
        set({ profiles: result.value, hasDevProfile: result.value.some((p) => p.role === 'dev') });
      }
    },
    async start() {
      if (kit.started) return;
      kit.started = true;
      // Before the profiles, so the login screen fills in with the right one the first time.
      const startup = await api.startupProfile();
      if (startup.ok) set({ startupProfileId: startup.value });
      await get().loadProfiles();
    },
    async connect(input) {
      const saved = await api.saveProfile(input);
      if (!saved.ok) {
        set({ error: saved.error.message, screen: 'connect' });
        return;
      }
      const profile = saved.value;
      set((s) => ({ profiles: dedupeProfiles(s.profiles, profile) }));
      await get().connectProfile(profile.id);
    },
    async connectProfile(profileId) {
      const connected = await api.connect(profileId);
      if (!connected.ok) {
        set({ error: connected.error.message, screen: 'connect' });
        return;
      }
      await get().adoptConnection(connected.value);
    },
    async adoptConnection(summary) {
      if (summary.blocking) {
        set(blockedBy(summary));
        return;
      }
      set((s) => ({ summary, error: null, screen: 'pick', connection: s.connection + 1 }));
      await loadHistory({ api, set });
      await get().loadEntities();
      await get().loadLayer();
      // A different database may hold ids the project uses
      void get().checkIdConflicts();
    },
    async saveConnection(draft, original) {
      const saves = draftToSaves(draft, original);
      const world = await api.saveProfile(saves.world);
      if (!world.ok) return { ok: false, error: world.error.message, saved: null, original: null };
      // From here on the world row is saved: a later failure says so, and hands back the draft with
      // the saved IDs, keeping the original dev row so a retry still removes a replaced one.
      const partly = async (error: string, devRecord: ProfileRecord | null) => {
        const saved = savedDraft(draft, world.value, devRecord);
        const kept = devRecord ? saved.dev : draft.dev;
        await get().loadProfiles();
        return {
          ok: false as const,
          error,
          saved: { world: saved.world, dev: kept },
          original: { world: saved.world, dev: original.dev },
        };
      };
      let devRecord: ProfileRecord | null = null;
      if (saves.dev) {
        const dev = await api.saveProfile(saves.dev);
        if (!dev.ok) return await partly(`The world database was saved, but the dev database was not: ${dev.error.message}`, null);
        devRecord = dev.value;
      }
      if (saves.removeDevId !== null) {
        const removed = await api.deleteProfile(saves.removeDevId);
        if (!removed.ok) {
          return await partly(`The connection was saved, but the old dev database could not be removed: ${removed.error.message}`, devRecord);
        }
      }
      await get().loadProfiles();
      return { ok: true, worldId: world.value.id, saved: savedDraft(draft, world.value, devRecord) };
    },
    async reconnect(profileId) {
      // Pending edits are written first, so switching databases cannot lose one.
      await get().flushAll();
      // An edit that could not be saved would be lost when the quest closes: stay, and say why.
      if (get().dirty) return get().error ?? 'Your last edit could not be saved, so the connection was not changed.';
      const connected = await api.connect(profileId);
      if (!connected.ok) return connected.error.message;
      const summary = connected.value;
      // Nothing read from the old database may outlive it: the open quest and all that came with it.
      const closed = {
        open: null,
        dirty: false,
        links: null,
        openPanel: null,
        issues: [],
        results: [],
        preview: null,
        exportResult: null,
        projectPatch: null,
        exportError: null,
        pendingApply: null,
        appliedCount: null,
      };
      // The session has already switched, so a blocked database leaves the editor for the login screen.
      if (summary.blocking) {
        set({ ...blockedBy(summary), ...closed });
        get().setFocus(null);
        return null;
      }
      set((s) => ({ summary, error: null, screen: 'pick', connection: s.connection + 1, ...closed }));
      get().setFocus(null);
      // The canvas's links, starts and issue counts are read from the database just connected.
      await get().loadNodes();
      await loadHistory({ api, set });
      void get().checkIdConflicts();
      return null;
    },
    async chooseServerDataDir() {
      const chosen = await api.chooseServerDataDir();
      return chosen.ok ? chosen.value : null;
    },
    async search(text) {
      if (text.trim() === '') {
        set({ results: [] });
        return;
      }
      const token = ++kit.searchToken;
      const result = await api.searchQuests(text);
      if (token !== kit.searchToken) return;
      if (result.ok) set({ results: result.value });
      else set({ error: result.error.message });
    },
  };
}
