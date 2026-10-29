import { describe, expect, it, vi } from 'vitest';
import { createAppStore } from '../../src/renderer/state/app-store';
import { errv, makeMockApi, okv } from './mock-api';

const preview = (over: object = {}) => ({
  twoWay: false, summary: [], dropped: [], decisions: [], entries: [], settled: true, warnings: [], notCarried: [], fingerprint: 'f'.repeat(64), ...over,
});

describe('merge in the store', () => {
  it('opens clean, and closes', () => {
    const store = createAppStore(makeMockApi());
    store.getState().openMerge();
    expect(store.getState().merge).toMatchObject({ open: true, theirsPath: null, basePath: null, preview: null, choices: {} });
    store.getState().closeMerge();
    expect(store.getState().merge.open).toBe(false);
  });

  it('picking theirs asks for a preview once there is a file', async () => {
    const api = makeMockApi({ mergePickFile: vi.fn(async () => okv('C:\\t.awe')), mergePreview: vi.fn(async () => okv(preview())) });
    const store = createAppStore(api);
    store.getState().openMerge();
    await store.getState().pickMergeFile('theirs');
    expect(api.mergePreview).toHaveBeenCalledWith({ theirsPath: 'C:\\t.awe', basePath: null }, {});
    expect(store.getState().merge.preview?.fingerprint).toBe('f'.repeat(64));
  });

  it('a cancelled file dialog changes nothing', async () => {
    const api = makeMockApi({ mergePickFile: vi.fn(async () => okv(null)) });
    const store = createAppStore(api);
    store.getState().openMerge();
    await store.getState().pickMergeFile('theirs');
    expect(store.getState().merge.theirsPath).toBeNull();
    expect(api.mergePreview).not.toHaveBeenCalled();
  });

  it('a base without theirs asks for no preview yet', async () => {
    const api = makeMockApi({ mergePickFile: vi.fn(async () => okv('C:\\b.awe')) });
    const store = createAppStore(api);
    store.getState().openMerge();
    await store.getState().pickMergeFile('base');
    expect(store.getState().merge.basePath).toBe('C:\\b.awe');
    expect(api.mergePreview).not.toHaveBeenCalled();
  });

  it('a choice is kept and the preview is asked for again with it', async () => {
    const api = makeMockApi({ mergePickFile: vi.fn(async () => okv('C:\\t.awe')), mergePreview: vi.fn(async () => okv(preview())) });
    const store = createAppStore(api);
    store.getState().openMerge();
    await store.getState().pickMergeFile('theirs');
    await store.getState().chooseMerge('quest|1', 'theirs');
    expect(store.getState().merge.choices).toEqual({ 'quest|1': 'theirs' });
    expect(api.mergePreview).toHaveBeenLastCalledWith({ theirsPath: 'C:\\t.awe', basePath: null }, { 'quest|1': 'theirs' });
  });

  it('changing a file forgets the choices made for the old one', async () => {
    const api = makeMockApi({ mergePickFile: vi.fn(async () => okv('C:\\t.awe')), mergePreview: vi.fn(async () => okv(preview())) });
    const store = createAppStore(api);
    store.getState().openMerge();
    await store.getState().pickMergeFile('theirs');
    await store.getState().chooseMerge('quest|1', 'mine');
    await store.getState().pickMergeFile('base');
    expect(store.getState().merge.choices).toEqual({});
  });

  it('no base makes the merge two-way and asks again', async () => {
    const api = makeMockApi({ mergePickFile: vi.fn(async () => okv('C:\\t.awe')), mergePreview: vi.fn(async () => okv(preview())) });
    const store = createAppStore(api);
    store.getState().openMerge();
    await store.getState().pickMergeFile('theirs');
    store.setState((s) => ({ merge: { ...s.merge, basePath: 'C:\\b.awe' } }));
    await store.getState().clearMergeBase();
    expect(store.getState().merge.basePath).toBeNull();
    expect(api.mergePreview).toHaveBeenLastCalledWith({ theirsPath: 'C:\\t.awe', basePath: null }, {});
  });

  it('a slow preview cannot overwrite a newer one', async () => {
    let finishFirst: (v: unknown) => void = () => {};
    const first = new Promise((resolve) => { finishFirst = resolve; });
    let calls = 0;
    const api = makeMockApi({
      mergePickFile: vi.fn(async () => okv('C:\\t.awe')),
      mergePreview: vi.fn(() => (++calls === 1 ? first : Promise.resolve(okv(preview({ fingerprint: 'n'.repeat(64) }))))),
    });
    const store = createAppStore(api);
    store.getState().openMerge();
    const slow = store.getState().pickMergeFile('theirs');
    await vi.waitFor(() => expect(api.mergePreview).toHaveBeenCalledTimes(1));
    await store.getState().chooseMerge('quest|1', 'theirs');
    finishFirst(okv(preview({ fingerprint: 'o'.repeat(64) })));
    await slow;
    expect(store.getState().merge.preview?.fingerprint).toBe('n'.repeat(64));
  });

  it('shows the error and keeps no preview when the preview fails', async () => {
    const api = makeMockApi({ mergePickFile: vi.fn(async () => okv('C:\\t.awe')), mergePreview: vi.fn(async () => errv('BAD_REQUEST', 'C:\\t.awe was saved by a newer version of the editor.')) });
    const store = createAppStore(api);
    store.getState().openMerge();
    await store.getState().pickMergeFile('theirs');
    expect(store.getState().merge.preview).toBeNull();
    expect(store.getState().error).toBe('C:\\t.awe was saved by a newer version of the editor.');
  });

  it('a preview that then works takes back the failed one\'s message', async () => {
    let fail = true;
    const api = makeMockApi({
      mergePickFile: vi.fn(async () => okv('C:\\t.awe')),
      mergePreview: vi.fn(async () => (fail ? errv('BAD_REQUEST', 'Unreadable.') : okv(preview()))),
    });
    const store = createAppStore(api);
    store.getState().openMerge();
    await store.getState().pickMergeFile('theirs');
    expect(store.getState().error).toBe('Unreadable.');
    fail = false;
    await store.getState().pickMergeFile('theirs');
    expect(store.getState().error).toBeNull();
    expect(store.getState().merge.preview).not.toBeNull();
  });

  it('apply sends pending edits first, passes the fingerprint, closes, and reloads the project', async () => {
    const order: string[] = [];
    const api = makeMockApi({
      mergePickFile: vi.fn(async () => okv('C:\\t.awe')),
      mergePreview: vi.fn(async () => okv(preview())),
      mergeApply: vi.fn(async () => { order.push('apply'); return okv({ opened: true as const }); }),
    });
    const store = createAppStore(api);
    store.setState({ flushAll: async () => { order.push('flush'); } } as never);
    store.getState().openMerge();
    await store.getState().pickMergeFile('theirs');
    order.length = 0;
    const epoch = store.getState().projectEpoch;
    await store.getState().applyMerge();
    expect(order).toEqual(['flush', 'apply']);
    expect(api.mergeApply).toHaveBeenCalledWith({ theirsPath: 'C:\\t.awe', basePath: null }, {}, 'f'.repeat(64));
    expect(store.getState().merge.open).toBe(false);
    // The merged project is a different project: it is loaded as Open loads one
    expect(store.getState().projectEpoch).toBe(epoch + 1);
    expect(api.listNodes).toHaveBeenCalled();
    expect(api.projectState).toHaveBeenCalled();
  });

  it('a failed apply (or a cancelled unsaved-changes prompt) keeps the dialog open and says why', async () => {
    const api = makeMockApi({
      mergePickFile: vi.fn(async () => okv('C:\\t.awe')),
      mergePreview: vi.fn(async () => okv(preview())),
      mergeApply: vi.fn(async () => errv('BAD_REQUEST', "The merged project was not opened: the open project's unsaved changes were kept.")),
    });
    const store = createAppStore(api);
    store.getState().openMerge();
    await store.getState().pickMergeFile('theirs');
    const epoch = store.getState().projectEpoch;
    await store.getState().applyMerge();
    expect(store.getState().merge.open).toBe(true);
    expect(store.getState().merge.busy).toBe(false);
    expect(store.getState().error).toBe("The merged project was not opened: the open project's unsaved changes were kept.");
    expect(store.getState().projectEpoch).toBe(epoch);
  });

  it('sends pending edits before every preview, so the preview is of mine as it is', async () => {
    const order: string[] = [];
    const api = makeMockApi({ mergePickFile: vi.fn(async () => okv('C:\\t.awe')), mergePreview: vi.fn(async () => { order.push('preview'); return okv(preview()); }) });
    const store = createAppStore(api);
    store.setState({ flushAll: async () => { order.push('flush'); } } as never);
    store.getState().openMerge();
    await store.getState().pickMergeFile('theirs');
    await store.getState().chooseMerge('quest|1', 'mine');
    expect(order).toEqual(['flush', 'preview', 'flush', 'preview']);
  });

  it('a stale apply previews again with the choices kept', async () => {
    let fingerprint = 'f'.repeat(64);
    const api = makeMockApi({
      mergePickFile: vi.fn(async () => okv('C:\\t.awe')),
      mergePreview: vi.fn(async () => okv(preview({ fingerprint }))),
      mergeApply: vi.fn(async () => errv('BAD_REQUEST', 'A file changed since the preview. Preview the merge again.')),
    });
    const store = createAppStore(api);
    store.getState().openMerge();
    await store.getState().pickMergeFile('theirs');
    await store.getState().chooseMerge('quest|1', 'theirs');
    fingerprint = 'n'.repeat(64);
    await store.getState().applyMerge();
    expect(api.mergePreview).toHaveBeenLastCalledWith({ theirsPath: 'C:\\t.awe', basePath: null }, { 'quest|1': 'theirs' });
    expect(store.getState().merge).toMatchObject({ open: true, busy: false, choices: { 'quest|1': 'theirs' } });
    expect(store.getState().merge.preview?.fingerprint).toBe('n'.repeat(64));
    expect(store.getState().error).toMatch(/changed since the preview/);
  });

  it('does not apply while something is unsettled', async () => {
    const api = makeMockApi({ mergePickFile: vi.fn(async () => okv('C:\\t.awe')), mergePreview: vi.fn(async () => okv(preview({ settled: false }))), mergeApply: vi.fn() });
    const store = createAppStore(api);
    store.getState().openMerge();
    await store.getState().pickMergeFile('theirs');
    await store.getState().applyMerge();
    expect(api.mergeApply).not.toHaveBeenCalled();
  });
});
