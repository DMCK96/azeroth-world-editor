import { selectUpdate } from '../../core/updates/select';
import type { Release, UpdateOffer } from '../../core/updates/types';
import { normalizeVersion } from '../../core/updates/version';
import { fail } from '../api/errors';
import type { UpdateSettings } from './settings';

export const UPDATE_REPO = 'DMCK96/azeroth-world-editor';
const RELEASES_URL = `https://api.github.com/repos/${UPDATE_REPO}/releases?per_page=30`;
const RELEASES_PATH = `/${UPDATE_REPO}/releases`;
const DEFAULT_TIMEOUT_MS = 5000;

/** The part of `fetch` the check uses, so tests can answer it without a network */
export type UpdateFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface UpdateController {
  /** The newer release to offer, or null: up to date, skipped, switched off, or GitHub could not be reached (never an error) */
  check(): Promise<UpdateOffer | null>;
  /** Stay quiet about this version and every older one */
  skip(version: string): void;
  /** Remind me later: nothing is offered again until the app is next launched, whatever window asks */
  remind(): void;
  /** Opens a page of this project's releases in the browser; any other address is refused */
  open(url: string): Promise<void>;
}

export interface UpdateControllerDeps {
  fetch: UpdateFetch;
  settings: UpdateSettings;
  /** The installed version */
  version: string;
  /** Off in unpackaged builds, so development never nags */
  enabled: boolean;
  openExternal(url: string): Promise<void>;
  timeoutMs?: number;
  warn?(message: string): void;
}

/** A GitHub API release, or null when the entry is not shaped like one */
function readRelease(entry: unknown): Release | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const e = entry as Record<string, unknown>;
  if (typeof e['tag_name'] !== 'string' || typeof e['html_url'] !== 'string') return null;
  return {
    tag: e['tag_name'],
    name: typeof e['name'] === 'string' ? e['name'] : null,
    body: typeof e['body'] === 'string' ? e['body'] : null,
    url: e['html_url'],
    draft: e['draft'] === true,
    prerelease: e['prerelease'] === true,
  };
}

/** The address in canonical form when it is a page of this project's releases on GitHub (https, no userinfo or port), else null */
function releasePage(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  const ok =
    url.protocol === 'https:' &&
    url.host === 'github.com' &&
    url.username === '' &&
    url.password === '' &&
    url.port === '' &&
    (url.pathname === RELEASES_PATH || url.pathname.startsWith(`${RELEASES_PATH}/`));
  return ok ? url.href : null;
}

export function createUpdateController(deps: UpdateControllerDeps): UpdateController {
  const { settings, warn } = deps;
  // Once the user has answered the dialog this launch (any of its three buttons), a reopened window or a
  // reload must not ask again; the next launch starts clean.
  let answered = false;

  async function fetchReleases(): Promise<Release[] | null> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const response = await deps.fetch(RELEASES_URL, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'azeroth-world-editor' },
        signal: abort.signal,
      });
      if (!response.ok) {
        warn?.(`GitHub answered ${response.status}.`);
        return null;
      }
      const body = await response.json();
      if (!Array.isArray(body)) {
        warn?.('GitHub did not answer with a list of releases.');
        return null;
      }
      return body.flatMap((entry) => {
        const release = readRelease(entry);
        return release ? [release] : [];
      });
    } catch (error) {
      warn?.(`Could not check for updates: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async check() {
      if (!deps.enabled || answered) return null;
      const releases = await fetchReleases();
      if (!releases) return null;
      try {
        return selectUpdate({ releases, current: deps.version, skipped: settings.skipped() });
      } catch (error) {
        warn?.(`Could not compare versions: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    },
    skip(version) {
      if (normalizeVersion(version) === null) throw fail('BAD_REQUEST', 'That is not a version number.');
      settings.setSkipped(version);
      answered = true;
    },
    remind() {
      answered = true;
    },
    async open(url) {
      const page = releasePage(url);
      if (!page) throw fail('BAD_REQUEST', "That address is not one of this project's releases.");
      await deps.openExternal(page);
      answered = true;
    },
  };
}
