import type { ConnectionApi } from './connection';
import type { LookupApi } from './lookup';
import type { QuestsApi } from './quests';
import type { MapApi } from './map';
import type { EntitiesApi } from './entities';
import type { WorldLayerApi } from './world-layer';
import type { SpawnGroupsApi } from './spawn-groups';
import type { HistoryApi } from './history';
import type { ExportApi } from './export';
import type { ProjectApi } from './project';
import type { McpApi } from './mcp';
import type { LoreApi } from './lore';
import type { AuthoringApi } from './authoring';
import type { DebugApi } from './debug';
import type { UpdatesApi } from './updates';
import type { IdsApi } from './ids';

/** Everything the renderer can ask the main process to do: every area's calls */
export interface Api
  extends ConnectionApi,
    LookupApi,
    QuestsApi,
    MapApi,
    EntitiesApi,
    WorldLayerApi,
    SpawnGroupsApi,
    HistoryApi,
    ExportApi,
    ProjectApi,
    McpApi,
    LoreApi,
    AuthoringApi,
    DebugApi,
    UpdatesApi,
    IdsApi {}
