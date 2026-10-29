import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Merging two projects that both grew from one base: a quest both changed is a conflict, a quest id
 * both used for different quests is a collision, and keeping both renumbers theirs. The three input
 * files are written by the app's own project writer (merge-projects.ts) and must come out of the
 * merge untouched.
 */

const work = mkdtempSync(join(tmpdir(), 'awe-merge-'));
const files = {
  base: join(work, 'base.awe'),
  mine: join(work, 'mine.awe'),
  theirs: join(work, 'theirs.awe'),
};
let before: Record<string, Buffer> = {};
test.beforeAll(() => {
  execFileSync(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), resolve('tests/e2e/merge-projects.ts'), work]);
  before = Object.fromEntries(Object.entries(files).map(([role, path]) => [role, readFileSync(path)]));
});

/** The connection: `ACQC_TEST_MYSQL_URL` when it is set, otherwise the repo's `.env`, which the unpackaged app reads itself */
function connectionEnv(): Record<string, string> {
  const raw = process.env['ACQC_TEST_MYSQL_URL'];
  if (!raw) return {};
  const u = new URL(raw);
  return {
    ACQC_ENV_FILE: 'none',
    ACQC_WORLD_DB_HOST: u.hostname, ACQC_WORLD_DB_PORT: u.port || '3306', ACQC_WORLD_DB_USER: decodeURIComponent(u.username),
    ACQC_WORLD_DB_PASSWORD: decodeURIComponent(u.password), ACQC_WORLD_DB_DATABASE: u.pathname.slice(1),
  };
}

/** The next native open dialog answers with this file */
const stubOpen = (app: ElectronApplication, path: string) =>
  app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as never;
  }, path);

let running: ElectronApplication | undefined;
test.afterEach(async () => {
  if (!running) return;
  // The merged project is unsaved, so quitting asks to save it; answer "Don't Save" so nothing hangs
  await running.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as never;
  });
  await running.close();
  running = undefined;
});

test('merge two projects with a base: a conflict, a collision kept both ways, and the inputs untouched', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && !/^ACQC_/.test(e[0]))),
      ACQC_USER_DATA: mkdtempSync(join(tmpdir(), 'acqc-ud-')), ACQC_OUTPUT_DIR: mkdtempSync(join(tmpdir(), 'acqc-out-')),
      ...connectionEnv(),
    },
  });
  running = app;
  const page = await app.firstWindow();
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Quests', exact: true })).toBeVisible({ timeout: 30_000 });

  // Mine is the open project
  await stubOpen(app, files.mine);
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('dialog', { name: 'Project' }).getByRole('button', { name: 'Open…' }).click();
  const heading = page.getByRole('banner').getByRole('heading', { level: 1 });
  await expect(heading).toHaveText('Mine');

  // Merge project… with theirs, then the base
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await page.getByRole('dialog', { name: 'Project' }).getByRole('button', { name: 'Merge project…' }).click();
  const merge = page.getByRole('dialog', { name: 'Merge projects' });
  await stubOpen(app, files.theirs);
  await merge.getByRole('button', { name: 'Choose their project' }).click();
  await expect(merge).toContainText(files.theirs);
  await stubOpen(app, files.base);
  await merge.getByRole('button', { name: 'Choose the base project' }).click();
  await expect(merge).toContainText(files.base);
  await expect(merge).not.toContainText('No base: the merge cannot tell which side changed what.');

  // A conflict on 60001 and a collision on 60002, and Merge waits for the conflict
  const conflict = merge.getByRole('group', { name: /60001: Changed differently in each project$/ });
  const collision = merge.getByRole('group', { name: /60002: Both projects use this id for different things$/ });
  await expect(conflict).toBeVisible();
  await expect(collision).toBeVisible();
  // Keep both is the collision's default
  await expect(collision.getByRole('radio', { name: /^Keep both \(theirs gets \d+\)$/ })).toBeChecked();
  const mergeButton = merge.getByRole('button', { name: /^Merge \(drops \d+\)$/ });
  await expect(mergeButton).toBeDisabled();

  // Keeping theirs settles it and drops mine's edit
  await conflict.getByRole('radio', { name: 'Keep theirs' }).check();
  await expect(mergeButton).toHaveText('Merge (drops 1)');
  await expect(mergeButton).toBeEnabled();
  await mergeButton.click();
  await expect(merge).toHaveCount(0);

  // The merged project: theirs' 60001, mine's 60002, and theirs' 60002 under a new id
  await page.getByRole('button', { name: 'Quests', exact: true }).click();
  const nodes = page.getByTestId('quest-node');
  await expect(nodes).toHaveCount(3);
  const labels = async () => (await nodes.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''))).sort();
  await expect.poll(labels).toEqual(
    expect.arrayContaining(['Quest 60001: Theirs', 'Quest 60002: Only mine', expect.stringMatching(/^Quest (?!6000[12]:)\d+: Only theirs$/)]),
  );
  // The result opens as a new unsaved project, keeping mine's name
  await expect(heading).toHaveText('Mine');
  await expect(page.getByLabel('Unsaved changes')).toBeVisible();
  await page.screenshot({ path: 'test-results/merge.png' });

  // None of the three files changed
  for (const [role, path] of Object.entries(files)) expect(readFileSync(path).equals(before[role]!), `${role} is unchanged`).toBe(true);
});
