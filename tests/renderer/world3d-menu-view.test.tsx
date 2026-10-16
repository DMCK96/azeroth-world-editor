// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NamesProvider } from '../../src/renderer/state/names';
import { makeMockApi, okv, errv } from './mock-api';
import { clearClipboard } from '../../src/renderer/world3d/clipboard';

const worlds = vi.hoisted(() => [] as any[]);
vi.mock('../../src/renderer/world3d/world3d', () => ({
  createWorld3D: (options: any) => {
    const canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    options.container.appendChild(canvas);
    const world = { options, canvas, dispose: vi.fn(), lookAt: vi.fn(), setDocks: vi.fn(), setDocksEnabled: vi.fn(), setMovementPlaying: vi.fn(), resetMovement: vi.fn(), frameOfSpawn: vi.fn(() => null), setSpawnVisibility: vi.fn(), setOwnSpawns: vi.fn(), select: vi.fn(), selectSpawns: vi.fn(),
      setWorldLayer: vi.fn(), setMode: vi.fn(), setPlacing: vi.fn(), cancelDrag: vi.fn(), setMarked: vi.fn(),
      setScenery: vi.fn(), setTool: vi.fn(), setFalloff: vi.fn(), setPendingMovement: vi.fn(), spawnMovement: vi.fn(() => ({ type: 'idle', wander: 0, pathId: null })),
      startPath: vi.fn(), finishPath: vi.fn(), cancelPath: vi.fn(), undoPoint: vi.fn(), selectedSpawns: vi.fn(() => []), groundAt: vi.fn(() => ({ x: 50, y: 60, z: 7 })), lastPointer: vi.fn(() => null),
      spawnOf: vi.fn(() => ({})), routeOf: vi.fn(() => null),
      camera: () => ({ position: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }),
      target: () => ({ x: 0, y: 0, z: 0 }), spawnStatus: () => ({ capped: { creatures: false, objects: false }, error: null }) };
    worlds.push(world);
    return world;
  },
}));

import { World3DView } from '../../src/renderer/world3d/World3DView';
import { HistoryProvider } from '../../src/renderer/state/history-context';
import { createAppStore } from '../../src/renderer/state/app-store';

const EMPTY = { spawns: [], routes: [], added: [] };
const look = { displayId: 1, scale: 1, equipment: [0, 0, 0] as [number, number, number], preset: null };
const guard = { kind: 'creature' as const, guid: 80330, entry: 1423, name: 'Guard', own: false, added: false, pathId: 0, wander: 0, map: 0, respawnSecs: 300, group: null, placement: { x: 10, y: 0, z: 5, orientation: 1, rotation: null } };
const at = { x: 1, y: 2, z: 3 };

beforeEach(() => clearClipboard());
afterEach(() => { worlds.length = 0; vi.unstubAllGlobals(); });

async function view(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200 }));
  const api = makeMockApi({
    worldLayer: vi.fn(async () => okv(EMPTY)),
    mapFloors: vi.fn(async () => okv({ reason: 'none' })),
    worldAddSpawn: vi.fn(async (kind: string, entry: number, map: number, placement: any, guid?: number) => okv({ layer: { ...EMPTY, added: [{ kind, guid: guid ?? 90001, entry, name: 'Guard', map, placement, look }] }, guid: guid ?? 90001 })),
    worldSetMovement: vi.fn(async () => okv(EMPTY)),
    worldNewPathId: vi.fn(async () => okv(803300)),
    searchEntities: vi.fn(async () => okv([{ id: 1423, name: 'Guard' }])),
    ...overrides,
  });
  render(<NamesProvider api={api}><HistoryProvider store={createAppStore(api)}><World3DView map={0} start={{ x: 0, y: 0, z: 0 }} hasClient /></HistoryProvider></NamesProvider>);
  await waitFor(() => expect(worlds).toHaveLength(1));
  return { api, world: worlds[0] };
}
const rightClick = (world: any, target: any) => act(() => world.options.onContextMenu(target, { x: 40, y: 40 }));

