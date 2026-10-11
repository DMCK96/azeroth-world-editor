import { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, shell } from 'electron';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openMysqlDevDb } from '../core/db/mysql-dev-db';
import { openMysqlWorldDb } from '../core/db/mysql-world-db';
import { CONNECTED_CHANNEL, DEBUG_CHANGED_CHANNEL, DEBUG_REQUEST_CHANNEL, EXTERNAL_CHANGE_CHANNEL, FLUSH_DONE_CHANNEL, FLUSH_REQUEST_CHANNEL, HISTORY_CHANNEL, HOLD_EDITS_CHANNEL } from '../shared/api-methods';
import { describeStep } from './project/step-labels';
import { API_METHODS, channelFor, type Api } from '../shared/ipc';
import { invokeApi } from './api/invoke';
import { waitForFlush } from './wait-for-flush';
import type { McpContext } from './mcp/tool';
import { createMcpController, type McpController } from './mcp/controller';
import { startMcpHttp } from './mcp/http';
import { createMcpServer } from './mcp/server';
import { createMcpSettings } from './mcp/settings';
import { allPrompts } from './mcp/prompts';
import { allTools } from './mcp/tools';
import { createWriteGuard } from './mcp/write-guard';
import { createApi, type ApiDeps } from './api';
import { seedEnvProfiles } from './env-profiles';
import { mapDataFiles, nodeServerDataFiles } from './server-data';
import { createGameClient, nodeClientFs, type GameClient } from './game-client';
import { ASSET_SCHEME, parseAssetUrl } from '../core/client/asset-url';
import { createSecretBox } from './secret-box';
import { moveProfileFromOldName } from './profile-move';
import { openStore, type Store } from './store/store';
import { DEFAULT_PROJECT_NAME, PROJECT_EXTENSIONS, defaultProjectMeta } from './project/project-file';
import { createProjectSession, type ProjectSession } from './project/session';
import { createProjectController, type Dialogs, type ProjectController } from './project/controller';
import { createCloseGuard, windowTitle } from './project/close-guard';
import { createRecovery, type Recovery } from './project/recovery';
import { nodeProjectFs } from './project/node-fs';
import { createDebugController, type DebugController, type DebugWindowPort } from './debug/controller';
import { createLogFiles } from './debug/log-file';
import { createMainTaps, dialogNote } from './debug/main-taps';
import { createDebugRecorder } from './debug/recorder';
import { createRendererLink } from './debug/renderer-link';
import { createDebugSettings } from './debug/settings';
import { createUpdateController, type UpdateController } from './updates/controller';
import { wantsFakeUpdate } from './updates/flags';
import { createUpdateSettings } from './updates/settings';

/**
 * The Electron shell: it owns the window, the SQLite store and the IPC surface, and nothing else.
 * All behaviour lives in `createApi`, which is why this file has no logic worth testing beyond the
 * wiring below.
 */

const STORE_FILE = 'quest-creator.sqlite';

/**
 * Where the native dialogs report themselves to the Debug mode timeline. The dialogs below are defined
 * before the controller exists, so they reach it through this holder, assigned once it is made.
 */
let debugNote: (category: string, name: string, data?: Record<string, unknown>) => void = () => {};
const noted = <T>(kind: string, work: () => Promise<T>): Promise<T> => dialogNote((c, n, d) => debugNote(c, n, d), kind, work);

/** The window a dialog or a probe belongs to: the first one still open */
const liveWindow = (): BrowserWindow | null => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ?? null;

/**
 * Test isolation. An end-to-end run points the app at a throwaway profile directory and patch
 * folder so it never touches the user's real store or writes into the fork's checkout. `setPath`
 * has to happen before the app is ready, which is why it runs at import time.
 */
const userDataOverride = process.env['ACQC_USER_DATA'];
if (userDataOverride) app.setPath('userData', userDataOverride);
else moveProfileFromOldName(app.getPath('appData'), app.getPath('userData'));

/**
 * An unpackaged app (`npm run dev`, or `electron out/main/index.js` as Playwright launches it) reads
 * the repo's `.env` (see `.env.example`), so the connection details need not be typed on every
 * launch. `ACQC_ENV_FILE` points at another file, or is `none` to read nothing, which is how the
 * end-to-end test keeps the connection form in front of it. Variables already set in the shell win.
 */
const envFile = process.env['ACQC_ENV_FILE'] ?? (app.isPackaged ? 'none' : join(__dirname, '..', '..', '.env'));
if (envFile !== 'none' && existsSync(envFile)) process.loadEnvFile(envFile);

