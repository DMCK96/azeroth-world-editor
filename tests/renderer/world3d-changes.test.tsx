// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectChanges } from '../../src/renderer/world3d/ProjectChanges';
import { NamesProvider } from '../../src/renderer/state/names';
import { ProjectEntitiesProvider } from '../../src/renderer/state/project-entities';
import { EMPTY_ENTITIES } from '../../src/core/entities/model';
import { HistoryProvider } from '../../src/renderer/state/history-context';
import { createAppStore } from '../../src/renderer/state/app-store';
import { makeMockApi, okv } from './mock-api';

const worlds = vi.hoisted(() => [] as any[]);
vi.mock('../../src/renderer/world3d/world3d', () => ({
  createWorld3D: (options: any) => {
    const world = { options, dispose: vi.fn(), lookAt: vi.fn(), setDocks: vi.fn(), setDocksEnabled: vi.fn(), setMovementPlaying: vi.fn(), resetMovement: vi.fn(), frameOfSpawn: vi.fn(() => null), setSpawnVisibility: vi.fn(), setOwnSpawns: vi.fn(), select: vi.fn(), selectSpawns: vi.fn(),
      setWorldLayer: vi.fn(), setMode: vi.fn(), setPlacing: vi.fn(), cancelDrag: vi.fn(), setMarked: vi.fn(), setScenery: vi.fn(), setTool: vi.fn(),
      setFalloff: vi.fn(), setPendingMovement: vi.fn(), cancelPath: vi.fn(), selectedSpawns: vi.fn(() => []), spawnOf: vi.fn(() => ({})), routeOf: vi.fn(() => null),
      camera: () => ({ position: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }), target: () => ({ x: 0, y: 0, z: 0 }),
      spawnStatus: () => ({ capped: { creatures: false, objects: false }, error: null }) };
    worlds.push(world);
    return world;
  },
}));
import { World3DView } from '../../src/renderer/world3d/World3DView';

const spawn = { type: 'spawn', kind: 'creature', guid: 80330, entry: 1423, name: 'Stormwind Guard', map: 0, drifted: true,
  original: { x: -9481.31, y: 74.42, z: 56.55, orientation: 1.5, rotation: null }, current: { x: -9470, y: 74.42, z: 56.55, orientation: 2, rotation: null } };
const route = { type: 'route', pathId: 802, walkers: 3, drifted: false, original: [{ x: 1, y: 1, z: 1, rest: {} }, { x: 2, y: 2, z: 2, rest: {} }], current: [{ x: 1, y: 1, z: 1, rest: {} }] };

