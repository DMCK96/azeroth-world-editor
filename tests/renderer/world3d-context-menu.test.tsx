// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorldContextMenu } from '../../src/renderer/world3d/WorldContextMenu';
import type { MenuGroup } from '../../src/renderer/world3d/menu/model';

const at = { x: 1, y: 2, z: 3 };
const groups: MenuGroup[] = [
  { id: 'world', items: [
    { id: 'place-npc-here', label: 'Place NPC here…', action: { kind: 'placeHere', what: 'creature', at } },
    { id: 'paste-here', label: 'Paste here', disabledReason: 'Copy something first' },
  ] },
  { id: 'quest', items: [
    { id: 'quests', label: 'Quests', children: [{ id: 'show-quest-spawns', label: 'Show quest spawns', action: { kind: 'showSpawns', scope: 'quest' } }] },
    { id: 'quest-giver', label: 'Quest giver', checked: true, action: { kind: 'hideSpawns' } },
  ] },
];

function open() {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(<WorldContextMenu groups={groups} at={{ x: 10, y: 20 }} onPick={onPick} onClose={onClose} />);
  return { onPick, onClose };
}

describe('the 3D view’s right-click menu', () => {
  it('focuses the first item and moves round with the arrows', async () => {
    open();
    expect(screen.getByRole('menuitem', { name: 'Place NPC here…' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: /Paste here/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Quest giver' })).toHaveFocus();
  });

  it('runs an item on Enter or click', async () => {
    const { onPick } = open();
    await userEvent.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith({ kind: 'placeHere', what: 'creature', at });
  });

  it('shows why an item cannot run, and does nothing when it is clicked', async () => {
    const { onPick } = open();
    const paste = screen.getByRole('menuitem', { name: /Paste here/ });
    expect(paste).toHaveAttribute('aria-disabled', 'true');
    expect(paste).toHaveAccessibleDescription('Copy something first');
    await userEvent.click(paste);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('opens a submenu with the right arrow, and the left arrow closes only it', async () => {
    const { onPick, onClose } = open();
    screen.getByRole('menuitem', { name: 'Quests' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('menuitem', { name: 'Show quest spawns' })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.queryByRole('menuitem', { name: 'Show quest spawns' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Quests' })).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard('{ArrowRight}{Enter}');
    expect(onPick).toHaveBeenCalledWith({ kind: 'showSpawns', scope: 'quest' });
  });

  it('opens a submenu inside a submenu with the right arrow, and the left arrow closes the inner one first', async () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    const tiers: MenuGroup[] = [{ id: 'world', items: [{ id: 'trees', label: 'Trees', children: [
      { id: 'wild', label: 'Wildwood', children: [{ id: 'tree-1', label: 'Redridge Tree', action: { kind: 'placeTree', entry: 1, name: 'Redridge Tree', at } }] },
    ] }] }];
    render(<WorldContextMenu groups={tiers} at={{ x: 10, y: 20 }} onPick={onPick} onClose={onClose} />);
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('menuitem', { name: 'Wildwood' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('menuitem', { name: 'Redridge Tree' })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.queryByRole('menuitem', { name: 'Redridge Tree' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Wildwood' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}{Enter}');
    expect(onPick).toHaveBeenCalledWith({ kind: 'placeTree', entry: 1, name: 'Redridge Tree', at });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows a check on a checked item', () => {
    open();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Quest giver' })).toHaveAttribute('aria-checked', 'true');
  });

  it('Esc closes it and goes no further; a click outside closes it', async () => {
    const outer = vi.fn();
    document.addEventListener('keydown', outer);
    const { onClose } = open();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    document.removeEventListener('keydown', outer);
    await userEvent.click(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('stays inside the window', () => {
    Object.defineProperty(window, 'innerWidth', { value: 300, configurable: true });
    render(<WorldContextMenu groups={groups} at={{ x: 290, y: 5 }} onPick={vi.fn()} onClose={vi.fn()} />);
    expect(parseFloat(screen.getByRole('menu', { name: 'World actions' }).style.left)).toBeLessThanOrEqual(40);
  });

  it('keeps focus where the arrows put it when it renders again', async () => {
    const { rerender } = render(<WorldContextMenu groups={groups} at={{ x: 10, y: 20 }} onPick={vi.fn()} onClose={() => {}} />);
    await userEvent.keyboard('{ArrowDown}');
    rerender(<WorldContextMenu groups={groups} at={{ x: 10, y: 20 }} onPick={vi.fn()} onClose={() => {}} />);
    expect(screen.getByRole('menuitem', { name: /Paste here/ })).toHaveFocus();
  });
});

describe('a menu item\'s hint', () => {
  it('is shown after the label', () => {
    const items: MenuGroup[] = [{ id: 'world', items: [{ id: 'edit-vendor-stock', label: 'Edit vendor stock…', hint: '2 items', action: { kind: 'hideSpawns' } }] }];
    render(<WorldContextMenu groups={items} at={{ x: 10, y: 20 }} onPick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('menuitem', { name: /Edit vendor stock…/ })).toHaveTextContent('2 items');
  });
});
