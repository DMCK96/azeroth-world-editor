import { describe, expect, it } from 'vitest';
import { existingStatements } from '../../src/core/entities/existing';
import { npcFromRows } from '../../src/core/entities/from-rows';
import { EMPTY_ENTITIES, type CustomNpc } from '../../src/core/entities/model';

const template = { entry: '198', name: 'Warrior Trainer', subname: '', minlevel: '30', maxlevel: '30', faction: '11', rank: '0', type: '7', npcflag: '51', lootid: '0', AIName: '', ScriptName: '' };
const model = { CreatureID: '198', Idx: '0', CreatureDisplayID: '3167', DisplayScale: '1', Probability: '1' };
const trainerRow = { Id: '17', Type: '0', Requirement: '1', Greeting: 'Hello, warrior!', VerifiedBuild: '12340' };
const spell = (id: string, extra: Record<string, string> = {}) => ({ TrainerId: '17', SpellId: id, MoneyCost: '100', ReqSkillLine: '0', ReqSkillRank: '0', ReqAbility1: '0', ReqAbility2: '0', ReqAbility3: '0', ReqLevel: '10', VerifiedBuild: '12340', ...extra });
const defaultRow = { CreatureId: '198', TrainerId: '17' };
const trained = { creature_template: [template], creature_template_model: [model], creature_default_trainer: [defaultRow], trainer: [trainerRow], trainer_spell: [spell('78'), spell('100')] };
const untrained = { creature_template: [{ ...template, npcflag: '3' }], creature_template_model: [model], creature_default_trainer: [], trainer: [], trainer_spell: [] };
const counts = { sharedLoot: 0, spawnCount: 1, sharedTrainer: 0 };
const store = (npc: CustomNpc) => ({ ...EMPTY_ENTITIES, npcs: [npc] });
const TABLES = ['creature_default_trainer', 'trainer', 'trainer_spell'];
const trainerStatements = (npc: CustomNpc) => {
  const out = existingStatements(store(npc), []);
  const only = (list: typeof out.apply) => list.filter((s) => TABLES.includes(s.table));
  return { apply: only(out.apply), revert: only(out.revert) };
};
const flagOf = (npc: CustomNpc) => {
  const insert = existingStatements(store(npc), []).apply.find((s) => s.table === 'creature_template' && s.kind === 'insert') as { row: Record<string, string> };
  return Number(insert.row.npcflag);
};

