import { describe, expect, it } from 'vitest';
import { compareVersions, normalizeVersion, parseVersion } from '../../src/core/updates/version';
import { selectUpdate } from '../../src/core/updates/select';
import type { Release } from '../../src/core/updates/types';

const rel = (tag: string, over: Partial<Release> = {}): Release => ({
  tag, name: tag, body: `notes for ${tag}`, url: `https://github.com/DMCK96/azeroth-world-editor/releases/tag/${tag}`, prerelease: false, draft: false, ...over,
});

describe('versions', () => {
  it('parses MAJOR.MINOR.PATCH with an optional v and nothing else', () => {
    expect(parseVersion('0.7.0')).toEqual([0, 7, 0]);
    expect(parseVersion('v1.20.3')).toEqual([1, 20, 3]);
    for (const bad of ['', 'v', '1.2', '1.2.3.4', '1.2.3-beta.1', 'latest', '1.2.x', ' 1.2.3']) expect(parseVersion(bad)).toBeNull();
  });
  it('compares numerically, not as text', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.6.0', '0.6.1')).toBeLessThan(0);
    expect(() => compareVersions('1.0.0', 'nope')).toThrow(RangeError);
  });
  it('normalizes away the v', () => {
    expect(normalizeVersion('v0.7.0')).toBe('0.7.0');
    expect(normalizeVersion('0.7')).toBeNull();
  });
});

describe('selectUpdate', () => {
  it('offers nothing when the installed version is the latest', () => {
    expect(selectUpdate({ releases: [rel('v0.6.0'), rel('v0.5.0')], current: '0.6.0', skipped: null })).toBeNull();
  });
  it('offers nothing when the installed build is ahead of every release', () => {
    expect(selectUpdate({ releases: [rel('v0.6.0')], current: '0.7.0', skipped: null })).toBeNull();
    expect(selectUpdate({ releases: [], current: '0.6.0', skipped: null })).toBeNull();
  });
  it('offers the newest release with the notes of every release after the installed one, newest first', () => {
    const offer = selectUpdate({ releases: [rel('v0.6.0'), rel('v0.8.0'), rel('v0.7.0'), rel('v0.5.0')], current: '0.6.0', skipped: null });
    expect(offer).toEqual({
      current: '0.6.0',
      latest: '0.8.0',
      releaseUrl: 'https://github.com/DMCK96/azeroth-world-editor/releases/tag/v0.8.0',
      notes: [
        { version: '0.8.0', title: 'v0.8.0', body: 'notes for v0.8.0', url: 'https://github.com/DMCK96/azeroth-world-editor/releases/tag/v0.8.0' },
        { version: '0.7.0', title: 'v0.7.0', body: 'notes for v0.7.0', url: 'https://github.com/DMCK96/azeroth-world-editor/releases/tag/v0.7.0' },
      ],
    });
  });
  it('orders by version, not by the order GitHub listed them', () => {
    expect(selectUpdate({ releases: [rel('v0.9.0'), rel('v0.10.0')], current: '0.8.0', skipped: null })?.latest).toBe('0.10.0');
  });
  it('ignores drafts, pre-releases and tags that are not plain versions', () => {
    const releases = [rel('v9.0.0', { draft: true }), rel('v8.0.0', { prerelease: true }), rel('v7.0.0-beta.1'), rel('nightly'), rel('v0.7.0')];
    const offer = selectUpdate({ releases, current: '0.6.0', skipped: null });
    expect(offer?.latest).toBe('0.7.0');
    expect(offer?.notes.map((n) => n.version)).toEqual(['0.7.0']);
  });
  it('stays quiet for a skipped version and speaks again for a newer one', () => {
    const releases = [rel('v0.7.0'), rel('v0.6.0')];
    expect(selectUpdate({ releases, current: '0.6.0', skipped: '0.7.0' })).toBeNull();
    expect(selectUpdate({ releases: [rel('v0.8.0'), ...releases], current: '0.6.0', skipped: '0.7.0' })?.latest).toBe('0.8.0');
  });
  it('treats an unparseable skipped value as nothing skipped', () => {
    expect(selectUpdate({ releases: [rel('v0.7.0')], current: '0.6.0', skipped: 'garbage' })?.latest).toBe('0.7.0');
  });
  it('uses the tag as the title when a release has no name, and an empty body for none', () => {
    const offer = selectUpdate({ releases: [rel('v0.7.0', { name: null, body: null })], current: '0.6.0', skipped: null });
    expect(offer?.notes[0]).toMatchObject({ title: 'v0.7.0', body: '' });
    expect(selectUpdate({ releases: [rel('v0.7.0', { name: '   ' })], current: '0.6.0', skipped: null })?.notes[0]?.title).toBe('v0.7.0');
  });
});
