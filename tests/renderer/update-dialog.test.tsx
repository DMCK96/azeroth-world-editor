// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UpdateDialog } from '../../src/renderer/views/UpdateDialog';
import { makeMockApi, okv, errv } from './mock-api';

const url = 'https://github.com/DMCK96/azeroth-world-editor/releases/tag/v0.8.0';
const offer = {
  current: '0.6.0', latest: '0.8.0', releaseUrl: url,
  notes: [
    { version: '0.8.0', title: 'v0.8.0', body: '## Fixes\n- Export is stable (abc1234)\n- A **bold** fix (def5678)', url },
    { version: '0.7.0', title: 'v0.7.0', body: '', url: 'u7' },
  ],
};
afterEach(cleanup);

function open(over: Record<string, any> = {}, blocked = false) {
  const api = makeMockApi({ updateCheck: async () => okv(offer), ...over });
  const view = render(<UpdateDialog api={api} blocked={blocked} />);
  return { api, ...view };
}

describe('UpdateDialog', () => {
  it('shows both versions and every release\'s notes, newest first', async () => {
    open();
    expect(await screen.findByRole('alertdialog', { name: /update available/i })).toBeTruthy();
    expect(screen.getByText('0.6.0')).toBeTruthy();
    expect(screen.getByText('0.8.0', { selector: '.update-dialog__latest' })).toBeTruthy();
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['v0.8.0', 'v0.7.0']);
    expect(screen.getByText(/Export is stable \(abc1234\)/)).toBeTruthy();
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.getByText('No release notes.')).toBeTruthy();
  });
  it('shows nothing when there is no update, no api, or the check fails', async () => {
    const none = makeMockApi({ updateCheck: async () => okv(null) });
    const { container } = render(<UpdateDialog api={none} blocked={false} />);
    await waitFor(() => expect(none.updateCheck).toHaveBeenCalled());
    expect(container.textContent).toBe('');
    cleanup();
    expect(render(<UpdateDialog api={undefined} blocked={false} />).container.textContent).toBe('');
    cleanup();
    const failing = makeMockApi({ updateCheck: async () => errv('UNKNOWN', 'x') });
    const r = render(<UpdateDialog api={failing} blocked={false} />);
    await waitFor(() => expect(failing.updateCheck).toHaveBeenCalled());
    expect(r.container.textContent).toBe('');
  });
  it('checks once, however many times it re-renders', async () => {
    const { api, rerender } = open();
    await screen.findByRole('alertdialog');
    rerender(<UpdateDialog api={api} blocked={false} />);
    expect(api.updateCheck).toHaveBeenCalledTimes(1);
  });
  it('Remind me later closes, tells main so a reopened window stays quiet, and stores no skip', async () => {
    const { api } = open();
    await userEvent.click(await screen.findByRole('button', { name: 'Remind me later' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.updateRemind).toHaveBeenCalledTimes(1);
    expect(api.updateSkip).not.toHaveBeenCalled();
    expect(api.updateOpen).not.toHaveBeenCalled();
  });
  it('Skip this update stores the latest version and closes', async () => {
    const { api } = open();
    await userEvent.click(await screen.findByRole('button', { name: 'Skip this update' }));
    expect(api.updateSkip).toHaveBeenCalledWith('0.8.0');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });
  it('Update opens the release page and closes', async () => {
    const { api } = open();
    await userEvent.click(await screen.findByRole('button', { name: 'Update' }));
    expect(api.updateOpen).toHaveBeenCalledWith(url);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });
  it('stays open and says why when opening the page fails', async () => {
    open({ updateOpen: async () => errv('BAD_REQUEST', 'That address is not one of this project\'s releases.') });
    await userEvent.click(await screen.findByRole('button', { name: 'Update' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/not one of this project/);
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });
  it('Escape and the backdrop remind later, they do not skip', async () => {
    const { api } = open();
    await screen.findByRole('alertdialog');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.updateSkip).not.toHaveBeenCalled();
    expect(api.updateRemind).toHaveBeenCalledTimes(1);
    cleanup();
    const second = open();
    await screen.findByRole('alertdialog');
    await userEvent.click(second.container.querySelector('.modal-backdrop')!);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(second.api.updateSkip).not.toHaveBeenCalled();
  });
  it('takes focus itself, so a stray Space or Enter from a field behind it presses nothing', async () => {
    const { api } = open();
    const dialog = await screen.findByRole('alertdialog');
    expect(document.activeElement).toBe(dialog);
    await userEvent.keyboard('{Enter} ');
    expect(api.updateOpen).not.toHaveBeenCalled();
    expect(api.updateSkip).not.toHaveBeenCalled();
  });
  it('keeps Escape from whatever is open behind it', async () => {
    const behind = vi.fn();
    document.addEventListener('keydown', behind);
    try {
      open();
      await screen.findByRole('alertdialog');
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(behind).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', behind);
    }
  });
  it('still hears Escape after a click on plain text moved focus away from the buttons', async () => {
    open();
    await userEvent.click(await screen.findByText('Installed', { exact: false }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  it('a drag that starts in the notes and ends on the backdrop does not dismiss it', async () => {
    const { container } = open();
    await screen.findByRole('alertdialog');
    fireEvent.mouseDown(screen.getByText(/Export is stable/));
    const backdrop = container.querySelector('.modal-backdrop')!;
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });
  it('a double click on Update opens the page once', async () => {
    let release!: () => void;
    const slow = vi.fn(() => new Promise((resolve) => { release = () => resolve(okv(null)); }));
    open({ updateOpen: slow });
    const button = await screen.findByRole('button', { name: 'Update' });
    await userEvent.dblClick(button);
    expect(slow).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });
  it('shows notes as inert text, never as markup or a link', async () => {
    const hostile = { ...offer, notes: [{ version: '0.8.0', title: 'v0.8.0', body: '<img src=x onerror=alert(1)>\n[go](javascript:alert(1))', url }] };
    const { container } = open({ updateCheck: async () => okv(hostile) });
    await screen.findByRole('alertdialog');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    expect(screen.getByText('go')).toBeTruthy();
  });
  it('waits while the recovery dialog is up, then appears', async () => {
    const api = makeMockApi({ updateCheck: async () => okv(offer) });
    const { rerender } = render(<UpdateDialog api={api} blocked={true} />);
    await waitFor(() => expect(api.updateCheck).toHaveBeenCalled());
    expect(screen.queryByRole('alertdialog')).toBeNull();
    rerender(<UpdateDialog api={api} blocked={false} />);
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    expect(api.updateCheck).toHaveBeenCalledTimes(1);
  });
});
