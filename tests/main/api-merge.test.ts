import { describe, expect, it, vi } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import { parseRequest } from '../../src/shared/ipc';
import { EMPTY_ENTITIES } from '../../src/core/entities/model';
import { EMPTY_WORLD } from '../../src/core/world/layer';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };
const theirs = { ...defaultProjectMeta('Theirs', 'C:\\out'), quests: [], world: EMPTY_WORLD, entities: EMPTY_ENTITIES };

function build() {
  const session = createProjectSession(defaultProjectMeta('Mine', 'C:\\out'));
  const projects = {
    pickFile: vi.fn(async () => 'C:\\t.awe'),
    read: vi.fn(async () => ({ doc: theirs, digest: 'd' })),
    openDocument: vi.fn(async () => ({})),
    writeCopy: vi.fn(async () => {}),
  } as never;
  const api = createApi({ store: openStore(':memory:', box), openWorldDb: async () => { throw new Error('x'); }, openDevDb: async () => { throw new Error('x'); },
    fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date('2026-10-29T00:00:00Z'), session, projects });
  return { api, projects };
}

describe('merge api', () => {
  it('picks a file through the controller', async () => {
    expect(await build().api.mergePickFile()).toEqual({ ok: true, value: 'C:\\t.awe' });
  });
  it('previews, then applies with the fingerprint it was given', async () => {
    const { api, projects } = build();
    const files = { theirsPath: 'C:\\t.awe', basePath: null };
    const p: any = await api.mergePreview(files, {});
    expect(p.ok).toBe(true);
    const a: any = await api.mergeApply(files, {}, p.value.fingerprint);
    expect(a).toEqual({ ok: true, value: { opened: true } });
    expect((projects as any).openDocument).toHaveBeenCalledOnce();
  });
  it('writes to the output path with the fingerprint it was given', async () => {
    const { api, projects } = build();
    const files = { theirsPath: 'C:\\t.awe', basePath: null };
    const p: any = await api.mergePreview(files, {});
    const w: any = await api.mergeWrite(files, {}, p.value.fingerprint, 'C:\\out\\m.awe');
    expect(w).toEqual({ ok: true, value: { written: 'C:\\out\\m.awe' } });
    expect((projects as any).writeCopy).toHaveBeenCalledOnce();
    expect((projects as any).openDocument).not.toHaveBeenCalled();
  });
  // parseRequest returns `{ ok }` rather than throwing
  it('validates its arguments like every other call', () => {
    expect(parseRequest('mergePickFile', []).ok).toBe(true);
    expect(parseRequest('mergePreview', [{ theirsPath: '', basePath: null }, {}]).ok).toBe(false);
    expect(parseRequest('mergePreview', [{ theirsPath: 'C:\\t.awe', basePath: null }, { 'quest|1': 'nope' }]).ok).toBe(false);
    expect(parseRequest('mergePreview', [{ theirsPath: 'C:\\t.awe', basePath: null }, { 'quest|1': 'mine' }]).ok).toBe(true);
    expect(parseRequest('mergeApply', [{ theirsPath: 'C:\\t.awe', basePath: null }, {}, 'short']).ok).toBe(false);
    expect(parseRequest('mergeApply', [{ theirsPath: 'C:\\t.awe', basePath: null }, {}, 'a'.repeat(64)]).ok).toBe(true);
    expect(parseRequest('mergeWrite', [{ theirsPath: 'C:\\t.awe', basePath: null }, {}, 'a'.repeat(64), '']).ok).toBe(false);
    expect(parseRequest('mergeWrite', [{ theirsPath: 'C:\\t.awe', basePath: null }, {}, 'a'.repeat(64), 'C:\\o.awe']).ok).toBe(true);
  });
});
