import { describe, expect, it } from 'vitest';
import { existingDrift, existingStatements, newLootIds } from '../../src/core/entities/existing';
import { npcFromRows, objectFromRows, itemFromRows } from '../../src/core/entities/from-rows';
import { EMPTY_ENTITIES } from '../../src/core/entities/model';

const template = { entry: '1423', name: 'Stormwind Guard', subname: '', minlevel: '55', maxlevel: '56', faction: '11', rank: '1', type: '7', npcflag: '4097',
  HealthModifier: '1', DamageModifier: '1', AIName: '', ScriptName: '', lootid: '1423', unit_flags: '32768' };
const model = { CreatureID: '1423', Idx: '0', CreatureDisplayID: '3167', DisplayScale: '1', Probability: '1', VerifiedBuild: '12340' };
const loot = { Entry: '1423', Item: '2589', Reference: '0', Chance: '35', QuestRequired: '0', LootMode: '1', GroupId: '0', MinCount: '1', MaxCount: '2', Comment: '' };
const rows = { creature_template: [template], creature_template_model: [model], creature_loot_template: [loot] };
const guard = npcFromRows(1423, rows, { sharedLoot: 0, spawnCount: 3 });
const store = (npc = guard) => ({ ...EMPTY_ENTITIES, npcs: [npc] });

