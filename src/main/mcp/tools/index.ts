import type { ToolDef } from '../tool';
import { lookupTools } from './lookup';
import { projectTools } from './project';
import { questTools } from './quests';
import { entityTools } from './entities';
import { worldTools } from './world';
import { exportTools } from './export';
import { historyTools } from './history';
import { authoringTools } from './authoring';
import { loreTools } from './lore';
import { debugTools } from './debug';
import { navigationTools } from './navigation';
import { mergeTools } from './merge';

/**
 * Every tool the MCP server offers. A tool reaches the app only through `ctx.call`, never the API object,
 * so its arguments are validated like the window's (tests/main/mcp-tools-surface.test.ts enforces it).
 */
export const allTools: readonly ToolDef[] = [...projectTools, ...lookupTools, ...questTools, ...entityTools, ...worldTools, ...exportTools, ...historyTools, ...loreTools, ...authoringTools, ...debugTools, ...navigationTools, ...mergeTools];
