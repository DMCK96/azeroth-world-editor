import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clientDir, mysqlUrl } from '../helpers/env';

/**
 * Two new quests are made a daily rotation from the graph (Ctrl+click, Rotate these quests…); the
 * project patch carries the pool and its two quests and the revert deletes them. Then the World
 * follows an opened quest to its giver (Back becomes enabled), where a game client is configured.
 */
const withoutConnectionEnv = (env: NodeJS.ProcessEnv): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter(
      (e): e is [string, string] => e[1] !== undefined && !/^ACQC_(WORLD|DEV)_DB_/.test(e[0]) && e[0] !== 'ELECTRON_RUN_AS_NODE',
    ),
  );

let running: ElectronApplication | undefined;
test.afterEach(async () => {
  if (!running) return;
  // The project has unsaved edits, so quitting asks to save it; answer "Don't Save" so nothing hangs.
  await running.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as never;
  });
  await running.close();
  running = undefined;
});

async function newQuestWithGiver(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'New quest', exact: true }).click();
  await page.getByLabel('Quest title').fill(title);
  await page.getByRole('list', { name: 'Modules' }).getByRole('button', { name: /^Quest Giver/ }).click();
  const giver = page.getByRole('dialog', { name: 'Quest Giver' });
  await giver.getByRole('button', { name: 'Add quest giver' }).click();
  await giver.getByRole('combobox', { name: 'Starts at 1' }).fill('Stormwind Guard');
  await giver.getByRole('option', { name: /^Stormwind Guard.*#1423$/ }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '← Back to chain' }).click();
}

test('two quests are made a daily rotation, exported with its revert; the World follows the quest', async () => {
  test.setTimeout(240_000);
  const u = new URL(mysqlUrl());
  const outDir = mkdtempSync(join(tmpdir(), 'acqc-out-'));
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...withoutConnectionEnv(process.env), ACQC_USER_DATA: mkdtempSync(join(tmpdir(), 'acqc-ud-')), ACQC_OUTPUT_DIR: outDir, ACQC_ENV_FILE: 'none' },
  });
  running = app;
  const page = await app.firstWindow();

  await page.getByLabel('Host').fill(u.hostname);
  await page.getByLabel('Port', { exact: true }).fill(u.port || '3306');
  await page.getByLabel('User').fill(decodeURIComponent(u.username));
  await page.getByLabel('Database').fill(u.pathname.slice(1));
  await page.getByLabel('Password').fill(decodeURIComponent(u.password));
  await page.getByLabel('Game client folder (optional)').fill(clientDir());
  await page.getByRole('button', { name: 'Save and connect' }).click();
  await expect(page.getByRole('button', { name: 'Quests', exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Quests', exact: true }).click();
  await newQuestWithGiver(page, 'Daily errand one');
  await newQuestWithGiver(page, 'Daily errand two');

  const one = page.getByRole('button', { name: /^Quest \d+: Daily errand one$/ });
  const two = page.getByRole('button', { name: /^Quest \d+: Daily errand two$/ });
  const tools = page.getByRole('toolbar', { name: 'Quest tools' });
  // Fit view brings both cards clear of the toolbar
  await tools.getByRole('button', { name: 'Fit view' }).click();
  await one.click({ modifiers: ['Control'] });
  await two.click({ modifiers: ['Control'] });
  await tools.getByRole('button', { name: 'Rotate these quests…' }).click();

  const dialog = page.getByRole('dialog', { name: 'Quest rotation' });
  await dialog.getByLabel('Name', { exact: true }).fill('Test rotation');
  await dialog.getByRole('radio', { name: 'Daily' }).check();
  await dialog.getByRole('button', { name: 'Make them all daily' }).click();
  const save = dialog.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(dialog).toHaveCount(0);

  // The world stays in view above the Quests dock
  const welcome = page.getByRole('dialog', { name: 'Welcome' });
  if (await welcome.isVisible().catch(() => false)) await page.keyboard.press('Escape');
  await expect(page.getByText('Loading the world…')).toHaveCount(0, { timeout: 90_000 });
  const changesButton = page.getByRole('button', { name: /^Project changes \(\d+\)$/ });
  await expect(changesButton).toBeEnabled({ timeout: 60_000 });
  await changesButton.click();
  const changes = page.getByRole('dialog', { name: 'Project changes' });
  await changes.getByRole('button', { name: 'Export project patch' }).click();
  await expect(changes.locator('.world-changes__exported p').nth(1)).toBeVisible();
  const written = (await changes.locator('.world-changes__exported p').nth(1).textContent())!.trim();
  const sql = readFileSync(written, 'utf8');
  expect(sql).toMatch(/INSERT INTO `pool_template` .*'Test rotation'/);
  expect(sql.match(/INSERT INTO `pool_quest`/g) ?? []).toHaveLength(2);
  const revert = readFileSync(written.replace(/\.sql$/, '_revert.sql'), 'utf8');
  expect(revert).toMatch(/DELETE FROM `pool_template`/);
  expect(revert).toMatch(/DELETE FROM `pool_quest`/);
  await page.keyboard.press('Escape');
  await expect(changes).toHaveCount(0);

  // The World follows a quest opened in the dock to its giver
  await one.click({ position: { x: 12, y: 12 } });
  if (await page.getByText('See the world in 3D').isVisible().catch(() => false)) {
    test.info().annotations.push({ type: 'skipped', description: 'No game client: the World cannot follow the quest' });
    return;
  }
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeEnabled({ timeout: 60_000 });
});
