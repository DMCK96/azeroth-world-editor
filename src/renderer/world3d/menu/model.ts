import type { SpawnInfo } from '../scene/spawn/SpawnManager';
import type { QuestRoles, Role } from '@core/modules/quest-roles';
import type { Dock } from '@core/map/transport-docks';
import type { WoodcuttingTree } from '@core/world/woodcutting';
import type { MenuGroupId } from './section';

/**
 * The 3D view's right-click menu as data: what was right-clicked (the target), what the view and the
 * open quest allow (the context), and the items and groups the sections (see `section.ts`) build from
 * them. Building it is pure; the view runs the action an item carries.
 */

export type At = { x: number; y: number; z: number };
export type MenuSpawn = SpawnInfo;
/** The editor tabs the menu can open an NPC on */
export type MenuEditorTab = 'vendor' | 'trainer' | 'gossip' | 'scripts';

export interface MenuTarget {
  /** The ground under the right-click, or null for sky */
  ground: At | null;
  hit: { type: 'spawn'; spawn: MenuSpawn } | { type: 'point'; guid: number; index: number } | null;
  /** The spawns selected once the right-click has selected what it hit */
  selection: MenuSpawn[];
  /** The vessel under the right-click: a docked one with its dock, or the view's own (no dock) */
  vessel?: { dock: Dock | null } | null;
}

export interface QuestMenuInfo {
  id: number;
  title: string;
  /** Entries by role in the open quest */
  roles: QuestRoles;
  /** The chain has quests besides this one */
  chained: boolean;
}

export interface MenuContext {
  map: number;
  /** The world database is there: existing NPCs and objects can be placed */
  connected: boolean;
  /** How many spawns are copied, and why they cannot be pasted here (null when they can) */
  clipboard: { count: number; blocked: string | null };
  placing: boolean;
  drawing: { guid: number; points: number } | null;
  quest: QuestMenuInfo | null;
  /** A project is open: a new quest can be started */
  project: boolean;
  /** Quest spawns are marked in the view */
  marked: boolean;
  /** The view shows a vessel: its passengers' walking paths are drawn there but not edited */
  vessel: boolean;
  /** The woodcutting trees the database has (a Conquest of Azeroth / Ascension feature); none when it has none */
  woodcutting: readonly WoodcuttingTree[];
}

export type MenuAction =
  | { kind: 'stopPlacing' }
  | { kind: 'finishPath' }
  | { kind: 'undoPoint' }
  | { kind: 'cancelPath' }
  | { kind: 'placeHere'; what: 'creature' | 'object'; at: At }
  /** A new project NPC or object standing here, attached to no quest */
  | { kind: 'newEntity'; what: 'creature' | 'object'; at: At }
  /** A woodcutting tree of this entry standing here */
  | { kind: 'placeTree'; entry: number; name: string; at: At }
  /** A woodcutting tree of the kind nearest here, standing here */
  | { kind: 'placeNearestTree'; at: At }
  /** `tab`: the editor tab to open on */
  | { kind: 'editEntity'; spawn: MenuSpawn; tab?: MenuEditorTab }
  | { kind: 'setLootable'; spawn: MenuSpawn; on: boolean }
  | { kind: 'copy' }
  | { kind: 'paste'; at: At }
  | { kind: 'duplicate' }
  /** Deletes these spawns, with no question asked: the undo step takes them back */
  | { kind: 'delete'; spawns: MenuSpawn[] }
  | { kind: 'copyCoordinates'; at: At }
  /** How long the spawns take to respawn, asked for in a dialog */
  | { kind: 'respawn'; spawns: MenuSpawn[] }
  /** Which game events NPC spawns follow of their own, asked for in a dialog */
  | { kind: 'spawnEvents'; spawns: MenuSpawn[] }
  /** A new spawn group of these spawns, made in a dialog */
  | { kind: 'groupSpawns'; spawns: MenuSpawn[] }
  /** A spawn group's members and chances, changed in a dialog */
  | { kind: 'editGroup'; id: number }
  /** Selects a spawn group's members, so its card shows */
  | { kind: 'showGroup'; id: number }
  /** Takes a spawn out of the group it is in */
  | { kind: 'leaveGroup'; spawn: MenuSpawn }
  | { kind: 'startPath'; spawn: MenuSpawn; at: At }
  | { kind: 'wander'; spawn: MenuSpawn }
  /** What an NPC does at one point of its route, changed in a dialog */
  | { kind: 'pointSettings'; guid: number; index: number }
  | { kind: 'removePath'; spawn: MenuSpawn }
  | { kind: 'toggleRole'; role: Role; spawn: MenuSpawn; on: boolean }
  | { kind: 'newQuest'; spawn: MenuSpawn; after: boolean }
  /** The quests an NPC starts and ends, listed in a dialog */
  | { kind: 'findQuests'; spawn: MenuSpawn }
  | { kind: 'showSpawns'; scope: 'quest' | 'chain' }
  | { kind: 'hideSpawns' }
  /** The stops of the vessel right-clicked, listed in a dialog */
  | { kind: 'vesselStops'; dock: Dock | null };

export interface MenuItem {
  id: string;
  label: string;
  action?: MenuAction;
  /** Why the item cannot run now; it is shown, disabled, with this */
  disabledReason?: string;
  /** Muted text after the label, such as how many things a vendor sells */
  hint?: string;
  /** A role the target has (shown with a check) or not */
  checked?: boolean;
  children?: MenuItem[];
}

export interface MenuGroup {
  id: MenuGroupId;
  items: MenuItem[];
}

/** A stable id from a label, without counts: "Paste here (3)" is `paste-here` */
export const itemId = (label: string): string =>
  label
    .replace(/\(\d+\)|\s\d+$/g, '')
    .replace(/…/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const item = (label: string, rest: Omit<MenuItem, 'id' | 'label'> = {}): MenuItem => ({ id: itemId(label), label, ...rest });

/** What the menu may still do while an AI client is writing: look, copy, and put down what is half done in the view alone */
const READS: ReadonlySet<MenuAction['kind']> = new Set([
  'stopPlacing', 'undoPoint', 'cancelPath', 'copy', 'copyCoordinates', 'showGroup', 'findQuests', 'showSpawns', 'hideSpawns', 'vesselStops',
]);

/** Whether a menu action changes the project (so it waits while an AI client is writing) */
export const editsProject = (action: MenuAction): boolean => !READS.has(action.kind);

export const AI_WRITING = 'The assistant is changing the project; try again in a moment';

/** The menu with every item that edits the project disabled, saying why */
export function lockEdits(groups: MenuGroup[]): MenuGroup[] {
  const lock = (entry: MenuItem): MenuItem => ({
    ...entry,
    ...(entry.action && editsProject(entry.action) ? { disabledReason: AI_WRITING } : {}),
    ...(entry.children ? { children: entry.children.map(lock) } : {}),
  });
  return groups.map((group) => ({ ...group, items: group.items.map(lock) }));
}
