import { describe, expect, it } from 'vitest';
import { mergeTools } from '../../src/main/mcp/tools/merge';

const tool = (name: string) => mergeTools.find((t) => t.name === name)!;

describe('merge MCP tools', () => {
  it('registers merge_preview and merge_write, neither a project write', () => {
    expect(mergeTools.map((t) => t.name)).toEqual(['merge_preview', 'merge_write']);
    for (const t of mergeTools) expect(t.write).toBe(false);
  });
  it('tells the model the rules that matter', () => {
    expect(tool('merge_preview').description).toMatch(/open project is "mine"/);
    expect(tool('merge_preview').description).toMatch(/collision/i);
    expect(tool('merge_write').description).toMatch(/must not already exist/);
  });
  it('merge_preview forwards the files and choices to the api', async () => {
    const calls: unknown[][] = [];
    const ctx = { call: async (m: string, ...a: unknown[]) => { calls.push([m, ...a]); return { ok: true, value: { summary: [], dropped: [], decisions: [], entries: [{ big: true }], notCarried: [], warnings: [], settled: true, fingerprint: 'f' } }; } } as never;
    const r: any = await tool('merge_preview').run({ theirsPath: 'C:\t.awe', choices: { 'quest|1': 'mine' } } as never, ctx);
    expect(calls[0]).toEqual(['mergePreview', { theirsPath: 'C:\t.awe', basePath: null }, { 'quest|1': 'mine' }]);
    expect(tool('merge_preview').present!(r.value)).not.toHaveProperty('entries');
  });
  it('merge_write forwards the fingerprint and output path, and returns the api error unchanged', async () => {
    const err = { ok: false, error: { code: 'CONFLICT', message: 'A file changed since the preview. Preview the merge again.' } };
    const ctx = { call: async () => err } as never;
    const r = await tool('merge_write').run({ theirsPath: 'C:\t.awe', fingerprint: 'f'.repeat(64), outputPath: 'C:\o.awe' } as never, ctx);
    expect(r).toEqual(err);
  });
});
