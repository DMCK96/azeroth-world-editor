import { describe, expect, it } from 'vitest';
import { checkReferences } from '../../../src/core/merge/references';
import { docOf, quest } from './helpers';

const grp = (questId: number) => ({ id: 1, name: 'g', map: 0, maxActive: 1, members: [{ type: 'quest', questId }], event: null, origin: { kind: 'new' } }) as never;
const withGroup = (g: never, quests: ReturnType<typeof quest>[] = []) => docOf({ quests, world: { spawns: [], routes: [], added: [], groups: [g] } });

describe('checkReferences', () => {
  it('warns about a reference to a project item that is in a source but not in the result', () => {
    const result = withGroup(grp(7));
    const warnings = checkReferences(result, [result, docOf({ quests: [quest(7)] })]);
    expect(warnings).toEqual(['Group 1 g points at quest 7, which is not in the result']);
  });
  it('says nothing about a reference to something that is in the result', () => {
    const result = withGroup(grp(7), [quest(7)]);
    expect(checkReferences(result, [result])).toEqual([]);
  });
  it('says nothing about a reference to something no source has, because it belongs to the database', () => {
    const result = withGroup(grp(7));
    expect(checkReferences(result, [result])).toEqual([]);
  });
});
