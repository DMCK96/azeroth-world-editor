import { createHash } from 'node:crypto';
import { applyMerge, notCarriedOver, previewMerge, UnsettledConflictError, type Choices, type MergeDocument } from '../../core/merge';
import { groupsOf } from '../../core/world/layer';
import type { MergeFiles, MergePreviewResult, Result } from '../../shared/ipc';
import { fail, run } from '../api/errors';
import type { ProjectController } from '../project/controller';
import { ProjectFileError, type ProjectDocument } from '../project/project-file';
import type { ProjectSession } from '../project/session';

/** The controller calls the merge reads and writes through */
export type MergeProjects = Pick<ProjectController, 'read' | 'openDocument' | 'writeCopy'>;

export interface MergeService {
  preview(files: MergeFiles, choices: Choices): Promise<Result<MergePreviewResult>>;
  apply(files: MergeFiles, choices: Choices, fingerprint: string): Promise<Result<{ opened: true }>>;
  write(files: MergeFiles, choices: Choices, fingerprint: string, outputPath: string): Promise<Result<{ written: string }>>;
}

/** The three documents of one merge, and the fingerprint of the inputs they were read from */
interface Inputs {
  mine: ProjectDocument;
  theirs: ProjectDocument;
  base: ProjectDocument | null;
  fingerprint: string;
}

const STALE = 'A file changed since the preview. Preview the merge again.';

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** Every numeric id the merged project holds that comes from the user's id range: quests, new entities and spawn groups */
function idsOf(doc: MergeDocument): number[] {
  const { npcs, objects, items } = doc.entities;
  return [
    ...doc.quests.map((q) => q.questId),
    ...[...npcs, ...objects, ...items].map((e) => e.entry),
    ...groupsOf(doc.world).map((g) => g.id),
  ];
}

/**
 * Merges another project file, and optionally the base both started from, into the open project.
 * Stateless: every call reads the files again, and apply and write refuse when the inputs no longer
 * match the preview's fingerprint. Nothing here writes the world database or any input file.
 */
export function createMergeService(deps: { projects: MergeProjects; session: ProjectSession }): MergeService {
  const { projects, session } = deps;

  /** One file, with a read failure turned into a message that names it */
  async function readFile(path: string): Promise<{ doc: ProjectDocument; digest: string }> {
    try {
      return await projects.read(path);
    } catch (error) {
      if (!(error instanceof ProjectFileError)) throw error;
      if (error.reason === 'newer-version') throw fail('BAD_REQUEST', `${path} was saved by a newer version of the editor.`);
      throw fail('BAD_REQUEST', `${path}: ${error.message}`);
    }
  }

  async function load(files: MergeFiles): Promise<Inputs> {
    const { theirsPath, basePath } = files;
    if (theirsPath === basePath) throw fail('BAD_REQUEST', `${theirsPath} is chosen as both theirs and the base. Choose two different files.`);
    // Merging the open project's own file into it would only compare the open project with its last save
    if (theirsPath === session.filePath()) throw fail('BAD_REQUEST', `${theirsPath} is the open project's own file. Choose another project to merge.`);
    // Read together with the open project's state, so nothing can change between them
    const [theirs, base] = await Promise.all([readFile(theirsPath), basePath === null ? Promise.resolve(null) : readFile(basePath)]);
    const revision = session.revision();
    const { migrationWarnings: _warnings, ...mine } = session.toDocument();
    // The open project has no file digest; its session id and revision say whether it is the one that was previewed
    const fingerprint = sha256(`${revision}|${session.id()}|${theirs.digest}|${base?.digest ?? ''}`);
    return { mine, theirs: theirs.doc, base: base?.doc ?? null, fingerprint };
  }

  /** The merged project, with mine's settings; refuses stale inputs and an unsettled conflict */
  async function merged(files: MergeFiles, choices: Choices, fingerprint: string): Promise<ProjectDocument> {
    const inputs = await load(files);
    if (inputs.fingerprint !== fingerprint) throw fail('BAD_REQUEST', STALE);
    let result: MergeDocument;
    try {
      result = applyMerge({ base: inputs.base, mine: inputs.mine, theirs: inputs.theirs }, choices);
    } catch (error) {
      if (error instanceof UnsettledConflictError) throw fail('BAD_REQUEST', error.message);
      throw error;
    }
    const { name, idRangeStart, idRangeEnd, outputDir, viewport } = inputs.mine;
    return { name, idRangeStart, idRangeEnd, outputDir, viewport, quests: result.quests, world: result.world, entities: result.entities };
  }

  return {
    preview: (files, choices) =>
      run(async () => {
        const { mine, theirs, base, fingerprint } = await load(files);
        const preview = previewMerge({ base, mine, theirs }, choices);
        // The ids are the ones the result would hold; an unsettled conflict counts as mine, as in the preview
        let ids: number[];
        try {
          ids = idsOf(applyMerge({ base, mine, theirs }, choices));
        } catch (error) {
          if (!(error instanceof UnsettledConflictError)) throw error;
          // Only the unsettled ids are overridden: a choice given for one of them is not one of its options
          ids = idsOf(applyMerge({ base, mine, theirs }, { ...choices, ...Object.fromEntries(error.decisionIds.map((id) => [id, 'mine' as const])) }));
        }
        const notCarried = notCarriedOver(mine, theirs, base, ids);
        return { ...preview, notCarried, fingerprint };
      }),

    apply: (files, choices, fingerprint) =>
      run(async () => {
        const doc = await merged(files, choices, fingerprint);
        const opened = await projects.openDocument(doc);
        if (opened.done === false) throw fail('BAD_REQUEST', 'The merged project was not opened: the open project\'s unsaved changes were kept.');
        return { opened: true as const };
      }),

    write: (files, choices, fingerprint, outputPath) =>
      run(async () => {
        const inputsPaths = [files.theirsPath, files.basePath, session.filePath()];
        if (inputsPaths.includes(outputPath)) throw fail('BAD_REQUEST', `${outputPath} is one of the merged files. Choose a new file for the result.`);
        const doc = await merged(files, choices, fingerprint);
        await projects.writeCopy(outputPath, doc);
        return { written: outputPath };
      }),
  };
}
