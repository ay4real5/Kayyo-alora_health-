import { expect, test, type Page } from '@playwright/test';
import { wcagViolations } from './axe';

/** Automated WCAG 2.1 A/AA checks (axe-core) on the main pages; the portal pages are checked in portal.spec.ts. */
const PASSWORD = 'Demo-Password-1!';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome|Good (morning|afternoon|evening)/ })).toBeVisible({ timeout: 20_000 });
}

/** Opens each page, waits for its heading and data, and collects violations per page (one report for all). */
async function scan(page: Page, pages: [string, RegExp][]) {
  const found: Record<string, unknown> = {};
  for (const [path, heading] of pages) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible({ timeout: 30_000 });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    const v = await wcagViolations(page);
    if (v.length) found[path] = v;
  }
  return found;
}

/** The href of the first link in the first data row of the page's table (a detail page to check). */
async function firstRowLink(page: Page, listPath: string): Promise<string> {
  await page.goto(listPath);
  const link = page.getByRole('table').first().getByRole('row').nth(1).getByRole('link').first();
  await expect(link).toBeVisible({ timeout: 30_000 });
  return (await link.getAttribute('href'))!;
}

test('signed-out pages have no WCAG A/AA violations', async ({ page }) => {
  for (const path of ['/login', '/forgot-password', '/reset-password']) {
    await page.goto(path);
    await expect(page.getByRole('heading').first()).toBeVisible();
    expect(await wcagViolations(page), path).toEqual([]);
  }
});

test('office pages have no WCAG A/AA violations', async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, 'supervisor@demo.alora.test');
  const patient = await firstRowLink(page, '/patients');
  const evvRecord = await firstRowLink(page, '/evv');
  const found = await scan(page, [
    ['/', /Welcome|Good (morning|afternoon|evening)/],
    ['/patients', /Patients/],
    [patient, /MRN|, /],
    ['/staff', /Staff/],
    ['/schedule', /Schedule/],
    ['/schedule/new', /Book a visit|New visit|Schedule/],
    ['/evv', /EVV/],
    [evvRecord, /EVV|Visit/],
    ['/monitor', /Live monitor/],
    ['/messages', /Messages/],
    ['/reports', /Reports/],
    ['/compliance', /Compliance/],
    ['/settings/notifications', /Notification settings/],
  ]);
  expect(found).toEqual({});
});

test('billing pages have no WCAG A/AA violations', async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, 'billing.staff@demo.alora.test');
  const found = await scan(page, [
    ['/billing/ready', /Ready to bill/],
    ['/billing/claims', /Claims/],
    ['/billing/files', /Claim files/],
    ['/billing/aging', /aging/i],
    ['/billing/payments', /Payments|Remittance/],
    ['/billing/invoices', /Invoices/],
    ['/billing/setup', /Billing setup|Payers/],
  ]);
  expect(found).toEqual({});
});
