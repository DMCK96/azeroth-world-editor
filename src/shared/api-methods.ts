import type { Api } from './ipc';

/**
 * The method names and channel names, with no runtime dependencies at all.
 *
 * This sits apart from `ipc/` because the preload imports it: a sandboxed preload script cannot
 * `require` anything from `node_modules`, so it must not reach code that pulls zod in. Everything
 * else should import these from `@shared/ipc`, which re-exports them.
 */

/** Every method the bridge exposes, in `Api` declaration order. */
export const API_METHODS = [
  'testConnection',
  'saveProfile',
  'listProfiles',
  'deleteProfile',
  'startupProfile',
  'connect',
  'chooseServerDataDir',
  'searchQuests',
  'questsOfNpc',
  'searchEntities',
  'openQuest',
  'newQuest',
  'addQuestChain',
  'listNodes',
  'moveNodes',
  'removeNode',
  'saveViewport',
  'lookupNames',
  'questLinks',
  'rewardTables',
  'updateQuest',
  'previewChanges',
  'validate',
  'questScripts',
  'testCommands',
  'groundHeight',
  'spellFacts',
  'clientMaps',
  'mapFloors',
  'viewSpawns',
  'projectEntities',
  'putProjectEntities',
  'deleteEntity',
  'readExistingEntity',
  'existingDrift',
  'worldLayer',
  'worldMoveSpawn',
  'worldAddSpawn',
  'worldRoute',
  'worldSetRoute',
  'worldDeleteSpawn',
  'worldRevert',
  'worldChanges',
  'worldGroup',
  'worldGroupView',
  'worldGroupSpawns',
  'worldGroupsOnMap',
  'worldNewGroupId',
  'worldCheckGroup',
  'worldSetGroup',
  'worldDeleteGroup',
  'worldDropMember',
  'questPools',
  'gameEvents',
  'historyList',
  'historyUndo',
  'historyRedo',
  'historyJump',
  'historyBegin',
  'historyEnd',
  'exportProject',
  'worldSetMovement',
  'worldSetRespawn',
  'worldSetSpawnEvents',
  'worldNewPathId',
  'questSpawnList',
  'entitySpawns',
  'findSpawns',
  'spawnPlacement',
  'allocateIds',
  'patrolPathId',
  'entityTemplate',
  'itemColumns',
  'exportQuest',
  'applyToDev',
  'projectState',
  'renameProject',
  'newProject',
  'openProject',
  'saveProject',
  'saveProjectAs',
  'recentProjects',
  'forgetRecent',
  'recoveries',
  'restoreRecovery',
  'discardRecovery',
  'mcpStatus',
  'mcpConfigure',
  'mcpRegenerateToken',
  'questsInZone',
  'questSummaries',
  'areaOverview',
  'checkNames',
  'checkIds',
  'wikiSearch',
  'wikiPage',
  'projectIssues',
  'debugStatus',
  'debugSetEnabled',
  'debugEvents',
  'debugSnapshot',
  'debugType',
  'captureScreenshot',
  'cameraStatus',
  'cameraTeleport',
  'debugRecord',
  'debugAnswer',
  'updateCheck',
  'updateSkip',
  'updateOpen',
] as const satisfies readonly (keyof Api)[];

/** Fails to compile if `Api` gains or loses a method that this list does not follow. */
type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _everyMethodIsListed: Exactly<(typeof API_METHODS)[number], keyof Api> = true;
void _everyMethodIsListed;

/** The IPC channel one method answers on. */
export const channelFor = (method: keyof Api): string => `api:${method}`;

/**
 * Closing the window: main asks the renderer to hand over any debounced edit, and the renderer
 * answers once it has, so the unsaved-changes check sees everything the user typed.
 */
export const FLUSH_REQUEST_CHANNEL = 'app:flush';
export const FLUSH_DONE_CHANNEL = 'app:flushed';

/** Main tells the window it was connected to a world database by a tool of the MCP server (an AI client). */
export const CONNECTED_CHANNEL = 'app:connected';

/** Main tells the window what a tool of the MCP server (an AI client) changed in the project, as an undo result. */
export const EXTERNAL_CHANGE_CHANNEL = 'app:external-change';
/** Main to window: `true` while an AI client's write is on its way (hold quest saves), `false` once it is done. */
export const HOLD_EDITS_CHANNEL = 'app:hold-edits';

/** Main to window: Debug mode was switched on (`true`) or off (`false`), so the window attaches or removes its recorders. */
export const DEBUG_CHANGED_CHANNEL = 'app:debug-changed';
/** Main to window: a question for the page (a focus snapshot or an element's rectangle), answered with `debugAnswer`. */
export const DEBUG_REQUEST_CHANNEL = 'app:debug-request';

/** Main tells the window the undo history after every step, undo, redo, save or clear. */
export const HISTORY_CHANNEL = 'app:history';
