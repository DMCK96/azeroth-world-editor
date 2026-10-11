import { fightIsEmpty } from '../combat/model';
import type { RawRow } from '../db/types';
import type { WorldDb } from '../db/world-db';
import type { PatchStatement } from '../export/build-patch';
import { ITEM_SLOT_BLOCKS, itemRow } from './item-columns';
import { itemFromRows, MAX_GOSSIP_MENUS, npcFromRows } from './from-rows';
import { seenByColumns, seenByOf } from './visibility';
import { npcSpawnGuids, spawnEventRows } from './spawn-events-read';
import { rowsOrNone } from '../db/rows-or-none';
import {
  existingOnly, gossipUnread, sameGossip, sameGossipMenu, sameGossipOption, sameTrainer, sameVendor, trainerUnread, TRAINER_TYPE_VALUE, vendorUnread, NPC_TYPE_VALUE, OBJECT_TYPE_VALUE, RANK_VALUE,
  type CustomItem, type CustomNpc, type CustomObject, type LootRow, type OriginalRows, type Page, type ProjectEntities, type StoredOrigin, type GossipMenu, type GossipOption, type GossipTree, type Trainer, type VendorItem,
} from './model';

/**
 * The patch rows of existing NPCs, objects and items edited in the project. Each table is written as
 * the row the database had with the editor's modelled columns laid over it, so every column, flag
 * bit and script name the editor does not know stays as it was; the revert deletes the same keys and
 * puts the original rows back.
 */

type Row = Record<string, string | null>;
type Existing = Extract<StoredOrigin, { kind: 'existing' }>;
type Statements = { apply: PatchStatement[]; revert: PatchStatement[] };

const GOSSIP_BIT = 1;
const QUEST_GIVER_BIT = 2;
const VENDOR_BIT = 128;
const TRAINER_BIT = 16;
const DATA_COLUMN = /^Data\d+$/;

