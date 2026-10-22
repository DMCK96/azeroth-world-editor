import { item, type MenuItem } from '../model';
import { NEEDS_GROUND, type MenuSection } from '../section';
import { tiersOf } from '@core/world/woodcutting';
import type { GroundSubject } from './kinds';

/**
 * Spawn a woodcutting tree here: the nearest tree's kind, or any tree by tier and then name. The trees
 * are a Conquest of Azeroth / Ascension feature, so a database without them, or no database, offers
 * nothing: no item and no submenu.
 */
export const woodcutting: MenuSection<GroundSubject> = {
  id: 'woodcutting',
  group: 'world',
  appliesTo: (subject, context): subject is GroundSubject => subject.type === 'ground' && !context.placing,
  items: ({ at }, context) => {
    if (!context.connected || context.woodcutting.length === 0) return [];
    if (!at) return [item('Spawn woodcutting tree here', { disabledReason: NEEDS_GROUND }), item('Woodcutting tree', { disabledReason: NEEDS_GROUND })];
    const tiers: MenuItem[] = tiersOf(context.woodcutting).map((tier) =>
      item(tier.tier, {
        children: tier.trees.map((tree) => ({
          // Trees may share a name (a variant of another's), so each is told by its entry
          ...item(tree.name, { hint: String(tree.entry), action: { kind: 'placeTree', entry: tree.entry, name: tree.name, at } }),
          id: `woodcutting-tree-${tree.entry}`,
        })),
      }),
    );
    return [item('Spawn woodcutting tree here', { action: { kind: 'placeNearestTree', at } }), item('Woodcutting tree', { children: tiers })];
  },
};
