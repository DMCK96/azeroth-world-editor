// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '../../src/renderer/state/app-store';
import { IdConflictDialog } from '../../src/renderer/views/IdConflictDialog';
import { makeMockApi, okv } from './mock-api';

const conflict = (id: number) => ({
  kind: 'spawn-guid', noun: 'spawn', scope: 'creature', scopeLabel: 'NPC spawn', id,
  mine: { entry: 11000230, name: 'Amalgam', map: 0, x: 10, y: 20, z: 30 },
  database: { entry: 1423, name: 'Stormwind Guard', map: 0, x: -9481, y: 74, z: 56 },
});

function mount(conflicts = [conflict(5300700)], recoveries: unknown[] = []) {
  const api = makeMockApi({ resolveIdConflicts: vi.fn(async () => okv({ renamed: conflicts.length })) });
  const store = createAppStore(api);
  store.setState({ idConflicts: conflicts, recoveries: recoveries as never });
  render(<IdConflictDialog store={store} />);
  return { api, store };
}

describe('IdConflictDialog', () => {
  it('shows nothing when there is no clash', () => {
    mount([]);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('lists each clash, naming both sides', () => {
    mount([conflict(5300700), conflict(5300701)]);
    const dialog = screen.getByRole('alertdialog', { name: 'Ids clash with the database' });
    expect(dialog).toHaveTextContent('The database has a spawn with these ids now.');
    expect(dialog).toHaveTextContent('5300700: yours is Amalgam (11000230); the database has Stormwind Guard (1423) on map 0 at -9481, 74, 56.');
    expect(dialog).toHaveTextContent('5300701');
  });

  it('groups the clashes under what they are of', () => {
    const object = { ...conflict(5400001), scope: 'gameobject', scopeLabel: 'Object spawn' };
    mount([conflict(5300700), object, conflict(5300701)]);
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['NPC spawn', 'Object spawn']);
    const npcs = screen.getByRole('heading', { name: 'NPC spawn' }).nextElementSibling!;
    expect(npcs).toHaveTextContent('5300700');
    expect(npcs).toHaveTextContent('5300701');
    expect(npcs).not.toHaveTextContent('5400001');
  });

  it('names what the ids are of from the clashes, whatever kinds are present', () => {
    mount([conflict(5300700), { ...conflict(60001), kind: 'quest-id', noun: 'quest', scope: 'quest', scopeLabel: 'Quest' }]);
    expect(screen.getByRole('alertdialog')).toHaveTextContent('The database has a spawn and a quest with these ids now.');
  });

  it('says the entry when a side has no name', () => {
    mount([{ ...conflict(5300700), mine: { entry: 11000230, name: '', map: 0, x: 10, y: 20, z: 30 } }]);
    expect(screen.getByRole('alertdialog')).toHaveTextContent('yours is entry 11000230;');
  });

  it('waits while a crash recovery is offered', () => {
    mount([conflict(5300700)], [{ id: 'r1', name: 'P', damaged: false, questCount: 1, writtenAt: 0 }]);
    expect(screen.queryByRole('alertdialog', { name: 'Ids clash with the database' })).toBeNull();
  });

  it('Renumber asks the API and closes', async () => {
    const { api, store } = mount();
    await userEvent.click(screen.getByRole('button', { name: 'Renumber' }));
    expect(api.resolveIdConflicts).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(store.getState().idConflicts).toEqual([]);
  });

  it('Leave as is closes without renumbering', async () => {
    const { api, store } = mount();
    await userEvent.click(screen.getByRole('button', { name: 'Leave as is' }));
    expect(api.resolveIdConflicts).not.toHaveBeenCalled();
    expect(store.getState().idConflicts).toEqual([]);
  });

  it('Escape leaves things as they are', async () => {
    const { api } = mount();
    await userEvent.keyboard('{Escape}');
    expect(api.resolveIdConflicts).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('a click behind the dialog neither renumbers nor dismisses', async () => {
    const { api, store } = mount();
    await userEvent.click(document.querySelector('.modal-backdrop')!);
    expect(api.resolveIdConflicts).not.toHaveBeenCalled();
    expect(store.getState().idConflicts).toHaveLength(1);
  });

  it('keeps both buttons off while the renumber runs', async () => {
    let finish: (v: unknown) => void = () => {};
    const api = makeMockApi({ resolveIdConflicts: vi.fn(() => new Promise((resolve) => { finish = resolve; })) });
    const store = createAppStore(api);
    store.setState({ idConflicts: [conflict(5300700)] });
    render(<IdConflictDialog store={store} />);
    await userEvent.click(screen.getByRole('button', { name: 'Renumber' }));
    expect(screen.getByRole('button', { name: 'Renumber' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Leave as is' })).toBeDisabled();
    finish(okv({ renamed: 1 }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });
});
