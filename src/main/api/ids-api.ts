import { applyRenames, findConflicts, planRenumber } from '../../core/ids/conflicts';
import { ID_KINDS } from '../../core/ids/kinds';
import type { ProjectIds } from '../../core/ids/kinds/kind';
import type { IdsApi } from '../../shared/ipc';
import type { Services } from './services';
import { run } from './errors';

/** The ids the project allocated for itself, checked against the world database and renumbered when they clash */
export function createIdsApi(s: Services): IdsApi {
  const { deps, conn, connected, asOneStep } = s.ctx;
  const projectIds = (): ProjectIds => ({ entities: deps.session.entities.get(), world: deps.session.world.get() });

  return {
    idConflicts: () =>
      run(async () => {
        const live = conn.current();
        return live ? findConflicts(live.db, projectIds(), ID_KINDS) : [];
      }),

    resolveIdConflicts: () =>
      run(async () => {
        const live = connected();
        // Found again here, not taken from the window: the database may have changed since it looked
        const project = projectIds();
        const conflicts = await findConflicts(live.db, project, ID_KINDS);
        if (conflicts.length === 0) return { renamed: 0 };
        const renames = await planRenumber(live.db, project, ID_KINDS, conflicts);
        const next = applyRenames(project, ID_KINDS, renames);
        // Put straight into the session, not through `putEntities`: that drops a spawn group's members whose guid left the NPCs, which would lose the ones just renamed
        await asOneStep(async () => {
          deps.session.entities.put(next.entities);
          deps.session.world.put(next.world);
        }, 'Renumbered spawn ids');
        return { renamed: renames.length };
      }),
  };
}
