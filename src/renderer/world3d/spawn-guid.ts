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
