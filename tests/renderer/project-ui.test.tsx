// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '../../src/renderer/state/app-store';
import { AppShell } from '../../src/renderer/views/AppShell';
import { makeMockApi, okv } from './mock-api';

const drift = { missingTables: [], unregistered: [], missingColumns: [], typeMismatches: [] };
const form = { name: 'w', role: 'world' as const, host: 'h', port: 1, user: 'u', database: 'd', password: 'p' };
const state = (over: Record<string, unknown> = {}) => ({ name: 'Northshire', filePath: 'C:\\w\\north.aqc', dirty: false, idRangeStart: 60000, idRangeEnd: 99999, outputDir: 'C:\\out', viewport: { x: 0, y: 0, zoom: 1 }, ...over });

async function home(over: Record<string, any> = {}) {
  const api = makeMockApi({ saveProfile: async () => okv({ id: 1, ...form }), connect: async () => okv({ profileId: 1, schemaHash: 'h', drift, blocking: false }), projectState: async () => okv(state()), ...over });
  const store = createAppStore(api, { saveDelayMs: 0 });
  await store.getState().connect(form);
  render(<AppShell store={store} />);
  await screen.findByRole('heading', { name: 'Northshire' });
  return { api, store };
}
const openModal = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Project' }));
  return screen.findByRole('dialog', { name: 'Project' });
};

describe('project UI', () => {
  it('shows the name, with a dot while there are unsaved changes', async () => {
    await home({ projectState: async () => okv(state({ dirty: true })) });
    expect(screen.getByLabelText('Unsaved changes')).toBeInTheDocument();
  });

  it('renames from the modal on Enter', async () => {
    const { api } = await home();
    const dialog = await openModal();
    const name = within(dialog).getByLabelText('Project name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Wolves{Enter}');
    await waitFor(() => expect(api.renameProject).toHaveBeenCalledWith('Wolves'));
    expect(within(dialog).getByText('C:\\w\\north.aqc')).toBeInTheDocument();
  });

  it('sends a rename once, not again when the field then loses focus', async () => {
    // The rename lands slowly, so the store still has the old name when the field is left
    const { api } = await home({ renameProject: vi.fn(() => new Promise(() => {})) });
    const dialog = await openModal();
    const name = within(dialog).getByLabelText('Project name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Wolves{Enter}');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(api.renameProject).toHaveBeenCalledTimes(1);
  });

  it('creates a new project under the name typed', async () => {
    const { api } = await home();
    const dialog = await openModal();
    await userEvent.click(within(dialog).getByRole('button', { name: 'New project…' }));
    const name = within(dialog).getByLabelText('New project name');
    expect(name).toHaveValue('Untitled Project');
    await userEvent.clear(name);
    await userEvent.type(name, 'Second');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(api.newProject).toHaveBeenCalledWith('Second'));
  });

  it('offers Open, Save and Save As', async () => {
    const { api } = await home();
    // Save keeps the modal open; Save As and Open close it once they complete.
    let dialog = await openModal();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveProject).toHaveBeenCalled());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save As…' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Project' })).toBeNull());
    expect(api.saveProjectAs).toHaveBeenCalled();
    dialog = await openModal();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Open…' }));
    await waitFor(() => expect(api.openProject).toHaveBeenCalledWith());
  });

  it('lists recent projects; a missing one can only be removed', async () => {
    const { api } = await home({ recentProjects: async () => okv([
      { path: 'C:\\w\\a.aqc', name: 'A', openedAt: '2026-09-23T10:00:00.000Z', exists: true },
      { path: 'C:\\w\\gone.aqc', name: 'Gone', openedAt: '2026-09-22T10:00:00.000Z', exists: false },
    ]) });
    const dialog = await openModal();
    await within(dialog).findByRole('button', { name: /^Open A/ });
    expect(within(dialog).queryByRole('button', { name: /^Open Gone/ })).toBeNull();
    expect(within(dialog).getByText(/file not found/i)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove Gone from recent projects' }));
    await waitFor(() => expect(api.forgetRecent).toHaveBeenCalledWith('C:\\w\\gone.aqc'));
    // Opening closes the modal, so it comes last.
    await userEvent.click(within(dialog).getByRole('button', { name: /^Open A/ }));
    await waitFor(() => expect(api.openProject).toHaveBeenCalledWith('C:\\w\\a.aqc'));
  });

  it('answers Ctrl+S, Ctrl+Shift+S and Ctrl+O', async () => {
    const { api } = await home();
    fireEvent.keyDown(document, { key: 's', ctrlKey: true });
    fireEvent.keyDown(document, { key: 'S', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(document, { key: 'o', ctrlKey: true });
    await waitFor(() => expect(api.openProject).toHaveBeenCalledWith());
    expect(api.saveProject).toHaveBeenCalledTimes(1);
    expect(api.saveProjectAs).toHaveBeenCalledTimes(1);
  });

  it('ignores a held-down Ctrl+S, so key repeat does not stack up saves', async () => {
    const { api } = await home();
    fireEvent.keyDown(document, { key: 's', ctrlKey: true });
    fireEvent.keyDown(document, { key: 's', ctrlKey: true, repeat: true });
    fireEvent.keyDown(document, { key: 's', ctrlKey: true, repeat: true });
    await waitFor(() => expect(api.saveProject).toHaveBeenCalledTimes(1));
  });

  it('offers to restore unsaved work left by a crash', async () => {
    const { api } = await home({ recoveries: vi.fn().mockResolvedValueOnce(okv([
      { id: 'a', name: 'Northshire rework', recoveredFrom: null, writtenAt: '2026-09-23T14:02:00.000Z', questCount: 12, damaged: false },
      { id: 'bad', name: '', recoveredFrom: null, writtenAt: '', questCount: 0, damaged: true },
    ])).mockResolvedValue(okv([])) });
    const dialog = await screen.findByRole('alertdialog', { name: 'Recover unsaved work' });
    expect(within(dialog).getByText(/Northshire rework/)).toBeInTheDocument();
    expect(within(dialog).getByText(/12 quests/)).toBeInTheDocument();
    expect(within(dialog).getByText('Damaged recovery file')).toBeInTheDocument();
    expect(within(dialog).getAllByRole('button', { name: /^Restore/ })).toHaveLength(1);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Restore Northshire rework' }));
    await waitFor(() => expect(api.restoreRecovery).toHaveBeenCalledWith('a'));
    await waitFor(() => expect(screen.queryByRole('alertdialog', { name: 'Recover unsaved work' })).toBeNull());
  });
});
