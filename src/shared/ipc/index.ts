/**
 * The contract between the main process and the renderer: the `Api` types plus the zod schemas
 * that validate every call as it crosses the wire.
 *
 * Only zod is pulled in, so the renderer, the preload and the main process can all import this
 * without dragging in MySQL, SQLite or Node.
 *
 * Each area has its own file: its types and its part of the `Api` interface.
 */

export type * from './connection';
export type * from './lookup';
export type * from './quests';
export type * from './map';
export type * from './entities';
export type * from './world-layer';
export type * from './spawn-groups';
export type * from './woodcutting';
export type * from './history';
export type * from './export';
export type * from './project';
export type * from './mcp';
export type * from './debug';
export type * from './updates';
export type * from './lore';
export type * from './authoring';
export type * from './ids';
export type * from './result';
export type { Api } from './api';
export { parseRequest } from './requests';

// The method and channel names live in a zod-free module so the sandboxed preload can import them.
export { API_METHODS, channelFor, HISTORY_CHANNEL } from '../api-methods';
export type { HistoryList, HistoryPart, HistoryResult, QuestEdit, StepPlace, StepSummary } from '../history';
