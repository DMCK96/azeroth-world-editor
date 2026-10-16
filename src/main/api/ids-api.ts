import { applyRenames, findConflicts, planRenumber } from '../../core/ids/conflicts';
import { ID_KINDS } from '../../core/ids/kinds';
import type { ProjectIds } from '../../core/ids/kinds/kind';
import type { IdsApi } from '../../shared/ipc';
import type { Services } from './services';
import { fail, run } from './errors';

/** How many times a renumber starts over when the project changes while the database is being read */
const ATTEMPTS = 3;

const skipped = (kind: string, error: unknown): void => console.warn(`The ${kind} id check was skipped:`, error);

/** The ids the project allocated for itself, checked against the world database and renumbered when they clash */
export function createIdsApi(s: Services): IdsApi {
  const { deps, conn, connected, asOneStep } = s.ctx;
  const projectIds = (): ProjectIds => ({ entities: deps.session.entities.get(), world: deps.session.world.get() });

  return {
    idConflicts: () =>
      run(async () => {
        const live = conn.current();
        return live ? findConflicts(live.db, projectIds(), ID_KINDS, skipped) : [];
      }),

    resolveIdConflicts: () =>
      run(async () => {
        const live = connected();
        for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
          // Found again here, not taken from the window: the database may have changed since it looked
          const revision = deps.session.revision();
          const project = projectIds();
          const conflicts = await findConflicts(live.db, project, ID_KINDS, skipped);
          if (conflicts.length === 0) return { renamed: 0 };
          const renames = await planRenumber(live.db, project, ID_KINDS, conflicts);
          // An edit that landed while the database was read would be lost by putting back what was read before it
          if (deps.session.revision() !== revision) continue;
          const next = applyRenames(project, ID_KINDS, renames);
          const nouns = [...new Set(conflicts.map((c) => c.noun))].join(' and ');
          // Put straight into the session, not through `putEntities`: that drops a spawn group's members whose guid left the NPCs, which would lose the ones just renamed
          // Nothing is awaited between the check above and the puts
          await asOneStep(async () => {
            deps.session.entities.put(next.entities);
            deps.session.world.put(next.world);
          }, `Renumbered ${nouns} ids`);
          return { renamed: renames.length };
        }
        throw fail('BAD_REQUEST', 'The project kept changing while its ids were checked. Try again.');
      }),
  };
}
