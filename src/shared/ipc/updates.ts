import type { UpdateOffer } from '@core/updates/types';
import type { Result } from './result';

export type { UpdateOffer, ReleaseNote } from '@core/updates/types';

/** Telling the user a newer release is out: the check, skipping a version, and opening its page */
export interface UpdatesApi {
  /** The newer release to tell the user about, or null (up to date, skipped, offline, or a development build). */
  updateCheck(): Promise<Result<UpdateOffer | null>>;
  /** Stay quiet until a version newer than this one is published. */
  updateSkip(version: string): Promise<Result<null>>;
  /** Open one of this project's GitHub release pages in the browser. */
  updateOpen(url: string): Promise<Result<null>>;
}
