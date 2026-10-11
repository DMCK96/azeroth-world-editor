import type { ColumnInfo, RawRow, SchemaInfo } from '../db/types';
import { SqlRenderError, ident, renderDelete, renderInsert, renderInserts, renderValue } from '../sql/render';
import type { PatchStatement } from './build-patch';

export interface PatchMeta {
  toolVersion: string;
  date: string;
  /** The quest a patch is for; a patch that is not a quest's names its `label` instead. */
  questId?: number;
  label?: string;
  /**
   * Written the way the azerothcore-coa SQL lint reads it: each table's deletes followed by one multi-row
   * INSERT, and the tables the lint protects upserted with no DELETE. Off for a revert, which is not linted.
   */
  lint?: boolean;
}

/** The tables the lint never lets a patch delete from: their rows are written over instead */
const LINT_PROTECTED: ReadonlySet<string> = new Set(['creature_template', 'gameobject_template', 'item_template', 'quest_template']);

const UNSIGNED_INT_TEXT = /^\d+$/;
/** Slug length that keeps the whole file name comfortably inside path limits. */
const SLUG_MAX = 40;

function columnsOf(schema: SchemaInfo, table: string): ColumnInfo[] {
  const columns = schema.tables[table];
  if (!columns) throw new SqlRenderError(`Table \`${table}\` is not in the loaded schema`);
  return columns;
}

function keyColumnsOf(schema: SchemaInfo, table: string, names: readonly string[]): ColumnInfo[] {
  const byName = new Map(columnsOf(schema, table).map((c) => [c.name, c]));
  return names.map((name) => {
    const column = byName.get(name);
    if (!column) throw new SqlRenderError(`Table \`${table}\` has no key column \`${name}\``);
    return column;
  });
}

/**
 * An idempotent bit set: `npcflag = npcflag | 2`. The bit and the key are written straight into the
 * statement rather than through a column codec, so both are checked to be plain unsigned integers.
 */
function renderSetFlag(s: Extract<PatchStatement, { kind: 'set-flag' }>): string {
  if (!Number.isInteger(s.bit) || s.bit < 0) {
    throw new SqlRenderError(`Flag bit for \`${s.table}\`.\`${s.column}\` must be a non-negative integer`);
  }
  const conds = Object.entries(s.key).map(([column, value]) => {
    if (!UNSIGNED_INT_TEXT.test(value)) {
      throw new SqlRenderError(`Key \`${column}\` for \`${s.table}\` must be a non-negative integer, got ${JSON.stringify(value)}`);
    }
    return `${ident(column)} = ${value}`;
  });
  if (conds.length === 0) throw new SqlRenderError(`Refusing UPDATE on \`${s.table}\` without key columns`);
  return `UPDATE ${ident(s.table)} SET ${ident(s.column)} = ${ident(s.column)} | ${s.bit} WHERE ${conds.join(' AND ')};`;
}

/**
 * `UPDATE t SET … WHERE key AND onlyIf;` with every value through the column codec. The guard keeps a
 * re-applied patch from overwriting a value somebody set on purpose since.
 */
function renderUpdate(s: Extract<PatchStatement, { kind: 'update' }>, schema: SchemaInfo): string {
  const byName = new Map(columnsOf(schema, s.table).map((c) => [c.name, c]));
  const column = (name: string) => {
    const c = byName.get(name);
    if (!c) throw new SqlRenderError(`Table \`${s.table}\` has no column \`${name}\``);
    return c;
  };
  const sets = Object.entries(s.set).map(([name, value]) => `${ident(name)} = ${renderValue(column(name), value)}`);
  const keys = Object.entries(s.key).map(([name, value]) => `${ident(name)} = ${renderValue(column(name), value)}`);
  const guards = Object.entries(s.onlyIf ?? {}).map(([name, value]) => `${ident(name)} = ${renderValue(column(name), value)}`);
  if (sets.length === 0) throw new SqlRenderError(`Refusing UPDATE on \`${s.table}\` with nothing to set`);
  if (keys.length === 0) throw new SqlRenderError(`Refusing UPDATE on \`${s.table}\` without key columns`);
  return `UPDATE ${ident(s.table)} SET ${sets.join(', ')} WHERE ${[...keys, ...guards].join(' AND ')};`;
}

