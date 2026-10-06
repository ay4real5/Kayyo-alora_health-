import { expect, test, type Page } from '@playwright/test';
import { demoDay } from './dates';

const PASSWORD = 'Demo-Password-1!';

async function openPatient(page: Page, email: string, mrn: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome|Good (morning|afternoon|evening)/ })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Patients' })
    .click();
  await page.getByLabel('Search').fill(mrn);
  const row = page.getByRole('row').filter({ hasText: mrn });
  await expect(row).toHaveCount(1);
  await row.getByRole('link').first().click();
  await expect(page.getByText(`MRN ${mrn}`)).toBeVisible();
}

test('a supervisor keeps the medication list, orders and plan of care', async ({ page }) => {
  await openPatient(page, 'supervisor@demo.alora.test', 'DEMO-0003');

  // Medications: add, then discontinue (kept on record).
  const meds = page.getByRole('list', { name: 'Medications' });
  await page.getByLabel('Medication', { exact: true }).fill('Lisinopril');
  await page.getByLabel('Dose').fill('10 mg');
  await page.getByRole('button', { name: 'Add medication' }).click();
  await expect(meds).toContainText('Lisinopril');
  page.once('dialog', (d) => void d.accept('Blood pressure controlled'));
  await meds.getByRole('button', { name: 'Discontinue' }).first().click();
  await expect(meds).not.toContainText('Lisinopril');
  await page.getByLabel('Show discontinued').check();
  await expect(meds).toContainText('Blood pressure controlled');

  // A verbal order, marked sent.
  const orders = page.getByRole('list', { name: 'Physician orders' });
  await page.getByLabel('Order', { exact: true }).fill('Aide visits 3 times a week');
  await page.getByRole('button', { name: 'Record order' }).click();
  await expect(orders).toContainText('Aide visits 3 times a week');
  await orders.getByRole('button', { name: 'Mark sent to physician' }).first().click();
  await expect(orders.getByRole('button', { name: 'Mark sent to physician' })).toHaveCount(0);

  // Plan of care: draft, then active once the physician signed.
  await page.getByRole('button', { name: 'New version' }).click();
  const physician = page.getByLabel('Physician', { exact: true });
  await expect(physician.locator('option').nth(1)).toBeAttached();
  await physician.selectOption({ index: 1 });
  const today = demoDay();
  const end = demoDay(59);
  await page.getByLabel('Certification from').fill(today);
  await page.getByLabel('to', { exact: true }).fill(end);
  await page.getByLabel('Goals (one per line)').fill('Safe transfers without help');
  await page.getByLabel('Visit frequency').fill('HHA 3W8, RN 1W8');
  await page.getByRole('button', { name: 'Save draft' }).click();
  const plans = page.getByRole('list', { name: 'Plans of care' });
  await expect(plans).toContainText('HHA 3W8, RN 1W8');
  page.once('dialog', (d) => void d.accept(today));
  await plans.getByRole('button', { name: /Physician signed/ }).click();
  await expect(plans.getByText('active', { exact: true })).toBeVisible();
});
