import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MenuAction, MenuGroup, MenuItem } from './menu/model';
import './WorldContextMenu.css';

const MENU_WIDTH = 260;

/** The items of one menu element, in order, for the arrow keys */
const itemsOf = (menu: HTMLElement | null): HTMLElement[] =>
  menu ? [...menu.querySelectorAll<HTMLElement>(':scope > .world3d-menu__group > .world3d-menu__entry > [data-menu-item], :scope > .world3d-menu__entry > [data-menu-item]')] : [];

/** Moves focus one item up or down a menu, round the ends */
function step(menu: HTMLElement | null, by: 1 | -1): void {
  const items = itemsOf(menu);
  if (items.length === 0) return;
  const now = items.indexOf(document.activeElement as HTMLElement);
  items[(now + by + items.length) % items.length]?.focus();
}

/**
 * The 3D view's right-click menu: the groups the target offers, separated, at the cursor and kept
 * inside the window. An item that cannot run says why and does nothing; one with children opens a
 * submenu (hover, → or Enter), which may open another. Esc closes it and goes no further, and so does a click outside.
 */
export function WorldContextMenu({
  groups,
  at,
  onPick,
  onClose,
}: {
  groups: MenuGroup[];
  at: { x: number; y: number };
  onPick(action: MenuAction): void;
  onClose(): void;
}): React.JSX.Element {
  const menu = useRef<HTMLDivElement | null>(null);
  const [top, setTop] = useState(at.y);
  const [open, setOpen] = useState<string | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const height = menu.current?.offsetHeight ?? 0;
    setTop(Math.max(0, Math.min(at.y, window.innerHeight - height)));
  }, [at.y]);

  useEffect(() => {
    const first = itemsOf(menu.current).find((item) => item.getAttribute('aria-disabled') !== 'true');
    first?.focus();
    const outside = (e: MouseEvent): void => {
      // Submenus are portalled out of the menu, so they are told apart by class
      const inside = menu.current?.contains(e.target as Node) || (e.target as Element).closest?.('.world3d-menu');
      if (!inside) onCloseRef.current();
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
    // Once, when it opens: a render after that leaves the focus where the arrows put it
  }, []);

  function onKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      step(menu.current, e.key === 'ArrowDown' ? 1 : -1);
    }
  }

  const left = Math.max(0, Math.min(at.x, window.innerWidth - MENU_WIDTH));
  return (
    <div ref={menu} role="menu" aria-label="World actions" className="world3d-menu glass" style={{ left, top }} onKeyDown={onKeyDown}>
      {groups.map((group, g) => (
        <Fragment key={group.id}>
          {g > 0 && <div role="separator" className="world3d-menu__separator" />}
          <div className="world3d-menu__group" role="group">
            {group.items.map((item) => (
              <Item key={item.id} item={item} open={open === item.id} onOpen={(yes) => setOpen(yes ? item.id : null)} onPick={onPick} />
            ))}
          </div>
        </Fragment>
      ))}
    </div>
  );
}

/** A submenu's items, one of which may have its own submenu open (a tier of trees opens its trees) */
function Items({ items, onPick }: { items: MenuItem[]; onPick(action: MenuAction): void }): React.JSX.Element {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      {items.map((item) => (
        <Item key={item.id} item={item} open={open === item.id} onOpen={(yes) => setOpen(yes ? item.id : null)} onPick={onPick} />
      ))}
    </>
  );
}

function Item({ item, open, onOpen, onPick }: { item: MenuItem; open: boolean; onOpen(open: boolean): void; onPick(action: MenuAction): void }): React.JSX.Element {
  const reason = useId();
  const self = useRef<HTMLButtonElement | null>(null);
  const entry = useRef<HTMLDivElement | null>(null);
  const sub = useRef<HTMLDivElement | null>(null);
  const [subAt, setSubAt] = useState<{ left: number; top: number } | null>(null);
  const disabled = item.disabledReason !== undefined;
  const parent = item.children !== undefined;

  // The submenu is portalled to the body (the menu scrolls and clips its children), so it is placed
  // beside its entry in window coordinates: to the right, or to the left when there is no room
  useLayoutEffect(() => {
    if (!open || !entry.current) {
      setSubAt(null);
      return;
    }
    const rect = entry.current.getBoundingClientRect();
    const height = sub.current?.offsetHeight ?? 0;
    const left = rect.right + MENU_WIDTH > window.innerWidth ? Math.max(0, rect.left - MENU_WIDTH) : rect.right;
    setSubAt({ left, top: Math.max(0, Math.min(rect.top - 5, window.innerHeight - height)) });
  }, [open]);

  // A submenu opened by key takes focus on its first item, once it is placed
  const placed = subAt !== null;
  useEffect(() => {
    if (open && placed) itemsOf(sub.current)[0]?.focus();
  }, [open, placed]);

  const run = (): void => {
    if (disabled) return;
    if (parent) onOpen(true);
    else if (item.action) onPick(item.action);
  };
  const closeSub = (): void => {
    onOpen(false);
    self.current?.focus();
  };

  return (
    <div ref={entry} className="world3d-menu__entry" onMouseEnter={() => parent && !disabled && onOpen(true)} onMouseLeave={() => parent && onOpen(false)}>
      <button
        ref={self}
        type="button"
        data-menu-item=""
        role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
        aria-checked={item.checked === undefined ? undefined : item.checked}
        aria-disabled={disabled ? 'true' : undefined}
        aria-describedby={disabled ? reason : undefined}
        aria-haspopup={parent ? 'menu' : undefined}
        aria-expanded={parent ? open : undefined}
        className="world3d-menu__item"
        onClick={run}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' && parent && !disabled) {
            e.preventDefault();
            e.stopPropagation();
            onOpen(true);
          } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            run();
          }
        }}
      >
        <span className="world3d-menu__check" aria-hidden="true">
          {item.checked ? '✓' : ''}
        </span>
        <span className="world3d-menu__label">{item.label}</span>
        {item.hint && <span className="world3d-menu__reason">{item.hint}</span>}
        {parent && (
          <span className="world3d-menu__more" aria-hidden="true">
            ›
          </span>
        )}
        {disabled && (
          <span id={reason} className="world3d-menu__reason">
            {item.disabledReason}
          </span>
        )}
      </button>
      {parent &&
        open &&
        createPortal(
          <div
            ref={sub}
            style={subAt ?? { left: 0, top: 0, visibility: 'hidden' }}
            role="menu"
            aria-label={item.label}
            className="world3d-menu world3d-menu--sub glass"
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeSub();
              } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                e.stopPropagation();
                step(sub.current, e.key === 'ArrowDown' ? 1 : -1);
              }
            }}
          >
            <Items items={item.children!} onPick={onPick} />
          </div>,
          document.body,
        )}
    </div>
  );
}