describe('the right-click menu in the 3D view', () => {
  it('opens at the click with what the target offers, and Esc closes it', async () => {
    const { world } = await view();
    rightClick(world, { ground: at, hit: null, selection: [] });
    expect(screen.getByRole('menu', { name: 'World actions' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Place NPC here…' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Place NPC here puts one down where it was right-clicked and selects it', async () => {
    const { api, world } = await view();
    rightClick(world, { ground: at, hit: null, selection: [] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Place NPC here…' }));
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Find by name or ID' }), 'Guard');
    await userEvent.click(await screen.findByRole('button', { name: /Guard/ }));
    await waitFor(() => expect(api.worldAddSpawn).toHaveBeenCalledWith('creature', 1423, 0, expect.objectContaining({ x: 1, y: 2, z: 3 })));
    expect(world.setPlacing).not.toHaveBeenCalledWith(expect.objectContaining({ entry: 1423 }));
    await waitFor(() => expect(world.selectSpawns).toHaveBeenCalledWith([{ kind: 'creature', guid: 90001 }]));
  });

  it('Delete takes an NPC out of the world as one undo step and clears the selection', async () => {
    const { api, world } = await view();
    rightClick(world, { ground: at, hit: { type: 'spawn', spawn: guard }, selection: [guard] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(api.worldDeleteSpawn).toHaveBeenCalledWith('creature', 80330));
    await waitFor(() => expect(api.historyEnd).toHaveBeenCalledTimes(1));
    expect(api.historyBegin).toHaveBeenCalledWith('Delete Guard', undefined);
    expect(world.select).toHaveBeenCalledWith(null);
  });

  it('Delete on a selection deletes every spawn in one step, and names them', async () => {
    const { api, world } = await view();
    const second = { ...guard, guid: 80331 };
    rightClick(world, { ground: at, hit: { type: 'spawn', spawn: guard }, selection: [guard, second] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete 2' }));
    await waitFor(() => expect(api.worldDeleteSpawn).toHaveBeenCalledTimes(2));
    expect((api.worldDeleteSpawn as any).mock.calls.map((c: any[]) => c[1])).toEqual([80330, 80331]);
    await waitFor(() => expect(api.historyEnd).toHaveBeenCalledTimes(1));
    expect(api.historyBegin).toHaveBeenCalledWith('Delete 2 spawns', undefined);
  });

  it('goes on deleting when one spawn cannot be, and says which', async () => {
    const worldDeleteSpawn = vi.fn(async (_kind: string, guid: number) => (guid === 80330 ? errv('BAD_REQUEST', 'Spawn 80330 is no longer in the database.') : okv(EMPTY)));
    const { api, world } = await view({ worldDeleteSpawn });
    rightClick(world, { ground: at, hit: { type: 'spawn', spawn: guard }, selection: [guard, { ...guard, guid: 80331, name: 'Second' }] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete 2' }));
    await waitFor(() => expect(api.worldDeleteSpawn).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Could not delete Guard: Spawn 80330 is no longer in the database.')).toBeTruthy();
    // The spawn that could not be deleted stays selected; the other one is gone from the selection
    expect(world.selectSpawns).toHaveBeenLastCalledWith([{ kind: 'creature', guid: 80330 }]);
    expect(world.select).not.toHaveBeenCalledWith(null);
  });

  it('deletes the selected spawns with no menu, for the Delete key', async () => {
    const { api, world } = await view();
    world.selectedSpawns.mockReturnValue([guard]);
    await act(async () => { world.options.onDeleteSpawns(); });
    await waitFor(() => expect(api.worldDeleteSpawn).toHaveBeenCalledWith('creature', 80330));
  });

  it('copies the selection and pastes it where right-clicked, on the map being viewed', async () => {
    const { api, world } = await view();
    world.selectedSpawns.mockReturnValue([{ ...guard, map: 1 }, { ...guard, guid: 80331, placement: { ...guard.placement, x: 20 } }]);
    rightClick(world, { ground: at, hit: { type: 'spawn', spawn: guard }, selection: [guard, { ...guard, guid: 80331 }] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy 2' }));
    rightClick(world, { ground: { x: 100, y: 0, z: 0 }, hit: null, selection: [] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Paste here (2)' }));
    await waitFor(() => expect(api.worldAddSpawn).toHaveBeenCalledTimes(2));
    expect((api.worldAddSpawn as any).mock.calls.map((c: any[]) => [c[2], c[3].x])).toEqual([[0, 95], [0, 105]]);
    await waitFor(() => expect(world.selectSpawns).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.historyEnd).toHaveBeenCalledTimes(1));
    expect(api.historyBegin).toHaveBeenCalledWith('Paste 2 spawns', undefined);
    const [first, second] = vi.mocked(api.worldAddSpawn).mock.invocationCallOrder;
    expect(vi.mocked(api.historyBegin).mock.invocationCallOrder[0]!).toBeLessThan(first!);
    expect(second!).toBeLessThan(vi.mocked(api.historyEnd).mock.invocationCallOrder[0]!);
  });

  it('Ctrl+C and Ctrl+V on the view copy and paste under the cursor; in a text field they do nothing', async () => {
    const { api, world } = await view();
    world.selectedSpawns.mockReturnValue([guard]);
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    await userEvent.keyboard('{Control>}c{/Control}{Control>}v{/Control}');
    expect(api.worldAddSpawn).not.toHaveBeenCalled();
    world.canvas.focus();
    act(() => { world.options.onShortcut('KeyC'); });
    act(() => { world.options.onShortcut('KeyV'); });
    await waitFor(() => expect(api.worldAddSpawn).toHaveBeenCalledWith('creature', 1423, 0, expect.objectContaining({ x: 50, y: 60 })));
    field.remove();
  });

  it('a pasted group keeps what was raised in it: the spawn on the floor lands on the floor, the one above it stays that high above', async () => {
    const mapFloors = vi.fn(async () => okv({ floors: [10], ground: 10 }));
    const { api, world } = await view({ mapFloors });
    const onFloor = { ...guard, guid: 1, placement: { ...guard.placement, x: 10, y: 0, z: 10.2 } };
    const stacked = { ...guard, guid: 2, placement: { ...guard.placement, x: 12, y: 0, z: 14 } };
    world.selectedSpawns.mockReturnValue([onFloor, stacked]);
    world.groundAt.mockReturnValue({ x: 50, y: 60, z: 30 });
    act(() => { world.options.onShortcut('KeyC'); });
    // The heights above the floor follow the copy once the floors answer
    await waitFor(() => expect(mapFloors).toHaveBeenCalledTimes(2));
    await act(async () => { await Promise.resolve(); });
    act(() => { world.options.onShortcut('KeyV'); });
    await waitFor(() => expect(api.worldAddSpawn).toHaveBeenCalledTimes(2));
    const zs = (api.worldAddSpawn as any).mock.calls.map((c: any[]) => c[3].z).sort((x: number, y: number) => x - y);
    expect(zs[0]).toBeCloseTo(10, 3);
    expect(zs[1]).toBeCloseTo(14, 3);
  });

  it('Copy coordinates writes the GM command, and says when the clipboard refuses', async () => {
    const writeText = vi.fn(async (_text: string) => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const { world } = await view();
    rightClick(world, { ground: { x: 1.234, y: -5, z: 7.891 }, hit: null, selection: [] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy coordinates' }));
    expect(writeText).toHaveBeenCalledWith('.go xyz 1.23 -5.00 7.89 0');
    expect(await screen.findByText('Copied .go xyz to the clipboard')).toBeInTheDocument();
    writeText.mockRejectedValueOnce(new Error('Document is not focused.'));
    rightClick(world, { ground: at, hit: null, selection: [] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy coordinates' }));
    expect(await screen.findByText('Could not copy to the clipboard: Document is not focused.')).toBeInTheDocument();
  });

  it('Start path here asks for a new path id and starts drawing; the first point is sent as a new route', async () => {
    const { api, world } = await view({ worldSetRoute: vi.fn(async () => okv(EMPTY)) });
    rightClick(world, { ground: at, hit: null, selection: [guard] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Start path here' }));
    await waitFor(() => expect(world.startPath).toHaveBeenCalledWith(80330, 803300, at));
    act(() => world.options.onGesture([{ kind: 'route', spawn: { kind: 'creature', guid: 80330, entry: 1423, own: false }, pathId: 803300, points: [{ x: 1, y: 2, z: 3 }] }]));
    await waitFor(() => expect(api.worldSetRoute).toHaveBeenCalledWith(803300, [{ x: 1, y: 2, z: 3, rest: {} }], { isNew: true }));
  });

  it('Change wander distance previews, and Apply sends the movement', async () => {
    const { api, world } = await view();
    rightClick(world, { ground: at, hit: { type: 'spawn', spawn: guard }, selection: [guard] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Change wander distance…' }));
    const field = screen.getByRole('spinbutton', { name: 'Yards' });
    await userEvent.clear(field);
    await userEvent.type(field, '8');
    expect(world.setPendingMovement).toHaveBeenLastCalledWith(80330, { type: 'wander', wander: 8, pathId: null });
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(api.worldSetMovement).toHaveBeenCalledWith(80330, { type: 'wander', wander: 8, pathId: null }));
    await waitFor(() => expect(api.historyEnd).toHaveBeenCalledTimes(1));
  });

  it('Respawn time sets a database spawn\'s time through the world layer, as one step', async () => {
    const { api, world } = await view({ worldSetRespawn: vi.fn(async () => okv(EMPTY)) });
    const timed = { ...guard, respawnSecs: 300 };
    rightClick(world, { ground: at, hit: { type: 'spawn', spawn: timed }, selection: [timed] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Respawn time…' }));
    await userEvent.clear(screen.getByLabelText('Minutes'));
    await userEvent.type(screen.getByLabelText('Minutes'), '1');
    await userEvent.clear(screen.getByLabelText('Seconds'));
    await userEvent.type(screen.getByLabelText('Seconds'), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(api.worldSetRespawn).toHaveBeenCalledWith('creature', 80330, 60));
    await waitFor(() => expect(api.historyEnd).toHaveBeenCalledTimes(1));
    expect(api.historyBegin).toHaveBeenCalledWith('Respawn time of Guard', undefined);
  });

  it('says so and does nothing when the right-clicked spawn has gone', async () => {
    const { api, world } = await view();
    world.spawnOf.mockReturnValue(null);
    rightClick(world, { ground: at, hit: { type: 'spawn', spawn: guard }, selection: [guard] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Change wander distance…' }));
    expect(await screen.findByText('That spawn is no longer here')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Wander distance' })).toBeNull();
    expect(api.worldSetMovement).not.toHaveBeenCalled();
  });

  it('an undone placement takes the spawn back out of the world layer, and its redo keeps the guid', async () => {
    const { api, world } = await view({ worldDeleteSpawn: vi.fn(async () => okv(EMPTY)) });
    const spawn = { kind: 'creature', guid: 90001, entry: 1423, own: false };
    const placement = { x: 1, y: 2, z: 3, orientation: 0, rotation: null };
    act(() => world.options.onGesture([{ kind: 'presence', spawn, present: false, at: placement, map: 0 }]));
    await waitFor(() => expect(api.worldDeleteSpawn).toHaveBeenCalledWith('creature', 90001));
    act(() => world.options.onGesture([{ kind: 'presence', spawn, present: true, at: placement, map: 0 }]));
    await waitFor(() => expect(api.worldAddSpawn).toHaveBeenCalledWith('creature', 1423, 0, placement, 90001));
  });

  it('counts movement changes on the Project changes button', async () => {
    const movements = [{ guid: 80330, entry: 1423, name: 'Guard', map: 0, addonRow: false, original: { type: 'idle', wander: 0, pathId: null }, current: { type: 'wander', wander: 5, pathId: null } }];
    await view({ worldLayer: vi.fn(async () => okv({ ...EMPTY, movements })) });
    expect(await screen.findByRole('button', { name: 'Project changes (1)' })).toBeEnabled();
  });

  it('counts respawn and spawn group changes on the Project changes button, so a project with only those can open it', async () => {
    const respawns = [{ kind: 'creature', guid: 80330, entry: 1423, name: 'Guard', map: 0, original: 300, current: 120 }];
    const groups = [{ id: 900001, name: 'Path 1', map: 0, maxActive: 1, members: [{ type: 'spawn', kind: 'npc', guid: 80330, entry: 1423, chance: 0 }], origin: { kind: 'new' } }];
    await view({ worldLayer: vi.fn(async () => okv({ ...EMPTY, respawns, groups })) });
    expect(await screen.findByRole('button', { name: 'Project changes (2)' })).toBeEnabled();
  });

  it('does not paste or duplicate while a path is drawn', async () => {
    const { api, world } = await view();
    world.selectedSpawns.mockReturnValue([guard]);
    act(() => { world.options.onShortcut('KeyC'); });
    act(() => world.options.onDrawing({ guid: 80330, points: 2 }));
    act(() => { world.options.onShortcut('KeyV'); });
    act(() => { world.options.onShortcut('KeyD'); });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.worldAddSpawn).not.toHaveBeenCalled();
  });

  it('a map switch cancels the path being drawn, and the next world\u2019s menu is the usual one', async () => {
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200 }));
    const api = makeMockApi({ worldLayer: vi.fn(async () => okv(EMPTY)) });
    const { rerender } = render(<NamesProvider api={api}><World3DView map={0} start={{ x: 0, y: 0, z: 0 }} hasClient /></NamesProvider>);
    await waitFor(() => expect(worlds).toHaveLength(1));
    act(() => worlds[0].options.onDrawing({ guid: 80330, points: 1 }));
    rerender(<NamesProvider api={api}><World3DView map={1} start={{ x: 0, y: 0, z: 0 }} hasClient /></NamesProvider>);
    await waitFor(() => expect(worlds).toHaveLength(2));
    expect(worlds[0].cancelPath).toHaveBeenCalled();
    rightClick(worlds[1], { ground: at, hit: null, selection: [] });
    expect(screen.getByRole('menuitem', { name: 'Place NPC here…' })).toBeInTheDocument();
  });

  it('Remove path on a quest\u2019s own NPC keeps its points in the undo step', async () => {
    const onOwnEdit = vi.fn();
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200 }));
    const api = makeMockApi({ worldLayer: vi.fn(async () => okv(EMPTY)) });
    render(<NamesProvider api={api}><World3DView map={0} start={{ x: 0, y: 0, z: 0 }} hasClient onOwnEdit={onOwnEdit} /></NamesProvider>);
    await waitFor(() => expect(worlds).toHaveLength(1));
    const world = worlds[0];
    const own = { ...guard, guid: 900, entry: 12000001, own: true, pathId: 9000 };
    world.spawnMovement.mockReturnValue({ type: 'path', wander: 0, pathId: 9000 });
    world.routeOf.mockReturnValue({ pathId: 9000, points: [{ x: 1, y: 1, z: 1 }, { x: 2, y: 2, z: 2 }] });
    rightClick(world, { ground: at, hit: { type: 'spawn', spawn: own }, selection: [own] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove path' }));
    const ref = { kind: 'creature', guid: 900, entry: 12000001, own: true };
    await waitFor(() => expect(onOwnEdit).toHaveBeenCalledWith({ kind: 'movement', spawn: ref, to: { type: 'idle', wander: 0, pathId: null } }));
  });

  it('knows a path made before a restart from the layer: its points go out as new, and Remove path takes them back', async () => {
    const newRoute = { pathId: 803300, walkers: 1, original: [], current: [{ x: 1, y: 1, z: 1, rest: {} }, { x: 2, y: 2, z: 2, rest: {} }] };
    const withRoute = { ...EMPTY, routes: [newRoute] };
    const { api, world } = await view({ worldLayer: vi.fn(async () => okv(withRoute)), worldSetRoute: vi.fn(async () => okv(withRoute)), worldSetMovement: vi.fn(async () => okv(withRoute)) });
    await waitFor(() => expect(world.setWorldLayer).toHaveBeenCalled());
    act(() => world.options.onGesture([{ kind: 'route', spawn: { kind: 'creature', guid: 80330, entry: 1423, own: false }, pathId: 803300, points: [{ x: 3, y: 3, z: 3 }] }]));
    await waitFor(() => expect(api.worldSetRoute).toHaveBeenCalledWith(803300, [{ x: 3, y: 3, z: 3, rest: {} }], { isNew: true }));
    const walking = { ...guard, pathId: 803300 };
    world.spawnMovement.mockReturnValue({ type: 'path', wander: 0, pathId: 803300 });
    world.routeOf.mockReturnValue({ pathId: 803300, points: [{ x: 1, y: 1, z: 1 }] });
    rightClick(world, { ground: at, hit: { type: 'spawn', spawn: walking }, selection: [walking] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove path' }));
    await waitFor(() => expect(api.worldSetRoute).toHaveBeenLastCalledWith(803300, [], { isNew: true }));
  });

  it('says why an edit was refused', async () => {
    const { world } = await view({ worldSetMovement: vi.fn(async () => ({ ok: false, error: { code: 'BAD_REQUEST', message: 'Spawn 80330 is no longer in the database.' } })) });
    rightClick(world, { ground: at, hit: { type: 'spawn', spawn: guard }, selection: [guard] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Change wander distance…' }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByText('Spawn 80330 is no longer in the database.')).toBeInTheDocument();
  });

  it('forgets quest marks when the map changes, so Hide is not offered for nothing', async () => {
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200 }));
    const questSpawnList = vi.fn(async () => okv([{ questId: 60001, title: 'Wolves', capped: false, cut: 0, spawns: [{ kind: 'creature', guid: 80330, entry: 1423, name: 'G', map: 0, x: 1, y: 2, z: 3, role: 'giver' }] }]));
    const api = makeMockApi({ worldLayer: vi.fn(async () => okv(EMPTY)), questSpawnList });
    const quest = { id: 60001, title: 'Wolves', roles: { givers: [], enders: [], objectives: [null, null, null, null] }, entities: [], chained: false };
    const shown = (map: number) => <NamesProvider api={api}><World3DView map={map} start={{ x: 0, y: 0, z: 0 }} hasClient quest={quest} /></NamesProvider>;
    const { rerender } = render(shown(0));
    await waitFor(() => expect(worlds).toHaveLength(1));
    rightClick(worlds[0], { ground: at, hit: null, selection: [] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Show quest spawns' }));
    await waitFor(() => expect(worlds[0].setMarked).toHaveBeenCalledWith([{ kind: 'creature', guid: 80330 }]));
    rerender(shown(1));
    await waitFor(() => expect(worlds).toHaveLength(2));
    rightClick(worlds[1], { ground: at, hit: null, selection: [] });
    expect(screen.queryByRole('menuitem', { name: 'Hide quest spawns' })).toBeNull();
  });

  it('a pasted database NPC gets the copied respawn time and wander in the same step', async () => {
    const { api, world } = await view({ worldSetRespawn: vi.fn(async () => okv(EMPTY)) });
    const timed = { ...guard, respawnSecs: 60, wander: 5 };
    world.selectedSpawns.mockReturnValue([timed]);
    rightClick(world, { ground: at, hit: { type: 'spawn', spawn: timed }, selection: [timed] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy' }));
    rightClick(world, { ground: { x: 100, y: 0, z: 0 }, hit: null, selection: [] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Paste here (1)' }));
    await waitFor(() => expect(api.worldSetMovement).toHaveBeenCalledWith(90001, { type: 'wander', wander: 5, pathId: null }));
    expect(api.worldSetRespawn).toHaveBeenCalledWith('creature', 90001, 60);
    await waitFor(() => expect(api.historyEnd).toHaveBeenCalledTimes(1));
    expect(api.historyBegin).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.worldSetMovement).mock.invocationCallOrder[0]!).toBeLessThan(vi.mocked(api.historyEnd).mock.invocationCallOrder[0]!);
  });

  it('a pasted NPC gets the copied spawn’s own game events in the same step', async () => {
    const { api, world } = await view({ worldSetSpawnEvents: vi.fn(async () => okv(EMPTY)) });
    const gone = { ...guard, spawnEvents: { mode: 'except' as const, events: [24] } };
    world.selectedSpawns.mockReturnValue([gone]);
    rightClick(world, { ground: at, hit: { type: 'spawn', spawn: gone }, selection: [gone] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy' }));
    rightClick(world, { ground: { x: 100, y: 0, z: 0 }, hit: null, selection: [] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Paste here (1)' }));
    await waitFor(() => expect(api.worldSetSpawnEvents).toHaveBeenCalledWith(90001, { mode: 'except', events: [24] }));
    await waitFor(() => expect(api.historyEnd).toHaveBeenCalledTimes(1));
    expect(api.historyBegin).toHaveBeenCalledTimes(1);
  });

  it('Group these spawns makes a new group of the selection, saved as one step', async () => {
    const { api, world } = await view({ worldNewGroupId: vi.fn(async () => okv(900001)), worldCheckGroup: vi.fn(async () => okv({ reasons: [], notes: [] })), worldSetGroup: vi.fn(async () => okv(EMPTY)) });
    const other = { ...guard, guid: 80331, entry: 68, name: 'Other' };
    world.selectedSpawns.mockReturnValue([guard, other]);
    rightClick(world, { ground: at, hit: { type: 'spawn', spawn: guard }, selection: [guard, other] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Group these spawns…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Spawn group' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Camp');
    // Save waits for the check of the latest change
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Save' })).toHaveProperty('disabled', false));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.worldSetGroup).toHaveBeenCalledWith({ id: 900001, name: 'Camp', map: 0, maxActive: 1, event: null, origin: { kind: 'new' },
      members: [{ type: 'spawn', kind: 'npc', guid: 80330, entry: 1423, chance: 0 }, { type: 'spawn', kind: 'npc', guid: 80331, entry: 68, chance: 0 }] }, []));
    await waitFor(() => expect(api.historyEnd).toHaveBeenCalledTimes(1));
  });

  it('Delete on a placed spawn also takes it out of its group, in the same step', async () => {
    const { api, world } = await view({ worldDropMember: vi.fn(async () => okv(EMPTY)) });
    const placed = { ...guard, guid: 90001, added: true, group: 900001 };
    rightClick(world, { ground: at, hit: { type: 'spawn', spawn: placed }, selection: [placed] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(api.worldDropMember).toHaveBeenCalledWith('npc', 90001));
    await waitFor(() => expect(api.historyEnd).toHaveBeenCalledTimes(1));
  });
});
