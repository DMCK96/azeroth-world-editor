import type { Api } from '@shared/ipc';

/** Said when every spawn guid in the project's range is taken */
export const NO_FREE_GUID = 'No free spawn ID could be found.';

/**
 * Fresh guids for new spawns of the project's own NPCs or objects, or why there are none. A group is asked
 * for together: the project reaches the main process after a pause, so asking one at a time would hand
 * every spawn of a paste the same guid.
 */
export async function newSpawnGuids(api: Api, kind: 'creature' | 'object', count: number): Promise<{ guids: number[] } | { error: string }> {
  if (count === 0) return { guids: [] };
  const ids = await api.allocateIds(kind === 'object' ? 'gameobjectSpawn' : 'creatureSpawn', count);
  if (!ids.ok) return { error: ids.error.message };
  return ids.value.length >= count ? { guids: ids.value.slice(0, count) } : { error: NO_FREE_GUID };
}

/** A fresh guid for one new spawn of the project's own NPC or object, or why there is none */
export async function newSpawnGuid(api: Api, kind: 'creature' | 'object'): Promise<{ guid: number } | { error: string }> {
  const made = await newSpawnGuids(api, kind, 1);
  return 'error' in made ? made : { guid: made.guids[0]! };
}

/**
 * Puts a group of spawns down, the world layer's first. The world layer takes the next id above the database's
 * and cannot see ids merely handed out, so the project's own spawns ask for theirs after, when the allocator
 * sees the ones placed. Each put that went down comes back with what `putOne` made of it.
 */
export async function putInIdOrder<P extends { own: boolean; kind: 'creature' | 'object' }, R>(
  api: Api,
  puts: readonly P[],
  putOne: (put: P, guid: number | undefined) => Promise<R | null>,
  say: (note: string) => void,
): Promise<{ put: P; result: R }[]> {
  const done: { put: P; result: R }[] = [];
  const place = async (put: P, guid?: number): Promise<void> => {
    const result = await putOne(put, guid);
    if (result !== null) done.push({ put, result });
  };
  for (const put of puts) if (!put.own) await place(put);
  for (const kind of ['creature', 'object'] as const) {
    const own = puts.filter((p) => p.own && p.kind === kind);
    const made = await newSpawnGuids(api, kind, own.length);
    if ('error' in made) {
      say(made.error);
      continue;
    }
    for (const [i, put] of own.entries()) await place(put, made.guids[i]!);
  }
  return done;
}