const text = (n: number): string => String(n);
const num = (raw: string | null | undefined): number => {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const rowsOf = (origin: Existing, table: string): Row[] => origin.original[table] ?? [];
const matches = (row: Row, key: Record<string, string>): boolean => Object.entries(key).every(([c, v]) => num(row[c]) === num(v));

const has = (row: Row, column: string): boolean => Object.prototype.hasOwnProperty.call(row, column);

/**
 * Puts back the database's own value of every column the editor left as it read it. `asRead` is the row
 * the editor would write for the entity exactly as it was read, so a column whose written value equals it
 * was not edited: its raw value (a creature type the editor has no name for, a blank, a zero stat) stays.
 * Each block in `blocks` is kept or written as a whole; `derived` columns (set from more than the editor's
 * fields, such as the quest giver bit a project quest gives) are always written.
 */
function keepUnedited(row: Row, asRead: Row, original: Row, blocks: readonly (readonly string[])[] = [], derived: readonly string[] = []): Row {
  const out: Row = { ...row };
  const inBlock = new Set(blocks.flat());
  for (const column of Object.keys(row)) {
    if (!inBlock.has(column) && !derived.includes(column) && has(original, column) && row[column] === asRead[column]) out[column] = original[column]!;
  }
  for (const block of blocks) {
    if (block.every((column) => row[column] === asRead[column])) for (const column of block) if (has(original, column)) out[column] = original[column]!;
  }
  return out;
}

/**
 * Writes one table: deletes each key, inserts the rows; the revert deletes the same keys and inserts the originals under them.
 * Rows that are the ones the database already has under those keys write nothing, in either file.
 */
function writeTable(out: Statements, origin: Existing, table: string, keys: Record<string, string>[], rows: Row[]): void {
  const original = rowsOf(origin, table).filter((row) => keys.some((key) => matches(row, key)));
  if (sameRows(original, rows as RawRow[])) return;
  for (const key of keys) {
    out.apply.push({ kind: 'delete', table, key });
    out.revert.push({ kind: 'delete', table, key });
  }
  for (const row of rows) out.apply.push({ kind: 'insert', table, row: row as RawRow });
  for (const row of original) out.revert.push({ kind: 'insert', table, row: row as RawRow });
}

/** The loot rows of a list; a row for an item the list already had keeps the columns the editor does not model (`Comment`) */
const lootRows = (lootId: number, loot: readonly LootRow[], original: readonly Row[]): Row[] => {
  const unused = original.filter((r) => num(r.Entry) === lootId);
  return loot.map((row) => {
    const at = unused.findIndex((r) => num(r.Item) === row.item);
    const same = at >= 0 ? unused.splice(at, 1)[0] : undefined;
    return {
      Reference: '0', GroupId: '0', Comment: '', ...same,
      Entry: text(lootId), Item: text(row.item), Chance: text(row.chance), QuestRequired: row.questOnly ? '1' : '0',
      LootMode: '1', MinCount: text(row.min), MaxCount: text(row.max),
    };
  });
};

/** The stock rows, slot by position; a row for an item and cost the database already had keeps its other columns (`VerifiedBuild`) */
const vendorRows = (entry: string, vendor: readonly VendorItem[], original: readonly Row[]): Row[] =>
  vendor.map((v, slot) => {
    const same = original.find((r) => num(r.item) === v.item && num(r.ExtendedCost) === v.extendedCost);
    return {
      ...same, entry, slot: text(slot), item: text(v.item), maxcount: text(v.maxCount),
      // Unlimited stock never restocks
      incrtime: text(v.maxCount === 0 ? 0 : v.restockSecs), ExtendedCost: text(v.extendedCost),
    };
  });

/**
 * The NPC's trainer: its default-trainer row, and under the trainer's own id the trainer row and its spells. A
 * trainer under the id that was read keeps the original columns the editor does not model; one under a new id
 * (an own copy of a shared trainer, or a new trainer) is all new rows, and the trainer it was read from is in no key.
 * An NPC that stops being a trainer loses only its default-trainer row: the trainer's rows may be another NPC's.
 */
function writeTrainer(out: Statements, origin: Existing, entry: string, trainer: Trainer | null, read: Trainer | null): void {
  const link = rowsOf(origin, 'creature_default_trainer')[0] ?? {};
  writeTable(out, origin, 'creature_default_trainer', [{ CreatureId: entry }], trainer ? [{ ...link, CreatureId: entry, TrainerId: text(trainer.trainerId) }] : []);
  if (!trainer) return;
  const id = text(trainer.trainerId);
  const sameId = read !== null && read.trainerId === trainer.trainerId;
  const original = sameId ? rowsOf(origin, 'trainer').find((r) => num(r.Id) === trainer.trainerId) : undefined;
  writeTable(out, origin, 'trainer', [{ Id: id }], [
    { ...original, Id: id, Type: text(TRAINER_TYPE_VALUE[trainer.type]), Requirement: text(trainer.requirement),
      // A greeting the database left NULL stays NULL until one is written
      Greeting: trainer.greeting === '' && original && original.Greeting === null ? null : trainer.greeting },
  ]);
  const carried = new Map(sameId ? rowsOf(origin, 'trainer_spell').map((r) => [num(r.SpellId), r] as const) : []);
  const spells = [...trainer.spells].sort((a, b) => a.spell - b.spell).map((s): Row => ({
    ...carried.get(s.spell), TrainerId: id, SpellId: text(s.spell), MoneyCost: text(s.cost), ReqSkillLine: text(s.reqSkill), ReqSkillRank: text(s.reqSkillRank),
    ReqAbility1: text(s.reqSpells[0] ?? 0), ReqAbility2: text(s.reqSpells[1] ?? 0), ReqAbility3: text(s.reqSpells[2] ?? 0), ReqLevel: text(s.reqLevel),
  }));
  writeTable(out, origin, 'trainer_spell', [{ TrainerId: id }], spells);
}

const VARIANTS = 8;

/** A menu's text row: the original columns with the greeting laid over; a variant whose text changed loses its broadcast text */
function gossipTextRow(menu: GossipMenu, read: GossipMenu | undefined, original: Row | undefined): Row {
  const row: Row = { ...original, ID: text(menu.textId) };
  // A variant removed moves the ones after it up a slot, and the language and emotes belong to the slot: they are reset
  const shifted = read !== undefined && menu.greeting.length < read.greeting.length;
  // A column the database left NULL stays NULL while the text it holds is empty
  const keepNull = (column: string, value: string): string | null => (value === '' && original !== undefined && original[column] === null ? null : value);
  for (let i = 0; i < VARIANTS; i++) {
    const v = menu.greeting[i];
    const was = read?.greeting[i];
    if (v) {
      const same = was !== undefined && was.text === v.text && was.textFemale === v.textFemale && was.probability === v.probability;
      row[`text${i}_0`] = keepNull(`text${i}_0`, v.text);
      row[`text${i}_1`] = keepNull(`text${i}_1`, v.textFemale);
      row[`Probability${i}`] = text(v.probability);
      row[`BroadcastTextID${i}`] = same && !shifted ? (original?.[`BroadcastTextID${i}`] ?? '0') : '0';
    } else if (was) {
      // A variant that was read and is gone
      row[`text${i}_0`] = keepNull(`text${i}_0`, '');
      row[`text${i}_1`] = keepNull(`text${i}_1`, '');
      row[`Probability${i}`] = '0';
      row[`BroadcastTextID${i}`] = '0';
    }
  }
  if (shifted) {
    for (let i = 0; i < VARIANTS; i++) {
      for (const column of [`lang${i}`, ...[0, 1, 2].flatMap((k) => [`EmoteDelay${i}_${k}`, `Emote${i}_${k}`])]) if (original && column in original) row[column] = '0';
    }
  }
  return row;
}

/** An option's row: the original (written as it is when the option is unchanged) with the modelled columns laid over it */
function gossipOptionRow(menuId: number, option: GossipOption, read: GossipOption | undefined, original: Row | undefined): Row {
  if (read && original && sameGossipOption(option, read)) return original;
  const row: Row = { ...original, MenuID: text(menuId), OptionID: text(option.optionId), OptionIcon: text(option.icon), OptionText: option.text === '' && original !== undefined && original.OptionText === null ? null : option.text };
  // The translation of a text that changed no longer says what it does
  if (original) row.OptionBroadcastTextID = read && read.text === option.text ? (original.OptionBroadcastTextID ?? '0') : '0';
  const action = option.action;
  if (action.kind === 'service') Object.assign(row, { OptionType: text(action.type), OptionNpcFlag: text(action.npcFlag), ActionMenuID: '0' });
  else if (action.kind === 'close') Object.assign(row, { OptionType: '1', OptionNpcFlag: '1', ActionMenuID: '0' });
  else {
    // A plain option keeps the type and flag it was read with when it still only opens or closes
    const plain = original !== undefined && read !== undefined && read.action.kind !== 'service';
    Object.assign(row, { OptionType: plain ? (original.OptionType ?? '1') : '1', OptionNpcFlag: plain ? (original.OptionNpcFlag ?? '1') : '1', ActionMenuID: text(action.menuId) });
  }
  return row;
}

/**
 * The NPC's gossip menus. Each menu that is new, changed or removed and not locked is written: its text row, its
 * menu row and its options, option by option (never by whole menu, so options another writer added survive). A
 * menu under a new id (a copy) is all new rows; the menu it was copied from is in no key. An option the database
 * ties to a condition or a script is never deleted, nor is a removed menu that holds one.
 */
function writeGossip(out: Statements, origin: Existing, tree: GossipTree | null, read: GossipTree | null): void {
  const held = tree?.menus ?? [];
  const was = read?.menus ?? [];
  const write = (menu: GossipMenu | null, before: GossipMenu | undefined): void => {
    const textIds = [...new Set([menu?.textId, before?.textId].filter((id): id is number => id !== undefined && id > 0))];
    const menuId = (menu ?? before)!.menuId;
    const originalOption = (id: number): Row | undefined => rowsOf(origin, 'gossip_menu_option').find((r) => num(r.MenuID) === menuId && num(r.OptionID) === id);
    writeTable(out, origin, 'gossip_menu', textIds.map((id) => ({ MenuID: text(menuId), TextID: text(id) })),
      menu && menu.textId > 0 ? [{ ...rowsOf(origin, 'gossip_menu').find((r) => num(r.MenuID) === menuId && num(r.TextID) === menu.textId), MenuID: text(menuId), TextID: text(menu.textId) }] : []);
    writeTable(out, origin, 'npc_text', textIds.map((id) => ({ ID: text(id) })),
      menu && menu.textId > 0 ? [gossipTextRow(menu, before, rowsOf(origin, 'npc_text').find((r) => num(r.ID) === menu.textId))] : []);
    // A kept option is only written when its text or icon changed (its action is the one it was read with); a removed one stays
    const readOption = (id: number): GossipOption | undefined => before?.options.find((b) => b.optionId === id);
    const written = (menu?.options ?? [])
      .map((o) => (readOption(o.optionId)?.kept ? { ...o, action: readOption(o.optionId)!.action, kept: true } : o))
      .filter((o) => !(readOption(o.optionId)?.kept && sameGossipOption(o, readOption(o.optionId)!)));
    const ids = [...new Set([...written.map((o) => o.optionId), ...(before?.options ?? []).filter((o) => !o.kept).map((o) => o.optionId)])].sort((a, b) => a - b);
    if (ids.length > 0) {
      writeTable(out, origin, 'gossip_menu_option', ids.map((id) => ({ MenuID: text(menuId), OptionID: text(id) })),
        written.map((o) => gossipOptionRow(menuId, o, readOption(o.optionId), originalOption(o.optionId))));
    }
  };
  for (const menu of held) {
    if (menu.locked) continue;
    const before = was.find((m) => m.menuId === menu.menuId);
    if (before?.locked || (before && sameGossipMenu(menu, before))) continue;
    write(menu, before);
  }
  for (const before of was) {
    if (before.locked || held.some((m) => m.menuId === before.menuId) || before.options.some((o) => o.kept)) continue;
    write(null, before);
  }
}

/** Pages: the original chain's and the current chain's rows deleted, the current ones written over their original columns */
function writePages(out: Statements, origin: Existing, pages: readonly Page[]): void {
  const original = rowsOf(origin, 'page_text');
  const ids = [...new Set([...original.map((r) => num(r.ID)), ...pages.map((p) => p.id)])].filter((id) => id > 0).sort((a, b) => a - b);
  if (ids.length === 0) return;
  const byId = new Map(original.map((r) => [num(r.ID), r]));
  const rows = pages.map((page, i) => ({ ...byId.get(page.id), ID: text(page.id), Text: page.text, NextPageID: text(pages[i + 1]?.id ?? 0) }));
  writeTable(out, origin, 'page_text', ids.map((id) => ({ ID: text(id) })), rows);
}

/** A free loot id given to an existing NPC or chest whose entry is already another loot list, by 'npc:<entry>' or 'object:<entry>' */
export type LootIds = ReadonlyMap<string, number>;

/** Whether an existing NPC or chest has no loot list of its own yet and is given one, under a new loot id */
function wantsNewLoot(kind: 'npc' | 'object', entity: CustomNpc | CustomObject): boolean {
  if (entity.origin.kind !== 'existing' || entity.origin.locked.includes('loot') || entity.loot.length === 0) return false;
  if (kind === 'npc') return num(rowsOf(entity.origin, 'creature_template')[0]?.lootid) === 0;
  const object = entity as CustomObject;
  if (entity.origin.locked.includes('type') || object.type !== 'chest') return false;
  const original = rowsOf(entity.origin, 'gameobject_template')[0] ?? {};
  return num(original.type) !== OBJECT_TYPE_VALUE.chest || num(original.Data1) === 0;
}

const LOOT_TABLE = { npc: 'creature_loot_template', object: 'gameobject_loot_template' } as const;

/**
 * The loot ids existing NPCs and chests get when they are given their first loot. Their entry is used
 * unless some other loot list already has that id (a list the database's own row of this entity does not
 * point at, so not one an earlier apply of this patch wrote); then the next free id is taken, so the patch
 * never writes over another list and its revert never deletes it.
 */
export async function newLootIds(
  db: Pick<WorldDb, 'selectRows'> & Partial<Pick<WorldDb, 'selectMax'>>, store: ProjectEntities,
): Promise<{ ids: Map<string, number>; warnings: string[] }> {
  const ids = new Map<string, number>();
  const warnings: string[] = [];
  const taken: Record<'npc' | 'object', Set<number>> = { npc: new Set(), object: new Set() };
  const edited = existingOnly(store);
  const wanting = [
    ...edited.npcs.filter((e) => wantsNewLoot('npc', e)).map((entity) => ({ kind: 'npc' as const, entity })),
    ...edited.objects.filter((e) => wantsNewLoot('object', e)).map((entity) => ({ kind: 'object' as const, entity })),
  ];
  for (const { kind, entity } of wanting) {
    const table = LOOT_TABLE[kind];
    const id = text(entity.entry);
    const rows = await db.selectRows(table, { Entry: id });
    if (rows.length === 0) continue;
    const own = kind === 'npc'
      ? (await db.selectRows('creature_template', { entry: id })).some((r) => num(r.lootid) === entity.entry)
      : (await db.selectRows('gameobject_template', { entry: id })).some((r) => num(r.type) === OBJECT_TYPE_VALUE.chest && num(r.Data1) === entity.entry);
    if (own) continue;
    let next = Math.max(entity.entry, ...taken[kind]) + 1;
    const max = db.selectMax ? await db.selectMax(table, 'Entry') : null;
    if (max !== null) next = Math.max(next, max + 1);
    while (taken[kind].has(next) || (max === null && (await db.selectRows(table, { Entry: text(next) })).length > 0)) next += 1;
    taken[kind].add(next);
    ids.set(`${kind}:${entity.entry}`, next);
    warnings.push(`"${entity.name || entity.entry}" gets loot id ${next}: loot list ${entity.entry} already belongs to something else.`);
  }
  return { ids, warnings };
}

function npcStatements(out: Statements, npc: CustomNpc, origin: Existing, givers: readonly number[], lootIds: LootIds): void {
  const entry = text(npc.entry);
  const original: Row = rowsOf(origin, 'creature_template')[0] ?? { entry };
  const lootLocked = origin.locked.includes('loot');
  const fightLocked = origin.locked.includes('fight');
  const originalLoot = num(original.lootid);
  const lootId = originalLoot > 0 ? originalLoot : !lootLocked && npc.loot.length > 0 ? (lootIds.get(`npc:${npc.entry}`) ?? npc.entry) : 0;
  const asRead = npcFromRows(npc.entry, origin.original, { sharedLoot: origin.sharedLoot, spawnCount: origin.spawnCount, sharedMenus: origin.sharedMenus, sharedTexts: origin.sharedTexts });
  // Stock a project saved before vendors existed never read is not ours to replace; stock left as read is not written
  const vendorChanged = !vendorUnread(npc) && !sameVendor(npc.vendor, asRead.vendor);
  const vendorBit = vendorChanged ? (npc.vendor.length > 0 ? VENDOR_BIT : 0) : num(original.npcflag) & VENDOR_BIT;
  // A trainer other NPCs share, or one never read, is not ours to write; one left as read is not written
  // (A shared trainer can still be walked away from: that deletes only this NPC's own link)
  const trainerChanged = !trainerUnread(npc) && (!origin.locked.includes('trainer') || npc.trainer === null) && !sameTrainer(npc.trainer, asRead.trainer);
  const trainerBit = trainerChanged ? (npc.trainer ? TRAINER_BIT : 0) : num(original.npcflag) & TRAINER_BIT;
  // Gossip never read is not ours to write; menus left as read are not written; the root menu is the NPC's gossip_menu_id
  const gossipChanged = !gossipUnread(npc) && !sameGossip(npc.gossipMenu, asRead.gossipMenu);
  const rootNow = npc.gossipMenu?.menus[0]?.menuId ?? 0;
  const rootRead = asRead.gossipMenu?.menus[0]?.menuId ?? 0;
  const rootChanged = gossipChanged && rootNow !== rootRead;
  const templateRow = (n: CustomNpc): Row => {
    const flags =
      (num(original.npcflag) & ~(GOSSIP_BIT | QUEST_GIVER_BIT | VENDOR_BIT | TRAINER_BIT)) |
      (n.questGiver || givers.includes(n.entry) ? QUEST_GIVER_BIT : 0) |
      (n.gossip ? GOSSIP_BIT : 0) |
      vendorBit | trainerBit;
    return {
      ...original, entry, name: n.name, subname: n.subname, minlevel: text(n.minLevel), maxlevel: text(n.maxLevel),
      faction: text(n.faction), rank: text(RANK_VALUE[n.rank]), type: text(NPC_TYPE_VALUE[n.type]),
      HealthModifier: text(n.healthModifier), DamageModifier: text(n.damageModifier), npcflag: text(flags),
      ...(rootChanged ? { gossip_menu_id: text(rootNow) } : {}),
      // Scenes run on SmartAI too; the snapshot of an NPC adopted with no AI says '', so it is set again at every export
      AIName: !fightLocked && (!fightIsEmpty(n.fight) || (n.scenes.length > 0 && !origin.locked.includes('scenes'))) ? 'SmartAI' : (original.AIName ?? ''),
      lootid: text(lootId),
      // Written only when changed: absent on an NPC saved before it could be set, its flags stay as they are
      ...(n.seenBy && n.seenBy !== seenByOf(original) ? seenByColumns(n.seenBy, original) : {}),
    };
  };
  writeTable(out, origin, 'creature_template', [{ entry }], [keepUnedited(templateRow(npc), templateRow(asRead), original, [], ['npcflag', 'lootid', 'AIName', 'gossip_menu_id'])]);

  const model = rowsOf(origin, 'creature_template_model').find((r) => num(r.Idx) === 0) ?? { CreatureID: entry, Idx: '0', Probability: '1' };
  writeTable(out, origin, 'creature_template_model', [{ CreatureID: entry, Idx: '0' }], [
    { ...model, CreatureDisplayID: text(npc.displayId), DisplayScale: text(npc.scale) },
  ]);

  const { mainHand, offHand, ranged } = npc.equipment;
  const gear = rowsOf(origin, 'creature_equip_template').find((r) => num(r.ID) === 1);
  const armed = mainHand > 0 || offHand > 0 || ranged > 0;
  if (armed || gear) {
    writeTable(out, origin, 'creature_equip_template', [{ CreatureID: entry, ID: '1' }], armed
      ? [{ ...(gear ?? { CreatureID: entry, ID: '1' }), ItemID1: text(mainHand), ItemID2: text(offHand), ItemID3: text(ranged) }]
      : []);
  }

  if (!lootLocked && lootId > 0) writeTable(out, origin, 'creature_loot_template', [{ Entry: text(lootId) }], lootRows(lootId, npc.loot, rowsOf(origin, 'creature_loot_template')));
  if (vendorChanged) writeTable(out, origin, 'npc_vendor', [{ entry }], vendorRows(entry, npc.vendor, rowsOf(origin, 'npc_vendor')));
  if (trainerChanged) writeTrainer(out, origin, entry, npc.trainer, asRead.trainer);
  if (gossipChanged) writeGossip(out, origin, npc.gossipMenu, asRead.gossipMenu);
}

function objectStatements(out: Statements, object: CustomObject, origin: Existing, lootIds: LootIds): void {
  const entry = text(object.entry);
  const original: Row = rowsOf(origin, 'gameobject_template')[0] ?? { entry };
  const row: Row = { ...original, entry, name: object.name, displayId: text(object.displayId), size: text(object.size) };
  let lootId = 0;
  if (!origin.locked.includes('type')) {
    const type = OBJECT_TYPE_VALUE[object.type];
    // A new type gives the Data columns new meanings: the old type's values go
    if (num(original.type) !== type) for (const column of Object.keys(row)) if (DATA_COLUMN.test(column)) row[column] = '0';
    row.type = text(type);
    const firstPage = text(object.pages[0]?.id ?? 0);
    const quest = text(object.onlyDuringQuest ?? 0);
    if (object.type === 'text') row.Data0 = firstPage;
    if (object.type === 'goober') Object.assign(row, { Data1: quest, Data7: firstPage });
    if (object.type === 'chest') {
      // A chest's loot stays under the list it has; one with none gets its own entry when loot is added
      const originalLoot = num(row.Data1);
      lootId = originalLoot > 0 ? originalLoot : !origin.locked.includes('loot') && object.loot.length > 0 ? (lootIds.get(`object:${object.entry}`) ?? object.entry) : 0;
      Object.assign(row, { Data1: text(lootId), Data8: quest });
    }
  }
  writeTable(out, origin, 'gameobject_template', [{ entry }], [row]);
  if (!origin.locked.includes('loot') && lootId > 0) writeTable(out, origin, 'gameobject_loot_template', [{ Entry: text(lootId) }], lootRows(lootId, object.loot, rowsOf(origin, 'gameobject_loot_template')));
  writePages(out, origin, object.pages);
}

function itemStatements(out: Statements, item: CustomItem, origin: Existing): void {
  const original: Row = rowsOf(origin, 'item_template')[0] ?? {};
  const asRead = itemFromRows(item.entry, origin.original);
  const row = keepUnedited({ ...original, ...itemRow(item) }, { ...original, ...itemRow(asRead) }, original, ITEM_SLOT_BLOCKS);
  writeTable(out, origin, 'item_template', [{ entry: text(item.entry) }], [row]);
  writePages(out, origin, item.pages);
}

/** The apply and revert rows of every existing entity in the store; new ones are compiled elsewhere */
export function existingStatements(store: ProjectEntities, givers: readonly number[], lootIds: LootIds = new Map()): Statements {
  const out: Statements = { apply: [], revert: [] };
  const edited = existingOnly(store);
  for (const npc of edited.npcs) if (npc.origin.kind === 'existing') npcStatements(out, npc, npc.origin, givers, lootIds);
  for (const object of edited.objects) if (object.origin.kind === 'existing') objectStatements(out, object, object.origin, lootIds);
  for (const item of edited.items) if (item.origin.kind === 'existing') itemStatements(out, item, item.origin);
  return out;
}

type Kind = 'npc' | 'object' | 'item';
type RowReader = Pick<WorldDb, 'selectRows'> & Partial<Pick<WorldDb, 'columns'>>;


/** The rows of a page chain starting at `first`, following `NextPageID` */
async function pageRows(db: RowReader, first: number): Promise<Row[]> {
  const rows: Row[] = [];
  const seen = new Set<number>();
  for (let id = first; id > 0 && !seen.has(id); ) {
    seen.add(id);
    const [row] = await rowsOrNone(db, 'page_text', { ID: text(id) });
    if (!row) break;
    rows.push(row);
    id = num(row.NextPageID);
  }
  return rows;
}

/**
 * The rows an existing NPC, object or item is made of, as the database has them now; null when it has
 * none. What is brought into the project is kept as these rows, and drift compares against them again.
 */
/** The tables a gossip tree is read from that the database has */
interface GossipTables {
  hasMenu: boolean;
  hasOptions: boolean;
  hasText: boolean;
  hasConditions: boolean;
  hasScripts: boolean;
}

/**
 * The rows of an NPC's gossip tree: the menu it opens with and, level by level, every menu its options open
 * (at most `MAX_GOSSIP_MENUS`), their texts, and only the conditions and gossip-select scripts that name them.
 */
async function readGossipRows(db: RowReader, root: number, t: GossipTables): Promise<OriginalRows> {
  const out: OriginalRows = {};
  const menuRows: Row[] = [];
  const optionRows: Row[] = [];
  const menus: number[] = [];
  if (t.hasMenu && t.hasOptions) {
    for (let frontier = root > 0 ? [root] : []; frontier.length > 0 && menus.length < MAX_GOSSIP_MENUS; ) {
      const batch = [...new Set(frontier)].filter((id) => !menus.includes(id)).slice(0, MAX_GOSSIP_MENUS - menus.length);
      if (batch.length === 0) break;
      menus.push(...batch);
      const where = { MenuID: batch.map(text) };
      const [found, options] = await Promise.all([rowsOrNone(db, 'gossip_menu', where), rowsOrNone(db, 'gossip_menu_option', where)]);
      menuRows.push(...found);
      optionRows.push(...options);
      frontier = options.map((r) => num(r.ActionMenuID)).filter((id) => id > 0 && !menus.includes(id));
    }
  }
  const names = menus.map(text);
  if (t.hasMenu) out.gossip_menu = menuRows;
  if (t.hasOptions) out.gossip_menu_option = optionRows;
  if (t.hasText) {
    const ids = [...new Set(menuRows.map((r) => r.TextID ?? '0'))];
    out.npc_text = ids.length > 0 ? await rowsOrNone(db, 'npc_text', { ID: ids }) : [];
  }
  if (t.hasConditions) out.conditions = names.length > 0 ? await rowsOrNone(db, 'conditions', { SourceTypeOrReferenceId: ['14', '15'], SourceGroup: names }) : [];
  if (t.hasScripts) out.smart_scripts = names.length > 0 ? await rowsOrNone(db, 'smart_scripts', { source_type: '0', event_type: '62', event_param1: names }) : [];
  return out;
}

export async function readOriginalRows(db: RowReader, kind: Kind, entry: number): Promise<OriginalRows | null> {
  const key = text(entry);
  if (kind === 'npc') {
    const template = await rowsOrNone(db, 'creature_template', { entry: key });
    if (template.length === 0) return null;
    const lootid = num(template[0]!.lootid);
    const has = async (table: string): Promise<boolean> => (db.columns ? (await db.columns(table)).length > 0 : true);
    const [models, equip, loot, vendor, hasVendorTable, hasDefault, hasTrainer, hasSpells, hasLegacy] = await Promise.all([
      rowsOrNone(db, 'creature_template_model', { CreatureID: key }),
      rowsOrNone(db, 'creature_equip_template', { CreatureID: key, ID: '1' }),
      lootid > 0 ? rowsOrNone(db, 'creature_loot_template', { Entry: text(lootid) }) : Promise.resolve([]),
      rowsOrNone(db, 'npc_vendor', { entry: key }),
      // A fork without the table has no stock to read; the key is left out so its stock is never written
      has('npc_vendor'),
      has('creature_default_trainer'), has('trainer'), has('trainer_spell'), has('npc_trainer'),
    ]);
    // Its trainer: the default-trainer row, then that trainer's row and spells. A fork without a table has no key for it, so it is never written
    const links = hasDefault ? await rowsOrNone(db, 'creature_default_trainer', { CreatureId: key }) : [];
    const trainerId = links[0]?.TrainerId ?? null;
    const [trainerRows, spellRows, legacyRows] = await Promise.all([
      hasTrainer && trainerId !== null ? rowsOrNone(db, 'trainer', { Id: trainerId }) : Promise.resolve([]),
      hasSpells && trainerId !== null ? rowsOrNone(db, 'trainer_spell', { TrainerId: trainerId }) : Promise.resolve([]),
      // Only counted, to say what else the NPC teaches; never written
      hasLegacy ? rowsOrNone(db, 'npc_trainer', { ID: key }) : Promise.resolve([]),
    ]);
    // Its gossip: the menu it opens with and every menu its options open (a table the fork lacks has no key, so it is never written)
    const [hasMenu, hasOptions, hasText, hasConditions, hasScripts] = await Promise.all([has('gossip_menu'), has('gossip_menu_option'), has('npc_text'), has('conditions'), has('smart_scripts')]);
    const gossip = await readGossipRows(db, num(template[0]!.gossip_menu_id), { hasMenu, hasOptions, hasText, hasConditions, hasScripts });
    // Its spawns and their game event rows: what its event rule is read from
    const guids = await npcSpawnGuids(db, entry);
    const events = [...(await spawnEventRows(db, guids)).values()].flat()
      .sort((a, b) => num(a.guid) - num(b.guid) || num(a.eventEntry) - num(b.eventEntry));
    return {
      creature_template: template, creature_template_model: models, creature_equip_template: equip, creature_loot_template: loot, ...(hasVendorTable ? { npc_vendor: vendor } : {}),
      ...gossip,
      ...(hasDefault ? { creature_default_trainer: links } : {}), ...(hasTrainer ? { trainer: trainerRows } : {}), ...(hasSpells ? { trainer_spell: spellRows } : {}), ...(hasLegacy ? { npc_trainer: legacyRows } : {}),
      creature: guids.map((g) => ({ guid: text(g) })), game_event_creature: events,
    };
  }
  if (kind === 'object') {
    const template = await rowsOrNone(db, 'gameobject_template', { entry: key });
    if (template.length === 0) return null;
    const row = template[0]!;
    const type = num(row.type);
    const lootid = type === OBJECT_TYPE_VALUE.chest ? num(row.Data1) : 0;
    const first = type === OBJECT_TYPE_VALUE.text ? num(row.Data0) : type === OBJECT_TYPE_VALUE.goober ? num(row.Data7) : 0;
    const [loot, pages] = await Promise.all([
      lootid > 0 ? rowsOrNone(db, 'gameobject_loot_template', { Entry: text(lootid) }) : Promise.resolve([]),
      pageRows(db, first),
    ]);
    return { gameobject_template: template, gameobject_loot_template: loot, page_text: pages };
  }
  const template = await rowsOrNone(db, 'item_template', { entry: key });
  if (template.length === 0) return null;
  return { item_template: template, page_text: await pageRows(db, num(template[0]!.PageText)) };
}

/** Whether two lists hold the same rows, in any order, comparing values as text */
export function sameRows(a: readonly Row[], b: readonly RawRow[]): boolean {
  const norm = (row: Readonly<Row>): string => JSON.stringify(Object.keys(row).sort().map((k) => [k, row[k] ?? null]));
  const left = a.map(norm).sort();
  const right = b.map(norm).sort();
  return left.length === right.length && left.every((v, i) => v === right[i]);
}

/**
 * The existing entities whose rows the database no longer has as they were when first brought in: the
 * rows are read again as `readOriginalRows` read them and compared table by table. The Project changes
 * badge and the export's warning both come from here, so they always agree.
 */
/**
 * A table's rows then and now, as drift compares them. Spawns coming and going are not the NPC's rows
 * (the patch does not write them), so the spawn list is not compared, and spawn events only for the
 * spawns both lists have.
 */
function comparable(table: string, was: OriginalRows, now: OriginalRows): [Row[], Row[]] {
  if (table === 'creature') return [[], []];
  if (table !== 'game_event_creature') return [was[table] ?? [], (now[table] ?? []) as Row[]];
  const guidsOf = (rows: OriginalRows) => new Set((rows.creature ?? []).map((r) => r.guid));
  const before = guidsOf(was);
  const after = guidsOf(now);
  const both = (rows: Row[]) => rows.filter((r) => before.has(r.guid ?? null) && after.has(r.guid ?? null));
  return [both(was[table] ?? []), both((now[table] ?? []) as Row[])];
}

export async function existingDrift(db: RowReader, store: ProjectEntities): Promise<{ kind: Kind; entry: number; name: string }[]> {
  const edited = existingOnly(store);
  const all = [
    ...edited.npcs.map((e) => ({ kind: 'npc' as const, entity: e })),
    ...edited.objects.map((e) => ({ kind: 'object' as const, entity: e })),
    ...edited.items.map((e) => ({ kind: 'item' as const, entity: e })),
  ];
  const drifted: { kind: Kind; entry: number; name: string }[] = [];
  for (const { kind, entity } of all) {
    if (entity.origin.kind !== 'existing') continue;
    const was = entity.origin.original;
    const now = await readOriginalRows(db, kind, entity.entry);
    // A project saved before a table was read has none of it, which is not a change
    const changed = !now || Object.keys(was).some((table) => !sameRows(...comparable(table, was, now)));
    if (changed) drifted.push({ kind, entry: entity.entry, name: entity.name || String(entity.entry) });
  }
  return drifted;
}
