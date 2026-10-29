import { z } from 'zod';
import type { RefKind } from '@core/db/types';
import { eventRuleSchema } from '@core/entities/model';
import type { Api } from './api';
import type { ApiError } from './result';

/**
 * Request validation.
 *
 * Every argument list that arrives over IPC is untrusted, so each method gets a tuple schema and
 * nothing reaches `createApi` until it matches. The schemas guard shape, not policy: a quest ID of
 * `0` or `-5` is a well-formed request that the API answers with its own `INVALID_QUEST_ID`, and
 * only genuinely malformed input becomes `BAD_REQUEST`.
 *
 * zod rejects `NaN` and `Infinity` for `z.number()`, so every number below is finite by
 * construction; coordinates therefore cannot poison the stored canvas.
 */

const REF_KINDS = [
  'item',
  'creature',
  'gameobject',
  'quest',
  'spell',
  'sound',
  'creatureDisplay',
  'objectDisplay',
  'factionTemplate',
  'faction',
  'title',
  'areatrigger',
  'map',
  'emote',
  'zone',
  'skill',
  'questSort',
  'mailTemplate',
  'extendedCost',
] as const;

// Fails to compile if `RefKind` gains a member that the wire schema does not accept.
type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _refKindsAreComplete: Exactly<(typeof REF_KINDS)[number], RefKind> = true;
void _refKindsAreComplete;

/** Search text is bounded so a runaway renderer cannot hand MySQL a megabyte-long LIKE. */
const MAX_SEARCH_TEXT = 200;
/** One lookup covers a whole canvas of quests; beyond this the caller is not asking a question. */
const MAX_LOOKUP_IDS = 5000;
/** A drag never moves more nodes than a project holds. */
const MAX_MOVES = 500;
/** Project names, file paths and recovery ids: generous, and only there to refuse garbage. */
const MAX_PROJECT_NAME = 200;
const MAX_PATH = 4096;
const MAX_RECOVERY_ID = 100;

const positionSchema = z.object({ x: z.number(), y: z.number() });
const viewportSchema = z.object({ x: z.number(), y: z.number(), zoom: z.number().positive() });
const finite = z.number().finite();
/** Debug mode: a whole coordinate or size on screen, and a string in an answer from the page */
const debugCoord = z.number().int().min(0).max(20000);
const debugSize = z.number().int().min(1).max(20000);
const debugText = z.string().max(500);
const worldKindArg = z.enum(['creature', 'gameobject']);
const movementArg = z.object({ type: z.enum(['idle', 'wander', 'path']), wander: z.number().min(0), pathId: z.number().int().min(1).nullable() });
const stepPlaceArg = z.union([
  z.object({ questId: z.number().int(), module: z.string().max(64).optional() }),
  z.object({ map: z.number().int(), x: finite, y: finite, z: finite, spawn: z.object({ kind: worldKindArg, guid: z.number().int() }).optional() }),
]);
const placementArg = z.object({ x: finite, y: finite, z: finite, orientation: finite, rotation: z.tuple([finite, finite, finite, finite]).nullable() });
const rowArg = z.record(z.string(), z.string().nullable());
const groupMemberArg = z.discriminatedUnion('type', [
  z.object({ type: z.literal('spawn'), kind: z.enum(['npc', 'object']), guid: z.number().int().min(1), entry: z.number().int().min(0), chance: z.number().min(0).max(100) }),
  z.object({ type: z.literal('group'), id: z.number().int().min(1), chance: z.number().min(0).max(100) }),
  z.object({ type: z.literal('quest'), questId: z.number().int().min(1) }),
]);
const spawnGroupArg = z.object({
  id: z.number().int().min(1),
  name: z.string().max(255),
  map: z.number().int().min(0),
  maxActive: z.number().int().min(0),
  members: z.array(groupMemberArg).max(1000),
  event: z.object({ id: z.number().int().min(1), during: z.boolean() }).nullable(),
  origin: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('new') }),
    z.object({
      kind: z.literal('existing'),
      original: z.object({
        template: rowArg,
        members: z.array(z.object({ table: z.enum(['pool_creature', 'pool_gameobject', 'pool_pool', 'pool_quest']), row: rowArg })),
        event: rowArg.nullable(),
      }),
    }),
  ]),
  removed: z.boolean().optional(),
});
const groupMovesArg = z
  .array(
    z.union([
      z.object({ kind: z.enum(['npc', 'object']), guid: z.number().int().min(1) }),
      z.object({ kind: z.literal('quest'), questId: z.number().int().min(1) }),
    ]),
  )
  .max(1000);
const routePointArg = z.object({ x: finite, y: finite, z: finite, rest: z.record(z.string(), z.string().nullable()) });

