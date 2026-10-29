import { idsAbove } from '../../ids/free';
import { SCRIPTS_FIELD } from '../../scripts/model';
import type { MergeDocument, MergeQuest } from '../doc';

/**
 * Small pieces the renumbers share: swapping one number for another inside the loosely typed rows a
 * quest's values hold, and the free key above every key in use. Every helper returns new objects and
 * never changes its argument.
 */

export type Row = Record<string, unknown>;
export type Values = Record<string, unknown>;

const isRow = (x: unknown): x is Row => typeof x === 'object' && x !== null && !Array.isArray(x);

/** The row with `column` set to `to` where it holds `from`; the same row otherwise */
export function swapIn<T extends object>(row: T, column: string, from: number, to: number): T {
  return (row as Row)[column] === from ? ({ ...row, [column]: to } as T) : row;
}

/** Each row of a list field passed through `fn`; values without the field are returned as they are */
export function mapRows(values: Values, fieldId: string, fn: (row: Row) => Row): Values {
  const rows = values[fieldId];
  if (!Array.isArray(rows)) return values;
  return { ...values, [fieldId]: rows.map((r) => (isRow(r) ? fn(r) : r)) };
}

/** A scalar field set to `to` where it holds `from` */
export function swapScalar(values: Values, fieldId: string, from: number, to: number): Values {
  return values[fieldId] === from ? { ...values, [fieldId]: to } : values;
}

/** A scalar field whose sign is a flag (`PrevQuestID`, `ExclusiveGroup`): the number follows, the sign stays */
export function swapSigned(values: Values, fieldId: string, from: number, to: number): Values {
  const value = values[fieldId];
  if (typeof value !== 'number' || Math.abs(value) !== from) return values;
  return { ...values, [fieldId]: value < 0 ? -to : to };
}

/** Each stored scene of the quest passed through `fn`, the ones that do not parse included (they keep what they hold otherwise) */
export function mapScenes(values: Values, fn: (scene: Row) => Row): Values {
  return mapRows(values, SCRIPTS_FIELD, fn);
}

/** A scene's (or NPC scene's) steps and gates passed through `step` and `gate` */
export function mapSceneParts<T extends object>(scene: T, step: (s: Row) => Row, gate: (g: Row) => Row): T {
  const s = scene as Row;
  return {
    ...scene,
    ...(Array.isArray(s.steps) && { steps: s.steps.map((x) => (isRow(x) ? step(x) : x)) }),
    ...(Array.isArray(s.gates) && { gates: s.gates.map((x) => (isRow(x) ? gate(x) : x)) }),
  } as T;
}

/** The `conditions` rows of these types with `ConditionValue1` swapped */
export function swapConditionValue1(values: Values, types: ReadonlySet<number>, from: number, to: number): Values {
  return mapRows(values, 'conditions', (r) => (types.has(r.ConditionTypeOrReference as number) ? swapIn(r, 'ConditionValue1', from, to) : r));
}

/** Every quest's values passed through `fn` */
export function mapQuestValues(doc: MergeDocument, fn: (values: Values, quest: MergeQuest) => Values): MergeQuest[] {
  return doc.quests.map((quest) => ({
    ...quest,
    aggregate: { ...quest.aggregate, values: fn(quest.aggregate.values as Values, quest) as MergeQuest['aggregate']['values'] },
  }));
}

/** The one key above every number in use */
export function freeAbove(used: readonly number[]): string {
  return String(idsAbove(0, used, 1)[0]);
}
