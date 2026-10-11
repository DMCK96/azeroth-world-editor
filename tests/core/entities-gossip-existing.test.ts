import { describe, expect, it } from 'vitest';
import { existingStatements } from '../../src/core/entities/existing';
import { npcFromRows } from '../../src/core/entities/from-rows';
import { EMPTY_ENTITIES, type CustomNpc, type GossipMenu } from '../../src/core/entities/model';

const template = { entry: '1423', name: 'Guard', subname: '', minlevel: '10', maxlevel: '10', faction: '11', rank: '0', type: '7', npcflag: '129', lootid: '0', AIName: '', ScriptName: '', gossip_menu_id: '5000' };
const model = { CreatureID: '1423', Idx: '0', CreatureDisplayID: '3167', DisplayScale: '1', Probability: '1' };
const menuRow = (id: string, text: string) => ({ MenuID: id, TextID: text, VerifiedBuild: '12340' });
const textRow = (id: string, over: Record<string, string | null> = {}) => ({ ID: id, text0_0: 'Hello', text0_1: 'Hello, lady', BroadcastTextID0: '123', lang0: '0', Probability0: '1', text1_0: '', text1_1: '', BroadcastTextID1: '0', Probability1: '0', VerifiedBuild: '12340', ...over });
const optionRow = (menuId: string, id: string, over: Record<string, string | null> = {}) => ({ MenuID: menuId, OptionID: id, OptionIcon: '0', OptionText: 'Option', OptionBroadcastTextID: '77', OptionType: '1', OptionNpcFlag: '1', ActionMenuID: '0', ActionPoiID: '0', BoxCoded: '0', BoxMoney: '0', BoxText: null, BoxBroadcastTextID: '0', VerifiedBuild: '12340', ...over });
const gossipRows = {
  creature_template: [template], creature_template_model: [model],
  gossip_menu: [menuRow('5000', '7000'), menuRow('5001', '7001')],
  npc_text: [textRow('7000'), textRow('7001', { text0_0: 'Farewell', text0_1: '', BroadcastTextID0: '0' })],
  gossip_menu_option: [
    optionRow('5000', '0', { OptionText: 'Browse', OptionIcon: '1', OptionType: '3', OptionNpcFlag: '128' }),
    optionRow('5000', '1', { OptionText: 'More', ActionMenuID: '5001' }),
    optionRow('5001', '0', { OptionText: 'Bye' }),
  ],
  conditions: [], smart_scripts: [],
};
const bare = { creature_template: [{ ...template, gossip_menu_id: '0' }], creature_template_model: [model], gossip_menu: [], npc_text: [], gossip_menu_option: [], conditions: [], smart_scripts: [] };
const counts = { sharedLoot: 0, spawnCount: 1, sharedTrainer: 0 };
const store = (npc: CustomNpc) => ({ ...EMPTY_ENTITIES, npcs: [npc] });
const TABLES = ['gossip_menu', 'gossip_menu_option', 'npc_text'];
const gossipStatements = (npc: CustomNpc) => {
  const out = existingStatements(store(npc), []);
  const only = (list: typeof out.apply) => list.filter((s) => TABLES.includes(s.table));
  return { apply: only(out.apply), revert: only(out.revert) };
};
const templateRowOf = (npc: CustomNpc) => (existingStatements(store(npc), []).apply.find((s) => s.table === 'creature_template' && s.kind === 'insert') as { row: Record<string, string> }).row;
const read = (rows: object = gossipRows, c: object = counts) => npcFromRows(1423, rows as never, c as never);
/** The NPC with one menu replaced */
const withMenu = (npc: CustomNpc, index: number, change: (m: GossipMenu) => GossipMenu): CustomNpc =>
  ({ ...npc, gossipMenu: { menus: npc.gossipMenu!.menus.map((m, i) => (i === index ? change(m) : m)) } });

