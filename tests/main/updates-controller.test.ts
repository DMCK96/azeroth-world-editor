import { describe, expect, it, vi } from 'vitest';
import { openStore } from '../../src/main/store/store';
import { createUpdateSettings } from '../../src/main/updates/settings';
import { createUpdateController, type UpdateFetch } from '../../src/main/updates/controller';

const box = { encrypt: (s: string) => Uint8Array.from(Buffer.from(s)), decrypt: (b: Uint8Array) => Buffer.from(b).toString() };
const base = 'https://github.com/DMCK96/azeroth-world-editor/releases';
const gh = (tag: string, over: Record<string, unknown> = {}) => ({ tag_name: tag, name: tag, body: `notes ${tag}`, html_url: `${base}/tag/${tag}`, prerelease: false, draft: false, ...over });
const reply = (body: unknown, status = 200): UpdateFetch => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function setup(fetch: UpdateFetch, over: Record<string, unknown> = {}) {
  const store = openStore(':memory:', box);
  const settings = createUpdateSettings(store);
  const opened: string[] = [];
  const warn = vi.fn();
  const controller = createUpdateController({
    fetch, settings, version: '0.6.0', enabled: true, openExternal: async (u) => void opened.push(u), warn, timeoutMs: 20, ...over,
  });
  return { controller, settings, opened, warn, store };
}

describe('the update settings', () => {
  it('remembers a skipped version and never lowers it', () => {
    const { settings } = setup(reply([]));
    expect(settings.skipped()).toBeNull();
    settings.setSkipped('v0.8.0');
    expect(settings.skipped()).toBe('0.8.0');
    settings.setSkipped('0.7.0');
    expect(settings.skipped()).toBe('0.8.0');
    settings.setSkipped('junk');
    expect(settings.skipped()).toBe('0.8.0');
    settings.setSkipped('0.9.0');
    expect(settings.skipped()).toBe('0.9.0');
  });
});

describe('check', () => {
  it('asks GitHub for the releases list with the documented request', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const { controller } = setup(async (url, init) => {
      calls.push({ url, headers: init.headers });
      return { ok: true, status: 200, json: async () => [] };
    });
    await controller.check();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.github.com/repos/DMCK96/azeroth-world-editor/releases?per_page=30');
    expect(calls[0]!.headers['Accept']).toBe('application/vnd.github+json');
  });
  it('offers a newer published release', async () => {
    const { controller } = setup(reply([gh('v0.7.0'), gh('v0.6.0')]));
    const offer = await controller.check();
    expect(offer).toMatchObject({ current: '0.6.0', latest: '0.7.0', releaseUrl: `${base}/tag/v0.7.0` });
    expect(offer?.notes).toHaveLength(1);
  });
  it('offers nothing when up to date', async () => {
    expect(await setup(reply([gh('v0.6.0')])).controller.check()).toBeNull();
  });
  it('does not fetch at all when disabled', async () => {
    const fetch = vi.fn(reply([gh('v0.7.0')]));
    expect(await setup(fetch, { enabled: false }).controller.check()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('honours a skipped version', async () => {
    const { controller, settings } = setup(reply([gh('v0.7.0')]));
    settings.setSkipped('0.7.0');
    expect(await controller.check()).toBeNull();
  });
  it('is silent when GitHub is unreachable, rate limited, or answers nonsense', async () => {
    const cases: UpdateFetch[] = [
      async () => { throw new Error('offline'); },
      reply({ message: 'API rate limit exceeded' }, 403),
      reply({ message: 'API rate limit exceeded' }, 200),
      reply('not a list'),
      async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } }),
      reply([null, 5, 'x', { tag_name: 7 }, {}]),
    ];
    for (const fetch of cases) {
      const { controller } = setup(fetch);
      expect(await controller.check()).toBeNull();
    }
  });
  it('gives up after the timeout', async () => {
    const hang: UpdateFetch = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    const { controller } = setup(hang, { timeoutMs: 10 });
    expect(await controller.check()).toBeNull();
  });
  it('skips malformed entries but still reads the good ones', async () => {
    const { controller } = setup(reply([null, { tag_name: 7 }, gh('v0.7.0')]));
    expect((await controller.check())?.latest).toBe('0.7.0');
  });
  it('reads a missing body or name as none', async () => {
    const { controller } = setup(reply([gh('v0.7.0', { body: null, name: null })]));
    expect((await controller.check())?.notes[0]).toMatchObject({ title: 'v0.7.0', body: '' });
  });
});

describe('skip', () => {
  it('stores the version, so the next check is quiet', async () => {
    const { controller } = setup(reply([gh('v0.7.0')]));
    controller.skip('0.7.0');
    expect(await controller.check()).toBeNull();
  });
  it('refuses a version that is not one', () => {
    const { controller } = setup(reply([]));
    expect(() => controller.skip('banana')).toThrow(/version/i);
  });
});

describe('open', () => {
  it('opens a page of this project\'s releases', async () => {
    const { controller, opened } = setup(reply([]));
    await controller.open(`${base}/tag/v0.7.0`);
    await controller.open(base);
    expect(opened).toEqual([`${base}/tag/v0.7.0`, base]);
  });
  it('refuses everything else', async () => {
    const { controller, opened } = setup(reply([]));
    const bad = [
      'https://evil.example/DMCK96/azeroth-world-editor/releases/tag/v1',
      'https://github.com.evil.example/DMCK96/azeroth-world-editor/releases/tag/v1',
      'https://github.com@evil.example/DMCK96/azeroth-world-editor/releases/tag/v1',
      'http://github.com/DMCK96/azeroth-world-editor/releases/tag/v1',
      'https://github.com/other/repo/releases/tag/v1',
      'https://github.com/DMCK96/azeroth-world-editor/releases-fake',
      'https://github.com/DMCK96/azeroth-world-editor',
      'javascript:alert(1)',
      'file:///C:/Windows/System32/calc.exe',
      'not a url',
      '',
    ];
    for (const url of bad) await expect(controller.open(url)).rejects.toThrow();
    expect(opened).toEqual([]);
  });
});
