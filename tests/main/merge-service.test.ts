import { describe, expect, it } from 'vitest';
import { createMergeService } from '../../src/main/merge/service';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta, ProjectFileError, type ProjectDocument } from '../../src/main/project/project-file';
import { EMPTY_ENTITIES } from '../../src/core/entities/model';
import { EMPTY_WORLD } from '../../src/core/world/layer';
import { quest } from '../core/merge/helpers';

const docOf = (name: string, quests: ReturnType<typeof quest>[] = []): ProjectDocument =>
  ({ ...defaultProjectMeta(name, 'C:\\out'), quests: quests as never, world: EMPTY_WORLD, entities: EMPTY_ENTITIES });

function build(files: Record<string, { doc: ProjectDocument; digest: string }>) {
  const session = createProjectSession(defaultProjectMeta('Mine', 'C:\\out'));
  const opened: ProjectDocument[] = [];
  const written: Array<[string, ProjectDocument]> = [];
  const projects = {
    read: async (p: string) => { const f = files[p]; if (!f) throw new ProjectFileError('unreadable', `Cannot read ${p}`); return f; },
    openDocument: async (d: ProjectDocument) => { opened.push(d); return {} as never; },
    writeCopy: async (p: string, d: ProjectDocument) => { written.push([p, d]); },
  } as never;
  return { service: createMergeService({ projects, session }), session, opened, written, files };
}

