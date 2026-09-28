import { expect, test } from '@playwright/test';

const PASSWORD = 'Demo-Password-1!';

test('billing sends a claim, sees it in AR aging, and replaces it with a corrected claim', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/login');
  await page.getByLabel('Email').fill('billing.staff@demo.alora.test');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main' });

  // Make sure there are claims (another test may already have made them).
  await nav.getByRole('link', { name: 'Ready to bill' }).click();
  await page.getByRole('button', { name: 'Create claims for ready visits' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Created \d+ claims?/ })).toBeVisible({ timeout: 30_000 });

  await nav.getByRole('link', { name: 'Claims' }).click();
  await page.getByLabel('Status').selectOption('ready');
  const first = page.getByRole('table').getByRole('link').first();
  await expect(first).toBeVisible();
  const claimNumber = (await first.textContent())!.trim();
  await first.click();
  await expect(page.getByRole('heading', { name: new RegExp(claimNumber) })).toBeVisible();

  await page.getByRole('button', { name: 'Mark as sent to payer' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(claimNumber) })).toContainText('submitted', { timeout: 15_000 });

  await nav.getByRole('link', { name: 'AR aging' }).click();
  const aging = page.getByRole('table', { name: 'Aging' });
  await expect(aging.getByRole('row').filter({ hasText: 'Demo Medicaid (FAKE)' })).toBeVisible({ timeout: 15_000 });

  await page.goBack();
  await expect(page.getByRole('heading', { name: new RegExp(claimNumber) })).toBeVisible();
  page.once('dialog', (d) => void d.accept('Corrected units'));
  await page.getByRole('button', { name: 'Create corrected claim' }).click();
  await expect(page.getByText('Corrected claim replacing')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: new RegExp(claimNumber) })).toHaveCount(0); // a new claim number
});
