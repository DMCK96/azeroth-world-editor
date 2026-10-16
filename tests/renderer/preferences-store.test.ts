// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PREFERENCES, PREFERENCES_KEY, clampDockSize, parsePreferences, readPreferences, subscribePreferences, writePreferences,
} from '../../src/renderer/preferences/store';

afterEach(() => localStorage.clear());

describe('preferences store', () => {
  it('keeps a dock size between 15% and 85%', () => {
    expect(clampDockSize(0)).toBe(0.15);
    expect(clampDockSize(2)).toBe(0.85);
    expect(clampDockSize(0.5)).toBe(0.5);
  });

  it('gives the defaults for nothing, junk, or the wrong version', () => {
    expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences('{not json')).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences(JSON.stringify({ version: 99, dockSide: 'right' }))).toEqual(DEFAULT_PREFERENCES);
  });

  it('keeps valid fields and defaults the invalid ones one by one', () => {
    const raw = JSON.stringify({ version: 1, dockSide: 'sideways', dockSize: { bottom: 0.5, right: -3 } });
    expect(parsePreferences(raw)).toEqual({ dockSide: 'bottom', dockSize: { bottom: 0.5, right: DEFAULT_PREFERENCES.dockSize.right }, snapKey: 'alt' });
  });

  it('clamps sizes to 0.15..0.85', () => {
    const raw = JSON.stringify({ version: 1, dockSide: 'right', dockSize: { bottom: 5, right: 0.01 } });
    expect(parsePreferences(raw).dockSize).toEqual({ bottom: 0.85, right: 0.15 });
  });

  it('writes versioned data, reads it back, and tells subscribers', () => {
    const heard = vi.fn();
    const stop = subscribePreferences(heard);
    writePreferences({ dockSide: 'right', dockSize: { bottom: 0.3, right: 0.6 }, snapKey: 'ctrl' });
    expect(JSON.parse(localStorage.getItem(PREFERENCES_KEY)!).version).toBe(1);
    expect(readPreferences()).toEqual({ dockSide: 'right', dockSize: { bottom: 0.3, right: 0.6 }, snapKey: 'ctrl' });
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    writePreferences(DEFAULT_PREFERENCES);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('survives storage that throws', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readPreferences()).toEqual(DEFAULT_PREFERENCES);
    get.mockRestore();
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => writePreferences(DEFAULT_PREFERENCES)).not.toThrow();
    set.mockRestore();
  });
});

describe('the snap key', () => {
  it('is Alt until chosen, and an unknown key falls back to it', () => {
    expect(DEFAULT_PREFERENCES.snapKey).toBe('alt');
    expect(parsePreferences(JSON.stringify({ version: 1, snapKey: 'shift' })).snapKey).toBe('shift');
    expect(parsePreferences(JSON.stringify({ version: 1, snapKey: 'f13' })).snapKey).toBe('alt');
  });
});
