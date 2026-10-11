import { describe, expect, it } from 'vitest';
import { wantsFakeUpdate } from '../../src/main/updates/flags';

describe('wantsFakeUpdate', () => {
  it('is asked for by the --fake-update flag, wherever it sits in the arguments', () => {
    expect(wantsFakeUpdate({}, ['electron', '.', '--fake-update'])).toBe(true);
    expect(wantsFakeUpdate({}, ['app.exe', '--fake-update', '--other'])).toBe(true);
  });
  it('or by AWE_FAKE_UPDATE=1', () => {
    expect(wantsFakeUpdate({ AWE_FAKE_UPDATE: '1' }, ['app.exe'])).toBe(true);
  });
  it('is off otherwise, including for look-alikes', () => {
    expect(wantsFakeUpdate({}, ['app.exe'])).toBe(false);
    expect(wantsFakeUpdate({ AWE_FAKE_UPDATE: '0' }, ['app.exe'])).toBe(false);
    expect(wantsFakeUpdate({ AWE_FAKE_UPDATE: '' }, ['app.exe'])).toBe(false);
    expect(wantsFakeUpdate({}, ['app.exe', '--fake-updates', 'fake-update'])).toBe(false);
  });
});
