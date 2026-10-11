// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/renderer/world3d/world3d', () => ({
  createWorld3D: () => ({
    setOwnSpawns: vi.fn(), setWorldLayer: vi.fn(), setMarked: vi.fn(), setPlacing: vi.fn(), dispose: vi.fn(), cancelPath: vi.fn(), lookAt: vi.fn(), select: vi.fn(),
    setDocks: vi.fn(), setDocksEnabled: vi.fn(), setMovementPlaying: vi.fn(), resetMovement: vi.fn(), frameOfSpawn: vi.fn(() => null), setSpawnVisibility: vi.fn(),
    setScenery: vi.fn(), setTool: vi.fn(), setFalloff: vi.fn(), target: () => ({ x: 0, y: 0, z: 0 }),
    spawnStatus: () => ({ capped: { creatures: false, objects: false }, error: null, loading: 0 }),
  }),
}));

import { App } from '../../src/renderer/App';
import { makeMockApi, okv } from './mock-api';

const offer = { current: '0.6.0', latest: '0.7.0', releaseUrl: 'https://github.com/DMCK96/azeroth-world-editor/releases', notes: [{ version: '0.7.0', title: 'v0.7.0', body: '- Fixed it (abc1234)', url: 'u' }] };
const drift = { missingTables: [], unregistered: [], missingColumns: [], typeMismatches: [] };
const state = { name: 'North', filePath: 'C:\\w\\north.aqc', dirty: false, idRangeStart: 60000, idRangeEnd: 99999, outputDir: 'C:\\out', viewport: { x: 0, y: 0, zoom: 1 } };
const recovery = { id: 'a', name: 'Northshire rework', recoveredFrom: null, writtenAt: '2026-09-23T14:02:00.000Z', questCount: 12, damaged: false };

function launch(over: Record<string, any> = {}) {
  const handlers: Record<string, (arg: unknown) => void> = {};
  const api = makeMockApi({ updateCheck: async () => okv(offer), projectState: async () => okv(state), ...over });
  (window as any).api = api;
  (window as any).appEvents = {
    onFlushRequest: () => {}, onHistory: () => {}, onHoldEdits: () => {}, onExternalChange: () => {},
    onConnected: (h: (arg: unknown) => void) => { handlers['connected'] = h; },
  };
  localStorage.setItem('acqc.welcome.seen', JSON.stringify([state.filePath]));
  render(<App />);
  return { api, connected: (): Promise<void> => act(async () => handlers['connected']!({ profileId: 1, schemaHash: 'h', drift, blocking: false })) };
}
afterEach(() => {
  cleanup();
  delete (window as any).api;
  delete (window as any).appEvents;
  localStorage.clear();
});

describe('the update dialog in the app', () => {
  it('appears on the connect screen, before anyone connects', async () => {
    launch();
    const dialog = await screen.findByRole('alertdialog', { name: 'Update available' });
    expect(within(dialog).getByText('0.7.0', { selector: '.update-dialog__latest' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /connect/i })).toBeTruthy();
  });

  it('is asked for once, however the screens change afterwards', async () => {
    const { api, connected } = launch();
    await userEvent.click(await screen.findByRole('button', { name: 'Remind me later' }));
    await connected();
    await waitFor(() => expect(api.projectState).toHaveBeenCalled());
    expect(api.updateCheck).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog', { name: 'Update available' })).toBeNull();
  });

  it('shows the recovery dialog before it once connected, then the update', async () => {
    const { connected } = launch({ recoveries: vi.fn().mockResolvedValueOnce(okv([recovery])).mockResolvedValue(okv([])) });
    // Answered at the connect screen, the update does not come back; so connect first through the app
    await screen.findByRole('alertdialog', { name: 'Update available' });
    await connected();
    const recover = await screen.findByRole('alertdialog', { name: 'Recover unsaved work' });
    expect(screen.queryByRole('alertdialog', { name: 'Update available' })).toBeNull();
    await userEvent.click(within(recover).getByRole('button', { name: 'Discard Northshire rework' }));
    expect(await screen.findByRole('alertdialog', { name: 'Update available' })).toBeTruthy();
    expect(screen.queryByRole('alertdialog', { name: 'Recover unsaved work' })).toBeNull();
  });
});
