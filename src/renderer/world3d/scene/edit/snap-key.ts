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
