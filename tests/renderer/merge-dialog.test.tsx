// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '../../src/renderer/state/app-store';
import { MergeDialog } from '../../src/renderer/views/MergeDialog';
import { makeMockApi } from './mock-api';

const entry = (over: object = {}) => ({ decisionId: 'quest|1', kind: 'quest', label: 'Quests', key: '1', outcome: 'conflict', base: 'Quest 1: a', mine: 'Quest 1: b', theirs: 'Quest 1: c', diff: [{ field: 'quest_template.LogTitle', from: 'b', to: 'c' }], ...over });
const decision = (over: object = {}) => ({ id: 'quest|1', type: 'conflict', label: 'Quests', entryIds: ['quest|1'], options: ['mine', 'theirs'], default: null, newKey: null, rewrites: [], ...over });
const preview = (over: object = {}) => ({
  twoWay: false, summary: [{ kind: 'quest', label: 'Quests', common: 1, fromMine: 1, fromTheirs: 1, renumbered: 0, total: 3 }],
  dropped: [], decisions: [decision()], entries: [entry()], settled: false, warnings: [], notCarried: ['The result is a new unsaved project; none of the three files is changed.'], fingerprint: 'f'.repeat(64), ...over,
});

function mount(p: object | null = preview(), api = makeMockApi()) {
  const store = createAppStore(api);
  store.setState({ merge: { open: true, theirsPath: 'C:\\t.awe', basePath: 'C:\\b.awe', preview: p, choices: {}, busy: false } } as never);
  render(<MergeDialog store={store} />);
  return { api, store };
}

describe('MergeDialog', () => {
  it('shows nothing while closed', () => {
    const store = createAppStore(makeMockApi());
    render(<MergeDialog store={store} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the five sections in order', () => {
    mount();
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Result', 'Will be dropped', 'Not carried over', 'Needs a decision', 'Warnings']);
  });

  it('keeps every section, saying None. when it is empty', () => {
    mount(preview({ decisions: [], entries: [], notCarried: [], settled: true }));
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(5);
    for (const name of ['Will be dropped', 'Not carried over', 'Needs a decision', 'Warnings']) {
      expect(screen.getByRole('heading', { name }).nextElementSibling).toHaveTextContent('None.');
    }
  });

  it('shows no sections before there is a preview', () => {
    mount(null);
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
  });

  it('shows what is not carried over, before anything is applied', () => {
    mount();
    expect(screen.getByRole('dialog', { name: 'Merge projects' })).toHaveTextContent('none of the three files is changed');
  });

  it('shows both sides of a conflict and what differs', () => {
    mount();
    const d = screen.getByRole('dialog');
    expect(d).toHaveTextContent('Quest 1: b');
    expect(d).toHaveTextContent('Quest 1: c');
    expect(d).toHaveTextContent('quest_template.LogTitle');
  });

  it('keeps Merge disabled until every decision is settled, and counts the drops', () => {
    mount(preview({ settled: false, dropped: [{}, {}] as never }));
    expect(screen.getByRole('button', { name: 'Merge (drops 2)' })).toBeDisabled();
  });

  it('enables Merge once settled', () => {
    mount(preview({ settled: true, decisions: [] }));
    expect(screen.getByRole('button', { name: 'Merge (drops 0)' })).toBeEnabled();
  });

  it('a choice is sent to the store', async () => {
    const { store } = mount();
    const spy = vi.spyOn(store.getState(), 'chooseMerge');
    store.setState({ chooseMerge: spy } as never);
    await userEvent.click(screen.getByRole('radio', { name: 'Keep theirs' }));
    expect(spy).toHaveBeenCalledWith('quest|1', 'theirs');
  });

  it('offers keep both on a collision and names the new id', () => {
    mount(preview({ decisions: [decision({ type: 'collision', options: ['both', 'mine', 'theirs'], default: 'both', newKey: '60006' })], settled: true }));
    expect(screen.getByRole('radio', { name: 'Keep both (theirs gets 60006)' })).toBeChecked();
  });

  it('lists what keep-both rewrites', () => {
    mount(preview({ decisions: [decision({ type: 'collision', options: ['both', 'mine', 'theirs'], default: 'both', newKey: '60006', rewrites: ['Group 1 g'] })], settled: true }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Group 1 g');
  });

  it('says the merge is two-way when there is no base', () => {
    mount(preview({ twoWay: true }));
    expect(screen.getByRole('dialog')).toHaveTextContent('No base: the merge cannot tell which side changed what.');
  });

  it('shows every dropped item with the file it came from', () => {
    mount(preview({ dropped: [{ from: 'theirs', what: 'item', kind: 'quest', label: 'Quests', key: '1', line: 'Quest 1: c' }] }));
    const section = screen.getByRole('heading', { name: 'Will be dropped' }).nextElementSibling!;
    expect(section).toHaveTextContent('theirs');
    expect(section).toHaveTextContent('Quest 1: c');
  });

  it('shows the warnings', () => {
    mount(preview({ warnings: ['Group 1 g points at quest 7, which is not in the result'] }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Group 1 g points at quest 7');
  });

  it('shows the store error inside the dialog', () => {
    const { store } = mount();
    act(() => store.setState({ error: 'The merged project was not opened.' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('The merged project was not opened.');
  });

  it('No base asks the store for a two-way merge', async () => {
    const { store } = mount();
    const spy = vi.fn(async () => {});
    store.setState({ clearMergeBase: spy } as never);
    await userEvent.click(screen.getByRole('button', { name: 'No base (two-way merge)' }));
    expect(spy).toHaveBeenCalled();
  });

  it('Cancel closes without merging', async () => {
    const { api, store } = mount();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(store.getState().merge.open).toBe(false);
    expect(api.mergeApply).not.toHaveBeenCalled();
  });
});