describe('writing an existing NPC\'s trainer', () => {
  it('writes nothing for a trainer it only read, and leaves npcflag as it was', () => {
    const npc = npcFromRows(198, trained, counts);
    expect(trainerStatements(npc)).toEqual({ apply: [], revert: [] });
    expect(flagOf(npc)).toBe(51);
  });

  it('replaces its own trainer\'s spells by key, carrying VerifiedBuild, and the revert puts the originals back', () => {
    const npc = npcFromRows(198, trained, counts);
    const edited = { ...npc, trainer: { ...npc.trainer!, greeting: 'Welcome!', spells: [{ ...npc.trainer!.spells[0]!, cost: 250 }, { spell: 5, cost: 1, reqLevel: 2, reqSkill: 0, reqSkillRank: 0, reqSpells: [78] }] } };
    const { apply, revert } = trainerStatements(edited);
    const added = { TrainerId: '17', SpellId: '5', MoneyCost: '1', ReqSkillLine: '0', ReqSkillRank: '0', ReqAbility1: '78', ReqAbility2: '0', ReqAbility3: '0', ReqLevel: '2' };
    // The default-trainer link is as it was read, so it is not written
    expect(apply).toEqual([
      { kind: 'delete', table: 'trainer', key: { Id: '17' } },
      { kind: 'insert', table: 'trainer', row: { ...trainerRow, Greeting: 'Welcome!' } },
      { kind: 'delete', table: 'trainer_spell', key: { TrainerId: '17' } },
      { kind: 'insert', table: 'trainer_spell', row: added },
      { kind: 'insert', table: 'trainer_spell', row: spell('78', { MoneyCost: '250' }) },
    ]);
    expect(revert).toEqual([
      { kind: 'delete', table: 'trainer', key: { Id: '17' } },
      { kind: 'insert', table: 'trainer', row: trainerRow },
      { kind: 'delete', table: 'trainer_spell', key: { TrainerId: '17' } },
      { kind: 'insert', table: 'trainer_spell', row: spell('78') },
      { kind: 'insert', table: 'trainer_spell', row: spell('100') },
    ]);
    expect(flagOf(edited)).toBe(51);
  });

  it('writes the requirement as it is: the class of a class trainer, and what another type was read with', () => {
    const npc = npcFromRows(198, trained, counts);
    const asProfession = trainerStatements({ ...npc, trainer: { ...npc.trainer!, type: 'profession', requirement: 7 } }).apply;
    expect(asProfession.find((s) => s.table === 'trainer' && s.kind === 'insert')).toMatchObject({ row: { Type: '2', Requirement: '7' } });
    const reclassed = trainerStatements({ ...npc, trainer: { ...npc.trainer!, requirement: 2 } }).apply;
    expect(reclassed.find((s) => s.table === 'trainer' && s.kind === 'insert')).toMatchObject({ row: { Type: '0', Requirement: '2' } });
  });

  it('makes an NPC a trainer: a new trainer row under its own id, and bit 16 set, other bits kept', () => {
    const npc = npcFromRows(198, untrained, counts);
    const made = { ...npc, trainer: { trainerId: 900033, type: 'class' as const, requirement: 1, greeting: 'Hi', spells: [{ spell: 78, cost: 100, reqLevel: 10, reqSkill: 0, reqSkillRank: 0, reqSpells: [] }] } };
    const { apply, revert } = trainerStatements(made);
    expect(apply).toEqual([
      { kind: 'delete', table: 'creature_default_trainer', key: { CreatureId: '198' } },
      { kind: 'insert', table: 'creature_default_trainer', row: { CreatureId: '198', TrainerId: '900033' } },
      { kind: 'delete', table: 'trainer', key: { Id: '900033' } },
      { kind: 'insert', table: 'trainer', row: { Id: '900033', Type: '0', Requirement: '1', Greeting: 'Hi' } },
      { kind: 'delete', table: 'trainer_spell', key: { TrainerId: '900033' } },
      { kind: 'insert', table: 'trainer_spell', row: { TrainerId: '900033', SpellId: '78', MoneyCost: '100', ReqSkillLine: '0', ReqSkillRank: '0', ReqAbility1: '0', ReqAbility2: '0', ReqAbility3: '0', ReqLevel: '10' } },
    ]);
    expect(revert).toEqual([
      { kind: 'delete', table: 'creature_default_trainer', key: { CreatureId: '198' } },
      { kind: 'delete', table: 'trainer', key: { Id: '900033' } },
      { kind: 'delete', table: 'trainer_spell', key: { TrainerId: '900033' } },
    ]);
    expect(flagOf(made)).toBe(3 | 16);
  });

  it('stops being a trainer by deleting only the default-trainer row and clearing bit 16', () => {
    const npc = npcFromRows(198, trained, counts);
    const { apply, revert } = trainerStatements({ ...npc, trainer: null });
    expect(apply).toEqual([{ kind: 'delete', table: 'creature_default_trainer', key: { CreatureId: '198' } }]);
    expect(revert).toEqual([{ kind: 'delete', table: 'creature_default_trainer', key: { CreatureId: '198' } }, { kind: 'insert', table: 'creature_default_trainer', row: defaultRow }]);
    expect(flagOf({ ...npc, trainer: null })).toBe(51 & ~16);
  });

  it('lets an NPC stop teaching a trainer it shares, by deleting only its own link', () => {
    const shared = npcFromRows(198, trained, { ...counts, sharedTrainer: 30 });
    const { apply, revert } = trainerStatements({ ...shared, trainer: null });
    expect(apply).toEqual([{ kind: 'delete', table: 'creature_default_trainer', key: { CreatureId: '198' } }]);
    expect(revert).toEqual([{ kind: 'delete', table: 'creature_default_trainer', key: { CreatureId: '198' } }, { kind: 'insert', table: 'creature_default_trainer', row: defaultRow }]);
    expect(flagOf({ ...shared, trainer: null })).toBe(51 & ~16);
  });

  it('keeps a greeting the database left NULL as NULL until it is written', () => {
    const nulled = npcFromRows(198, { ...trained, trainer: [{ ...trainerRow, Greeting: null as never }] }, counts);
    const edited = { ...nulled, trainer: { ...nulled.trainer!, requirement: nulled.trainer!.requirement + 1, spells: [] } };
    expect(trainerStatements(edited).apply.find((s) => s.table === 'trainer' && s.kind === 'insert')).toMatchObject({ row: { Greeting: null } });
    const written = { ...nulled, trainer: { ...nulled.trainer!, greeting: 'Hi' } };
    expect(trainerStatements(written).apply.find((s) => s.table === 'trainer' && s.kind === 'insert')).toMatchObject({ row: { Greeting: 'Hi' } });
  });

  it('treats a trainer added and taken away again as unchanged', () => {
    const npc = npcFromRows(198, untrained, counts);
    expect(trainerStatements({ ...npc, trainer: null })).toEqual({ apply: [], revert: [] });
    expect(flagOf({ ...npc, trainer: null })).toBe(3);
  });

  it('never writes a trainer other NPCs share', () => {
    const npc = npcFromRows(198, trained, { ...counts, sharedTrainer: 30 });
    const edited = { ...npc, trainer: { ...npc.trainer!, greeting: 'Changed' } };
    expect(trainerStatements(edited)).toEqual({ apply: [], revert: [] });
    expect(flagOf(edited)).toBe(51);
  });

  it('after its own copy, writes new rows under the new id and leaves the shared trainer\'s rows alone', () => {
    const shared = npcFromRows(198, trained, { ...counts, sharedTrainer: 30 });
    const copied: CustomNpc = {
      ...shared,
      trainer: { ...shared.trainer!, trainerId: 900033 },
      origin: { ...shared.origin, locked: [] } as CustomNpc['origin'],
    };
    const { apply, revert } = trainerStatements(copied);
    expect(apply.filter((s) => s.kind === 'delete')).toEqual([
      { kind: 'delete', table: 'creature_default_trainer', key: { CreatureId: '198' } },
      { kind: 'delete', table: 'trainer', key: { Id: '900033' } },
      { kind: 'delete', table: 'trainer_spell', key: { TrainerId: '900033' } },
    ]);
    expect(apply.find((s) => s.table === 'creature_default_trainer' && s.kind === 'insert')).toMatchObject({ row: { CreatureId: '198', TrainerId: '900033' } });
    expect(apply.filter((s) => s.table === 'trainer_spell' && s.kind === 'insert')).toHaveLength(2);
    // The shared trainer 17 is in no key of either list
    for (const s of [...apply, ...revert]) {
      if (s.table === 'trainer' && s.kind === 'insert') expect(s.row.Id).not.toBe('17');
      if (s.table === 'trainer_spell' && s.kind === 'insert') expect(s.row.TrainerId).not.toBe('17');
    }
    // The revert puts the NPC back on trainer 17
    expect(revert).toContainEqual({ kind: 'insert', table: 'creature_default_trainer', row: defaultRow });
  });

  it('never touches a trainer it did not read (a project saved before trainers, or a fork without the tables)', () => {
    const { creature_default_trainer: _a, trainer: _b, trainer_spell: _c, ...unread } = trained;
    const npc = npcFromRows(198, unread, counts);
    const edited = { ...npc, trainer: { trainerId: 900033, type: 'class' as const, requirement: 1, greeting: 'Hi', spells: [] } };
    expect(trainerStatements(edited)).toEqual({ apply: [], revert: [] });
    expect(flagOf(edited)).toBe(51);
  });

  it('leaves an NPC with a trainer it could not model alone', () => {
    const odd = npcFromRows(198, { ...trained, trainer: [{ ...trainerRow, Type: '9' }] }, counts);
    expect(trainerStatements({ ...odd, trainer: { trainerId: 900033, type: 'class' as const, requirement: 1, greeting: '', spells: [] } })).toEqual({ apply: [], revert: [] });
  });
});
