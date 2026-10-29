import type { Api } from '../../shared/ipc';
import { createConnectionApi } from './connection-api';
import { createLookupApi } from './lookup-api';
import { createQuestsApi } from './quests-api';
import { createMapApi } from './map-api';
import { createEntitiesApi } from './entities-api';
import { createWorldLayerApi } from './world-layer-api';
import { createSpawnGroupsApi } from './spawn-groups-api';
import { createWoodcuttingApi } from './woodcutting-api';
import { createHistoryApi } from './history-api';
import { createExportApi } from './export-api';
import { createProjectApi } from './project-api';
import { createMcpApi } from './mcp-api';
import { createDebugApi } from './debug-api';
import { createUpdatesApi } from './updates-api';
import { createLoreApi } from './lore-api';
import { createAuthoringApi } from './authoring-api';
import { createIdsApi } from './ids-api';
import { createMergeApi } from './merge-api';
import type { ApiDeps } from './deps';
import { createServices } from './services';

export type { ApiDeps } from './deps';
export type { DevDb } from '../../core/db/dev-db';

/**
 * The whole application, as one object of plain async functions.
 *
 * Every side effect arrives through `deps`, so the tests drive the real thing with an in-memory
 * world DB, an in-memory store and a fake file system. The Electron layer only wires the real
 * implementations in and forwards the calls over IPC.
 *
 * Each area of the API is its own module, built from the shared services; a new area is a new
 * module added here.
 */
export function createApi(deps: ApiDeps): Api {
  const services = createServices(deps);

  return {
    ...createConnectionApi(services),
    ...createLookupApi(services),
    ...createQuestsApi(services),
    ...createMapApi(services),
    ...createEntitiesApi(services),
    ...createWorldLayerApi(services),
    ...createSpawnGroupsApi(services),
    ...createWoodcuttingApi(services),
    ...createHistoryApi(services),
    ...createExportApi(services),
    ...createProjectApi(services),
    ...createMcpApi(deps),
    ...createDebugApi(deps),
    ...createUpdatesApi(deps),
    ...createLoreApi(services, deps),
    ...createAuthoringApi(services),
    ...createIdsApi(services),
    ...createMergeApi(services),
  };
}
