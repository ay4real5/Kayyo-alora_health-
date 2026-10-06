import { expect, test } from '@playwright/test';

const PASSWORD = 'Demo-Password-1!';

test('billing staff read the reports dashboard, switch ranges, see the table view and download a CSV', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/login');
  await page.getByLabel('Email').fill('billing.staff@demo.alora.test');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome|Good (morning|afternoon|evening)/ })).toBeVisible();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Reports' }).click();

  const numbers = page.getByRole('region', { name: 'Key numbers' });
  await expect(numbers.getByText('Active patients')).toBeVisible({ timeout: 30_000 }); // first visit compiles the page in dev
  // Other tests admit patients and complete visits, so check the shape, not exact counts.
  await expect(numbers).toContainText(/Active patients\d+/, { timeout: 15_000 });
  await expect(numbers).toContainText(/Visits completed\d+(\.\d)?%/);
  await expect(numbers.getByText('Outstanding')).toBeVisible(); // billing sees money
  await expect(page.getByRole('img', { name: /Visits per day/ })).toBeVisible();
  if (process.env.REPORTS_SCREENSHOT) await page.screenshot({ path: process.env.REPORTS_SCREENSHOT, fullPage: true });

  await page.getByRole('button', { name: 'Show as table' }).click();
  await expect(page.getByRole('table', { name: 'Visits per day' }).getByRole('row')).toHaveCount(31); // header + 30 days
  await page.getByRole('button', { name: 'Last 7 days' }).click();
  await expect(page.getByRole('table', { name: 'Visits per day' }).getByRole('row')).toHaveCount(8, { timeout: 15_000 });

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV' }).nth(1).click(); // staff productivity
  expect((await download).suggestedFilename()).toMatch(/^staff-productivity-.*\.csv$/);
});

test('a supervisor sees reports but no money', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('supervisor@demo.alora.test');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome|Good (morning|afternoon|evening)/ })).toBeVisible();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Reports' }).click();
  await expect(page.getByRole('region', { name: 'Key numbers' }).getByText('EVV verified')).toBeVisible();
  await expect(page.getByText('Outstanding')).toHaveCount(0);
  await expect(page.getByText(/don't have access|Something went wrong/)).toHaveCount(0);
});
