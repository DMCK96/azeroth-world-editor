import { z } from 'zod';
import { defineTool } from '../tool';

const choice = z.enum(['mine', 'theirs', 'both']);

const files = {
  theirsPath: z.string().min(1).describe('Path of the .awe project file to merge into the open project.'),
  basePath: z.string().min(1).optional().describe('Path of the .awe file both projects started from. Leave out for a two-way merge.'),
  choices: z.record(z.string(), choice).default({}).describe('Decisions by id from the preview: "mine", "theirs" or "both". Conflicts need a choice; collisions default to keeping both.'),
};

const RULES = 'The open project is "mine"; the file at theirsPath is "theirs". No file is changed. Conflicts need a choice; collisions (two different items with the same id) default to keeping both.';

/** Merging another project file into the open one: preview it, then write the result to a new file. */
export const mergeTools = [
  defineTool({
    name: 'merge_preview',
    title: 'Preview a project merge',
    description: `Previews merging another project file into the open one. ${RULES} Returns the summary, what is dropped, the decisions still to make (with options and defaults), what is not carried over, warnings, whether the merge is settled, and a fingerprint to pass to merge_write.`,
    input: files,
    write: false,
    run: ({ theirsPath, basePath, choices }, ctx) => ctx.call('mergePreview', { theirsPath, basePath: basePath ?? null }, choices),
    present: (p) => ({
      summary: p.summary,
      dropped: p.dropped,
      decisions: p.decisions?.map((d: any) => ({ id: d.id, type: d.type, options: d.options, default: d.default, newKey: d.newKey })),
      notCarried: p.notCarried,
      warnings: p.warnings,
      settled: p.settled,
      fingerprint: p.fingerprint,
    }),
  }),
  defineTool({
    name: 'merge_write',
    title: 'Write a merged project to a new file',
    description: `Writes the merged project to a new file; it opens nothing and changes no open project. ${RULES} Use the same files and choices as the merge_preview whose fingerprint you pass; the call is refused if a file changed since. outputPath must not already exist.`,
    input: {
      ...files,
      fingerprint: z.string().length(64).describe('The fingerprint from merge_preview.'),
      outputPath: z.string().min(1).describe('Where to write the merged .awe file. It must not already exist.'),
    },
    write: false,
    run: ({ theirsPath, basePath, choices, fingerprint, outputPath }, ctx) =>
      ctx.call('mergeWrite', { theirsPath, basePath: basePath ?? null }, choices, fingerprint, outputPath),
  }),
];
