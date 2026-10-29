import { EMPTY_ENTITIES } from '../../../src/core/entities/model';
import { EMPTY_WORLD, type WorldAddedSpawn } from '../../../src/core/world/layer';
import type { MergeDocument, MergeQuest } from '../../../src/core/merge/doc';

export const emptyDoc = (): MergeDocument => ({ quests: [], world: { ...EMPTY_WORLD }, entities: { ...EMPTY_ENTITIES } });

export const docOf = (part: Partial<MergeDocument>): MergeDocument => ({ ...emptyDoc(), ...part });

export const quest = (id: number, title = 'q', at: { x: number; y: number } = { x: 0, y: 0 }): MergeQuest => ({
  questId: id,
  isNew: true,
  aggregate: { questId: id, isNew: true, values: { 'quest_template.LogTitle': title }, readOnly: [], sharedItems: {} } as MergeQuest['aggregate'],
  snapshot: null,
  fidelity: null,
  x: at.x,
  y: at.y,
  lastExportPath: null,
});

export const placed = (guid: number, entry = 1, x = 0, kind: 'creature' | 'gameobject' = 'creature'): WorldAddedSpawn => ({
  kind, guid, entry, name: `n${guid}`, map: 0,
  placement: { x, y: 0, z: 0, orientation: 0, rotation: null },
  look: { displayId: 1, scale: 1, equipment: [0, 0, 0], preset: null },
});
