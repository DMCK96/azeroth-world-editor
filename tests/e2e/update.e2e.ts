import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const withoutConnectionEnv = (env: NodeJS.ProcessEnv): Record<string, string> =>
  Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined && !/^(ACQC_(WORLD|DEV)_DB_|AWE_)/.test(e[0])));

let running: ElectronApplication | undefined;
test.afterEach(async () => {
  await running?.close();
  running = undefined;
});

const launch = async (extraArgs: string[]) => {
  const app = await electron.launch({
    args: ['out/main/index.js', ...extraArgs],
    env: { ...withoutConnectionEnv(process.env), ACQC_USER_DATA: mkdtempSync(join(tmpdir(), 'acqc-ud-')), ACQC_ENV_FILE: 'none' },
  });
  running = app;
  return app.firstWindow();
};

test('--fake-update shows the update dialog on the connect screen, and Remind me later closes it', async () => {
  const page = await launch(['--fake-update']);
  const dialog = page.getByRole('alertdialog', { name: 'Update available' });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('button', { name: /connect/i })).toBeVisible();
  await dialog.getByRole('button', { name: 'Remind me later' }).click();
  await expect(dialog).toBeHidden();
});

test('an unpackaged build without the flag shows no update dialog', async () => {
  const page = await launch([]);
  await expect(page.getByRole('button', { name: /connect/i })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.getByRole('alertdialog', { name: 'Update available' })).toHaveCount(0);
});
