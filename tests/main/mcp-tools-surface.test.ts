import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_METHODS } from '../../src/shared/api-methods';

const dir = join(__dirname, '../../src/main/mcp/tools');
const sources = readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => readFileSync(join(dir, f), 'utf8'));
const called = [...new Set(sources.flatMap((s) => [...s.matchAll(/ctx\.call\(\s*'([A-Za-z]+)'/g)].map((m) => m[1]!)))];
const FORBIDDEN = ['applyToDev', 'saveProfile', 'testConnection', 'deleteProfile', 'chooseServerDataDir', 'startupProfile', 'mcpStatus', 'mcpConfigure', 'mcpRegenerateToken', 'newProject', 'openProject', 'saveProject', 'saveProjectAs', 'renameProject', 'restoreRecovery', 'discardRecovery', 'forgetRecent', 'debugSetEnabled', 'debugRecord', 'debugAnswer', 'updateCheck', 'updateSkip', 'updateOpen'];

describe('what the MCP tools may reach', () => {
  it('only call real API methods', () => {
    expect(called.length).toBeGreaterThan(20);
    for (const m of called) expect(API_METHODS as readonly string[]).toContain(m);
  });
  it('never call a method that writes a database, handles a password, or replaces the whole project', () => {
    for (const m of FORBIDDEN) expect(called).not.toContain(m);
  });
  it('the debug tools reach the controller only through its read and probe methods', () => {
    for (const m of ['debugStatus', 'debugEvents', 'debugSnapshot', 'debugType', 'captureScreenshot', 'cameraStatus', 'cameraTeleport']) expect(called).toContain(m);
  });
  it('never use the API object directly, only ctx.call', () => {
    for (const s of sources) expect(s).not.toMatch(/ctx\.api\b/);
  });
});
