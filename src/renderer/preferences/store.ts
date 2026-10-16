// Local, per-machine preferences. Never part of the project file.
import { DEFAULT_SNAP_KEY, SNAP_KEYS, type SnapKey } from '../world3d/scene/edit/snap-key';
export type DockSide = 'bottom' | 'right';

export interface Preferences {
  dockSide: DockSide;
  /** Fractions of the window, 0.15 to 0.85. */
  dockSize: { bottom: number; right: number };
  /** The key that, held while dragging in the 3D view, snaps to the surface under it */
  snapKey: SnapKey;
}

export const PREFERENCES_KEY = 'acqc.preferences';
const VERSION = 1;
/** The smallest and largest share of the window the dock takes */
export const DOCK_MIN_SIZE = 0.15;
export const DOCK_MAX_SIZE = 0.85;

/** A dock size kept between the smallest and the largest */
export function clampDockSize(n: number): number {
  return Math.min(DOCK_MAX_SIZE, Math.max(DOCK_MIN_SIZE, n));
}

export const DEFAULT_PREFERENCES: Preferences = {
  dockSide: 'bottom',
  dockSize: { bottom: 0.4, right: 0.4 },
  snapKey: DEFAULT_SNAP_KEY,
};

const listeners = new Set<() => void>();
let snapshot: Preferences | null = null;

function size(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return clampDockSize(value);
}

export function parsePreferences(raw: string | null): Preferences {
  let data: unknown;
  try { data = raw === null ? null : JSON.parse(raw); } catch { return DEFAULT_PREFERENCES; }
  if (typeof data !== 'object' || data === null || (data as { version?: unknown }).version !== VERSION) return DEFAULT_PREFERENCES;
  const { dockSide, dockSize, snapKey } = data as { dockSide?: unknown; dockSize?: Partial<Record<DockSide, unknown>> | null; snapKey?: unknown };
  return {
    dockSide: dockSide === 'bottom' || dockSide === 'right' ? dockSide : DEFAULT_PREFERENCES.dockSide,
    dockSize: {
      bottom: size(dockSize?.bottom, DEFAULT_PREFERENCES.dockSize.bottom),
      right: size(dockSize?.right, DEFAULT_PREFERENCES.dockSize.right),
    },
    snapKey: SNAP_KEYS.find((k) => k === snapKey) ?? DEFAULT_PREFERENCES.snapKey,
  };
}

export function readPreferences(): Preferences {
  try { return parsePreferences(localStorage.getItem(PREFERENCES_KEY)); } catch { return DEFAULT_PREFERENCES; }
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function writePreferences(next: Preferences): void {
  snapshot = next;
  try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ version: VERSION, ...next })); } catch { /* storage blocked: keep the in-memory change */ }
  notify();
}

export function subscribePreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The cached current value, stable between changes so it suits useSyncExternalStore. */
export function getPreferencesSnapshot(): Preferences {
  snapshot ??= readPreferences();
  return snapshot;
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== PREFERENCES_KEY) return;
    snapshot = readPreferences();
    notify();
  });
}
