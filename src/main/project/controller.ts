import { createHash } from 'node:crypto';
import type { ProjectActionResult, ProjectState, RecentProject, RecoveryEntry } from '../../shared/ipc';
import type { Store } from '../store/store';
import {
  DEFAULT_PROJECT_NAME,
  InvalidNameError,
  PROJECT_EXTENSION,
  ProjectFileError,
  SaveFailedError,
  defaultProjectMeta,
  parseProject,
  serializeProject,
  writeFileAtomic,
  type ProjectDocument,
  type ProjectFs,
} from './project-file';
import type { Recovery } from './recovery';
import type { ProjectSession } from './session';

export type UnsavedAnswer = 'save' | 'discard' | 'cancel';

/** The native dialogs, injected so the tests can answer them. */
export interface Dialogs {
  /** Returns the chosen path, or null when cancelled. */
  showSave(suggestedFileName: string): Promise<string | null>;
  showOpen(): Promise<string | null>;
  confirmUnsaved(projectName: string): Promise<UnsavedAnswer>;
}

/**
 * Everything the user does with project files: New, Open, Save, Save As, the recent list and
 * restoring after a crash. The session is only ever replaced once the new content is in hand, so a
 * cancelled dialog or an unreadable file leaves the open project exactly as it was.
 */
export interface ProjectController {
  state(): ProjectState;
  /** Asks about unsaved changes if there are any. True when it is fine to move on. */
  settleUnsaved(): Promise<boolean>;
  newProject(name: string): Promise<ProjectActionResult>;
  open(path?: string): Promise<ProjectActionResult>;
  save(): Promise<ProjectActionResult>;
  saveAs(): Promise<ProjectActionResult>;
  rename(name: string): void;
  recent(): Promise<RecentProject[]>;
  forgetRecent(path: string): void;
  recoveries(): Promise<RecoveryEntry[]>;
  restoreRecovery(id: string): Promise<void>;
  discardRecovery(id: string): Promise<void>;
  /** The app is closing and the user settled any unsaved changes: nothing needs recovering. */
  discardOnQuit(): Promise<void>;
  /** The open dialog on its own, for choosing a file to read rather than open; null when cancelled. */
  pickFile(): Promise<string | null>;
  /**
   * Reads a project file without opening it, migrated like an ordinary open; `digest` is the
   * sha-256 hex of the file's text. Throws `ProjectFileError`; the open project is never touched.
   */
  read(path: string): Promise<{ doc: ProjectDocument; digest: string }>;
  /** Asks about unsaved changes, then opens the document as a new project that has never been saved. */
  openDocument(doc: ProjectDocument): Promise<ProjectActionResult>;
  /** Writes the document to a new file; throws when the path already exists, so nothing is overwritten. */
  writeCopy(path: string, doc: ProjectDocument): Promise<void>;
}

// Characters Windows refuses in a file name, plus control characters.
const UNSAFE_FILE_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

