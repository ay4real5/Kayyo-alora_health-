import { expect, test, type Page } from '@playwright/test';
import { answerTwoFactor } from './two-factor';

const PASSWORD = 'Demo-Password-1!';

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

test('a caregiver reports a fall; the supervisor resolves it; the admin finds it in the audit log', async ({ page }) => {
  test.setTimeout(150_000);
  const description = `Client slipped getting out of bed ${Date.now()}`;

  await signIn(page, 'hha@demo.alora.test');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Compliance' }).click();
  await expect(page.getByRole('region', { name: 'Compliance summary' })).toHaveCount(0); // reporting only
  await page.getByLabel('Type of incident').selectOption('fall');
  await page.getByLabel('Severity').selectOption('high');
  await page.getByLabel('Describe what happened').fill(description);
  await page.getByLabel('What was done right away').fill('Helped back to bed, checked for injuries.');
  await page.getByRole('button', { name: 'Submit report' }).click();
  await expect(page.getByText('Thank you — the incident was reported.')).toBeVisible({ timeout: 15_000 });
  await signOut(page);

  await signIn(page, 'supervisor@demo.alora.test');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Compliance' }).click();
  await expect(page.getByRole('region', { name: 'Compliance summary' })).toBeVisible();
  const incidents = page.getByRole('list', { name: 'Incidents' });
  const item = incidents.getByRole('listitem').filter({ has: page.getByText('Fall') }).first();
  await item.getByRole('button').first().click();
  await expect(item).toContainText(description);
  await item.getByLabel('Status').selectOption('resolved');
  await item.getByLabel('Follow-up notes').fill('Bed rail installed.');
  await item.getByRole('button', { name: 'Save' }).click();
  await expect(incidents.getByText(description)).toHaveCount(0, { timeout: 15_000 }); // left the "open" list
  await signOut(page);

  await signIn(page, 'agency.admin@demo.alora.test');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Audit log' }).click();
  await expect(page.getByRole('list', { name: 'HIPAA safeguards' })).toContainText('Two-factor authentication for administrators');
  await page.getByLabel('Action').fill('report_incident');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('table', { name: 'Audit entries' }).getByText('REPORT_INCIDENT').first()).toBeVisible({ timeout: 15_000 });
});
