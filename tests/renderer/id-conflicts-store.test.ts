import { describe, expect, it, vi } from 'vitest';
import { createAppStore } from '../../src/renderer/state/app-store';
import { errv, makeMockApi, okv } from './mock-api';

const conflict = {
  kind: 'spawn-guid', scope: 'creature', scopeLabel: 'NPC spawn', id: 5300700,
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
