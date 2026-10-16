import { spawnEntryColumn } from '../../db/spawns';
import { rowsOrNone } from '../../db/rows-or-none';
import type { WorldDb } from '../../db/world-db';
import { entityOf } from '../../scripts/tag';
import { PLACED_COMMENT, type WorldLayer } from '../../world/layer';
import type { SpawnGroup } from '../../world/groups';
import { idsAbove } from '../free';
import type { Spawn } from '../../entities/model';
import { claimKey, type IdClaim, type IdHolder, type IdKind, type ProjectIds } from './kind';

/** How far a database spawn may stand from the project's and still be the project's own, applied by an exported patch */
export const SAME_SPOT = 0.5;

type Scope = 'creature' | 'gameobject';

const num = (raw: string | null | undefined): number => Number(raw ?? 0) || 0;

/** The kind of group member a scope's spawn is */
const memberKind = (scope: string): 'npc' | 'object' => (scope === 'creature' ? 'npc' : 'object');

/** The spawns an adopted group holds in the database: a member at one of these guids is the database's own, not the project's */
function databaseMembers(group: SpawnGroup, scope: string): Set<number> {
  if (group.origin.kind !== 'existing') return new Set();
  const table = scope === 'creature' ? 'pool_creature' : 'pool_gameobject';
  return new Set(group.origin.original.members.filter((m) => m.table === table).map((m) => num(m.row.guid)));
}

function renameGroup(group: SpawnGroup, scope: string, from: number, to: number): SpawnGroup {
  const theirs = databaseMembers(group, scope);
  return {
    ...group,
    members: group.members.map((m) => (m.type === 'spawn' && m.kind === memberKind(scope) && m.guid === from && !theirs.has(from) ? { ...m, guid: to } : m)),
  };
}

/** A patrol's "use an object" actions name an object spawn by its guid, so they follow it */
function renamePatrolTargets(spawn: Spawn, from: number, to: number): Spawn {
  if (!spawn.patrol) return spawn;
  const points = spawn.patrol.points.map((p) => ({ ...p, actions: p.actions.map((a) => (a.kind === 'useObject' && a.guid === from ? { ...a, guid: to } : a)) }));
  return { ...spawn, patrol: { ...spawn.patrol, points } };
}

/** Whether a database row carries this tool's mark for the spawn's NPC or object (its entity tag, or the 3D view's) */
function writtenByTool(claim: IdClaim, holder: IdHolder): boolean {
  if (holder.comment === PLACED_COMMENT) return true;
  const tag = entityOf(holder.comment);
  return tag !== null && tag.entry === claim.entry && tag.kind === (claim.scope === 'creature' ? 'npc' : 'obj');
}

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
  noun: 'spawn',

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
      // One table that cannot be read leaves the other's clashes standing
      try {
        const columns = (await db.columns(scope)).map((c) => c.name);
        if (columns.length === 0) continue;
        const entryColumn = spawnEntryColumn(scope, columns);
        const rows = await rowsOrNone(db, scope, { guid: ids });
        const names = await db.lookupNames(scope, [...new Set(rows.map((r) => num(r[entryColumn])))]);
        for (const r of rows) {
          const entry = num(r[entryColumn]);
          found.set(claimKey(scope, num(r.guid)), {
            entry, name: names.get(entry) ?? '', map: num(r.map), x: num(r.position_x), y: num(r.position_y), z: num(r.position_z),
            ...(r.Comment ? { comment: r.Comment } : {}),
          });
        }
      } catch {
        // Skipped: this table cannot say what it holds
      }
    }
    return found;
  },

  // The project's own row is the same NPC or object on the same map where it was written, or one this tool wrote for it, which stays in a dev database after the spawn is moved
  isSameThing: (claim, holder) =>
    claim.entry === holder.entry &&
    (writtenByTool(claim, holder) ||
      (claim.map === holder.map && Math.abs(claim.x - holder.x) <= SAME_SPOT && Math.abs(claim.y - holder.y) <= SAME_SPOT && Math.abs(claim.z - holder.z) <= SAME_SPOT)),

  rename(project, scope, from, to): ProjectIds {
    const spawns = <T extends { guid: number }>(list: T[]): T[] => list.map((s) => (s.guid === from ? { ...s, guid: to } : s));
    const { npcs, objects } = project.entities;
    return {
      entities: {
        ...project.entities,
        npcs: scope === 'creature'
          ? npcs.map((n) => ({ ...n, spawns: spawns(n.spawns) }))
          : npcs.map((n) => ({ ...n, spawns: n.spawns.map((s) => renamePatrolTargets(s, from, to)) })),
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
