import { expect, test, type Page } from '@playwright/test';
import { answerTwoFactor } from './two-factor';

const PASSWORD = 'Demo-Password-1!';
const isoDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (email.startsWith('agency.admin@')) await answerTwoFactor(page);
  else await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
}

async function signOut(page: Page) {
  const reloaded = page.waitForEvent('load');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await reloaded;
}

test('an aide logs mileage; the admin runs payroll; the aide sees the stub', async ({ page }) => {
  test.setTimeout(240_000);
  const nav = page.getByRole('navigation', { name: 'Main' });

  await signIn(page, 'hha@demo.alora.test');
  await nav.getByRole('link', { name: 'My pay' }).click();
  await page.getByLabel('Date').fill(isoDay(-2));
  await page.getByLabel('Miles').fill('12.5');
  await page.getByLabel('Trip').fill('Office to client visit');
  await page.getByRole('button', { name: 'Log mileage' }).click();
  await expect(page.getByRole('list', { name: 'My mileage' })).toContainText('12.5 miles', { timeout: 15_000 });
  await signOut(page);

  await signIn(page, 'agency.admin@demo.alora.test');
  await nav.getByRole('link', { name: 'Payroll' }).click();
  const approvals = page.getByRole('list', { name: 'Mileage to approve' });
  await approvals.getByRole('listitem').filter({ hasText: '12.5 miles' }).getByRole('button', { name: 'Approve' }).click();
  await expect(approvals.getByText('12.5 miles')).toHaveCount(0, { timeout: 15_000 });

  await page.getByLabel('Period start').fill(isoDay(-6));
  await page.getByLabel('Period end').fill(isoDay(0));
  await page.getByLabel('Pay date').fill(isoDay(5));
  await page.getByRole('button', { name: 'New pay period' }).click();
  const periods = page.getByRole('table', { name: 'Pay periods' });
  await periods.getByRole('link').first().click();
  await page.getByRole('button', { name: 'Calculate' }).click();
  const stubs = page.getByRole('table', { name: 'Pay stubs' });
  await expect(stubs).toBeVisible({ timeout: 30_000 });
  // 12.5 mi × the aide's own $0.67 rate (in the aide's row and the totals).
  await expect(stubs.getByRole('cell', { name: '$8.38', exact: true }).first()).toBeVisible();

  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Approve' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV' }).click({ timeout: 15_000 });
  expect((await download).suggestedFilename()).toMatch(/^payroll-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/);
  await signOut(page);

  await signIn(page, 'hha@demo.alora.test');
  await nav.getByRole('link', { name: 'My pay' }).click();
  const mine = page.getByRole('list', { name: 'Pay stubs' });
  await expect(mine.getByRole('listitem')).toHaveCount(1, { timeout: 15_000 });
  await expect(mine).toContainText('$8.38 mileage');
});
