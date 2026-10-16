import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clientDir, mysqlUrl, serverDataDir } from '../helpers/env';

/**
 * An existing stock NPC (Stormwind Guard, entry 1423) is picked as a quest giver, edited from the
 * giver card, and shows in Project changes; the project patch carries the changed row and its revert
 * carries the original.
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

test('an existing NPC is edited from the giver card and exported with its revert', async () => {
  test.setTimeout(180_000);
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
  await page.getByLabel('Server data folder (optional)').fill(serverDataDir());
  await page.getByLabel('Game client folder (optional)').fill(clientDir());
  await page.getByRole('button', { name: 'Save and connect' }).click();
  await expect(page.getByRole('button', { name: 'Quests', exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Quests', exact: true }).click();
  await page.getByRole('button', { name: 'New quest', exact: true }).click();
  await page.getByLabel('Quest title').fill('Ask the guard');
  await page.getByRole('list', { name: 'Modules' }).getByRole('button', { name: /^Quest Giver/ }).click();
  const giver = page.getByRole('dialog', { name: 'Quest Giver' });
  await giver.getByRole('button', { name: 'Add quest giver' }).click();
  await giver.getByRole('combobox', { name: 'Starts at 1' }).fill('Stormwind Guard');
  await giver.getByRole('option', { name: /^Stormwind Guard.*#1423$/ }).click();
  // The picker's button is named for the card ("Edit Starts at 1"), not "Edit Giver"
  await giver.getByRole('button', { name: 'Edit Starts at 1' }).click();

  const editor = page.getByRole('dialog', { name: 'NPC: Stormwind Guard (existing)' });
  await expect(editor).toBeVisible();
  await editor.getByLabel('Min level').fill('60');
  await editor.getByLabel('Max level').fill('60');
  await editor.getByRole('button', { name: 'Done' }).click();
  await expect(editor).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '← Back to chain' }).click();

  // The world stays in view above the Quests dock
  const welcome = page.getByRole('dialog', { name: 'Welcome' });
  // A project's first visit to the World greets it; Esc leaves the greeting
  await expect(welcome).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(welcome).toHaveCount(0);
  await expect(page.getByText('Loading the world…')).toHaveCount(0, { timeout: 90_000 });
  const changesButton = page.getByRole('button', { name: /^Project changes \(\d+\)$/ });
  await expect(changesButton).toHaveText('Project changes (1)', { timeout: 60_000 });
  await changesButton.click();
  const changes = page.getByRole('dialog', { name: 'Project changes' });
  const row = changes.getByRole('listitem', { name: 'Stormwind Guard' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Details changed');
  await page.screenshot({ path: 'test-results/edit-existing-changes.png' });

  await changes.getByRole('button', { name: 'Export project patch' }).click();
  const written = (await changes.locator('.world-changes__exported p').nth(1).textContent())!.trim();
  const sql = readFileSync(written, 'utf8');
  expect(sql).toMatch(/INSERT INTO `creature_template` .*60/);
  const revert = readFileSync(written.replace(/\.sql$/, '_revert.sql'), 'utf8');
  // Stormwind Guard's stock row is 22-25: the revert puts the original max level back
  expect(revert).toMatch(/INSERT INTO `creature_template` /);
  expect(revert).toContain('25');
});