describe('the Project changes modal', () => {
  it('lists each change with before and after, and says when the database moved since', async () => {
    const api = makeMockApi({ worldChanges: vi.fn(async () => okv([spawn, route])) });
    render(<ProjectChanges api={api} onLayer={vi.fn()} onClose={vi.fn()} />);
    const dialog = await screen.findByRole('dialog', { name: 'Project changes' });
    const rows = await within(dialog).findAllByRole('row');
    expect(rows[1]).toHaveTextContent('Stormwind Guard');
    expect(rows[1]).toHaveTextContent('80330');
    expect(rows[1]).toHaveTextContent('-9481.31, 74.42, 56.55');
    expect(rows[1]).toHaveTextContent('-9470.00, 74.42, 56.55');
    expect(rows[1]).toHaveTextContent('Changed in the database since');
    expect(rows[2]).toHaveTextContent('Route 802');
    expect(rows[2]).toHaveTextContent('3 spawns');
    expect(rows[2]).toHaveTextContent('2 points');
    expect(rows[2]).toHaveTextContent('1 point');
  });

  it('reverts one change and hands the new layer back', async () => {
    const layer = { spawns: [], routes: [], added: [] };
    const worldRevert = vi.fn(async () => okv(layer));
    const worldChanges = vi.fn().mockResolvedValueOnce(okv([spawn])).mockResolvedValue(okv([]));
    const onLayer = vi.fn();
    render(<ProjectChanges api={makeMockApi({ worldChanges, worldRevert })} onLayer={onLayer} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Revert Stormwind Guard' }));
    expect(worldRevert).toHaveBeenCalledWith({ kind: 'spawn', spawnKind: 'creature', guid: 80330 });
    await waitFor(() => expect(onLayer).toHaveBeenCalledWith(layer));
    expect(await screen.findByText('No world changes.')).toBeTruthy();
  });

  it('exports and shows where the two files went', async () => {
    const exportProject = vi.fn(async () => okv({ applyPath: 'C:\\out\\2026-10-03_00_world.sql', revertPath: 'C:\\out\\2026-10-03_00_world_revert.sql', sql: '' }));
    render(<ProjectChanges api={makeMockApi({ worldChanges: vi.fn(async () => okv([spawn])), exportProject })} onLayer={vi.fn()} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Export project patch' }));
    expect(await screen.findByText('C:\\out\\2026-10-03_00_world.sql')).toBeTruthy();
    expect(screen.getByText('C:\\out\\2026-10-03_00_world_revert.sql')).toBeTruthy();
  });

  it('says one spawn, not one spawns', async () => {
    render(<ProjectChanges api={makeMockApi({ worldChanges: vi.fn(async () => okv([{ ...route, walkers: 1 }])) })} onLayer={vi.fn()} onClose={vi.fn()} />);
    const rows = await screen.findAllByRole('row');
    expect(rows[1]).toHaveTextContent('Route 802 · 1 spawn');
    expect(rows[1]).not.toHaveTextContent('1 spawns');
  });

  it('lists an NPC’s movement before and after, and reverts it', async () => {
    const movement = { type: 'movement', guid: 80330, entry: 1423, name: 'Stormwind Guard', map: 0, addonRow: true, drifted: false,
      original: { type: 'path', wander: 0, pathId: 801 }, current: { type: 'wander', wander: 5, pathId: null } };
    const worldRevert = vi.fn(async () => okv({ spawns: [], routes: [], added: [] }));
    render(<ProjectChanges api={makeMockApi({ worldChanges: vi.fn(async () => okv([movement])), worldRevert })} onLayer={vi.fn()} onClose={vi.fn()} />);
    const row = (await screen.findByText(/Stormwind Guard · movement/)).closest('tr')!;
    expect(within(row).getByText('walks path 801')).toBeInTheDocument();
    expect(within(row).getByText('wanders 5 yd')).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Revert movement of Stormwind Guard' }));
    expect(worldRevert).toHaveBeenCalledWith({ kind: 'movement', guid: 80330 });
  });

  it('lists a spawn’s own events before and after, by name, and reverts them', async () => {
    const events = { type: 'spawnEvents', guid: 80330, entry: 1423, name: 'Stormwind Guard', map: 0, drifted: false,
      original: [{ eventEntry: '12', guid: '80330' }], current: { mode: 'except', events: [4, 12] } };
    const worldRevert = vi.fn(async () => okv({ spawns: [], routes: [], added: [] }));
    const gameEvents = vi.fn(async () => okv([{ id: 12, name: 'Darkmoon Faire' }, { id: 4, name: "Hallow's End" }]));
    render(<ProjectChanges api={makeMockApi({ worldChanges: vi.fn(async () => okv([events])), worldRevert, gameEvents })} onLayer={vi.fn()} onClose={vi.fn()} />);
    const row = (await screen.findByText(/Stormwind Guard · events/)).closest('tr')!;
    expect(await within(row).findByText('only during Darkmoon Faire')).toBeInTheDocument();
    expect(within(row).getByText("gone during Hallow's End, Darkmoon Faire")).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Revert events of Stormwind Guard' }));
    expect(worldRevert).toHaveBeenCalledWith({ kind: 'spawnEvents', guid: 80330 });
  });

  it('hands every layer the 3D view takes to the project context', async () => {
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200 }));
    const layer = { spawns: [{ ...spawn, type: undefined }], routes: [], added: [] };
    const api = makeMockApi({ worldLayer: vi.fn(async () => okv(layer)), mapFloors: vi.fn(async () => okv({ reason: 'none' })) });
    const setLayer = vi.fn();
    const value = { entities: EMPTY_ENTITIES, setEntities: vi.fn(), quests: [], create: vi.fn(), remove: vi.fn(), layer, setLayer, tracked: [] } as any;
    render(<NamesProvider api={api}><HistoryProvider store={createAppStore(api)}><ProjectEntitiesProvider value={value}><World3DView map={0} start={{ x: 0, y: 0, z: 0 }} hasClient /></ProjectEntitiesProvider></HistoryProvider></NamesProvider>);
    await waitFor(() => expect(setLayer).toHaveBeenCalledWith(expect.objectContaining({ spawns: expect.any(Array) })));
    worlds.length = 0;
  });

  it('draws the layer of a project opened while the view is showing', async () => {
    vi.stubGlobal('fetch', async () => new Response(new Uint8Array([1]), { status: 200 }));
    const empty = { spawns: [], routes: [], added: [] };
    const opened = { spawns: [], routes: [{ pathId: 802630, walkers: 1, name: 'Stormwind Guard', original: route.original, current: route.current }], added: [] };
    const api = makeMockApi({ worldLayer: vi.fn(async () => okv(empty)), mapFloors: vi.fn(async () => okv({ reason: 'none' })) });
    const value = (layer: unknown) => ({ entities: EMPTY_ENTITIES, setEntities: vi.fn(), quests: [], create: vi.fn(), remove: vi.fn(), layer, setLayer: vi.fn(), tracked: [] }) as any;
    const view = (layer: unknown) => <NamesProvider api={api}><HistoryProvider store={createAppStore(api)}><ProjectEntitiesProvider value={value(layer)}><World3DView map={0} start={{ x: 0, y: 0, z: 0 }} hasClient /></ProjectEntitiesProvider></HistoryProvider></NamesProvider>;
    const { rerender } = render(view(empty));
    await waitFor(() => expect(worlds.at(-1)?.setWorldLayer).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Project changes (0)' })).toBeTruthy();
    // Project → Open…: the app store reads the new project's layer and hands it down
    rerender(view(opened));
    await waitFor(() => expect(worlds.at(-1)!.setWorldLayer).toHaveBeenLastCalledWith(opened));
    expect(screen.getByRole('button', { name: 'Project changes (1)' })).toBeTruthy();
    worlds.length = 0;
  });
});

