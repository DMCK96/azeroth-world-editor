import { describe, expect, it, vi } from 'vitest';
import { createAppStore } from '../../src/renderer/state/app-store';
import { errv, makeMockApi, okv } from './mock-api';

const conflict = {
  kind: 'spawn-guid', noun: 'spawn', scope: 'creature', scopeLabel: 'NPC spawn', id: 5300700,
  mine: { entry: 11000230, name: 'Amalgam', map: 0, x: 10, y: 20, z: 30 },
  database: { entry: 1423, name: 'Stormwind Guard', map: 0, x: -9481, y: 74, z: 56 },
};

describe('id conflicts in the store', () => {
  it('keeps what the check found', async () => {
    const api = makeMockApi({ idConflicts: vi.fn(async () => okv([conflict])) });
    const store = createAppStore(api);
    await store.getState().checkIdConflicts();
    expect(store.getState().idConflicts).toEqual([conflict]);
  });

  it('shows nothing, and no error, when the check fails', async () => {
    const api = makeMockApi({ idConflicts: vi.fn(async () => errv('NOT_CONNECTED', 'Connect first')) });
    const store = createAppStore(api);
    store.setState({ idConflicts: [conflict] });
    await store.getState().checkIdConflicts();
    expect(store.getState().idConflicts).toEqual([]);
    expect(store.getState().error).toBeNull();
  });

  it('Leave as is clears the list and changes nothing', () => {
    const api = makeMockApi();
    const store = createAppStore(api);
    store.setState({ idConflicts: [conflict] });
    store.getState().dismissIdConflicts();
    expect(store.getState().idConflicts).toEqual([]);
    expect(api.resolveIdConflicts).not.toHaveBeenCalled();
  });

  it('Renumber calls the API, clears the list and reloads what changed', async () => {
    const api = makeMockApi({ resolveIdConflicts: vi.fn(async () => okv({ renamed: 1 })) });
    const store = createAppStore(api);
    store.setState({ idConflicts: [conflict] });
    await store.getState().resolveIdConflicts();
    expect(api.resolveIdConflicts).toHaveBeenCalledTimes(1);
    expect(store.getState().idConflicts).toEqual([]);
    expect(api.projectEntities).toHaveBeenCalled();
    expect(api.worldLayer).toHaveBeenCalled();
    expect(api.projectState).toHaveBeenCalled();
  });

  it('keeps the list and says why when the renumber fails', async () => {
    const api = makeMockApi({ resolveIdConflicts: vi.fn(async () => errv('BAD_REQUEST', 'Could not renumber')) });
    const store = createAppStore(api);
    store.setState({ idConflicts: [conflict] });
    await store.getState().resolveIdConflicts();
    expect(store.getState().idConflicts).toEqual([conflict]);
    expect(store.getState().error).toBe('Could not renumber');
  });
});

describe('a check that finishes late', () => {
  /** An `idConflicts` whose answers are given by hand, in the order the checks were asked */
  function slowChecks() {
    const asked: ((value: unknown) => void)[] = [];
    const idConflicts = vi.fn(() => new Promise((resolve) => { asked.push(resolve); }));
    return { idConflicts, answer: (i: number, list: unknown[]) => asked[i]!(okv(list)) };
  }

  it('does not replace the answer to a newer check', async () => {
    const { idConflicts, answer } = slowChecks();
    const store = createAppStore(makeMockApi({ idConflicts }));
    const older = store.getState().checkIdConflicts();
    const newer = store.getState().checkIdConflicts();
    answer(1, []);
    await newer;
    answer(0, [conflict]);
    await older;
    expect(store.getState().idConflicts).toEqual([]);
  });

  it('does not bring the dialog back after Leave as is', async () => {
    const { idConflicts, answer } = slowChecks();
    const store = createAppStore(makeMockApi({ idConflicts }));
    const pending = store.getState().checkIdConflicts();
    store.getState().dismissIdConflicts();
    answer(0, [conflict]);
    await pending;
    expect(store.getState().idConflicts).toEqual([]);
  });

  it('does not bring the dialog back after Renumber', async () => {
    const { idConflicts, answer } = slowChecks();
    const store = createAppStore(makeMockApi({ idConflicts, resolveIdConflicts: vi.fn(async () => okv({ renamed: 1 })) }));
    const pending = store.getState().checkIdConflicts();
    await store.getState().resolveIdConflicts();
    answer(0, [conflict]);
    await pending;
    expect(store.getState().idConflicts).toEqual([]);
  });
});

describe('Renumber with an edit still waiting to be sent', () => {
  it('sends it first, so the renumber does not overwrite it', async () => {
    const api = makeMockApi({ resolveIdConflicts: vi.fn(async () => okv({ renamed: 1 })) });
    const store = createAppStore(api);
    const flushAll = vi.fn(async () => {});
    store.setState({ idConflicts: [conflict], flushAll });
    await store.getState().resolveIdConflicts();
    expect(flushAll).toHaveBeenCalledTimes(1);
    expect(flushAll.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(api.resolveIdConflicts).mock.invocationCallOrder[0]!);
  });
});

describe('a check that cannot run', () => {
  it('leaves a trace in the console', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createAppStore(makeMockApi({ idConflicts: vi.fn(async () => errv('QUERY', 'boom')) }));
    await store.getState().checkIdConflicts();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('id check'), 'boom');
    warn.mockRestore();
  });
});

describe('when the id check runs', () => {
  const summary = { profileId: 1, schemaHash: 'h', drift: { missingTables: [], unregistered: [], missingColumns: [], typeMismatches: [] }, blocking: false };

  it('after a database connects', async () => {
    const api = makeMockApi({ idConflicts: vi.fn(async () => okv([conflict])) });
    const store = createAppStore(api);
    await store.getState().adoptConnection(summary as never);
    await vi.waitFor(() => expect(store.getState().idConflicts).toEqual([conflict]));
  });

  it('not when the connection is blocked', async () => {
    const api = makeMockApi();
    const store = createAppStore(api);
    await store.getState().adoptConnection({ ...summary, blocking: true, blockingTables: ['quest_template'], forbiddenTables: [] } as never);
    expect(api.idConflicts).not.toHaveBeenCalled();
  });

  it('after the project is switched by Open', async () => {
    const api = makeMockApi({ openProject: vi.fn(async () => okv({ done: true })), idConflicts: vi.fn(async () => okv([conflict])) });
    const store = createAppStore(api);
    await store.getState().openProject('C:\\w\\n.aqc');
    await vi.waitFor(() => expect(store.getState().idConflicts).toEqual([conflict]));
  });

  it('not when Open was cancelled', async () => {
    const api = makeMockApi({ openProject: vi.fn(async () => okv({ done: false })) });
    const store = createAppStore(api);
    await store.getState().openProject();
    expect(api.idConflicts).not.toHaveBeenCalled();
  });

  it('after a reconnect to another database', async () => {
    const api = makeMockApi({ connect: vi.fn(async () => okv(summary)), idConflicts: vi.fn(async () => okv([conflict])) });
    const store = createAppStore(api);
    expect(await store.getState().reconnect(1)).toBeNull();
    await vi.waitFor(() => expect(store.getState().idConflicts).toEqual([conflict]));
  });
});
