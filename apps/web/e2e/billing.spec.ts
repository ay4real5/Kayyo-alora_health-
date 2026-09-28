import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'Demo-Password-1!';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
}

async function openPatient(page: Page, mrn: string) {
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Patients' })
    .click();
  await page.getByLabel('Search').fill(mrn);
  const row = page.getByRole('row').filter({ hasText: mrn });
  await expect(row).toHaveCount(1); // the search has settled on this patient
  await row.getByRole('link').first().click();
  await expect(page.getByText(`MRN ${mrn}`)).toBeVisible();
}

test('billing staff see the payers, service codes and rates', async ({ page }) => {
  await signIn(page, 'billing.staff@demo.alora.test');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Billing setup' })
    .click();
  await expect(page.getByRole('cell', { name: 'Demo Medicaid (FAKE)' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'G0156' })).toBeVisible();
  await page.getByLabel('Payer', { exact: true }).selectOption({ label: 'Demo Medicaid (FAKE)' });
  await expect(page.getByRole('cell', { name: 'T1019' })).toBeVisible();
});

test('the office sees authorization usage and adds an authorization', async ({ page }) => {
  await signIn(page, 'office.staff@demo.alora.test');
  // The first recurring aide patient has a 40-visit authorization with its visits linked.
  await openPatient(page, 'DEMO-0001');
  const auths = page.getByRole('list', { name: 'Authorizations' });
  await expect(auths).toContainText('DEMO-AUTH-1000');
  await expect(auths).toContainText(/booked of 40 visits/);

  await page.getByRole('button', { name: 'Add authorization' }).click();
  await page.getByLabel('Payer', { exact: true }).selectOption({ label: 'Demo Medicaid (FAKE)' });
  await page.getByLabel('Service code').selectOption('T1019');
  await page.getByLabel('Authorization number').fill('PW-NEW-1');
  const end = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel('End', { exact: true }).fill(end);
  await page.getByLabel('Authorized hours').fill('20');
  await page.getByRole('button', { name: 'Save authorization' }).click();
  await expect(auths).toContainText('PW-NEW-1');
  await expect(auths).toContainText('0 used + 0 booked of 20 hours');
});

test('pre-billing QA shows ready visits and what blocks the rest', async ({ page }) => {
  await signIn(page, 'billing.staff@demo.alora.test');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Ready to bill' })
    .click();
  const summary = page.getByRole('region', { name: 'Summary' });
  await expect(summary).toBeVisible();
  // Demo data: verified EVV + submitted notes two days ago are ready; the flagged ones from yesterday aren't.
  const table = page.getByRole('table');
  await expect(table.getByText('Ready', { exact: true }).first()).toBeVisible();
  await expect(table.getByText('EVV needs a supervisor to verify it').first()).toBeVisible();
  await page.getByLabel('Show').selectOption('true');
  await expect(table.getByText('Blocked', { exact: true })).toHaveCount(0);
  await expect(table.getByText('Ready', { exact: true }).first()).toBeVisible();
});

test('billing creates claims from ready visits, opens one and voids it', async ({ page }) => {
  await signIn(page, 'billing.staff@demo.alora.test');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Ready to bill' })
    .click();
  await page.getByRole('button', { name: 'Create claims for ready visits' }).click();
  // One claim per patient: several round trips to the database.
  await expect(page.getByRole('status').filter({ hasText: /Created \d+ claims?/ })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('link', { name: 'See claims' }).click();
  await expect(page.getByRole('heading', { name: 'Claims' })).toBeVisible();

  const first = page.getByRole('table').getByRole('link').first();
  const claimNumber = (await first.textContent())!.trim();
  await first.click();
  await expect(page.getByRole('heading', { name: new RegExp(claimNumber) })).toBeVisible();
  await expect(
    page.getByRole('table', { name: 'Claim lines' }).getByText('G0156').first(),
  ).toBeVisible();

  // The demo agency and payer are complete, so the electronic claim file downloads.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download 837P (preview)' }).click();
  expect((await download).suggestedFilename()).toBe(`837P-${claimNumber}-preview.edi`);

  await page.getByLabel('Void reason').fill('Playwright test');
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Void claim' }).click();
  await expect(page.getByText('Playwright test')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Void claim' })).toHaveCount(0);
});

test('billing loads an 835 remittance and sees which claims are not ours', async ({ page }) => {
  await signIn(page, 'billing.staff@demo.alora.test');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Payments' }).click();
  await page.getByLabel('835 file').setInputFiles(join(__dirname, '..', '..', 'api', 'src', 'modules', 'billing', 'edi', '__fixtures__', '835-basic.edi'));
  const payments = page.getByRole('list', { name: 'Payments' });
  await expect(payments).toContainText('$30.50');
  await expect(payments).toContainText('Not our claims (not posted): 260928ABC234, 260928DEF567');
  await expect(page.getByRole('table', { name: 'Payment details' })).toContainText('Denied');
});
