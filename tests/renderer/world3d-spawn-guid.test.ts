import { describe, expect, it } from 'vitest';
import { newSpawnGuids, putInIdOrder } from '../../src/renderer/world3d/spawn-guid';
import type { Api } from '../../src/shared/ipc';

/** An api whose allocator, like the main process's, does not see ids it has just handed out */
const forgetful = (calls: unknown[][]): Api =>
  ({
    allocateIds: async (kind: string, count: number) => {
      calls.push([kind, count]);
      return { ok: true, value: Array.from({ length: count }, (_, i) => 1000 + i) };
    },
  }) as unknown as Api;

describe('guids for a group of new spawns', () => {
  it('asks once for the whole group, so no two share a guid', async () => {
    const calls: unknown[][] = [];
    const made = await newSpawnGuids(forgetful(calls), 'object', 10);
    expect(calls).toEqual([['gameobjectSpawn', 10]]);
    expect('guids' in made && new Set(made.guids).size).toBe(10);
  });

  it('asks for nothing when there is nothing to place', async () => {
    const calls: unknown[][] = [];
    expect(await newSpawnGuids(forgetful(calls), 'creature', 0)).toEqual({ guids: [] });
    expect(calls).toEqual([]);
  });

  it('says so when the allocator gives fewer than asked', async () => {
    const api = { allocateIds: async () => ({ ok: true, value: [5] }) } as unknown as Api;
    expect(await newSpawnGuids(api, 'creature', 2)).toEqual({ error: 'No free spawn ID could be found.' });
  });
});

describe('a paste of the world layer\'s spawns and the project\'s own', () => {
  type Put = { name: string; own: boolean; kind: 'creature' | 'object' };

  /** One pool of ids: the allocator, like the main process's, sees spawns already placed but not ids it handed out */
  const pool = () => {
    const placed: number[] = [];
    const next = (n: number) => Array.from({ length: n }, (_, i) => Math.max(1000, ...placed) + 1 + i);
    const api = { allocateIds: async (_kind: string, count: number) => ({ ok: true, value: next(count) }) } as unknown as Api;
    const putOne = async (put: Put, guid: number | undefined): Promise<number | null> => {
      const id = put.own ? guid! : next(1)[0]!;
      placed.push(id);
      return id;
    };
    return { api, putOne };
  };

  it('gives every spawn an id of its own', async () => {
    const { api, putOne } = pool();
    const puts: Put[] = [
      { name: 'altar', own: false, kind: 'object' },
      { name: 'crystal', own: true, kind: 'object' },
      { name: 'skull', own: false, kind: 'object' },
      { name: 'portal', own: true, kind: 'object' },
      { name: 'candle', own: false, kind: 'object' },
    ];
    const done = await putInIdOrder(api, puts, putOne, () => {});
    expect(done).toHaveLength(5);
    expect(new Set(done.map((d) => d.result)).size).toBe(5);
  });

  it('skips the own spawns, and says why, when no ids are free', async () => {
    const notes: string[] = [];
    const api = { allocateIds: async () => ({ ok: true, value: [] }) } as unknown as Api;
    const done = await putInIdOrder(api, [{ name: 'a', own: false, kind: 'object' }, { name: 'b', own: true, kind: 'object' }], async (p, g) => (p.own ? g ?? null : 1), (m) => notes.push(m));
    expect(done.map((d) => d.put.name)).toEqual(['a']);
    expect(notes).toEqual(['No free spawn ID could be found.']);
  });
});
