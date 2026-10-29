import type { MergeApi } from '../../shared/ipc';
import { createMergeService } from '../merge/service';
import type { Services } from './services';
import { run } from './errors';

/** Merging another project file into the open one; the service reads the files again on every call */
export function createMergeApi(s: Services): MergeApi {
  const { deps } = s.ctx;
  const merge = createMergeService({ projects: deps.projects, session: deps.session });

  return {
    mergePickFile: () => run(() => deps.projects.pickFile()),
    mergePreview: (files, choices) => merge.preview(files, choices),
    mergeApply: (files, choices, fingerprint) => merge.apply(files, choices, fingerprint),
    mergeWrite: (files, choices, fingerprint, outputPath) => merge.write(files, choices, fingerprint, outputPath),
  };
}
