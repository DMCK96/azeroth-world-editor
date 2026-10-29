import type { Choices, MergePreview } from '@core/merge';
import type { Result } from './result';

export type { Choice, Choices, Decision, Dropped, MergePreview, PlanEntry, SummaryRow } from '@core/merge';

/** The two files merged into the open project: theirs, and the base they both started from (null for a two-way merge) */
export interface MergeFiles {
  theirsPath: string;
  basePath: string | null;
}

/** The engine's preview, plus what the merged project does not carry over from the three files */
export interface MergePreviewData extends MergePreview {
  notCarried: string[];
}

/** A preview with the fingerprint of the inputs it was made from; apply and write refuse once those change */
export interface MergePreviewResult extends MergePreviewData {
  fingerprint: string;
}

/** Merging another project file into the open one. Never writes the world database or any input file. */
export interface MergeApi {
  /** The open dialog, for choosing theirs or the base; null when cancelled */
  mergePickFile(): Promise<Result<string | null>>;
  /** What merging the files into the open project with these choices would give */
  mergePreview(files: MergeFiles, choices: Choices): Promise<Result<MergePreviewResult>>;
  /** Opens the merged project as a new unsaved project, asking about the open one's unsaved changes first */
  mergeApply(files: MergeFiles, choices: Choices, fingerprint: string): Promise<Result<{ opened: true }>>;
  /** Writes the merged project to a new file at `outputPath`, which must not exist; opens nothing */
  mergeWrite(files: MergeFiles, choices: Choices, fingerprint: string, outputPath: string): Promise<Result<{ written: string }>>;
}