export function suggestedFileName(projectName: string): string {
  const name = projectName.trim() === '' ? DEFAULT_PROJECT_NAME : projectName.trim();
  return `${name.replace(UNSAFE_FILE_CHARS, '_')}.${PROJECT_EXTENSION}`;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function createProjectController(deps: {
  session: ProjectSession;
  fs: ProjectFs;
  dialogs: Dialogs;
  recovery: Recovery;
  recent: Store['recent'];
  defaultOutputDir: string;
  now(): Date;
}): ProjectController {
  const { session, fs, dialogs, recovery, recent } = deps;

  async function writeTo(path: string): Promise<ProjectActionResult> {
    try {
      await writeFileAtomic(fs, path, serializeProject(session.toDocument()));
    } catch (error) {
      throw new SaveFailedError(`Could not save the project to ${path}: ${messageOf(error)}`);
    }
    session.markSaved(path);
    await recovery.clear(session.id());
    recent.touch(path, session.meta().name, deps.now());
    return { done: true };
  }

  async function saveAs(): Promise<ProjectActionResult> {
    const path = await dialogs.showSave(suggestedFileName(session.meta().name));
    if (path === null) return { done: false };
    return writeTo(path);
  }

  async function save(): Promise<ProjectActionResult> {
    const path = session.filePath();
    return path === null ? saveAs() : writeTo(path);
  }

  async function settleUnsaved(): Promise<boolean> {
    if (!session.dirty()) return true;
    const answer = await dialogs.confirmUnsaved(session.meta().name);
    if (answer === 'cancel') return false;
    if (answer === 'discard') return true;
    return (await save()).done;
  }

  // One file action at a time: two quick Ctrl+S presses must not race on the same temporary file,
  // and a second Save As dialog must not open over the first.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work, work);
    queue = run.catch(() => undefined);
    return run;
  };

  async function readText(path: string): Promise<string> {
    try {
      return await fs.readFile(path);
    } catch (error) {
      throw new ProjectFileError('unreadable', `Could not read ${path}: ${messageOf(error)}`);
    }
  }

  async function open(given?: string): Promise<ProjectActionResult> {
    if (!(await settleUnsaved())) return { done: false };
    const path = given ?? (await dialogs.showOpen());
    if (path === null) return { done: false };
    const doc = parseProject(await readText(path));
    await replaceWith(() => session.load(doc, path, { dirty: false }));
    recent.touch(path, doc.name, deps.now());
    return doc.migrationWarnings && doc.migrationWarnings.length > 0 ? { done: true, warnings: doc.migrationWarnings } : { done: true };
  }

  /** Swaps in new content, then drops the recovery copy of what was open before. */
  async function replaceWith(swap: () => void): Promise<void> {
    const oldId = session.id();
    swap();
    await recovery.clear(oldId);
  }

  return {
    state: () => ({ ...session.meta(), filePath: session.filePath(), dirty: session.dirty() }),
    settleUnsaved: () => serial(settleUnsaved),
    newProject: (name) =>
      serial(async () => {
        const trimmed = name.trim();
        if (trimmed === '') throw new InvalidNameError('A project needs a name.');
        if (!(await settleUnsaved())) return { done: false };
        await replaceWith(() => session.reset(defaultProjectMeta(trimmed, deps.defaultOutputDir)));
        return { done: true };
      }),
    open: (given) => serial(() => open(given)),
    save: () => serial(save),
    saveAs: () => serial(saveAs),
    rename: (name) => session.rename(name),
    async recent() {
      const entries = recent.list();
      return Promise.all(entries.map(async (e) => ({ ...e, exists: await fs.exists(e.path) })));
    },
    forgetRecent: (path) => recent.forget(path),
    recoveries: () => recovery.list(),
    restoreRecovery: (id) =>
      serial(async () => {
        const { doc, recoveredFrom } = await recovery.read(id);
        await replaceWith(() => session.load(doc, recoveredFrom, { dirty: true }));
        // Write the restored work's own copy before dropping the one it came from, so a second
        // crash straight after restoring still has something to offer.
        await recovery.tick(session);
        await recovery.clear(id);
      }),
    discardRecovery: (id) => recovery.clear(id),
    // The user settled the unsaved changes, so the work is dropped from memory too: nothing is
    // left for a late timer or window blur to write back as a recovery copy.
    discardOnQuit: () =>
      serial(() => replaceWith(() => session.reset(defaultProjectMeta(DEFAULT_PROJECT_NAME, deps.defaultOutputDir)))),
    pickFile: () => dialogs.showOpen(),
    async read(path) {
      const text = await readText(path);
      return { doc: parseProject(text), digest: createHash('sha256').update(text).digest('hex') };
    },
    openDocument: (doc) =>
      serial(async () => {
        if (!(await settleUnsaved())) return { done: false };
        await replaceWith(() => session.load(doc, null, { dirty: true }));
        return { done: true };
      }),
    writeCopy: (path, doc) =>
      serial(async () => {
        if (await fs.exists(path)) throw new SaveFailedError(`${path} already exists`);
        try {
          await writeFileAtomic(fs, path, serializeProject(doc));
        } catch (error) {
          throw new SaveFailedError(`Could not write the project to ${path}: ${messageOf(error)}`);
        }
      }),
  };
}
