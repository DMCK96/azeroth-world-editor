import { describe, expect, it } from 'vitest';
import { newSpawnGuids } from '../../src/renderer/world3d/spawn-guid';
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