describe('deleted spawns in the Project changes modal', () => {
  const deleted = { type: 'deleted', kind: 'creature', guid: 80330, entry: 1423, name: 'Stormwind Guard', map: 0, drifted: false,
    placement: { x: -9481.31, y: 74.42, z: 56.55, orientation: 1.5, rotation: null }, rows: [] };

  it('lists the spawn as deleted, with where it stood', async () => {
    render(<ProjectChanges api={makeMockApi({ worldChanges: vi.fn(async () => okv([deleted])) })} onLayer={vi.fn()} onClose={vi.fn()} />);
    const row = (await screen.findByText(/Stormwind Guard · deleted/)).closest('tr')!;
    expect(row).toHaveTextContent('80330');
    expect(row).toHaveTextContent('-9481.31, 74.42, 56.55');
  });

  it('says when the database no longer matches what was deleted', async () => {
    render(<ProjectChanges api={makeMockApi({ worldChanges: vi.fn(async () => okv([{ ...deleted, drifted: true }])) })} onLayer={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText('Changed in the database since')).toBeTruthy();
  });

  it('puts the spawn back, and hands the new layer on', async () => {
    const layer = { spawns: [], routes: [], added: [] };
    const worldRevert = vi.fn(async () => okv(layer));
    const onLayer = vi.fn();
    const worldChanges = vi.fn().mockResolvedValueOnce(okv([deleted])).mockResolvedValue(okv([]));
    render(<ProjectChanges api={makeMockApi({ worldChanges, worldRevert })} onLayer={onLayer} onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Revert deletion of Stormwind Guard' }));
    expect(worldRevert).toHaveBeenCalledWith({ kind: 'delete', spawnKind: 'creature', guid: 80330 });
    await waitFor(() => expect(onLayer).toHaveBeenCalledWith(layer));
  });
});

describe('placed spawns in the Project changes modal', () => {
  const added = { type: 'added', kind: 'gameobject', guid: 5001, entry: 1731, name: 'Copper Vein', map: 0, drifted: false, inDatabase: false,
    placement: { x: 1, y: 2, z: 3, orientation: 0, rotation: null }, look: {} };
  const show = (over: object) => render(<ProjectChanges api={makeMockApi({ worldChanges: vi.fn(async () => okv([{ ...added, ...over }])) })} onLayer={vi.fn()} onClose={vi.fn()} />);

  it('says a spawn the database already has is already there, and does not call it a clash', async () => {
    show({ inDatabase: true });
    expect(await screen.findByText('This object spawn is already in the database')).toBeTruthy();
    expect(screen.queryByText('The database has a spawn with this id now')).toBeNull();
  });

  it('warns when a different spawn holds its id', async () => {
    show({ drifted: true });
    expect(await screen.findByText('The database has a spawn with this id now')).toBeTruthy();
    expect(screen.queryByText(/already in the database/)).toBeNull();
  });
});
