import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createProjectController, type Dialogs } from '../../src/main/project/controller';
import { createProjectSession } from '../../src/main/project/session';
import { createRecovery } from '../../src/main/project/recovery';
import { defaultProjectMeta, ProjectFileError, serializeProject } from '../../src/main/project/project-file';
import { openStore, type SecretBox } from '../../src/main/store/store';
import { EMPTY_ENTITIES } from '../../src/core/entities/model';
import { EMPTY_WORLD } from '../../src/core/world/layer';
import { memFs } from '../helpers/mem-fs';

const box: SecretBox = { encrypt: (s) => Uint8Array.from(Buffer.from(s)), decrypt: (b) => Buffer.from(b).toString() };
const doc = (name: string) => ({ ...defaultProjectMeta(name, 'C:\\out'), quests: [], world: EMPTY_WORLD, entities: EMPTY_ENTITIES });

function build(answer: 'save' | 'discard' | 'cancel' = 'discard', picked: string | null = null) {
  const session = createProjectSession(defaultProjectMeta('Open', 'C:\\out'));
  const fs = memFs();
  const dialogs: Dialogs = { showSave: async () => null, showOpen: async () => picked, confirmUnsaved: async () => answer };
  const projects = createProjectController({ session, fs, dialogs, recovery: createRecovery({ dir: 'C:\\r', fs, now: () => new Date() }), recent: openStore(':memory:', box).recent, defaultOutputDir: 'C:\\out', now: () => new Date() });
  return { session, fs, projects };
}

describe('controller: merge support', () => {
  it('pickFile returns the chosen path, or null when cancelled', async () => {
    expect(await build('discard', 'C:\\a.awe').projects.pickFile()).toBe('C:\\a.awe');
    expect(await build('discard', null).projects.pickFile()).toBeNull();
  });

  it('read parses the file and gives a digest of its text', async () => {
    const { projects, fs } = build();
    const text = serializeProject(doc('Theirs') as never);
    fs.files.set('C:\\t.awe', text);
    const r = await projects.read('C:\\t.awe');
    expect(r.doc.name).toBe('Theirs');
    expect(r.digest).toBe(createHash('sha256').update(text).digest('hex'));
  });

  it('read refuses a file that is not a project, and does not touch the open project', async () => {
    const { projects, fs, session } = build();
    fs.files.set('C:\\bad.awe', 'nope');
    await expect(projects.read('C:\\bad.awe')).rejects.toBeInstanceOf(ProjectFileError);
    expect(session.meta().name).toBe('Open');
  });

  it('read names a file that cannot be read', async () => {
    const { projects } = build();
    await expect(projects.read('C:\\gone.awe')).rejects.toThrow(/C:\\gone\.awe/);
  });

  it('openDocument loads the document as a new unsaved project', async () => {
    const { projects, session } = build();
    await projects.openDocument(doc('Merged') as never);
    expect(session.meta().name).toBe('Merged');
    expect(session.filePath()).toBeNull();
    expect(session.dirty()).toBe(true);
  });

  it('openDocument leaves the open project alone when the user cancels the unsaved prompt', async () => {
    const { projects, session } = build('cancel');
    session.rename('Edited');
    expect(await projects.openDocument(doc('Merged') as never)).toEqual({ done: false });
    expect(session.meta().name).toBe('Edited');
  });

  it('writeCopy writes a new file and refuses an existing one', async () => {
    const { projects, fs } = build();
    await projects.writeCopy('C:\\new.awe', doc('X') as never);
    expect(fs.files.get('C:\\new.awe')).toBe(serializeProject(doc('X') as never));
    await expect(projects.writeCopy('C:\\new.awe', doc('Y') as never)).rejects.toThrow(/already exists/);
    expect(fs.files.get('C:\\new.awe')).toBe(serializeProject(doc('X') as never));
  });
});
