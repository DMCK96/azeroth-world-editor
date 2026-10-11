import { vi } from 'vitest';
import type { Api, ApiError, CanvasNode, ErrorCode, OpenResult, Result } from '@shared/ipc';

export function okv<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function errv(code: ErrorCode, message: string): Result<never> {
  const error: ApiError = { code, message };
  return { ok: false, error };
}

export function sampleOpen(overrides: Partial<OpenResult> = {}): OpenResult {
  const base: OpenResult = {
    questId: 60001,
    aggregate: {
      questId: 60001,
      isNew: false,
      values: { 'quest_template.LogTitle': 'Wolves' },
      readOnly: [],
      sharedItems: {},
    },
    fidelity: { ok: true },
    unmodelled: [],
    issues: [],
    inProject: false,
    stale: false,
    locales: [],
    importedText: {},
  };
  return { ...base, ...overrides };
}

export function nodeOf(overrides: Partial<CanvasNode> = {}): CanvasNode {
  const base: CanvasNode = {
    uses: { npcs: [], objects: [], items: [] },
    refs: { npcs: [], objects: [], items: [] },
    questId: 60001,
    title: 'Wolves',
    level: 10,
    isNew: false,
    exported: false,
    unsafe: false,
    errors: 0,
    warnings: 0,
    x: 0,
    y: 0,
    links: [],
    starts: [],
    groups: [],
    offCanvasLinks: 0,
    notConnected: false,
  };
  return { ...base, ...overrides };
}

/**
 * Builds a mock `Api` where every method not overridden is a `vi.fn` answering with a sensible
 * empty success, so tests can assert on calls without wiring every method by hand.
 */
/** An undo or redo that found nothing to do */
export const emptyHistoryResult = {
  step: null, direction: 'undo' as const, quests: [], positions: false, world: null, name: false, skipped: [] as string[],
  history: { steps: [], current: 0, saved: 0 as number | null },
};

