import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openMysqlWorldDb } from '@core/db/mysql-world-db';
import { createMysqlScratch, verifyPatchInMysql, type MysqlScratch } from '@core/roundtrip/mysql-gate';
import { importQuest } from '@core/import/importer';
import { buildPatch } from '@core/export/build-patch';
import { renderPatch } from '@core/export/render-patch';
import { applyPatchInMemory, keyColumnsByTable } from '@core/roundtrip/apply';
import { loadSchema } from '@core/schema/load';
import { registry } from '@core/registry';
import { TOOL_VERSION } from '@core/version';
import { mysqlUrl } from '../helpers/env';
import type { WorldDb } from '@core/db/world-db';

const u = new URL(mysqlUrl());
const conn = { host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
const tables = registry.tables.map((t) => t.table);
let db: WorldDb; let scratch: MysqlScratch;
beforeAll(async () => {
  db = await openMysqlWorldDb({ ...conn, database: u.pathname.slice(1) });
  scratch = await createMysqlScratch({ ...conn, worldDatabase: u.pathname.slice(1), tables });
});
afterAll(async () => { await scratch?.drop(); await db?.close(); });

async function gate(questId: number, applyTwice = false) {
  const schema = await loadSchema(db, tables);
  const { aggregate, snapshot } = await importQuest(db, schema, registry, questId);
  const sql = renderPatch(buildPatch({ aggregate, snapshot, schema, registry }).statements, schema, { toolVersion: TOOL_VERSION, questId, date: '20260921' });
  return verifyPatchInMysql(scratch, { snapshot, patchSql: sql, expected: snapshot.tables, schema, registry, applyTwice });
}

/**
 * Backslash, single quote, double quote, NUL, Ctrl-Z, an emoji and several non-ASCII scripts. The
 * `\\` and `\u0000` are the two `quoteString` escapes; the rest is what a charset mistake eats.
 */
const HOSTILE = 'backslash \\ quote \' dquote " NUL \u0000 ctrlz \u001a emoji \u{1f642} café Ω ÅÄÖ 中文 кириллица';

describe('MySQL round-trip gate', () => {
  it('round-trips the first 25 quests byte-identically', async () => {
    const ids = (await db.questIdsInRange(1, 30000)).slice(0, 25);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(await gate(id), `quest ${id}`).toEqual({ ok: true });
  });

  it('round-trips the quest with the longest text', async () => {
    const all = await db.questIdsInRange(1, 30000);
    const rows = await Promise.all(all.slice(0, 2000).map((id) => db.selectRows('quest_template', { ID: String(id) })));
    const longest = rows.flat().sort((a, b) => (b.QuestDescription ?? '').length - (a.QuestDescription ?? '').length)[0];
    expect((longest.QuestDescription ?? '').length).toBeGreaterThan(200);
    expect(await gate(Number(longest.ID))).toEqual({ ok: true });
  });

  /**
   * The old version of this test claimed to cover non-ASCII text and did not: it only found the
   * longest `QuestDescription`. Rather than hope this particular dump contains hostile text, the
   * text is written: the patch has to carry a backslash, a NUL, a Ctrl-Z, an emoji and several
   * non-ASCII scripts through a real MySQL and come back byte-identical to the in-memory apply.
   */
  it('writes and reads back hostile text — backslash, NUL, Ctrl-Z, emoji, non-ASCII — through real MySQL', async () => {
    expect(HOSTILE).toContain(String.fromCharCode(92));
    expect(HOSTILE).toContain('\u0000');
    expect(HOSTILE).toContain('\u001a');
    expect([...HOSTILE].some((c) => c.codePointAt(0)! > 127)).toBe(true);

    const schema = await loadSchema(db, tables);
    const [questId] = await db.questIdsInRange(1, 30000);
    const { aggregate, snapshot } = await importQuest(db, schema, registry, questId);
    const edited = {
      ...aggregate,
      values: {
        ...aggregate.values,
        'quest_template.LogTitle': `T ${HOSTILE}`.slice(0, 120),
        'quest_template.QuestDescription': HOSTILE,
        'quest_offer_reward.RewardText': HOSTILE,
        'quest_request_items.CompletionText': HOSTILE,
      },
    };

    const { statements } = buildPatch({ aggregate: edited, snapshot, schema, registry });
    const sql = renderPatch(statements, schema, { toolVersion: TOOL_VERSION, questId, date: '20260921' });
    expect(sql).toContain('\\\\'); // the backslash really did reach the rendered patch
    const expected = applyPatchInMemory(snapshot.tables, statements, keyColumnsByTable(registry));

    expect(await verifyPatchInMysql(scratch, { snapshot, patchSql: sql, expected, schema, registry })).toEqual({ ok: true });
    expect(await verifyPatchInMysql(scratch, { snapshot, patchSql: sql, expected, schema, registry, applyTwice: true })).toEqual({ ok: true });
  });

  it('is re-applicable: applying the patch twice gives the same rows', async () => {
    const [id] = await db.questIdsInRange(1, 30000);
    expect(await gate(id, true)).toEqual({ ok: true });
  });
});
