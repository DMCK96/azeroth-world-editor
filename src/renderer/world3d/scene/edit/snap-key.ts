/**
 * The key that, held during a drag, snaps what is dragged to the surface under it. Which key is a
 * preference; the view only asks whether it is down on a pointer event.
 */
export type SnapKey = 'alt' | 'ctrl' | 'shift';

export const SNAP_KEYS: readonly SnapKey[] = ['alt', 'ctrl', 'shift'];
export const DEFAULT_SNAP_KEY: SnapKey = 'alt';

/** Whether the snap key is down in a pointer or key event */
export function snapKeyHeld(event: { altKey: boolean; ctrlKey: boolean; shiftKey: boolean }, key: SnapKey): boolean {
  return key === 'alt' ? event.altKey : key === 'ctrl' ? event.ctrlKey : event.shiftKey;
}

/** How far, in yards, the server's floor may be from the surface a thing was snapped to and still be taken */
export const DEFAULT_SNAP_TOLERANCE = 1;
export const MIN_SNAP_TOLERANCE = 0.1;
export const MAX_SNAP_TOLERANCE = 10;

/** A tolerance kept between the smallest and the largest; the default for anything that is not a number */
export function clampSnapTolerance(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SNAP_TOLERANCE;
  return Math.min(MAX_SNAP_TOLERANCE, Math.max(MIN_SNAP_TOLERANCE, value));
}