describe('existingStatements', () => {
  it('writes the template as the database had it with the editor\'s columns laid over, keeping the rest', () => {
    const { apply } = existingStatements(store({ ...guard, minLevel: 60, maxLevel: 60, questGiver: true }), []);
    expect(apply).toContainEqual({ kind: 'delete', table: 'creature_template', key: { entry: '1423' } });
    const row = apply.find((s) => s.kind === 'insert' && s.table === 'creature_template') as any;
    expect(row.row).toMatchObject({ entry: '1423', minlevel: '60', maxlevel: '60', unit_flags: '32768', AIName: '', lootid: '1423' });
    // npcflag keeps 4096 (a bit the editor does not model) and gains the quest giver bit
    expect(row.row.npcflag).toBe('4099');
  });

  it('is a quest giver when a project quest starts or ends with it', () => {
    const { apply } = existingStatements(store(), [1423]);
    expect((apply.find((s) => s.kind === 'insert' && s.table === 'creature_template') as any).row.npcflag).toBe('4099');
  });

  it('writes the model row with the editor\'s look over the original', () => {
    const { apply } = existingStatements(store({ ...guard, displayId: 4000, scale: 2 }), []);
    expect(apply).toContainEqual({ kind: 'insert', table: 'creature_template_model', row: { ...model, CreatureDisplayID: '4000', DisplayScale: '2' } });
  });

  it('replaces the loot list under its own loot id, and the revert puts every original row back', () => {
    const next = { ...guard, loot: [{ item: 774, chance: 10, min: 1, max: 1, questOnly: true }] };
    const { apply, revert } = existingStatements(store(next), []);
    expect(apply).toContainEqual({ kind: 'delete', table: 'creature_loot_template', key: { Entry: '1423' } });
    expect(apply).toContainEqual({ kind: 'insert', table: 'creature_loot_template', row: { Entry: '1423', Item: '774', Reference: '0', Chance: '10', QuestRequired: '1', LootMode: '1', GroupId: '0', MinCount: '1', MaxCount: '1', Comment: '' } });
    expect(revert).toEqual([
      { kind: 'delete', table: 'creature_loot_template', key: { Entry: '1423' } },
      { kind: 'insert', table: 'creature_loot_template', row: loot },
    ]);
    // The template and model rows are as they were read, so neither file touches them
    expect([...apply, ...revert].filter((s) => s.table === 'creature_template' || s.table === 'creature_template_model')).toEqual([]);
  });

  it('leaves a locked loot list alone', () => {
    const locked = { ...guard, origin: { ...(guard.origin as any), locked: ['loot'] } };
    const { apply } = existingStatements(store(locked), []);
    expect(apply.some((s) => s.table === 'creature_loot_template')).toBe(false);
  });

  it('gives an NPC with no loot id its own entry when loot is added', () => {
    const bare = npcFromRows(1423, { creature_template: [{ ...template, lootid: '0' }] }, { sharedLoot: 0, spawnCount: 1 });
    const { apply } = existingStatements(store({ ...bare, loot: [{ item: 774, chance: 10, min: 1, max: 1, questOnly: false }] }), []);
    expect((apply.find((s) => s.kind === 'insert' && s.table === 'creature_template') as any).row.lootid).toBe('1423');
  });

  it('writes an object\'s name, look and size over its row, and only those when its type is locked', () => {
    const mailbox = objectFromRows(143981, { gameobject_template: [{ entry: '143981', type: '19', displayId: '1949', name: 'Mailbox', size: '1', Data0: '7' }] }, { sharedLoot: 0, spawnCount: 1 });
    const { apply } = existingStatements({ ...EMPTY_ENTITIES, objects: [{ ...mailbox, name: 'Post', size: 2 }] }, []);
    expect((apply.find((s) => s.kind === 'insert' && s.table === 'gameobject_template') as any).row).toEqual({ entry: '143981', type: '19', displayId: '1949', name: 'Post', size: '2', Data0: '7' });
  });

  it('writes an item as its row with the editor\'s columns over it', () => {
    const cloth = itemFromRows(2589, { item_template: [{ entry: '2589', name: 'Linen Cloth', class: '7', subclass: '5', displayid: '7426', Quality: '1', holy_res: '0' }] });
    const { apply, revert } = existingStatements({ ...EMPTY_ENTITIES, items: [{ ...cloth, name: 'Fine Linen' }] }, []);
    expect((apply.find((s) => s.kind === 'insert' && s.table === 'item_template') as any).row).toMatchObject({ entry: '2589', name: 'Fine Linen', holy_res: '0' });
    expect(revert).toContainEqual({ kind: 'insert', table: 'item_template', row: { entry: '2589', name: 'Linen Cloth', class: '7', subclass: '5', displayid: '7426', Quality: '1', holy_res: '0' } });
  });

  it('writes Seen by into flags_extra and type_flags, keeping their other bits; leaves them alone when unchanged or not set', () => {
    const flagged = npcFromRows(1423, { ...rows, creature_template: [{ ...template, flags_extra: '64', type_flags: '4' }] }, { sharedLoot: 0, spawnCount: 3 });
    const row = (npc: typeof guard) => (existingStatements(store(npc), []).apply.find((s) => s.kind === 'insert' && s.table === 'creature_template') as any)?.row;
    expect(row({ ...flagged, seenBy: 'dead' })).toMatchObject({ flags_extra: '1088', type_flags: '4' });
    expect(row(flagged)).toBeUndefined();
    const saved = { ...flagged };
    delete (saved as any).seenBy;
    expect(row({ ...saved, minLevel: 60 })).toMatchObject({ flags_extra: '64', type_flags: '4' });
  });

  it('leaves a ghost-only NPC saved before Seen by existed as it is', () => {
    const ghost = npcFromRows(1423, { ...rows, creature_template: [{ ...template, flags_extra: '1024' }] }, { sharedLoot: 0, spawnCount: 1 });
    const saved = { ...ghost };
    delete (saved as any).seenBy;
    const out = (existingStatements(store({ ...saved, minLevel: 60 }), []).apply.find((s) => s.kind === 'insert' && s.table === 'creature_template') as any).row;
    expect(out.flags_extra).toBe('1024');
  });

  it('writes nothing for new entities', () => {
    expect(existingStatements({ ...EMPTY_ENTITIES, npcs: [{ ...guard, origin: { kind: 'new' } }] }, [])).toEqual({ apply: [], revert: [] });
  });
});

