import { spawnEntryColumn } from '../../db/spawns';
import { rowsOrNone } from '../../db/rows-or-none';
import type { WorldDb } from '../../db/world-db';
import type { WorldLayer } from '../../world/layer';
import type { SpawnGroup } from '../../world/groups';
import { idsAbove } from '../free';
import { claimKey, type IdClaim, type IdHolder, type IdKind, type ProjectIds } from './kind';

/** How far a database spawn may stand from the project's and still be the project's own, applied by an exported patch */
export const SAME_SPOT = 0.5;

type Scope = 'creature' | 'gameobject';

const num = (raw: string | null | undefined): number => Number(raw ?? 0) || 0;

/** The kind of group member a scope's spawn is */
const memberKind = (scope: string): 'npc' | 'object' => (scope === 'creature' ? 'npc' : 'object');

const renameGroup = (group: SpawnGroup, scope: string, from: number, to: number): SpawnGroup => ({
  ...group,
  members: group.members.map((m) => (m.type === 'spawn' && m.kind === memberKind(scope) && m.guid === from ? { ...m, guid: to } : m)),
});

function renameWorld(world: WorldLayer, scope: string, from: number, to: number): WorldLayer {
  const placed = world.added.some((a) => a.kind === scope && a.guid === from);
  const next: WorldLayer = { ...world, added: world.added.map((a) => (a.kind === scope && a.guid === from ? { ...a, guid: to } : a)) };
  // A movement or event edit with this guid is the placed creature's only while the layer places it; otherwise it is the database creature's
  if (scope === 'creature' && placed) {
    if (world.movements) next.movements = world.movements.map((m) => (m.guid === from ? { ...m, guid: to } : m));
    if (world.spawnEvents) next.spawnEvents = world.spawnEvents.map((e) => (e.guid === from ? { ...e, guid: to } : e));
  }
  if (world.groups) next.groups = world.groups.map((g) => renameGroup(g, scope, from, to));
  return next;
}

/** The guids of the spawns the project adds: its NPCs' and objects' own, and the ones placed in the 3D view */
export const spawnGuidKind: IdKind = {
  key: 'spawn-guid',

  scopeLabel: (scope) => (scope === 'creature' ? 'NPC spawn' : 'Object spawn'),

  claims({ entities, world }) {
    const claims: IdClaim[] = [];
    for (const n of entities.npcs) for (const s of n.spawns) claims.push({ scope: 'creature', id: s.guid, entry: n.entry, name: n.name, map: s.map, x: s.x, y: s.y, z: s.z });
    for (const o of entities.objects) for (const s of o.spawns) claims.push({ scope: 'gameobject', id: s.guid, entry: o.entry, name: o.name, map: s.map, x: s.x, y: s.y, z: s.z });
    for (const a of world.added) claims.push({ scope: a.kind, id: a.guid, entry: a.entry, name: a.name, map: a.map, x: a.placement.x, y: a.placement.y, z: a.placement.z });
    return claims;
  },

  async holders(db, claims) {
    const found = new Map<string, IdHolder>();
    for (const scope of ['creature', 'gameobject'] as Scope[]) {
      const ids = claims.filter((c) => c.scope === scope).map((c) => String(c.id));
      if (ids.length === 0) continue;
      const columns = (await db.columns(scope)).map((c) => c.name);
      if (columns.length === 0) continue;
      const entryColumn = spawnEntryColumn(scope, columns);
      const rows = await rowsOrNone(db, scope, { guid: ids });
      const names = await db.lookupNames(scope, [...new Set(rows.map((r) => num(r[entryColumn])))]);
      for (const r of rows) {
        const entry = num(r[entryColumn]);
        found.set(claimKey(scope, num(r.guid)), { entry, name: names.get(entry) ?? '', map: num(r.map), x: num(r.position_x), y: num(r.position_y), z: num(r.position_z) });
      }
    }
    return found;
  },

  isSameThing: (claim, holder) =>
    claim.entry === holder.entry && claim.map === holder.map &&
    Math.abs(claim.x - holder.x) <= SAME_SPOT && Math.abs(claim.y - holder.y) <= SAME_SPOT && Math.abs(claim.z - holder.z) <= SAME_SPOT,

  rename(project, scope, from, to): ProjectIds {
    const spawns = <T extends { guid: number }>(list: T[]): T[] => list.map((s) => (s.guid === from ? { ...s, guid: to } : s));
    const { npcs, objects } = project.entities;
    return {
      entities: {
        ...project.entities,
        npcs: scope === 'creature' ? npcs.map((n) => ({ ...n, spawns: spawns(n.spawns) })) : npcs,
        objects: scope === 'gameobject' ? objects.map((o) => ({ ...o, spawns: spawns(o.spawns) })) : objects,
      },
      world: renameWorld(project.world, scope, from, to),
    };
  },

  async freeIds(db: WorldDb, project, scope, count) {
    let dbMax = 0;
    try {
      dbMax = (await db.selectMax?.(scope, 'guid')) ?? 0;
    } catch {
      // A fork without the table has none
    }
    const used = spawnGuidKind.claims(project).filter((c) => c.scope === scope).map((c) => c.id);
    return idsAbove(dbMax, used, count);
  },
};
