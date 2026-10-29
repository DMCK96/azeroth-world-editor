import type { QuestAggregate, Snapshot } from '../model/aggregate';
import type { FidelityReport } from '../roundtrip/verify';
import type { WorldLayer } from '../world/layer';
import type { ProjectEntities } from '../entities/model';

/** One quest of a project, as the merge sees it. */
export interface MergeQuest {
  questId: number;
  isNew: boolean;
  aggregate: QuestAggregate;
  snapshot: Snapshot | null;
  fidelity: FidelityReport | null;
  x: number;
  y: number;
  lastExportPath: string | null;
}

/**
 * The part of a project the merge reads and writes. `ProjectDocument` (main)
 * satisfies this structurally, so core never imports main.
 */
export interface MergeDocument {
  quests: MergeQuest[];
  world: WorldLayer;
  entities: ProjectEntities;
}