const profileFields = {
  name: z.string(),
  role: z.enum(['world', 'dev']),
  host: z.string(),
  port: z.number().int(),
  user: z.string(),
  database: z.string(),
  password: z.string(),
  dbcDir: z.string().optional(),
  clientDir: z.string().optional(),
  exportDir: z.string().optional(),
};
// Strict: a misspelled key must be a loud error, never a silently unsaved connection setting.
const profileInputSchema = z.object(profileFields).strict();
const profileSaveSchema = z
  .object({ ...profileFields, id: z.number().int().optional(), password: z.string().optional() })
  .strict()
  .refine((p) => p.id !== undefined || p.password !== undefined, { message: 'a new profile needs a password' });

const aggregateSchema = z
  .object({
    questId: z.number(),
    isNew: z.boolean(),
    // Field values are registry-shaped and checked by the registry, not here.
    values: z.record(z.string(), z.unknown()),
    readOnly: z.array(z.object({ fieldId: z.string(), reason: z.string() })),
    sharedItems: z.record(z.string(), z.array(z.number())),
  })
  .strict();

/** A project file the merge reads or writes */
const mergePathArg = z.string().min(1).max(MAX_PATH);
const mergeFilesArg = z.object({ theirsPath: mergePathArg, basePath: mergePathArg.nullable() });
/** A choice per decision id; the engine ignores one for no decision */
const mergeChoicesArg = z.record(z.string().max(MAX_PATH), z.enum(['mine', 'theirs', 'both']));
/** The sha-256 hex a preview returned */
const mergeFingerprintArg = z.string().length(64);

/**
 * One tuple schema per method, in `Api` declaration order.
 *
 * The `Record<keyof Api, ...>` annotation is the completeness check: a method added to `Api`
 * without a schema, or a schema for a method that no longer exists, fails to compile.
 */
