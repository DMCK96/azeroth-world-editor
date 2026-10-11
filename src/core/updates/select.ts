import { compareVersions, normalizeVersion } from './version';
import type { Release, UpdateOffer } from './types';

/**
 * The update to tell the user about, or null. Only published, plain-versioned releases count: a draft
 * or a pre-release never triggers it. A version the user skipped stays quiet until a newer one is out.
 */
export function selectUpdate(input: { releases: readonly Release[]; current: string; skipped: string | null }): UpdateOffer | null {
  const current = normalizeVersion(input.current);
  if (!current) throw new RangeError(`Not a version: ${input.current}`);

  const published = input.releases
    .flatMap((release) => {
      const version = release.draft || release.prerelease ? null : normalizeVersion(release.tag);
      return version ? [{ release, version }] : [];
    })
    .sort((a, b) => compareVersions(b.version, a.version));

  const latest = published[0];
  if (!latest || compareVersions(latest.version, current) <= 0) return null;

  const skipped = input.skipped === null ? null : normalizeVersion(input.skipped);
  if (skipped && compareVersions(latest.version, skipped) <= 0) return null;

  return {
    current,
    latest: latest.version,
    releaseUrl: latest.release.url,
    notes: published
      .filter((p) => compareVersions(p.version, current) > 0)
      .map(({ release, version }) => ({ version, title: release.name?.trim() || release.tag, body: release.body ?? '', url: release.url })),
  };
}