describe('existingStatements, more of an object', () => {
  const chestRow = { entry: '2843', type: '3', displayId: '10', name: 'Chest', size: '1', Data0: '57', Data1: '2843', Data8: '0' };
  const chestLoot = { Entry: '2843', Item: '774', Reference: '0', Chance: '50', QuestRequired: '0', LootMode: '1', GroupId: '0', MinCount: '1', MaxCount: '1', Comment: '' };

  it('keeps a chest\'s loot under its own list and its other Data columns', () => {
    const chest = objectFromRows(2843, { gameobject_template: [chestRow], gameobject_loot_template: [chestLoot] }, { sharedLoot: 0, spawnCount: 1 });
    const { apply, revert } = existingStatements({ ...EMPTY_ENTITIES, objects: [{ ...chest, name: 'Old Chest', loot: [] }] }, []);
    expect((apply.find((s) => s.kind === 'insert' && s.table === 'gameobject_template') as any).row).toMatchObject({ Data0: '57', Data1: '2843', Data8: '0' });
    expect(apply).toContainEqual({ kind: 'delete', table: 'gameobject_loot_template', key: { Entry: '2843' } });
    expect(apply.some((s) => s.kind === 'insert' && s.table === 'gameobject_loot_template')).toBe(false);
    expect(revert).toContainEqual({ kind: 'insert', table: 'gameobject_loot_template', row: chestLoot });
  });

  it('clears the old type\'s Data columns when its type changes', () => {
    const chest = objectFromRows(2843, { gameobject_template: [chestRow] }, { sharedLoot: 0, spawnCount: 1 });
    const { apply } = existingStatements({ ...EMPTY_ENTITIES, objects: [{ ...chest, type: 'generic' }] }, []);
    expect((apply.find((s) => s.kind === 'insert' && s.table === 'gameobject_template') as any).row).toMatchObject({ type: '5', Data0: '0', Data1: '0', Data8: '0' });
  });

  it('writes the page chain over its rows and the revert puts the original chain back', () => {
    const page = { ID: '50', Text: 'Old', NextPageID: '0', VerifiedBuild: '1' };
    const sign = objectFromRows(9, { gameobject_template: [{ entry: '9', type: '9', displayId: '1', name: 'Sign', size: '1', Data0: '50' }], page_text: [page] }, { sharedLoot: 0, spawnCount: 1 });
    const { apply, revert } = existingStatements({ ...EMPTY_ENTITIES, objects: [{ ...sign, pages: [{ id: 50, text: 'New' }, { id: 51, text: 'Two' }] }] }, []);
    expect(apply).toContainEqual({ kind: 'insert', table: 'page_text', row: { ID: '50', Text: 'New', NextPageID: '51', VerifiedBuild: '1' } });
    expect(apply).toContainEqual({ kind: 'insert', table: 'page_text', row: { ID: '51', Text: 'Two', NextPageID: '0' } });
    expect(revert).toContainEqual({ kind: 'delete', table: 'page_text', key: { ID: '51' } });
    expect(revert).toContainEqual({ kind: 'insert', table: 'page_text', row: page });
  });
});

describe('existingStatements, an NPC\'s weapons', () => {
  it('writes the weapons over the original row, and only deletes it once unarmed', () => {
    const gear = { CreatureID: '1423', ID: '1', ItemID1: '1899', ItemID2: '143', ItemID3: '0', VerifiedBuild: '1' };
    const armed = npcFromRows(1423, { ...rows, creature_equip_template: [gear] }, { sharedLoot: 0, spawnCount: 1 });
    const swap = existingStatements(store({ ...armed, equipment: { mainHand: 2000, offHand: 0, ranged: 0 } }), []);
    expect(swap.apply).toContainEqual({ kind: 'insert', table: 'creature_equip_template', row: { ...gear, ItemID1: '2000', ItemID2: '0' } });
    const bare = existingStatements(store({ ...armed, equipment: { mainHand: 0, offHand: 0, ranged: 0 } }), []);
    expect(bare.apply).toContainEqual({ kind: 'delete', table: 'creature_equip_template', key: { CreatureID: '1423', ID: '1' } });
    expect(bare.apply.some((s) => s.kind === 'insert' && s.table === 'creature_equip_template')).toBe(false);
    expect(bare.revert).toContainEqual({ kind: 'insert', table: 'creature_equip_template', row: gear });
  });
});

describe('existingDrift', () => {
  const db = (tables: Record<string, Record<string, string | null>[]>) => ({
    selectRows: async (table: string, where: Record<string, string | readonly string[]>) =>
      (tables[table] ?? []).filter((r) => Object.entries(where).every(([c, v]) => (Array.isArray(v) ? v : [v]).includes(r[c] ?? ''))),
  });

  it('lists nothing while the database has the rows as they were', async () => {
    expect(await existingDrift(db(rows), store())).toEqual([]);
  });

  it('names an entity whose rows the database changed since', async () => {
    const changed = { ...rows, creature_template: [{ ...template, maxlevel: '58' }] };
    expect(await existingDrift(db(changed), store())).toEqual([{ kind: 'npc', entry: 1423, name: 'Stormwind Guard' }]);
    const lootGone = { ...rows, creature_loot_template: [] };
    expect(await existingDrift(db(lootGone), store())).toHaveLength(1);
  });

  it('compares the same rows the entity was read with: every model, and the loot of the loot id the database has now', async () => {
    const second = { ...model, Idx: '1', CreatureDisplayID: '3168' };
    const read = npcFromRows(1423, { ...rows, creature_template_model: [model, second] }, { sharedLoot: 0, spawnCount: 3 });
    const both = { ...rows, creature_template_model: [model, second] };
    expect(await existingDrift(db(both), store(read))).toEqual([]);
    const secondChanged = { ...both, creature_template_model: [model, { ...second, CreatureDisplayID: '9999' }] };
    expect(await existingDrift(db(secondChanged), store(read))).toEqual([{ kind: 'npc', entry: 1423, name: 'Stormwind Guard' }]);
    expect(await existingDrift(db({ ...rows, creature_template: [] }), store())).toHaveLength(1);
  });
});

