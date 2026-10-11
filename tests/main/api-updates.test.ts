import { describe, expect, it } from 'vitest';
import { createApi } from '../../src/main/api';
import { openStore } from '../../src/main/store/store';
import { createProjectSession } from '../../src/main/project/session';
import { defaultProjectMeta } from '../../src/main/project/project-file';
import type { ProjectController } from '../../src/main/project/controller';
import { parseRequest } from '../../src/shared/ipc';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };
const deps = (updates?: any) => ({
  store: openStore(':memory:', box), openWorldDb: async () => { throw new Error('x'); }, openDevDb: async () => { throw new Error('x'); },
  fs: { writeFile: async () => {}, ensureDir: async () => {}, listDir: async () => [] }, now: () => new Date(),
  session: createProjectSession(defaultProjectMeta('P', 'C:/out')), projects: {} as ProjectController, updates,
});

describe('the updates API', () => {
  it('forwards each call to the controller and wraps the answer', async () => {
    const calls: string[] = [];
    const offer = { current: '0.6.0', latest: '0.7.0', releaseUrl: 'u', notes: [] };
    const api = createApi(deps({
      check: async () => offer,
      skip: (v: string) => { calls.push(`skip ${v}`); },
      remind: () => { calls.push('remind'); },
      open: async (u: string) => { calls.push(`open ${u}`); },
    }));
    expect(await api.updateCheck()).toEqual({ ok: true, value: offer });
    expect(await api.updateSkip('0.7.0')).toEqual({ ok: true, value: null });
    expect(await api.updateOpen('https://github.com/DMCK96/azeroth-world-editor/releases')).toEqual({ ok: true, value: null });
    expect(await api.updateRemind()).toEqual({ ok: true, value: null });
    expect(calls).toEqual(['skip 0.7.0', 'open https://github.com/DMCK96/azeroth-world-editor/releases', 'remind']);
  });
  it('answers no update, not an error, where the app has no controller', async () => {
    const api = createApi(deps());
    expect(await api.updateCheck()).toEqual({ ok: true, value: null });
    expect((await api.updateSkip('0.7.0')).ok).toBe(false);
    expect((await api.updateOpen('https://github.com/DMCK96/azeroth-world-editor/releases')).ok).toBe(false);
  });
  it('turns a controller refusal into the error the renderer is sent', async () => {
    const api = createApi(deps({ check: async () => null, skip: () => {}, open: async () => { throw new Error('nope'); } }));
    const out = await api.updateOpen('https://evil.example');
    expect(out.ok).toBe(false);
  });
  it('validates the requests that arrive over IPC', () => {
    expect(parseRequest('updateCheck', []).ok).toBe(true);
    expect(parseRequest('updateCheck', ['x']).ok).toBe(false);
    expect(parseRequest('updateRemind', []).ok).toBe(true);
    expect(parseRequest('updateRemind', [1]).ok).toBe(false);
    expect(parseRequest('updateRemind', []).ok).toBe(true);
    expect(parseRequest('updateRemind', [1]).ok).toBe(false);
    expect(parseRequest('updateSkip', ['0.7.0']).ok).toBe(true);
    expect(parseRequest('updateSkip', [7]).ok).toBe(false);
    expect(parseRequest('updateSkip', ['x'.repeat(41)]).ok).toBe(false);
    expect(parseRequest('updateOpen', ['https://github.com/DMCK96/azeroth-world-editor/releases']).ok).toBe(true);
    expect(parseRequest('updateOpen', [null]).ok).toBe(false);
    expect(parseRequest('updateOpen', ['x'.repeat(501)]).ok).toBe(false);
  });
});
