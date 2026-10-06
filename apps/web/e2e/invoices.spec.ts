import { expect, test } from '@playwright/test';
import { demoDay } from './dates';

const PASSWORD = 'Demo-Password-1!';
const isoDay = demoDay;

test('billing invoices the private-pay patient, downloads the PDF and records the payment', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/login');
  await page.getByLabel('Email').fill('billing.staff@demo.alora.test');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome|Good (morning|afternoon|evening)/ })).toBeVisible();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Invoices' }).click();
  await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible();

  // The demo has one private-pay patient with verified visits two days ago.
  await page.getByLabel('Visits from').fill(isoDay(-7));
  await page.getByLabel('to', { exact: true }).fill(isoDay(1));
  await page.getByRole('button', { name: 'Create invoices' }).click();
  await expect(page.getByRole('status').filter({ hasText: /Created 1 invoice\b/ })).toBeVisible({ timeout: 30_000 });

  const link = page.getByRole('table').getByRole('link', { name: /^INV-/ }).first();
  const number = (await link.textContent())!.trim();
  await link.click();
  await expect(page.getByRole('heading', { name: new RegExp(number) })).toBeVisible();
  await expect(page.getByText('Home health aide, each 15 minutes').first()).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  expect((await download).suggestedFilename()).toBe(`${number}.pdf`);

  await page.getByRole('button', { name: 'Mark as sent' }).click();
  await expect(page.getByRole('button', { name: 'Mark as sent' })).toHaveCount(0);
  await page.getByLabel('Reference').fill('1042');
  await page.getByRole('button', { name: 'Record payment' }).click(); // the full balance by default
  await expect(page.getByRole('list', { name: 'Payments' })).toContainText('#1042');
  await expect(page.getByRole('heading', { name: new RegExp(number) })).toContainText('paid');
});