/** Where patches go when the connection names no export folder (Settings → Export folder). */
const defaultOutputDir = (): string => join(app.getPath('documents'), 'Azeroth World Editor', 'sql');

/**
 * Drizzle's migration files. In development they sit in the repo, two levels above this bundle
 * (`out/main/index.js`); a packaged build carries them as an unpacked extra resource, because they
 * are read at runtime and cannot live inside the asar. This is deliberately not `app.getAppPath()`:
 * when Electron is handed a script path (`electron out/main/index.js`, which is how Playwright
 * launches it) that is the script's own directory, not the project root.
 */
const migrationsFolder = (): string =>
  app.isPackaged ? join(process.resourcesPath, 'drizzle') : join(__dirname, '..', '..', 'drizzle');

// The scheme must be known before `ready`. The 3D view reads the game client's files through `awe-wow`; its loaders run in workers, which need CORS.
protocol.registerSchemesAsPrivileged([
  { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

/** Serves `awe-wow://file/<client path>` from the game client's archives; a missing file is a 404. */
function registerClientFiles(client: GameClient): void {
  const missing = new Set<string>();
  protocol.handle(ASSET_SCHEME, async (request) => {
    const path = parseAssetUrl(request.url);
    const bytes = path ? await client.file(path) : null;
    if (!bytes) {
      // Once per file: the 3D view asks for the same missing one on every frame it is short of it.
      if (!missing.has(request.url)) {
        missing.add(request.url);
        console.warn(`[3D view] the game client has no file ${path ?? request.url}`);
      }
      return new Response(null, { status: 404, headers: { 'access-control-allow-origin': '*' } });
    }
    return new Response(bytes, { headers: { 'content-type': 'application/octet-stream', 'access-control-allow-origin': '*' } });
  });
}

function buildDeps(
  store: Store,
  session: ProjectSession,
  projects: ProjectController,
  startupProfileId: number | null,
  client: GameClient,
  mcp: McpController,
  debug: DebugController,
  updates: UpdateController,
): ApiDeps {
  return {
    store,
    mcp,
    debug,
    updates,
    fetch: globalThis.fetch,
    onClientDir: (dir) => client.setDir(dir),
    clientStatus: () => client.status(),
    clientFile: (path) => client.file(path),
    // Tests point exports at a scratch folder whatever the connection says.
    exportDirOverride: process.env['ACQC_OUTPUT_DIR'] || null,
    defaultExportDir: defaultOutputDir(),
    session,
    projects,
    startupProfileId,
    openWorldDb: (p) => openMysqlWorldDb(p),
    openDevDb: (p) => openMysqlDevDb(p),
    fs: {
      writeFile: (path, text) => writeFile(path, text, 'utf8'),
      ensureDir: async (path) => {
        await mkdir(path, { recursive: true });
      },
      listDir: (path) => readdir(path),
    },
    now: () => new Date(),
    serverDataFiles: nodeServerDataFiles,
    mapDataFiles,
    chooseDirectory: () =>
      noted('choose-folder', async () => {
        const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
        const options = { title: 'Choose a folder', properties: ['openDirectory' as const] };
        const r = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
        return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]!;
      }),
  };
}

/**
 * One handler per API method. Arguments are validated before the API sees them and nothing is ever
 * allowed to reject: an exception crossing IPC would reach the renderer as an opaque `Error`, so
 * every failure comes back as an ordinary `Result`.
 */
function registerIpc(api: Api): void {
  for (const method of API_METHODS) {
    ipcMain.handle(channelFor(method), (_event, ...args: unknown[]) => invokeApi(api, method, args));
  }
}

/** Recovery copies are written this often while there are unsaved changes (the e2e test shortens it). */
const recoveryIntervalMs = (): number => Number(process.env['ACQC_RECOVERY_INTERVAL_MS']) || 30000;

const PROJECT_FILTERS = [{ name: 'Azeroth World Editor project', extensions: [...PROJECT_EXTENSIONS] }];

/**
 * The native dialogs, parented to whichever window is focused. `dialog.*` is looked up on every
 * call rather than destructured, so the end-to-end test can answer them through `app.evaluate`.
 */
const electronDialogs: Dialogs = {
  showSave: (suggestedFileName) =>
    noted('save-project', async () => {
      const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const options = { defaultPath: join(app.getPath('documents'), suggestedFileName), filters: PROJECT_FILTERS };
      const r = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
      return r.canceled || !r.filePath ? null : r.filePath;
    }),
  showOpen: () =>
    noted('open-project', async () => {
      const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const options = { properties: ['openFile' as const], filters: PROJECT_FILTERS };
      const r = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
      return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]!;
    }),
  confirmUnsaved: (name) =>
    noted('confirm-unsaved', async () => {
      const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const options = {
        type: 'warning' as const,
        buttons: ['Save', "Don't Save", 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        message: `Save changes to "${name}"?`,
        detail: "Your changes will be lost if you don't save them.",
      };
      const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
      return response === 0 ? 'save' : response === 1 ? 'discard' : 'cancel';
    }),
};

/** Asks a window to hand over any edit it still holds back, and waits until it has (or the timeout, when given). */
const requestFlush = (win: BrowserWindow, timeoutMs?: number): Promise<void> =>
  waitForFlush({
    listen: (done) => {
      ipcMain.once(FLUSH_DONE_CHANNEL, done);
      return () => void ipcMain.removeListener(FLUSH_DONE_CHANNEL, done);
    },
    send: () => win.webContents.send(FLUSH_REQUEST_CHANNEL),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });

function createWindow(session: ProjectSession, recovery: Recovery, projects: ProjectController, debug: DebugController): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 880,
    // Smaller than this the quest editor and the 3D view's panels no longer fit beside each other
    minWidth: 720,
    minHeight: 500,
    show: false,
    title: 'Azeroth World Editor',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.on('ready-to-show', () => win.show());

  // No File/Edit/View bar: the app bar carries its own commands. Removing the menu also drops its
  // shortcuts, so unpackaged builds get DevTools and reload back by hand.
  win.removeMenu();
  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const key = input.key.toLowerCase();
      if (input.key === 'F12' || (input.control && input.shift && key === 'i')) {
        win.webContents.toggleDevTools();
        event.preventDefault();
      } else if (input.control && key === 'r') {
        win.webContents.reload();
        event.preventDefault();
      }
    });
  }

  // The title carries the project name and the unsaved marker, so the page's own <title> is ignored.
  const showTitle = (): void => win.setTitle(windowTitle(session.meta().name, session.dirty()));
  win.on('page-title-updated', (event) => event.preventDefault());
  showTitle();
  const stopTitle = session.onChange(showTitle);
  // The window's Undo buttons and History list follow every step, whatever made it
  const stopHistory = session.history.onChange(() => {
    if (!win.isDestroyed()) win.webContents.send(HISTORY_CHANNEL, session.history.list(describeStep));
  });

  const tick = (): void => {
    recovery.tick(session).catch((error: unknown) => console.error('Could not write the recovery copy:', error));
  };
  const timer = setInterval(tick, recoveryIntervalMs());
  win.on('blur', tick);

  const guard = createCloseGuard({
    flush: () => requestFlush(win),
    projects,
    onError: (message) => dialog.showErrorBox('The project was not saved', message),
  });
  let closing = false;
  win.on('close', (event) => {
    if (closing) return;
    event.preventDefault();
    void guard().then((mayClose) => {
      if (!mayClose) return;
      closing = true;
      win.close();
    });
  });
  // Debug mode: what only this process sees, recorded while the switch is on
  const taps = createMainTaps({ note: debug.note, win, contents: win.webContents, app });
  const stopDebug = debug.onChange((on) => (on ? taps.attach() : taps.detach()));
  if (debug.status().enabled) taps.attach();
  win.on('closed', () => {
    clearInterval(timer);
    stopTitle();
    stopHistory();
    taps.detach();
    stopDebug();
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

void app.whenReady().then(() => {
  // `safeStorage` is only usable once the app is ready, so the store opens here and not at import.
  const store = openStore(join(app.getPath('userData'), STORE_FILE), createSecretBox(safeStorage), migrationsFolder());
  app.on('will-quit', () => store.close());
  let startupProfileId: number | null = null;
  try {
    startupProfileId = seedEnvProfiles(store, process.env);
  } catch (error) {
    // A bad `.env` must not stop the app opening: the connection screen is still there.
    console.error('Ignoring connection settings from the environment:', error);
  }
  const session = createProjectSession(defaultProjectMeta(DEFAULT_PROJECT_NAME, defaultOutputDir()));
  const recovery = createRecovery({ dir: join(app.getPath('userData'), 'recovery'), fs: nodeProjectFs, now: () => new Date() });
  const projects = createProjectController({
    session,
    fs: nodeProjectFs,
    dialogs: electronDialogs,
    recovery,
    recent: store.recent,
    defaultOutputDir: defaultOutputDir(),
    now: () => new Date(),
  });
  const client = createGameClient({ fs: nodeClientFs, log: (m) => console.warn(`Game client: ${m}`) });
  registerClientFiles(client);

  // The MCP server (off unless the user turns it on in Settings) drives the same API the window does.
  let api: Api | null = null;
  const writeGuard = createWriteGuard();
  const mcpContext: McpContext = {
    get api() {
      return api!;
    },
    session,
    call: ((method: keyof Api, ...args: unknown[]) => invokeApi(api!, method, args)) as McpContext['call'],
    flush() {
      const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
      // The write guard stops waiting at 5 s; this clears the listener just after
      return win ? requestFlush(win, 6000) : Promise.resolve();
    },
    holdEdits(held) {
      for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(HOLD_EDITS_CHANNEL, held);
    },
    notifyConnected(summary) {
      for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(CONNECTED_CHANNEL, summary);
    },
    notify(change) {
      for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(EXTERNAL_CHANGE_CHANNEL, change);
    },
  };
  const mcp = createMcpController({
    settings: createMcpSettings(store),
    listen: ({ port, token }) => startMcpHttp({ port, token, createServer: () => createMcpServer(mcpContext, allTools, writeGuard, allPrompts) }),
  });
  // Debug mode (off unless the user turns it on in Preferences): a timeline of both processes, and probes of the live window.
  const debugPort: DebugWindowPort = {
    state() {
      const w = liveWindow();
      return w ? { focused: w.isFocused(), contentsFocused: w.webContents.isFocused(), visible: w.isVisible(), minimized: w.isMinimized() } : null;
    },
    async capture({ rect, maxWidth }) {
      const w = liveWindow();
      if (!w || !w.isVisible() || w.isMinimized()) return null;
      const taken = await w.webContents.capturePage(rect);
      const image = taken.getSize().width > maxWidth ? taken.resize({ width: maxWidth }) : taken;
      const { width, height } = image.getSize();
      return { data: image.toPNG().toString('base64'), width, height };
    },
    async sendText(text) {
      const w = liveWindow();
      if (!w) return;
      for (const keyCode of text) {
        w.webContents.sendInputEvent({ type: 'keyDown', keyCode });
        w.webContents.sendInputEvent({ type: 'char', keyCode });
        w.webContents.sendInputEvent({ type: 'keyUp', keyCode });
      }
    },
    announce(enabled) {
      for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(DEBUG_CHANGED_CHANNEL, enabled);
    },
  };
  const debug = createDebugController({
    settings: createDebugSettings(store),
    recorder: createDebugRecorder({ now: () => performance.timeOrigin + performance.now() }),
    logs: createLogFiles({
      dir: join(app.getPath('userData'), 'logs'),
      fs: {
        mkdir: async (path) => void (await mkdir(path, { recursive: true })),
        readdir: (path) => readdir(path),
        rm: (path) => rm(path, { force: true }),
        append: (path, text) => appendFile(path, text, 'utf8'),
      },
      now: () => new Date(),
    }),
    window: debugPort,
    link: createRendererLink({
      send(request) {
        const w = liveWindow();
        if (!w) return false;
        w.webContents.send(DEBUG_REQUEST_CHANNEL, request);
        return true;
      },
    }),
  });
  debugNote = debug.note;

  // Unpackaged builds never check, so development does not nag; AWE_UPDATE_CHECK=1 forces it for a manual try.
  // `net.fetch` goes through Chromium's network stack, so it follows the system proxy that Node's fetch ignores.
  const updates = createUpdateController({
    fetch: (url, init) => net.fetch(url, init),
    settings: createUpdateSettings(store),
    version: app.getVersion(),
    enabled: app.isPackaged || process.env['AWE_UPDATE_CHECK'] === '1',
    // --fake-update (or AWE_FAKE_UPDATE=1) offers a made-up update, to try the dialog without a release to find.
    fake: wantsFakeUpdate(process.env, process.argv),
    openExternal: (url) => shell.openExternal(url),
    warn: (message) => console.warn(`Updates: ${message}`),
  });

  api = createApi(buildDeps(store, session, projects, startupProfileId, client, mcp, debug, updates));
  registerIpc(api);
  app.on('will-quit', () => void mcp.stop());
  app.on('will-quit', () => void debug.stop());

  createWindow(session, recovery, projects, debug);
  mcp.start().catch((error: unknown) => console.error('Could not start the MCP server:', error));
  debug.start().catch((error: unknown) => console.error('Could not start Debug mode:', error));
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(session, recovery, projects, debug);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