describe('existingStatements keeps what the editor did not change', () => {
  const insertOf = (apply: { kind: string; table: string }[], table: string) => (apply.find((s) => s.kind === 'insert' && s.table === table) as any).row;

  it('keeps a totem\'s creature type (11, which the editor has no name for) when only its name changes', () => {
    const totemRow = { ...template, entry: '5913', name: 'Tremor Totem', type: '11', rank: '0' };
    const totem = npcFromRows(5913, { creature_template: [totemRow] }, { sharedLoot: 0, spawnCount: 0 });
    const row = insertOf(existingStatements(store({ ...totem, name: 'Quake Totem' }), []).apply, 'creature_template');
    expect(row).toMatchObject({ name: 'Quake Totem', type: '11' });
    // A type the author does choose is written
    expect(insertOf(existingStatements(store({ ...totem, type: 'beast' }), []).apply, 'creature_template').type).toBe('1');
  });

  it('writes an NPC with no edits exactly as the database had it', () => {
    const odd = { ...template, type: '0', rank: '7', faction: null, minlevel: '' };
    const npc = npcFromRows(1423, { creature_template: [odd] }, { sharedLoot: 0, spawnCount: 0 });
    expect(insertOf(existingStatements(store({ ...npc, name: 'Renamed', loot: [] }), []).apply, 'creature_template')).toEqual({ ...odd, name: 'Renamed' });
  });

  it('keeps an item\'s stat and spell slots as they were (zero stats, gaps, empty-slot cooldowns) unless edited', () => {
    const blade = {
      entry: '2000', name: 'Blade', class: '2', subclass: '7', displayid: '1', Quality: '2', StatsCount: '2',
      stat_type1: '0', stat_value1: '0', stat_type2: '7', stat_value2: '0', stat_type3: '4', stat_value3: '5',
      spellid_1: '0', spelltrigger_1: '0', spellcharges_1: '0', spellcooldown_1: '0', spellcategory_1: '0', spellcategorycooldown_1: '0',
      spellid_2: '18384', spelltrigger_2: '1', spellcharges_2: '0', spellcooldown_2: '-1', spellcategory_2: '0', spellcategorycooldown_2: '-1',
    };
    const item = itemFromRows(2000, { item_template: [blade] });
    const row = insertOf(existingStatements({ ...EMPTY_ENTITIES, items: [{ ...item, name: 'Sharp Blade' }] }, []).apply, 'item_template');
    expect(row).toMatchObject({ ...blade, name: 'Sharp Blade' });
    // An edited stat writes the stat block as the editor packs it
    const edited = insertOf(existingStatements({ ...EMPTY_ENTITIES, items: [{ ...item, stats: [{ type: 4, value: 6 }] }] }, []).apply, 'item_template');
    expect(edited).toMatchObject({ StatsCount: '1', stat_type1: '4', stat_value1: '6', stat_type3: '0', stat_value3: '0', spellid_2: '18384', spellcooldown_1: '0' });
  });
});

