/** The project merge engine: plan a three-way merge, preview it, and apply it. */
export { planMerge } from './plan';
export type { Choice, Choices, Decision, MergeInputs, MergePlan, PlanEntry } from './plan';
export { applyMerge, previewMerge, UnsettledConflictError } from './build';
export type { Dropped, MergePreview, SummaryRow } from './build';
export { checkReferences } from './references';
export { notCarriedOver } from './not-carried';
export type { MetaLine } from './not-carried';
export { MERGE_KINDS } from './kinds';
export type { FieldDiff, MergeKind, Ref } from './kind';
export type { MergeDocument, MergeQuest } from './doc';
export type { Outcome } from './classify';
