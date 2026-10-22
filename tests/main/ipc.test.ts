import { describe, it, expect } from 'vitest';
import { API_METHODS, parseRequest } from '../../src/shared/ipc';

const profile = { name: 'w', role: 'world', host: 'h', port: 3306, user: 'u', database: 'd', password: 'p' };
const aggregate = { questId: 1, isNew: false, values: { a: 1 }, readOnly: [], sharedItems: {} };

describe('parseRequest', () => {
  it('knows every API method', () => {
    expect([...API_METHODS].sort()).toEqual([
      'addQuestChain', 'applyToDev', 'cameraStatus', 'cameraTeleport', 'chooseServerDataDir', 'connect', 'exportQuest', 'projectState', 'listNodes', 'listProfiles', 'deleteProfile', 'lookupNames', 'moveNodes', 'newQuest',
      'openQuest', 'previewChanges', 'questLinks', 'questsOfNpc', 'removeNode', 'rewardTables', 'updateQuest', 'saveProfile', 'saveViewport', 'searchQuests', 'searchEntities', 'startupProfile',
      'testConnection', 'validate', 'questScripts', 'testCommands', 'groundHeight', 'spellFacts', 'clientMaps', 'mapFloors', 'viewSpawns', 'entitySpawns', 'findSpawns', 'spawnPlacement', 'allocateIds', 'entityTemplate', 'itemColumns',
      'patrolPathId', 'renameProject', 'newProject', 'openProject', 'saveProject', 'saveProjectAs', 'recentProjects', 'forgetRecent', 'recoveries', 'restoreRecovery', 'discardRecovery',
      'projectEntities', 'putProjectEntities', 'deleteEntity', 'readExistingEntity', 'existingDrift', 'worldLayer', 'worldMoveSpawn', 'worldAddSpawn', 'worldRoute', 'worldSetRoute', 'worldRevert', 'worldDeleteSpawn', 'worldChanges', 'exportProject', 'worldSetMovement', 'worldSetRespawn', 'worldSetSpawnEvents', 'worldNewPathId', 'questSpawnList',
      'worldGroup', 'worldGroupView', 'worldGroupSpawns', 'worldGroupsOnMap', 'worldNewGroupId', 'worldWoodcuttingTrees', 'worldNearestWoodcuttingTree', 'worldCheckGroup', 'worldSetGroup', 'worldDeleteGroup', 'worldDropMember', 'questPools', 'gameEvents',
      'historyList', 'historyUndo', 'historyRedo', 'historyJump', 'historyBegin', 'historyEnd',
      'mcpStatus', 'mcpConfigure', 'mcpRegenerateToken',
      'questsInZone', 'questSummaries', 'areaOverview', 'checkNames', 'checkIds', 'wikiSearch', 'wikiPage', 'projectIssues',
      'debugStatus', 'debugSetEnabled', 'debugEvents', 'debugSnapshot', 'debugType', 'captureScreenshot', 'debugRecord', 'debugAnswer',
      'updateCheck', 'updateSkip', 'updateRemind', 'updateOpen',
      'idConflicts', 'resolveIdConflicts',
    ].sort());
  });
  it('refuses world edits with a bad kind, a missing rotation or a point without its columns', () => {
    const at = { x: 1, y: 2, z: 3, orientation: 0, rotation: null };
    expect(parseRequest('worldMoveSpawn', ['creature', 5, at]).ok).toBe(true);
    expect(parseRequest('worldMoveSpawn', ['npc', 5, at]).ok).toBe(false);
    expect(parseRequest('worldAddSpawn', ['creature', 1423, 0, at]).ok).toBe(true);
    expect(parseRequest('worldAddSpawn', ['creature', 0, 0, at]).ok).toBe(false);
    expect(parseRequest('worldAddSpawn', ['npc', 1423, 0, at]).ok).toBe(false);
    expect(parseRequest('worldMoveSpawn', ['creature', 5, { x: 1, y: 2, z: 3, orientation: 0 }]).ok).toBe(false);
    expect(parseRequest('worldSetRoute', [801, [{ x: 1, y: 2, z: 3 }]]).ok).toBe(false);
    expect(parseRequest('worldRevert', [{ kind: 'route', pathId: 801 }]).ok).toBe(true);
  });
  it('accepts a delete revert and a spawn delete, and refuses a bad kind or guid', () => {
    expect(parseRequest('worldRevert', [{ kind: 'delete', spawnKind: 'creature', guid: 5 }]).ok).toBe(true);
    expect(parseRequest('worldRevert', [{ kind: 'delete', spawnKind: 'npc', guid: 5 }]).ok).toBe(false);
    expect(parseRequest('worldDeleteSpawn', ['creature', 80331]).ok).toBe(true);
    expect(parseRequest('worldDeleteSpawn', ['npc', 80331]).ok).toBe(false);
    expect(parseRequest('worldDeleteSpawn', ['creature', 0]).ok).toBe(false);
  });
  it('checks history requests', () => {
    expect(parseRequest('historyJump', [3]).ok).toBe(true);
    expect(parseRequest('historyJump', [-1]).ok).toBe(false);
    expect(parseRequest('historyBegin', []).ok).toBe(true);
    expect(parseRequest('historyBegin', ['Paste 3 spawns', { map: 0, x: 1, y: 2, z: 3 }]).ok).toBe(true);
    expect(parseRequest('historyBegin', ['x'.repeat(201)]).ok).toBe(false);
    expect(parseRequest('historyEnd', [1]).ok).toBe(true);
    expect(parseRequest('historyUndo', []).ok).toBe(true);
  });
  it('checks movement and new-path requests', () => {
    const at = { x: 1, y: 2, z: 3, orientation: 0, rotation: null };
    expect(parseRequest('worldSetMovement', [80330, { type: 'wander', wander: 5, pathId: null }]).ok).toBe(true);
    expect(parseRequest('worldSetMovement', [80330, { type: 'run', wander: 5, pathId: null }]).ok).toBe(false);
    expect(parseRequest('worldSetMovement', [80330, { type: 'wander', wander: -1, pathId: null }]).ok).toBe(false);
    // The database may hold more than the dialog offers; putting it back must not be refused
    expect(parseRequest('worldSetMovement', [80330, { type: 'wander', wander: 150, pathId: null }]).ok).toBe(true);
    expect(parseRequest('worldSetMovement', [80330, { type: 'wander', wander: 7.5, pathId: null }]).ok).toBe(true);
    expect(parseRequest('worldNewPathId', [80330]).ok).toBe(true);
    expect(parseRequest('worldAddSpawn', ['creature', 1423, 0, at, 95000]).ok).toBe(true);
    expect(parseRequest('worldSetRoute', [5, [], { isNew: true }]).ok).toBe(true);
    expect(parseRequest('worldRevert', [{ kind: 'movement', guid: 1 }]).ok).toBe(true);
    expect(parseRequest('questSpawnList', [[60001, 60002]]).ok).toBe(true);
    expect(parseRequest('questSpawnList', [[0]]).ok).toBe(false);
  });
  it('accepts well-formed requests', () => {
    expect(parseRequest('openQuest', [60001]).ok).toBe(true);
    expect(parseRequest('addQuestChain', [60001, { x: 1, y: 2 }]).ok).toBe(true);
    expect(parseRequest('searchQuests', ['wolves']).ok).toBe(true);
    expect(parseRequest('searchEntities', ['creature', 'wolf']).ok).toBe(true);
    expect(parseRequest('searchEntities', ['spell', 'frost']).ok).toBe(true);
    expect(parseRequest('searchEntities', ['map', 'wolf']).ok).toBe(false);
    expect(parseRequest('applyToDev', [60001, true]).ok).toBe(true);
    expect(parseRequest('saveProfile', [profile]).ok).toBe(true);
    expect(parseRequest('deleteProfile', [3]).ok).toBe(true);
    expect(parseRequest('deleteProfile', ['3']).ok).toBe(false);
    expect(parseRequest('saveProfile', [{ ...profile, id: 1, password: undefined }]).ok).toBe(true);
    expect(parseRequest('updateQuest', [aggregate]).ok).toBe(true);
    expect(parseRequest('lookupNames', ['item', [1, 2]]).ok).toBe(true);
    expect(parseRequest('newQuest', []).ok).toBe(true);
    expect(parseRequest('newQuest', [{ x: 10.5, y: -3 }]).ok).toBe(true);
    expect(parseRequest('openQuest', [60001, { x: 0, y: 0 }]).ok).toBe(true);
    expect(parseRequest('moveNodes', [[{ questId: 1, x: 1, y: 2 }]]).ok).toBe(true);
    expect(parseRequest('saveViewport', [{ x: -5, y: 5, zoom: 0.5 }]).ok).toBe(true);
    expect(parseRequest('removeNode', [1]).ok).toBe(true);
    expect(parseRequest('listNodes', []).ok).toBe(true);
    expect(parseRequest('questLinks', [[1, 2]]).ok).toBe(true);
    expect(parseRequest('newProject', ['Northshire']).ok).toBe(true);
    expect(parseRequest('openProject', []).ok).toBe(true);
    expect(parseRequest('openProject', ['C:/w/p.aqc']).ok).toBe(true);
    expect(parseRequest('renameProject', ['x']).ok).toBe(true);
    expect(parseRequest('restoreRecovery', ['abc']).ok).toBe(true);
    expect(parseRequest('saveProject', []).ok).toBe(true);
  });
  it('lets numeric edge cases through so the API can answer with its own error', () => {
    expect(parseRequest('openQuest', [0]).ok).toBe(true);
    expect(parseRequest('openQuest', [-5]).ok).toBe(true);
  });
  it('rejects wrong types, wrong arity and unknown keys as BAD_REQUEST', () => {
    for (const [m, a] of [
      ['openQuest', ['5']], ['openQuest', []], ['openQuest', [1, 2]], ['applyToDev', [1]], ['searchQuests', [1]],
      ['lookupNames', ['nonsense', [1]]], ['saveProfile', [{ ...profile, role: 'admin' }]], ['saveProfile', [{ ...profile, extra: 1 }]],
      ['saveProfile', [{ ...profile, password: undefined }]],
      ['updateQuest', [{ questId: 'x' }]],
      ['moveNodes', [[{ questId: 1, x: Number.POSITIVE_INFINITY, y: 0 }]]], ['moveNodes', [[{ questId: 1, x: Number.NaN, y: 0 }]]],
      ['newQuest', [{ x: 'a', y: 0 }]], ['saveViewport', [{ x: 0, y: 0, zoom: 0 }]], ['saveViewport', [{ x: 0, y: 0 }]],
      ['questLinks', ['x']],
      ['newProject', ['x'.repeat(201)]], ['newProject', [42]], ['openProject', [7]], ['forgetRecent', []],
    ] as const) {
      const r = parseRequest(m, [...a]);
      expect(r, `${m} ${JSON.stringify(a)}`).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
    }
  });
  it('bounds search text and id lists', () => {
    expect(parseRequest('searchQuests', ['x'.repeat(201)]).ok).toBe(false);
    expect(parseRequest('lookupNames', ['item', Array.from({ length: 5001 }, (_, i) => i)]).ok).toBe(false);
  });
  it('lets a rotation, a group event and a quest move through the window-to-main checks', () => {
    const rotation = {
      id: 900002, name: 'Dailies', map: 0, maxActive: 1, event: { id: 12, during: true },
      members: [{ type: 'quest', questId: 60001 }, { type: 'quest', questId: 60002 }],
      origin: { kind: 'existing', original: { template: { entry: '900002' }, members: [{ table: 'pool_quest', row: { entry: '60001', pool_entry: '900002' } }], event: { eventEntry: '12', pool_entry: '900002' } } },
    };
    for (const method of ['worldCheckGroup', 'worldSetGroup'] as const) {
      const r = parseRequest(method, [rotation, [{ kind: 'quest', questId: 60001 }]]);
      expect(r.ok).toBe(true);
      if (r.ok) expect((r.args[0] as any).event).toEqual({ id: 12, during: true });
    }
    expect(parseRequest('worldCheckGroup', [{ ...rotation, event: { id: 12 } }, []]).ok).toBe(false);
    expect(parseRequest('worldCheckGroup', [{ ...rotation, event: null }, []]).ok).toBe(true);
  });
});