export function makeMockApi(overrides: Partial<Record<keyof Api, (...args: any[]) => any>> = {}): Api {
  const defaults: Record<keyof Api, (...args: any[]) => any> = {
    mcpStatus: vi.fn(async () => okv({ enabled: false, port: 47600, url: 'http://127.0.0.1:47600/mcp', token: 'tok', running: false, error: null, wikiLookups: false })),
    mcpConfigure: vi.fn(async (c: { enabled: boolean; port: number; wikiLookups?: boolean }) => okv({ ...c, wikiLookups: c.wikiLookups ?? false, url: `http://127.0.0.1:${c.port}/mcp`, token: 'tok', running: c.enabled, error: null })),
    mcpRegenerateToken: vi.fn(async () => okv({ enabled: false, port: 47600, url: 'http://127.0.0.1:47600/mcp', token: 'tok2', running: false, error: null, wikiLookups: false })),
    projectIssues: vi.fn(async () => okv([])),
    debugStatus: vi.fn(async () => okv({ enabled: false, events: 0, capacity: 5000, logFile: null, logFailures: 0, logTruncated: false, window: null })),
    debugSetEnabled: vi.fn(async (on: boolean) => okv({ enabled: on, events: 0, capacity: 5000, logFile: null, logFailures: 0, logTruncated: false, window: null })),
    debugEvents: vi.fn(async () => okv([])),
    debugSnapshot: vi.fn(async () => okv({ main: null, renderer: null, rendererAnswered: false })),
    debugType: vi.fn(async () => okv({ typed: 0, before: null, after: null, changed: false, window: null, events: [] })),
    captureScreenshot: vi.fn(async () => okv({ width: 1, height: 1, mimeType: 'image/png' as const, data: '', window: null })),
    cameraStatus: vi.fn(async () => okv({ map: 0, x: 0, y: 0, z: 0, area: null })),
    cameraTeleport: vi.fn(async () => okv({ map: 0, x: 0, y: 0, z: 0, area: null })),
    debugRecord: vi.fn(async () => okv(null)),
    debugAnswer: vi.fn(async () => okv(null)),
    updateCheck: vi.fn(async () => okv(null)),
    updateSkip: vi.fn(async () => okv(null)),
    updateRemind: vi.fn(async () => okv(null)),
    updateOpen: vi.fn(async () => okv(null)),
    questsInZone: vi.fn(async (zone: number) => okv({ zone: { id: zone, name: `Zone ${zone}` }, quests: [], total: 0, truncated: false })),
    questSummaries: vi.fn(async () => okv({ quests: [], missing: [] })),
    areaOverview: vi.fn(async (map: number, x: number, y: number, radius: number) => okv({ query: { map, x, y, radius }, npcs: [], objects: [], quests: [], factions: [], truncated: { npcs: false, objects: false, quests: false, spawns: false, vendor: false, drops: false }, missing: [] })),
    checkNames: vi.fn(async () => okv([])),
    checkIds: vi.fn(async () => okv([])),
    wikiSearch: vi.fn(async () => okv({ results: [], note: '', license: '' })),
    wikiPage: vi.fn(async () => okv({ title: '', url: '', redirectedFrom: null, intro: '', sections: [], section: null, note: '', license: '' })),
    testConnection: vi.fn(async () => okv({ ok: true as const })),
    saveProfile: vi.fn(async () => okv({ id: 1, name: '', role: 'world', host: '', port: 3306, user: '', database: '', dbcDir: '', clientDir: '', exportDir: '', lastConnectedAt: null })),
    listProfiles: vi.fn(async () => okv([])),
    deleteProfile: vi.fn(async () => okv(null)),
    startupProfile: vi.fn(async () => okv(null)),
    chooseServerDataDir: vi.fn(async () => okv(null)),
    connect: vi.fn(async () => okv({ profileId: 1, schemaHash: '', drift: { missingTables: [], unregistered: [], missingColumns: [], typeMismatches: [], blockingTables: [] }, blocking: false, serverData: null })),
    searchQuests: vi.fn(async () => okv([])),
    questsOfNpc: vi.fn(async () => okv({ starts: [], ends: [] })),
    searchEntities: vi.fn(async () => okv([])),
    openQuest: vi.fn(async () => okv(sampleOpen())),
    newQuest: vi.fn(async () => okv(sampleOpen())),
    addQuestChain: vi.fn(async () => okv({ open: sampleOpen(), questIds: [sampleOpen().questId], truncated: false })),
    listNodes: vi.fn(async () => okv([])),
    moveNodes: vi.fn(async () => okv(true as const)),
    removeNode: vi.fn(async () => okv(true as const)),
    saveViewport: vi.fn(async () => okv(true as const)),
    lookupNames: vi.fn(async () => okv({})),
    questLinks: vi.fn(async () => okv({ instances: [], unrecognised: [], unavailable: [] })),
    rewardTables: vi.fn(async () => okv({ xp: [], money: [] })),
    updateQuest: vi.fn(async () => okv(true as const)),
    previewChanges: vi.fn(async () => okv([])),
    allocateIds: vi.fn(async () => okv([])),
    patrolPathId: vi.fn(async () => okv(0)),
    entityTemplate: vi.fn(async () => okv(null)),
    itemColumns: vi.fn(async () => okv([])),
    groundHeight: vi.fn(async () => okv({ reason: 'x' })),
    spellFacts: vi.fn(async () => okv({ available: false, reason: 'x', spells: {} })),
    clientMaps: vi.fn(async () => okv([])),
    mapFloors: vi.fn(async () => okv({ reason: 'x' })),
    viewSpawns: vi.fn(async () => okv({ creatures: [], objects: [], capped: { creatures: false, objects: false } })),
    projectEntities: vi.fn(async () => okv({ npcs: [], objects: [], items: [] })),
    putProjectEntities: vi.fn(async () => okv(true as const)),
    readExistingEntity: vi.fn(async () => okv(null as never)),
    existingDrift: vi.fn(async () => okv([])),
    deleteEntity: vi.fn(async () => okv({ entities: { npcs: [], objects: [], items: [] }, quests: [] })),
    worldLayer: vi.fn(async () => okv({ spawns: [], routes: [], added: [] })),
    worldMoveSpawn: vi.fn(async () => okv({ spawns: [], routes: [], added: [] })),
    worldAddSpawn: vi.fn(async () => okv({ layer: { spawns: [], routes: [], added: [] }, guid: 1 })),
    worldRoute: vi.fn(async () => okv({ points: [], walkers: 1 })),
    worldSetRoute: vi.fn(async () => okv({ spawns: [], routes: [], added: [] })),
    worldDeleteSpawn: vi.fn(async () => okv({ spawns: [], routes: [], added: [] })),
    worldRevert: vi.fn(async () => okv({ spawns: [], routes: [], added: [] })),
    worldSetRespawn: vi.fn(async () => okv({ spawns: [], routes: [], added: [] })),
    worldSetSpawnEvents: vi.fn(async () => okv({ spawns: [], routes: [], added: [] })),
    worldSetMovement: vi.fn(async () => okv({ spawns: [], routes: [], added: [] })),
    worldNewPathId: vi.fn(async () => okv(1)),
    questSpawnList: vi.fn(async () => okv([])),
    worldChanges: vi.fn(async () => okv([])),
    worldGroup: vi.fn(async () => okv(null)),
    worldGroupView: vi.fn(async () => okv(null)),
    worldGroupSpawns: vi.fn(async () => okv([])),
    worldGroupsOnMap: vi.fn(async () => okv([])),
    worldNewGroupId: vi.fn(async () => okv(900001)),
    worldCheckGroup: vi.fn(async () => okv({ reasons: [], notes: [] })),
    worldSetGroup: vi.fn(async () => okv({ spawns: [], routes: [], added: [] })),
    worldDeleteGroup: vi.fn(async () => okv({ spawns: [], routes: [], added: [] })),
    questPools: vi.fn(async () => okv([])),
    gameEvents: vi.fn(async () => okv([])),
    worldDropMember: vi.fn(async () => okv({ spawns: [], routes: [], added: [] })),
    historyList: vi.fn(async () => okv(emptyHistoryResult.history)),
    historyUndo: vi.fn(async () => okv(emptyHistoryResult)),
    historyRedo: vi.fn(async () => okv({ ...emptyHistoryResult, direction: 'redo' })),
    historyJump: vi.fn(async () => okv(emptyHistoryResult)),
    historyBegin: vi.fn(async () => okv(1)),
    historyEnd: vi.fn(async () => okv(true)),
    exportProject: vi.fn(async () => okv({ applyPath: '', revertPath: '', sql: '' })),
    entitySpawns: vi.fn(async () => okv([])),
    findSpawns: vi.fn(async () => okv({ spawns: [], capped: false })),
    spawnPlacement: vi.fn(async () => okv(null)),
    testCommands: vi.fn(async () => okv({ reload: [], restart: [], go: [], quest: [] })),
    questScripts: vi.fn(async () => okv({ foreign: [], unreadable: [], missingTables: [] })),
    validate: vi.fn(async () => okv([])),
    exportQuest: vi.fn(async () => okv({ path: '', sql: '', warnings: [], issues: [] })),
    applyToDev: vi.fn(async () => okv({ statements: 0 })),
    projectState: vi.fn(async () => okv({ name: 'Untitled Project', filePath: null, dirty: false, idRangeStart: 60000, idRangeEnd: 99999, outputDir: 'C:\\out', viewport: { x: 0, y: 0, zoom: 1 } })),
    renameProject: vi.fn(async () => okv(true as const)),
    newProject: vi.fn(async () => okv({ done: true })),
    openProject: vi.fn(async () => okv({ done: true })),
    saveProject: vi.fn(async () => okv({ done: true })),
    saveProjectAs: vi.fn(async () => okv({ done: true })),
    recentProjects: vi.fn(async () => okv([])),
    forgetRecent: vi.fn(async () => okv(true as const)),
    recoveries: vi.fn(async () => okv([])),
    restoreRecovery: vi.fn(async () => okv(true as const)),
    discardRecovery: vi.fn(async () => okv(true as const)),
  };

  const wrapped = Object.fromEntries(
    Object.entries(overrides).map(([key, fn]) => [key, vi.fn(fn)]),
  ) as Partial<Record<keyof Api, (...args: any[]) => any>>;

  const merged = { ...defaults, ...wrapped } as unknown as Api;
  return merged;
}
