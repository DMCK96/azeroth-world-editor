import type { UpdatesApi } from '../../shared/ipc';
import type { ApiDeps } from './deps';
import { fail, run } from './errors';

/** The update check; with no controller (tests, headless) there is never an update, and skipping or opening is an error */
export function createUpdatesApi(deps: ApiDeps): UpdatesApi {
  const controller = () => {
    if (!deps.updates) throw fail('UNKNOWN', 'Update checks are not available in this build.');
    return deps.updates;
  };
  return {
    updateCheck: () => run(async () => (deps.updates ? deps.updates.check() : null)),
    updateSkip: (version) =>
      run(async () => {
        controller().skip(version);
        return null;
      }),
    updateOpen: (url) =>
      run(async () => {
        await controller().open(url);
        return null;
      }),
  };
}
