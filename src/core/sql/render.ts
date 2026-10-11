import type { ColumnInfo, RawRow, RawValue } from '@core/db/types';
import { isNumericColumn } from '@core/db/types';

export class SqlRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlRenderError';
  }
}

const ESCAPES: Readonly<Record<string, string>> = {
  '\\': '\\\\',
  "'": "\\'",
  '\0': '\\0',
  '\x1a': '\\Z',
};

/** Single-quoted MySQL string literal. Only backslash, quote, NUL and Ctrl-Z are escaped; everything else is verbatim. */
export function quoteString(s: string): string {
  return `'${s.replace(/[\\'\0\x1a]/g, (c) => ESCAPES[c] as string)}'`;
}

const NUMERIC_TEXT = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

export function renderValue(col: ColumnInfo, value: RawValue): string {
  if (value === null) {
    if (col.nullable) return 'NULL';
    throw new SqlRenderError(`Column \`${col.name}\` is NOT NULL but got NULL`);
  }
  if (isNumericColumn(col)) {
    if (!NUMERIC_TEXT.test(value)) {
      throw new SqlRenderError(`Column \`${col.name}\` is numeric but got non-numeric text ${JSON.stringify(value)}`);
    }
    return value;
  }
  return quoteString(value);
}

/** Backtick-quoted identifier. */
export const ident = (name: string): string => `\`${name.replace(/`/g, '``')}\``;

/** The row's values in column order, checked against the table's columns */
function rowValues(table: string, ordered: readonly ColumnInfo[], row: RawRow): string {
  const known = new Set(ordered.map((c) => c.name));
  for (const key of Object.keys(row)) {
    if (!known.has(key)) throw new SqlRenderError(`Row for \`${table}\` has unknown column \`${key}\``);
  }
  const values = ordered.map((c) => {
    if (!Object.prototype.hasOwnProperty.call(row, c.name)) {
      throw new SqlRenderError(`Row for \`${table}\` is missing column \`${c.name}\``);
    }
    return renderValue(c, row[c.name] as RawValue);
  });
  return `(${values.join(', ')})`;
}

export function renderInsert(table: string, columns: readonly ColumnInfo[], row: RawRow): string {
  return renderInserts(table, columns, [row]);
}

/**
 * One INSERT for all the rows, the first on the VALUES line and each further one on a line of its own.
 * With `upsert` it ends in `ON DUPLICATE KEY UPDATE`, setting every column that is not part of the key.
 */
export function renderInserts(table: string, columns: readonly ColumnInfo[], rows: readonly RawRow[], upsert = false): string {
  if (rows.length === 0) throw new SqlRenderError(`Refusing INSERT into \`${table}\` without rows`);
  const ordered = [...columns].sort((a, b) => a.ordinal - b.ordinal);
  const values = rows.map((row) => rowValues(table, ordered, row));
  let sql = `INSERT INTO ${ident(table)} (${ordered.map((c) => ident(c.name)).join(', ')}) VALUES ${values.join(',\n')}`;
  if (upsert) {
    const settable = ordered.filter((c) => !c.isKey);
    if (settable.length === ordered.length) throw new SqlRenderError(`Table \`${table}\` has no key column to upsert on`);
    // A table that is all key has nothing to update, and an assignment to itself leaves the row as it is
    const assigned = settable.length > 0 ? settable : ordered.slice(0, 1);
    // On the last row's line: the lint wants a statement's last line to end in its semicolon
    sql += ` ON DUPLICATE KEY UPDATE ${assigned.map((c) => `${ident(c.name)} = VALUES(${ident(c.name)})`).join(', ')}`;
  }
  return `${sql};`;
}

export function renderDelete(
  table: string,
  keyColumns: readonly ColumnInfo[],
  key: Readonly<Record<string, string>>,
): string {
  const conds = keyColumns.map((c) => {
    if (!Object.prototype.hasOwnProperty.call(key, c.name)) {
      throw new SqlRenderError(`Key for \`${table}\` is missing column \`${c.name}\``);
    }
    return `${ident(c.name)} = ${renderValue(c, key[c.name] as string)}`;
  });
  if (conds.length === 0) throw new SqlRenderError(`Refusing DELETE on \`${table}\` without key columns`);
  return `DELETE FROM ${ident(table)} WHERE ${conds.join(' AND ')};`;
}
