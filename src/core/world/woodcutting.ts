import type { WorldDb } from '../db/world-db';
import { rowsOrNone } from '../db/rows-or-none';

/**
 * Woodcutting trees, a Conquest of Azeroth / Ascension feature: chest objects with the axe cursor whose
 * loot always gives a log. Nothing here is named by entry, so a database without them has none and the
 * 3D view offers nothing. The bonus magical log is a chance in the same loot table, so choosing a tree
 * chooses what it gives.
 */

/** The cursor a woodcutting tree shows over it */
const AXE_CURSOR = 'AxeCursor';
/** `gameobject_template.type` of a chest, and the column holding a chest's loot id */
const CHEST = '3';
const LOOT_COLUMN = 'Data1';
/** A tree not found within this many yards of a place is not "near" it */
const NEAR_YARDS = 400;

export interface WoodcuttingTree {
  entry: number;
  name: string;
  /** What its guaranteed log is called without "Log": Forestwood, Wildwood… */
  tier: string;
  /** The guaranteed log's item id: higher tiers are later items */
  tierRank: number;
}

export interface TreeTier {
  tier: string;
  trees: WoodcuttingTree[];
}

type Reads = Pick<WorldDb, 'selectRows' | 'lookupNames' | 'columns'>;

/** The trees the database has, ordered by entry; none when it has no axe-cursor chests or no loot to read */
export async function readWoodcuttingTrees(db: Reads): Promise<WoodcuttingTree[]> {
  if ((await db.columns('gameobject_template')).length === 0 || (await db.columns('gameobject_loot_template')).length === 0) return [];
  const chests = await rowsOrNone(db, 'gameobject_template', { type: CHEST, IconName: AXE_CURSOR });
  if (chests.length === 0) return [];

  const lootIds = [...new Set(chests.map((c) => c[LOOT_COLUMN] ?? '0').filter((id) => id !== '0'))];
  const rows = await rowsOrNone(db, 'gameobject_loot_template', { Entry: lootIds });
  // A table's guaranteed item: its sure (100%) row outside any group, a reference or a quest
  const sure = new Map<string, number>();
  for (const row of rows) {
    if (Number(row['Chance']) < 100 || row['GroupId'] !== '0' || row['Reference'] !== '0' || row['QuestRequired'] !== '0') continue;
    sure.set(row['Entry'] ?? '', Number(row['Item']));
  }
  const names = await db.lookupNames('item', [...new Set(sure.values())]);

  const trees: WoodcuttingTree[] = [];
  for (const chest of chests) {
    const item = sure.get(chest[LOOT_COLUMN] ?? '');
    const log = item === undefined ? undefined : /^(.+) Log$/.exec(names.get(item) ?? '')?.[1];
    if (item === undefined || log === undefined) continue;
    trees.push({ entry: Number(chest['entry']), name: chest['name'] ?? '', tier: log, tierRank: item });
  }
  return trees.sort((a, b) => a.entry - b.entry);
}

/** Trees by tier, the tiers in the order of their logs and each tier's trees by name */
export function tiersOf(trees: readonly WoodcuttingTree[]): TreeTier[] {
  const byTier = new Map<string, TreeTier & { rank: number }>();
  for (const tree of trees) {
    const found = byTier.get(tree.tier) ?? { tier: tree.tier, trees: [], rank: tree.tierRank };
    found.trees.push(tree);
    byTier.set(tree.tier, found);
  }
  return [...byTier.values()]
    .sort((a, b) => a.rank - b.rank)
    .map(({ tier, trees: members }) => ({ tier, trees: [...members].sort((a, b) => a.name.localeCompare(b.name) || a.entry - b.entry) }));
}

/** The entry of the nearest of these tree spawns to a place; null when none is near it */
export function nearestTree(spots: readonly { entry: number; x: number; y: number }[], at: { x: number; y: number }): number | null {
  let best: { entry: number; away: number } | null = null;
  for (const spot of spots) {
    const away = Math.hypot(spot.x - at.x, spot.y - at.y);
    if (away <= NEAR_YARDS && (!best || away < best.away)) best = { entry: spot.entry, away };
  }
  return best?.entry ?? null;
}
