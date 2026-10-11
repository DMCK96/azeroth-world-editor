import { parseVersion } from './version';
import type { UpdateOffer } from './types';

/**
 * A made-up update for trying the dialog (`AWE_FAKE_UPDATE=1`): two minor versions ahead of the installed
 * one, with notes that use every kind of line the dialog draws, and one release with none. The Update
 * button goes to the real releases page.
 */
export function fakeOffer(current: string): UpdateOffer {
  const [major, minor] = parseVersion(current) ?? [0, 0, 0];
  const url = 'https://github.com/DMCK96/azeroth-world-editor/releases';
  const next = `${major}.${minor + 1}.0`;
  const latest = `${major}.${minor + 2}.0`;
  return {
    current,
    latest,
    releaseUrl: url,
    notes: [
      {
        version: latest,
        title: `v${latest}`,
        body: '## What changed\n- A **fake** change, to see a bold run (abc1234)\n- Another fake change with a commit reference (def5678)\n\n**Full Changelog**: this is a test notification',
        url,
      },
      { version: next, title: `v${next}`, body: '', url },
    ],
  };
}
