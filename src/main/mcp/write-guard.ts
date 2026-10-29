import type { HistoryResult } from '../../shared/history';
import type { Result } from '../../shared/ipc';
import { resultOfProject, resultOfSteps } from '../api/step-result';
import { describeStep } from '../project/step-labels';
import type { McpContext, ToolDef } from './tool';

const DEFAULT_FLUSH_TIMEOUT_MS = 5000;
const DEFAULT_TOOL_TIMEOUT_MS = 120_000;

const crashed = (error: unknown): Result<never> => ({
  ok: false,
  error: { code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error) },
});

/** Waits for the window to hand over its pending edits, but not past the timeout. False when it did not answer in time. */
export async function flushed(ctx: McpContext): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ctx.flushTimeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS);
  });
  try {
    return await Promise.race([ctx.flush().then(() => true, () => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** The tool's result, or an error once it has run past the timeout, so one hung call cannot block every write after it. */
async function withinTime(ctx: McpContext, run: () => Promise<Result<unknown>>): Promise<Result<unknown>> {
  const ms = ctx.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Result<never>>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, error: { code: 'UNKNOWN', message: `The tool did not finish within ${Math.round(ms / 1000)} seconds and was given up on; check History for what it changed.` } }), ms);
  });
  try {
    return await Promise.race([run().catch(crashed), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs tools so that what an AI client changes stays one undoable step the window hears about.
 *
 * Read tools run as they are. Write tools run one at a time: the window is asked to hand over its
 * pending edits, the tool's changes become one history step with the tool's label, and the window
 * is told what changed. The queue belongs to the guard, so every server has its own.
 */
export type WriteGuard = (ctx: McpContext, tool: ToolDef, args: unknown) => Promise<Result<unknown>>;

export function createWriteGuard(): WriteGuard {
  let tail: Promise<unknown> = Promise.resolve();
  const exclusively = <T,>(work: () => Promise<T>): Promise<T> => {
    const next = tail.then(work, work);
    tail = next.catch(() => undefined);
    return next;
  };

  return async (ctx, tool, args) => {
    const mode = tool.write;
    if (mode === false) return tool.run(args as never, ctx);

    return exclusively(async () => {
      const answered = await flushed(ctx);
      // From here until the change has been sent, the window keeps its own quest edits back
      ctx.holdEdits?.(true);
      try {
        return await writeStep(ctx, tool, mode, args, answered);
      } finally {
        ctx.holdEdits?.(false);
      }
    });
  };
}

/** Runs one write tool as the guard's step and tells the window what changed. */
async function writeStep(ctx: McpContext, tool: ToolDef, mode: Exclude<ToolDef['write'], false>, args: unknown, answered: boolean): Promise<Result<unknown>> {
  const { session } = ctx;

  if (mode.kind === 'travel') {
    const result = await withinTime(ctx, () => tool.run(args as never, ctx));
    if (result.ok) ctx.notify(result.value as HistoryResult);
    return result;
  }

  const history = session.history;
  const stepBefore = history.peekUndo()?.id ?? null;
  const revisionBefore = session.revision();
  const label = mode.label(args) + (answered ? '' : ' (window did not answer)');
  const token = history.begin(label);
  let result: Result<unknown>;
  try {
    result = await withinTime(ctx, () => tool.run(args as never, ctx));
  } finally {
    history.end(token);
  }

  const list = history.list(describeStep);
  const step = history.peekUndo();
  const stepNow = step?.id ?? null;
  if (step && stepNow !== stepBefore && step.label === label) {
    ctx.notify(resultOfSteps(session, [{ step, skip: new Set() }], 'redo', [], list));
  } else if (stepNow !== stepBefore) {
    // The user undid or edited part-way through, so what changed is no longer this step alone
    ctx.notify(resultOfProject(session, list));
  } else if (session.revision() !== revisionBefore) {
    // A change that is not a step (a quest marked exported): the window reloads its canvas
    ctx.notify({ step: null, direction: 'redo', quests: [], positions: true, world: null, entities: null, name: false, skipped: [], history: list });
  }
  return result;
}
