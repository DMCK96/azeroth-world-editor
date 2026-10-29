import type { WorldRouteEdit } from '../../world/layer';
import { listKind } from './list-kind';

/** A route (`waypoint_data` path) edited in the 3D view. */
export const routeKind = listKind<WorldRouteEdit>({
  key: 'route',
  label: 'Routes',
  list: (doc) => doc.world.routes,
  keyOf: (r) => String(r.pathId),
  put: (doc, routes) => ({ ...doc, world: { ...doc.world, routes } }),
  describe: (r) => `Route ${r.pathId} (${r.current.length} points)`,
  fields: (r) => {
    const p = r.current[0];
    return { points: String(r.current.length), first: p ? `${p.x},${p.y},${p.z}` : '' };
  },
  comparable: (r) => r.current,
});