describe('a new loot id for an existing NPC or chest', () => {
  const fake = (tables: Record<string, Record<string, string | null>[]>) => ({
    selectRows: async (table: string, where: Record<string, string | readonly string[]>) =>
      (tables[table] ?? []).filter((r) => Object.entries(where).every(([c, v]) => (Array.isArray(v) ? v : [v]).includes(r[c] ?? ''))),
    selectMax: async (table: string, column: string) => Math.max(0, ...(tables[table] ?? []).map((r) => Number(r[column]))),
  });
  const bareRow = { ...template, lootid: '0' };
  const bare = npcFromRows(1423, { creature_template: [bareRow] }, { sharedLoot: 0, spawnCount: 1 });
  const looted = { ...bare, loot: [{ item: 774, chance: 10, min: 1, max: 1, questOnly: false }] };
  const theirs = { ...loot, Entry: '1423', Item: '9999' };

  it('takes a free loot id when the entry is already some other list, so apply never overwrites it and revert never deletes it', async () => {
    const db = fake({ creature_template: [bareRow, { ...template, entry: '1500', lootid: '1423' }], creature_loot_template: [theirs, { ...loot, Entry: '3000' }] });
    const { ids, warnings } = await newLootIds(db, store(looted));
    expect(ids.get('npc:1423')).toBe(3001);
    expect(warnings).toHaveLength(1);
    const { apply, revert } = existingStatements(store(looted), [], ids);
    expect((apply.find((s) => s.kind === 'insert' && s.table === 'creature_template') as any).row.lootid).toBe('3001');
    expect([...apply, ...revert].some((s) => s.table === 'creature_loot_template' && (s as any).key?.Entry === '1423')).toBe(false);
    expect(revert).toContainEqual({ kind: 'delete', table: 'creature_loot_template', key: { Entry: '3001' } });
  });

  it('keeps the entry as the loot id when no list has it, or when it is this NPC\'s own from an earlier apply', async () => {
    expect((await newLootIds(fake({ creature_template: [bareRow], creature_loot_template: [] }), store(looted))).ids.size).toBe(0);
    const applied = fake({ creature_template: [{ ...bareRow, lootid: '1423' }], creature_loot_template: [{ ...loot, Entry: '1423' }] });
    expect((await newLootIds(applied, store(looted))).ids.size).toBe(0);
  });

  it('does the same for a chest given its first loot', async () => {
    const chestRow = { entry: '2843', type: '3', displayId: '10', name: 'Chest', size: '1', Data0: '57', Data1: '0', Data8: '0' };
    const chest = objectFromRows(2843, { gameobject_template: [chestRow] }, { sharedLoot: 0, spawnCount: 1 });
    const withLoot = { ...EMPTY_ENTITIES, objects: [{ ...chest, loot: [{ item: 774, chance: 10, min: 1, max: 1, questOnly: false }] }] };
    const db = fake({ gameobject_template: [chestRow], gameobject_loot_template: [{ ...loot, Entry: '2843' }, { ...loot, Entry: '5000' }] });
    const { ids } = await newLootIds(db, withLoot);
    expect(ids.get('object:2843')).toBe(5001);
    expect((existingStatements(withLoot, [], ids).apply.find((s) => s.kind === 'insert' && s.table === 'gameobject_template') as any).row.Data1).toBe('5001');
  });
});

describe("an existing NPC's spawn events in its rows", () => {
  const fixture = async () => {
    const { forkDb } = await import('../helpers/fixtures');
    const db = forkDb();
    db.insert('creature_template', template);
    db.insert('creature', { guid: '80330', id1: '1423', map: '0' });
    db.insert('game_event_creature', { eventEntry: '12', guid: '80330' });
    return db;
  };

  it('reads its spawns and their event rows with its other rows', async () => {
    const { readOriginalRows } = await import('../../src/core/entities/existing');
    const read = await readOriginalRows(await fixture(), 'npc', 1423);
    expect(read!.creature).toEqual([{ guid: '80330' }]);
    expect(read!.game_event_creature).toEqual([{ eventEntry: '12', guid: '80330' }]);
  });

  it('does not count tables a project saved before they were read as drift', async () => {
    const db = await fixture();
    const { readOriginalRows } = await import('../../src/core/entities/existing');
    const read = (await readOriginalRows(db, 'npc', 1423))!;
    const older = { ...read };
    delete (older as any).creature;
    delete (older as any).game_event_creature;
    const npc = npcFromRows(1423, older, { sharedLoot: 0, spawnCount: 1 });
    expect(await existingDrift(db, store(npc))).toEqual([]);
  });

  it('does not count a spawn added or taken away as drift, but does count a spawn\'s events changing', async () => {
    const db = await fixture();
    const { readOriginalRows } = await import('../../src/core/entities/existing');
    const npc = npcFromRows(1423, (await readOriginalRows(db, 'npc', 1423))!, { sharedLoot: 0, spawnCount: 1 });
    db.insert('creature', { guid: '80331', id1: '1423', map: '0' });
    db.insert('game_event_creature', { eventEntry: '4', guid: '80331' });
    expect(await existingDrift(db, store(npc))).toEqual([]);
    db.insert('game_event_creature', { eventEntry: '7', guid: '80330' });
    expect(await existingDrift(db, store(npc))).toEqual([{ kind: 'npc', entry: 1423, name: 'Stormwind Guard' }]);
  });

  it('writes no event rows for an NPC exported unedited', () => {
    const { apply } = existingStatements(store(), []);
    expect(apply.some((s) => s.table === 'game_event_creature')).toBe(false);
  });
});