describe('writing an existing NPC\'s gossip', () => {
  it('writes nothing for a tree it only read, and leaves gossip_menu_id and npcflag as they were', () => {
    const npc = read();
    expect(gossipStatements(npc)).toEqual({ apply: [], revert: [] });
    expect(templateRowOf(npc)).toMatchObject({ gossip_menu_id: '5000', npcflag: '129' });
  });

  it('writes only the option that changed, keyed option by option, clearing the edited text\'s broadcast id; the menu and text rows it left as they were are not written', () => {
    const edited = withMenu(read(), 0, (m) => ({ ...m, options: m.options.map((o) => (o.optionId === 1 ? { ...o, text: 'Tell me more' } : o)) }));
    const { apply, revert } = gossipStatements(edited);
    expect(apply).toEqual([
      { kind: 'delete', table: 'gossip_menu_option', key: { MenuID: '5000', OptionID: '0' } },
      { kind: 'delete', table: 'gossip_menu_option', key: { MenuID: '5000', OptionID: '1' } },
      { kind: 'insert', table: 'gossip_menu_option', row: optionRow('5000', '0', { OptionText: 'Browse', OptionIcon: '1', OptionType: '3', OptionNpcFlag: '128' }) },
      { kind: 'insert', table: 'gossip_menu_option', row: optionRow('5000', '1', { OptionText: 'Tell me more', OptionBroadcastTextID: '0', ActionMenuID: '5001' }) },
    ]);
    expect(revert.filter((s) => s.kind === 'insert')).toEqual([
      { kind: 'insert', table: 'gossip_menu_option', row: optionRow('5000', '0', { OptionText: 'Browse', OptionIcon: '1', OptionType: '3', OptionNpcFlag: '128' }) },
      { kind: 'insert', table: 'gossip_menu_option', row: optionRow('5000', '1', { OptionText: 'More', ActionMenuID: '5001' }) },
    ]);
    expect(templateRowOf(edited)).toMatchObject({ gossip_menu_id: '5000', npcflag: '129' });
  });

  it('clears a variant\'s broadcast id only when its text changed', () => {
    const same = withMenu(read(), 0, (m) => ({ ...m, options: [...m.options, { optionId: 2, icon: 0, text: 'New', action: { kind: 'close' }, kept: false }] }));
    // The text is as it was read, so its row is not written
    expect(gossipStatements(same).apply.filter((s) => s.table === 'npc_text')).toEqual([]);
    const changed = withMenu(read(), 0, (m) => ({ ...m, greeting: [{ ...m.greeting[0]!, text: 'Welcome' }] }));
    expect(gossipStatements(changed).apply).toContainEqual({ kind: 'insert', table: 'npc_text', row: textRow('7000', { text0_0: 'Welcome', BroadcastTextID0: '0' }) });
  });

  it('adds a new option with the next id and a close action as type 1, flag 1', () => {
    const added = withMenu(read(), 1, (m) => ({ ...m, options: [...m.options, { optionId: 1, icon: 3, text: 'Farewell', action: { kind: 'close' }, kept: false }] }));
    const inserted = gossipStatements(added).apply.find((s) => s.table === 'gossip_menu_option' && s.kind === 'insert' && s.row.OptionID === '1');
    expect(inserted).toEqual({ kind: 'insert', table: 'gossip_menu_option', row: { MenuID: '5001', OptionID: '1', OptionIcon: '3', OptionText: 'Farewell', OptionType: '1', OptionNpcFlag: '1', ActionMenuID: '0' } });
  });

  it('writes a service option as its type and flag, and a changed action as the type and flag of its new kind', () => {
    const service = withMenu(read(), 0, (m) => ({ ...m, options: m.options.map((o) => (o.optionId === 1 ? { ...o, action: { kind: 'service' as const, type: 5, npcFlag: 16 } } : o)) }));
    expect(gossipStatements(service).apply).toContainEqual({ kind: 'insert', table: 'gossip_menu_option', row: optionRow('5000', '1', { OptionText: 'More', OptionType: '5', OptionNpcFlag: '16', ActionMenuID: '0' }) });
    const closed = withMenu(read(), 0, (m) => ({ ...m, options: m.options.map((o) => (o.optionId === 0 ? { ...o, action: { kind: 'close' as const } } : o)) }));
    expect(gossipStatements(closed).apply).toContainEqual({ kind: 'insert', table: 'gossip_menu_option', row: optionRow('5000', '0', { OptionText: 'Browse', OptionIcon: '1', OptionType: '1', OptionNpcFlag: '1', ActionMenuID: '0' }) });
  });

  it('keeps the type and flag of a plain option that opens a menu', () => {
    const odd = { ...gossipRows, gossip_menu_option: [optionRow('5000', '0', { OptionText: 'More', OptionNpcFlag: '3', ActionMenuID: '5001' }), optionRow('5001', '0')] };
    const edited = withMenu(read(odd), 0, (m) => ({ ...m, options: [{ ...m.options[0]!, text: 'Even more' }] }));
    expect(gossipStatements(edited).apply).toContainEqual({ kind: 'insert', table: 'gossip_menu_option', row: optionRow('5000', '0', { OptionText: 'Even more', OptionBroadcastTextID: '0', OptionNpcFlag: '3', ActionMenuID: '5001' }) });
  });

  it('removes a removed option and a removed menu with its text, deleting only keys it owns', () => {
    const noOption = withMenu(read(), 1, (m) => ({ ...m, options: [] }));
    expect(gossipStatements(noOption).apply.filter((s) => s.table === 'gossip_menu_option')).toEqual([{ kind: 'delete', table: 'gossip_menu_option', key: { MenuID: '5001', OptionID: '0' } }]);
    const npc = read();
    const dropped = { ...npc, gossipMenu: { menus: [{ ...npc.gossipMenu!.menus[0]!, options: npc.gossipMenu!.menus[0]!.options.filter((o) => o.optionId === 0) }] } };
    const { apply } = gossipStatements(dropped);
    expect(apply).toContainEqual({ kind: 'delete', table: 'gossip_menu', key: { MenuID: '5001', TextID: '7001' } });
    expect(apply).toContainEqual({ kind: 'delete', table: 'npc_text', key: { ID: '7001' } });
    expect(apply).toContainEqual({ kind: 'delete', table: 'gossip_menu_option', key: { MenuID: '5001', OptionID: '0' } });
    expect(apply.filter((s) => s.kind === 'insert' && s.table === 'gossip_menu' && s.row.MenuID === '5001')).toEqual([]);
  });

  it('never writes a locked menu, and never deletes a kept option', () => {
    const shared = read(gossipRows, { ...counts, sharedMenus: { 5000: 2 } });
    const edited = withMenu(shared, 0, (m) => ({ ...m, greeting: [{ ...m.greeting[0]!, text: 'Changed' }] }));
    expect(gossipStatements(edited)).toEqual({ apply: [], revert: [] });
    const tied = read({ ...gossipRows, conditions: [{ SourceTypeOrReferenceId: '15', SourceGroup: '5001', SourceEntry: '0' }] });
    const dropped = withMenu(tied, 1, (m) => ({ ...m, options: [] }));
    expect(gossipStatements(dropped).apply.filter((s) => s.table === 'gossip_menu_option')).toEqual([]);
  });

  it('lets an NPC give up a shared root menu by clearing only gossip_menu_id', () => {
    const shared = read(gossipRows, { ...counts, sharedMenus: { 5000: 2 } });
    const out = { ...shared, gossipMenu: null };
    expect(gossipStatements(out)).toEqual({ apply: [], revert: [] });
    expect(templateRowOf(out)).toMatchObject({ gossip_menu_id: '0' });
  });

  it('gives an NPC without a menu one: new rows and gossip_menu_id, other flags kept', () => {
    const npc = read(bare);
    const made = { ...npc, gossipMenu: { menus: [{ menuId: 932535, textId: 9780013, locked: false, greeting: [{ text: 'Hail', textFemale: '', probability: 1 }], options: [{ optionId: 0, icon: 0, text: 'Goodbye', action: { kind: 'close' as const }, kept: false }] }] } };
    const { apply, revert } = gossipStatements(made);
    expect(apply).toEqual([
      { kind: 'delete', table: 'gossip_menu', key: { MenuID: '932535', TextID: '9780013' } },
      { kind: 'insert', table: 'gossip_menu', row: { MenuID: '932535', TextID: '9780013' } },
      { kind: 'delete', table: 'npc_text', key: { ID: '9780013' } },
      { kind: 'insert', table: 'npc_text', row: { ID: '9780013', text0_0: 'Hail', text0_1: '', Probability0: '1', BroadcastTextID0: '0' } },
      { kind: 'delete', table: 'gossip_menu_option', key: { MenuID: '932535', OptionID: '0' } },
      { kind: 'insert', table: 'gossip_menu_option', row: { MenuID: '932535', OptionID: '0', OptionIcon: '0', OptionText: 'Goodbye', OptionType: '1', OptionNpcFlag: '1', ActionMenuID: '0' } },
    ]);
    expect(revert.every((s) => s.kind === 'delete')).toBe(true);
    expect(templateRowOf(made)).toMatchObject({ gossip_menu_id: '932535', npcflag: '129' });
  });

  it('writes a copy under new ids and leaves the shared menu\'s rows in no key', () => {
    const shared = read(gossipRows, { ...counts, sharedMenus: { 5000: 2, 5001: 2 } });
    const m0 = shared.gossipMenu!.menus[0]!;
    const m1 = shared.gossipMenu!.menus[1]!;
    const copy: CustomNpc = {
      ...shared,
      gossipMenu: { menus: [
        { ...m0, menuId: 932535, textId: 9780013, locked: false, options: m0.options.map((o) => (o.action.kind === 'menu' ? { ...o, action: { kind: 'menu' as const, menuId: 932536 } } : o)) },
        { ...m1, menuId: 932536, textId: 9780014, locked: false },
      ] },
    };
    const { apply, revert } = gossipStatements(copy);
    for (const s of [...apply, ...revert]) {
      const key = s.kind === 'insert' ? s.row : s.key;
      if (s.table === 'gossip_menu' || s.table === 'gossip_menu_option') expect(['5000', '5001']).not.toContain(key.MenuID);
      if (s.table === 'npc_text') expect(['7000', '7001']).not.toContain(key.ID);
    }
    // A copy is new rows: what the editor does not model (map markers, boxes, translations) is not copied
    expect(apply).toContainEqual({ kind: 'insert', table: 'gossip_menu_option', row: { MenuID: '932535', OptionID: '1', OptionIcon: '0', OptionText: 'More', OptionType: '1', OptionNpcFlag: '1', ActionMenuID: '932536' } });
    expect(templateRowOf(copy)).toMatchObject({ gossip_menu_id: '932535' });
  });

  it('keeps a text column the database left NULL as NULL', () => {
    const nulled = read({ ...gossipRows, npc_text: [textRow('7000', { text0_1: null }), textRow('7001')] });
    const edited = withMenu(nulled, 0, (m) => ({ ...m, greeting: [{ ...m.greeting[0]!, text: 'Welcome' }] }));
    expect(gossipStatements(edited).apply).toContainEqual({ kind: 'insert', table: 'npc_text', row: textRow('7000', { text0_0: 'Welcome', BroadcastTextID0: '0', text0_1: null }) });
  });

  it('never touches gossip it did not read (a project saved before gossip, or a fork without the tables)', () => {
    const { gossip_menu: _a, gossip_menu_option: _b, npc_text: _c, ...unread } = gossipRows;
    const npc = read(unread);
    const edited = { ...npc, gossipMenu: { menus: [{ menuId: 932535, textId: 9780013, locked: false, greeting: [{ text: 'Hail', textFemale: '', probability: 1 }], options: [] }] } } as CustomNpc;
    expect(gossipStatements(edited)).toEqual({ apply: [], revert: [] });
    expect(templateRowOf(edited)).toMatchObject({ gossip_menu_id: '5000' });
  });
});
