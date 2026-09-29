import { expect, test } from '@playwright/test';
import { wcagViolations } from './axe';

const PASSWORD = 'Demo-Password-1!';

test('billing makes an 837 file for one payer, downloads it and marks it sent', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/login');
  await page.getByLabel('Email').fill('billing.staff@demo.alora.test');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main' });

  // Make sure there are ready claims (another test may already have made them).
  await nav.getByRole('link', { name: 'Ready to bill' }).click();
  await page.getByRole('button', { name: 'Create claims for ready visits' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Created \d+ claims?/ })).toBeVisible({ timeout: 30_000 });

  await nav.getByRole('link', { name: 'Claim files' }).click();
  await expect(page.getByRole('heading', { name: 'Claim files' })).toBeVisible();
  const group = page.getByRole('region', { name: 'Demo Medicaid (FAKE) 837P' });
  await expect(group).toBeVisible({ timeout: 20_000 });
  // One claim only — leave the rest ready for the other billing tests.
  const boxes = group.getByRole('checkbox');
  const count = await boxes.count();
  for (let i = 1; i < count; i++) await boxes.nth(i).uncheck();
  await expect(group.getByRole('heading')).toContainText('1 of');
  await group.getByRole('button', { name: 'Create file' }).click();

  const files = page.getByRole('table', { name: 'Claim files' });
  const row = files.getByRole('row').filter({ hasText: /837P-\d{9}\.edi/ }).first();
  await expect(row).toContainText('Not sent yet', { timeout: 20_000 });
  const downloading = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Download' }).click();
  expect((await downloading).suggestedFilename()).toMatch(/^837P-\d{9}\.edi$/);

  page.once('dialog', (d) => void d.accept());
  await row.getByRole('button', { name: 'Mark as sent' }).click();
  await expect(row).toContainText('Sent', { timeout: 15_000 });
  await expect(row.getByRole('button', { name: 'Mark as sent' })).toHaveCount(0);
  expect(await wcagViolations(page)).toEqual([]);
});