const REQUEST_SCHEMAS: Record<keyof Api, z.ZodType<unknown[]>> = {
  testConnection: z.tuple([profileInputSchema]),
  saveProfile: z.tuple([profileSaveSchema]),
  listProfiles: z.tuple([]),
  deleteProfile: z.tuple([z.number().int()]),
  startupProfile: z.tuple([]),
  chooseServerDataDir: z.tuple([]),
  connect: z.tuple([z.number()]),
  searchQuests: z.tuple([z.string().max(MAX_SEARCH_TEXT)]),
  questsOfNpc: z.tuple([z.number().int()]),
  searchEntities: z.tuple([z.enum(['item', 'creature', 'gameobject', 'quest', 'spell', 'sound', 'questSort', 'extendedCost', 'creatureDisplay', 'objectDisplay', 'factionTemplate']), z.string().max(MAX_SEARCH_TEXT)]),
  openQuest: z.tuple([z.number(), positionSchema.optional()]),
  newQuest: z.tuple([positionSchema.optional()]),
  addQuestChain: z.tuple([z.number(), positionSchema.optional()]),
  listNodes: z.tuple([]),
  moveNodes: z.tuple([
    z.array(z.object({ questId: z.number(), x: z.number(), y: z.number() })).max(MAX_MOVES),
  ]),
  removeNode: z.tuple([z.number()]),
  saveViewport: z.tuple([viewportSchema]),
  lookupNames: z.tuple([z.enum(REF_KINDS), z.array(z.number()).max(MAX_LOOKUP_IDS)]),
  questLinks: z.tuple([z.array(z.number()).max(MAX_LOOKUP_IDS)]),
  rewardTables: z.tuple([z.number()]),
  updateQuest: z.tuple([aggregateSchema]),
  previewChanges: z.tuple([z.number()]),
  validate: z.tuple([z.number()]),
  questScripts: z.tuple([z.number()]),
  testCommands: z.tuple([z.number()]),
  groundHeight: z.tuple([z.number().int(), z.number(), z.number()]),
  spellFacts: z.tuple([z.array(z.number().int()).max(MAX_LOOKUP_IDS)]),
  clientMaps: z.tuple([]),
  mapFloors: z.tuple([z.number().int(), z.number().finite(), z.number().finite()]),
  viewSpawns: z.tuple([z.number().int(), z.object({ minX: z.number().finite(), maxX: z.number().finite(), minY: z.number().finite(), maxY: z.number().finite() })]),
  projectEntities: z.tuple([]),
  // Each entry is checked against the entity schemas by the main process
  putProjectEntities: z.tuple([z.object({ npcs: z.array(z.unknown()), objects: z.array(z.unknown()), items: z.array(z.unknown()) })]),
  readExistingEntity: z.tuple([z.enum(['npc', 'object', 'item']), z.number().int().min(1)]),
  existingDrift: z.tuple([]),
  idConflicts: z.tuple([]),
  resolveIdConflicts: z.tuple([]),
  deleteEntity: z.tuple([z.enum(['npc', 'object', 'item']), z.number().int().min(1)]),
  worldLayer: z.tuple([]),
  worldMoveSpawn: z.tuple([worldKindArg, z.number().int(), placementArg]),
  worldAddSpawn: z.tuple([worldKindArg, z.number().int().min(1), z.number().int().min(0), placementArg, z.number().int().min(1).optional()]),
  worldRoute: z.tuple([z.number().int().min(1)]),
  worldSetRoute: z.tuple([z.number().int().min(1), z.array(routePointArg), z.object({ isNew: z.boolean().optional() }).optional()]),
  worldSetMovement: z.tuple([z.number().int().min(1), movementArg]),
  worldSetRespawn: z.tuple([z.enum(['creature', 'gameobject']), z.number().int().min(1), z.number().int().min(0)]),
  worldSetSpawnEvents: z.tuple([z.number().int().min(1), z.union([eventRuleSchema, z.literal('npc')])]),
  worldNewPathId: z.tuple([z.number().int().min(1)]),
  worldDeleteSpawn: z.tuple([worldKindArg, z.number().int().min(1)]),
  worldRevert: z.tuple([z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('spawn'), spawnKind: worldKindArg, guid: z.number().int() }),
    z.object({ kind: z.literal('route'), pathId: z.number().int() }),
    z.object({ kind: z.literal('movement'), guid: z.number().int() }),
    z.object({ kind: z.literal('respawn'), spawnKind: worldKindArg, guid: z.number().int() }),
    z.object({ kind: z.literal('group'), id: z.number().int() }),
    z.object({ kind: z.literal('spawnEvents'), guid: z.number().int() }),
    z.object({ kind: z.literal('delete'), spawnKind: worldKindArg, guid: z.number().int() }),
  ])]),
  worldChanges: z.tuple([]),
  worldGroup: z.tuple([z.number().int().min(1)]),
  worldGroupView: z.tuple([z.number().int().min(1)]),
  worldGroupSpawns: z.tuple([z.number().int().min(1)]),
  worldGroupsOnMap: z.tuple([z.number().int().min(0)]),
  worldNewGroupId: z.tuple([]),
  worldWoodcuttingTrees: z.tuple([]),
  worldNearestWoodcuttingTree: z.tuple([z.number().int().min(0), z.number(), z.number()]),
  worldCheckGroup: z.tuple([spawnGroupArg, groupMovesArg]),
  worldSetGroup: z.tuple([spawnGroupArg, groupMovesArg]),
  worldDeleteGroup: z.tuple([z.number().int().min(1)]),
  worldDropMember: z.tuple([z.enum(['npc', 'object']), z.number().int().min(1)]),
  questPools: z.tuple([]),
  gameEvents: z.tuple([]),
  historyList: z.tuple([]),
  historyUndo: z.tuple([]),
  historyRedo: z.tuple([]),
  historyJump: z.tuple([z.number().int().min(0)]),
  historyBegin: z.tuple([z.string().max(200).optional(), stepPlaceArg.optional()]),
  historyEnd: z.tuple([z.number().int().min(1)]),
  exportProject: z.tuple([]),
  entitySpawns: z.tuple([z.enum(['creature', 'gameobject']), z.number().int()]),
  findSpawns: z.tuple([z.enum(['creature', 'gameobject']), z.number().int()]),
  spawnPlacement: z.tuple([z.enum(['npc', 'object']), z.number().int()]),
  questSpawnList: z.tuple([z.array(z.number().int().min(1)).max(50)]),
  allocateIds: z.tuple([z.enum(['creature', 'gameobject', 'creatureSpawn', 'gameobjectSpawn', 'page', 'item', 'trainer', 'gossipMenu', 'gossipText']), z.number().int().min(1).max(50)]),
  patrolPathId: z.tuple([z.number().int().min(1)]),
  entityTemplate: z.tuple([z.enum(['creature', 'gameobject', 'item']), z.number().int()]),
  itemColumns: z.tuple([]),
  exportQuest: z.tuple([z.number()]),
  applyToDev: z.tuple([z.number(), z.boolean()]),
  projectState: z.tuple([]),
  renameProject: z.tuple([z.string().max(MAX_PROJECT_NAME)]),
  newProject: z.tuple([z.string().max(MAX_PROJECT_NAME)]),
  openProject: z.tuple([z.string().max(MAX_PATH).optional()]),
  saveProject: z.tuple([]),
  saveProjectAs: z.tuple([]),
  recentProjects: z.tuple([]),
  forgetRecent: z.tuple([z.string().max(MAX_PATH)]),
  recoveries: z.tuple([]),
  restoreRecovery: z.tuple([z.string().max(MAX_RECOVERY_ID)]),
  discardRecovery: z.tuple([z.string().max(MAX_RECOVERY_ID)]),
  mcpStatus: z.tuple([]),
  mcpConfigure: z.tuple([z.object({ enabled: z.boolean(), port: z.number().int().min(1024).max(65535), wikiLookups: z.boolean().optional() })]),
  mcpRegenerateToken: z.tuple([]),
  questsInZone: z.tuple([
    z.number().int(),
    z.object({ minLevel: z.number().int().min(0).max(255).optional(), maxLevel: z.number().int().min(0).max(255).optional(), limit: z.number().int().min(1).max(200).optional() }).optional(),
  ]),
  questSummaries: z.tuple([z.array(z.number().int().min(1)).min(1).max(25)]),
  areaOverview: z.tuple([z.number().int().min(0), finite, finite, z.number().finite().positive().max(500)]),
  checkNames: z.tuple([z.enum(['creature', 'gameobject', 'item', 'quest']), z.array(z.string().max(100)).min(1).max(25)]),
  checkIds: z.tuple([z.enum(['creature', 'gameobject', 'item', 'quest']), z.array(z.number().int().min(1)).min(1).max(100)]),
  wikiSearch: z.tuple([z.string().min(1).max(200), z.number().int().min(1).max(10).optional()]),
  wikiPage: z.tuple([z.string().min(1).max(200), z.string().min(1).max(200).optional()]),
  projectIssues: z.tuple([]),
  debugStatus: z.tuple([]),
  debugSetEnabled: z.tuple([z.boolean()]),
  debugEvents: z.tuple([z.object({ since: finite.optional(), categories: z.array(z.string().max(40)).max(20).optional(), limit: z.number().int().min(1).max(1000).optional() }).optional()]),
  debugSnapshot: z.tuple([]),
  debugType: z.tuple([z.string().min(1).max(200)]),
  captureScreenshot: z.tuple([
    z
      .object({
        selector: z.string().max(300).optional(),
        rect: z.object({ x: debugCoord, y: debugCoord, width: debugSize, height: debugSize }).optional(),
        maxWidth: z.number().int().min(1).max(1600).optional(),
      })
      .optional(),
  ]),
  cameraStatus: z.tuple([]),
  cameraTeleport: z.tuple([z.object({ map: z.number().int().min(0), x: finite, y: finite, z: finite })]),
  debugRecord: z.tuple([
    z.array(z.object({ at: finite, category: z.string().max(40), name: z.string().max(60), data: z.record(z.string(), z.unknown()).optional() })).max(500),
  ]),
  updateCheck: z.tuple([]),
  updateSkip: z.tuple([z.string().max(40)]),
  updateRemind: z.tuple([]),
  updateOpen: z.tuple([z.string().max(500)]),
  debugAnswer: z.tuple([
    z.number().int(),
    z.union([
      z.object({
        focus: z.object({
          documentHasFocus: z.boolean(),
          active: debugText.nullable(),
          activeState: z.object({ editable: z.boolean(), disabled: z.boolean(), readOnly: z.boolean() }).nullable(),
          blockedBy: z.array(debugText).max(50),
          modals: z.array(debugText).max(50),
          coveredBy: debugText.nullable(),
        }),
        field: z.object({ target: debugText, value: debugText }).nullable(),
      }),
      z.object({ rect: z.object({ x: finite, y: finite, width: finite, height: finite }).nullable() }),
      z.object({ camera: z.object({ map: z.number().int(), x: finite, y: finite, z: finite, area: debugText.nullable() }).nullable() }),
    ]),
  ]),
  mergePickFile: z.tuple([]),
  mergePreview: z.tuple([mergeFilesArg, mergeChoicesArg]),
  mergeApply: z.tuple([mergeFilesArg, mergeChoicesArg, mergeFingerprintArg]),
  mergeWrite: z.tuple([mergeFilesArg, mergeChoicesArg, mergeFingerprintArg, mergePathArg]),
};

/**
 * Validates one call's arguments. The returned `args` are the parsed values, so unknown keys are
 * already gone by the time the API sees them.
 */
export function parseRequest(
  method: keyof Api,
  args: unknown[],
): { ok: true; args: unknown[] } | { ok: false; error: ApiError } {
  const schema = REQUEST_SCHEMAS[method];
  if (!schema) {
    return { ok: false, error: { code: 'BAD_REQUEST', message: `Unknown API method '${String(method)}'.` } };
  }
  const parsed = schema.safeParse(args);
  if (parsed.success) return { ok: true, args: [...parsed.data] };

  const issue = parsed.error.issues[0];
  const where = issue && issue.path.length > 0 ? ` at argument ${issue.path.join('.')}` : '';
  return {
    ok: false,
    error: { code: 'BAD_REQUEST', message: `${method}${where}: ${issue?.message ?? 'invalid request'}` },
  };
}