/**
 * One statement as a single SQL string.
 *
 * Exported so a caller that executes the patch gets exactly one string per statement, rather than
 * having to cut the rendered file up again: a text value may contain newlines and semicolons.
 */
export function renderStatement(s: PatchStatement, schema: SchemaInfo): string {
  if (s.kind === 'delete') {
    return renderDelete(s.table, keyColumnsOf(schema, s.table, Object.keys(s.key)), s.key);
  }
  if (s.kind === 'set-flag') return renderSetFlag(s);
  if (s.kind === 'update') return renderUpdate(s, schema);
  return renderInsert(s.table, columnsOf(schema, s.table), s.row);
}

/**
 * The statements as the lint reads them: the tables that are only deleted from, then each table that is
 * written, in the order its first row comes, as its deletes and one INSERT of all its rows; then the flag
 * updates and the other updates. A delete only touches its own table, so moving a table's statements together
 * changes nothing a patch does.
 */
function lintBlocks(statements: readonly PatchStatement[], schema: SchemaInfo): string[][] {
  const tables = new Map<string, { deletes: string[]; rows: RawRow[] }>();
  const flags: string[] = [];
  const updates: string[] = [];
  const own = (table: string) => tables.get(table) ?? tables.set(table, { deletes: [], rows: [] }).get(table)!;
  for (const s of statements) {
    if (s.kind === 'insert') own(s.table).rows.push(s.row);
    else if (s.kind === 'delete') own(s.table).deletes.push(renderStatement(s, schema));
    else (s.kind === 'set-flag' ? flags : updates).push(renderStatement(s, schema));
  }
  // Map order is the order of first mention, which a delete can make earlier than the table's first row
  const written = statements.flatMap((s) => (s.kind === 'insert' ? [s.table] : []));
  const order = [...[...tables.keys()].filter((t) => !written.includes(t)), ...new Set(written)];
  const grouped: string[] = [];
  for (const table of order) {
    const { deletes, rows } = tables.get(table)!;
    // A protected table's rows are written over, so deleting them first is left out
    const upsert = LINT_PROTECTED.has(table) && rows.length > 0;
    if (!upsert) grouped.push(...deletes);
    if (rows.length > 0) grouped.push(renderInserts(table, columnsOf(schema, table), rows, upsert));
  }
  return [grouped, flags, updates];
}

/** The patch as a `.sql` file: a header, then the deletes, the flag updates, the other updates and the inserts. */
export function renderPatch(
  statements: readonly PatchStatement[],
  schema: SchemaInfo,
  meta: PatchMeta,
): string {
  const header = [
    `-- Azeroth World Editor ${meta.toolVersion}`,
    typeof meta.questId === 'number' ? `-- Quest: ${meta.questId}` : `-- ${meta.label ?? 'Patch'}`,
    `-- Schema: ${schema.hash}`,
    `-- Generated: ${meta.date}`,
  ];

  const file = (blocks: string[][]): string => `${blocks.filter((b) => b.length > 0).map((b) => b.join('\n')).join('\n\n')}\n`;
  if (meta.lint) return file([header, ...lintBlocks(statements, schema)]);

  const deletes: string[] = [];
  const flags: string[] = [];
  const updates: string[] = [];
  const inserts: string[] = [];
  for (const s of statements) {
    const block = s.kind === 'delete' ? deletes : s.kind === 'set-flag' ? flags : s.kind === 'update' ? updates : inserts;
    block.push(renderStatement(s, schema));
  }

  return file([header, deletes, flags, updates, inserts]);
}

/** `<date>_<nn>_quest_<id>_<slug>.sql`, sortable and safe on every platform. */
export function patchFileName(args: { date: string; sequence: number; questId: number; title: string }): string {
  const slug =
    args.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, SLUG_MAX)
      .replace(/_+$/, '') || 'untitled';
  return `${args.date}_${String(args.sequence).padStart(2, '0')}_quest_${args.questId}_${slug}.sql`;
}
