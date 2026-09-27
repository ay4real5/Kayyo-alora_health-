import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'Demo-Password-1!';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
}

test('office staff search, admit, document and discharge a patient', async ({ page }) => {
  await signIn(page, 'office.staff@demo.alora.test');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Patients' }).click();

  // The demo agency has 27 active patients; search by MRN finds exactly one.
  await expect(page.getByText(/of 27$/)).toBeVisible();
  await page.getByLabel('Search').fill('DEMO-0001');
  await expect(page.getByRole('row')).toHaveCount(2); // header + one patient
  await expect(page).not.toHaveURL(/DEMO-0001/); // search terms never go in the address bar

  // Admit a new patient.
  const lastName = `Playwright${Date.now()}`;
  await page.getByRole('link', { name: 'Admit patient' }).click();
  await page.getByLabel('First name').fill('Test');
  await page.getByLabel('Last name').fill(lastName);
  await page.getByLabel('Date of birth').fill('1944-04-04');
  await page.getByLabel('Social Security number').fill('234-56-7891');
  await page.getByLabel('State').fill('IL');
  await page.getByRole('button', { name: 'Admit patient' }).click();

  await expect(page.getByRole('heading', { name: new RegExp(lastName) })).toBeVisible();
  await expect(page.getByText('•••-••-7891')).toBeVisible();
  await expect(page.getByText('234-56-7891')).toHaveCount(0);

  // A bad ICD-10 code shows the API's message and keeps what was typed.
  await page.getByLabel('Code').fill('not-a-code');
  await page.getByRole('button', { name: 'Add diagnosis' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /ICD-10/ })).toBeVisible();
  await expect(page.getByLabel('Code')).toHaveValue('not-a-code');

  // A valid code is normalised by the API.
  await page.getByLabel('Code').fill('e119');
  await page.getByLabel('Description').fill('Type 2 diabetes');
  await page.getByLabel('Primary diagnosis').check();
  await page.getByRole('button', { name: 'Add diagnosis' }).click();
  await expect(page.getByText('E11.9')).toBeVisible();

  // Discharge, then readmit.
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Discharge', exact: true }).click();
  await expect(page.getByText('discharged', { exact: true })).toBeVisible();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Readmit' }).click();
  await expect(page.getByText('active', { exact: true })).toBeVisible();
});

test('a field nurse sees only their own patients and cannot admit', async ({ page }) => {
  await signIn(page, 'rn@demo.alora.test');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Patients' }).click();
  await expect(page.getByRole('heading', { name: 'Patients' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Admit patient' })).toHaveCount(0);
  const rows = await page.getByRole('row').count();
  expect(rows - 1).toBeLessThan(27); // fewer than the whole agency

  // Opening a patient shows no edit controls for a read-only role.
  const firstPatient = page.getByRole('row').nth(1).getByRole('link');
  if (await firstPatient.count()) {
    await firstPatient.click();
    await expect(page.getByRole('heading', { name: 'Diagnoses (ICD-10)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add diagnosis' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0);
  }
});