describe('merge service', () => {
  it('previews with a fingerprint and the not-carried lines', async () => {
    const { service, session } = build({ 'C:\\t.awe': { doc: docOf('Theirs', [quest(2) as never]), digest: 'd1' }, 'C:\\b.awe': { doc: docOf('Base'), digest: 'd2' } });
    session.quests.put({ ...(quest(1) as any) });
    const r = await service.preview({ theirsPath: 'C:\\t.awe', basePath: 'C:\\b.awe' }, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(r.value.notCarried.at(-1)).toBe('The result is a new unsaved project; none of the three files is changed.');
    expect(r.value.summary.find((s) => s.kind === 'quest')!.total).toBe(2);
  });

  it('counts the result\'s ids outside mine\'s id range', async () => {
    const { service } = build({ 'C:\\t.awe': { doc: docOf('Theirs', [quest(2) as never]), digest: 'd1' } });
    const r = await service.preview({ theirsPath: 'C:\\t.awe', basePath: null }, {});
    if (!r.ok) throw new Error('preview failed');
    expect(r.value.notCarried).toContain('1 ids in the result are outside your id range 60000-99999.');
  });

  it('refuses the same file for two roles, naming it', async () => {
    const f = { doc: docOf('X'), digest: 'd' };
    const { service } = build({ 'C:\\same.awe': f });
    const r = await service.preview({ theirsPath: 'C:\\same.awe', basePath: 'C:\\same.awe' }, {});
    expect(r).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
    expect((r as any).error.message).toContain('C:\\same.awe');
  });

  it('refuses the same file for two roles when the paths are written differently', async () => {
    const f = { doc: docOf('X'), digest: 'd' };
    const { service, session } = build({ '/work/same.awe': f, '/work/sub/../same.awe': f, '/work/./mine.awe': f });
    const r = await service.preview({ theirsPath: '/work/sub/../same.awe', basePath: '/work/same.awe' }, {});
    expect(r).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
    session.markSaved('/work/mine.awe');
    expect(await service.preview({ theirsPath: '/work/./mine.awe', basePath: null }, {})).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
  });

  it.runIf(process.platform === 'win32')('compares paths without case or slash differences on Windows', async () => {
    const f = { doc: docOf('X'), digest: 'd' };
    const { service, session, written } = build({ 'C:/Work/Same.AWE': f, 'C:\\work\\same.awe': f, 'C:\\t.awe': { doc: docOf('Theirs'), digest: 'd1' } });
    expect(await service.preview({ theirsPath: 'C:/Work/Same.AWE', basePath: 'C:\\work\\same.awe' }, {})).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
    session.markSaved('C:\\Mine.awe');
    const files = { theirsPath: 'C:\\t.awe', basePath: null };
    const p = await service.preview(files, {});
    if (!p.ok) throw new Error('preview failed');
    expect(await service.write(files, {}, p.value.fingerprint, 'c:/T.awe')).toMatchObject({ ok: false, error: { message: expect.stringContaining('is one of the merged files') } });
    expect(await service.write(files, {}, p.value.fingerprint, 'c:/mine.AWE')).toMatchObject({ ok: false, error: { message: expect.stringContaining('is one of the merged files') } });
    expect(written).toEqual([]);
  });

  it('refuses to merge the open project\'s own file into it, naming it', async () => {
    const { service, session } = build({ 'C:\\mine.awe': { doc: docOf('Mine'), digest: 'd' } });
    session.markSaved('C:\\mine.awe');
    const r = await service.preview({ theirsPath: 'C:\\mine.awe', basePath: null }, {});
    expect(r).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
    expect((r as any).error.message).toContain('C:\\mine.awe');
  });

  it('names a file that cannot be read', async () => {
    const { service } = build({});
    const r = await service.preview({ theirsPath: 'C:\\gone.awe', basePath: null }, {});
    expect(r).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
    expect((r as any).error.message).toContain('C:\\gone.awe');
  });

  it('applies by opening the merged project, with mine\'s settings', async () => {
    const { service, opened } = build({ 'C:\\t.awe': { doc: docOf('Theirs', [quest(2) as never]), digest: 'd1' } });
    const files = { theirsPath: 'C:\\t.awe', basePath: null };
    const p = await service.preview(files, {});
    if (!p.ok) throw new Error('preview failed');
    const r = await service.apply(files, {}, p.value.fingerprint);
    expect(r).toEqual({ ok: true, value: { opened: true } });
    expect(opened[0]!.name).toBe('Mine');
    expect(opened[0]!.quests.map((q) => q.questId)).toEqual([2]);
  });

  // `CONFLICT` is not an ErrorCode in this repo; the nearest existing code is `BAD_REQUEST`
  it('refuses to apply when a file changed since the preview', async () => {
    const t = { doc: docOf('Theirs'), digest: 'd1' };
    const { service, opened } = build({ 'C:\\t.awe': t });
    const files = { theirsPath: 'C:\\t.awe', basePath: null };
    const p = await service.preview(files, {});
    if (!p.ok) throw new Error('preview failed');
    t.digest = 'changed';
    const r = await service.apply(files, {}, p.value.fingerprint);
    expect(r).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST', message: 'A file changed since the preview. Preview the merge again.' } });
    expect(opened).toEqual([]);
  });

  it('refuses to apply when the open project changed since the preview', async () => {
    const { service, session, opened } = build({ 'C:\\t.awe': { doc: docOf('Theirs'), digest: 'd1' } });
    const files = { theirsPath: 'C:\\t.awe', basePath: null };
    const p = await service.preview(files, {});
    if (!p.ok) throw new Error('preview failed');
    session.quests.put({ ...(quest(1) as any) });
    const r = await service.apply(files, {}, p.value.fingerprint);
    expect(r).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST', message: 'A file changed since the preview. Preview the merge again.' } });
    expect(opened).toEqual([]);
  });

  it('refuses to apply while a conflict has no choice', async () => {
    const base = docOf('Base', [quest(1, 'a') as never]);
    const { service, session, opened } = build({ 'C:\\t.awe': { doc: docOf('Theirs', [quest(1, 'c') as never]), digest: 'd1' }, 'C:\\b.awe': { doc: base, digest: 'd2' } });
    session.quests.put({ ...(quest(1, 'b') as any) });
    const files = { theirsPath: 'C:\\t.awe', basePath: 'C:\\b.awe' };
    const p = await service.preview(files, {});
    if (!p.ok) throw new Error('preview failed');
    expect(p.value.settled).toBe(false);
    const r = await service.apply(files, {}, p.value.fingerprint);
    expect(r).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
    expect((r as any).error.message).toContain('quest|1');
    expect(opened).toEqual([]);
  });

  it('write puts the merged project in the given path and opens nothing', async () => {
    const { service, opened, written } = build({ 'C:\\t.awe': { doc: docOf('Theirs', [quest(2) as never]), digest: 'd1' } });
    const files = { theirsPath: 'C:\\t.awe', basePath: null };
    const p = await service.preview(files, {});
    if (!p.ok) throw new Error('preview failed');
    const r = await service.write(files, {}, p.value.fingerprint, 'C:\\out\\merged.awe');
    expect(r).toEqual({ ok: true, value: { written: 'C:\\out\\merged.awe' } });
    expect(written[0]![0]).toBe('C:\\out\\merged.awe');
    expect(written[0]![1].quests.map((q) => q.questId)).toEqual([2]);
    expect(opened).toEqual([]);
  });

  it('write refuses an input file as the output', async () => {
    const { service, written } = build({ 'C:\\t.awe': { doc: docOf('Theirs'), digest: 'd1' } });
    const files = { theirsPath: 'C:\\t.awe', basePath: null };
    const p = await service.preview(files, {});
    if (!p.ok) throw new Error('preview failed');
    const r = await service.write(files, {}, p.value.fingerprint, 'C:\\t.awe');
    expect(r).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
    expect(written).toEqual([]);
  });

  it('names a newer-version file', async () => {
    const projects = { read: async () => { throw new ProjectFileError('newer-version', 'newer'); } } as never;
    const service = createMergeService({ projects, session: createProjectSession(defaultProjectMeta('Mine', 'C:\\out')) });
    const r = await service.preview({ theirsPath: 'C:\\t.awe', basePath: null }, {});
    expect((r as any).error.message).toBe('C:\\t.awe was saved by a newer version of the editor.');
  });
});
