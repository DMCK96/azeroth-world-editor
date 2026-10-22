import { nearestTree, readWoodcuttingTrees } from '../../core/world/woodcutting';
import { rowsOrNone } from '../../core/db/rows-or-none';
import type { WoodcuttingApi } from '../../shared/ipc';
import type { Services } from './services';
import { run } from './errors';

/** Woodcutting trees: which the database has, and which stands nearest a place */
export function createWoodcuttingApi(s: Services): WoodcuttingApi {
  const { deps, connected } = s.ctx;

  return {
    worldWoodcuttingTrees: () => run(async () => readWoodcuttingTrees(connected().db)),

    worldNearestWoodcuttingTree: (map, x, y) =>
      run(async () => {
        const db = connected().db;
        const entries = new Set((await readWoodcuttingTrees(db)).map((t) => t.entry));
        if (entries.size === 0) return null;
        const rows = await rowsOrNone(db, 'gameobject', { id: [...entries].map(String), map: String(map) });
        const spots = rows.map((r) => ({ entry: Number(r['id']), x: Number(r['position_x']), y: Number(r['position_y']) }));
        for (const a of deps.session.world.get().added) {
          if (a.kind === 'gameobject' && a.map === map && entries.has(a.entry)) spots.push({ entry: a.entry, x: a.placement.x, y: a.placement.y });
        }
        return nearestTree(spots, { x, y });
      }),
  };
}
