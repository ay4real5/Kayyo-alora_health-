import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'Demo-Password-1!';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' });

test('an admin adds a user, turns them into staff, and manages credentials, availability and time off', async ({ page }) => {
  await signIn(page, 'agency.admin@demo.alora.test');
  const stamp = Date.now();

  // 1. Create the login.
  await nav(page).getByRole('link', { name: 'Users' }).click();
  await page.getByRole('link', { name: 'Add user' }).click();
  await page.getByLabel('First name').fill('Robin');
  await page.getByLabel('Last name').fill(`Newhire${stamp}`);
  await page.getByLabel('Email').fill(`robin.${stamp}@demo.alora.test`);
  await page.getByLabel('Starting password').fill('Starting-Pass-1!');
  await page.getByLabel(/Home health aide/).check();
  await page.getByRole('button', { name: 'Add user' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(`Robin Newhire${stamp}`) })).toBeVisible();

  // 2. Give them a staff profile.
  await nav(page).getByRole('link', { name: 'Staff' }).click();
  await page.getByRole('link', { name: 'Add staff profile' }).click();
  const person = page.getByLabel('Person');
  const value = await person.locator('option', { hasText: `Newhire${stamp}` }).getAttribute('value');
  await person.selectOption(value!);
  await page.getByLabel('Discipline').selectOption('HHA');
  await page.getByLabel('Service area ZIP codes').fill('62701, 62702');
  await page.getByLabel('Hourly rate ($)').fill('21.50');
  await page.getByRole('button', { name: 'Create staff profile' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(`Robin Newhire${stamp}`) })).toBeVisible();
  await expect(page.getByText('$21.50')).toBeVisible(); // admins hold payroll:read

  // 3. Credentials with computed state.
  await page.getByLabel('Credential type').fill('cpr');
  await page.getByLabel('Credential name').fill('CPR/BLS');
  await page.getByLabel('Expiry date').fill('2020-01-01');
  await page.getByRole('button', { name: 'Add credential' }).click();
  await expect(page.getByText('expired', { exact: true })).toBeVisible();

  // 4. Availability: add a Monday slot and save; it is still there after reloading.
  await expect(page.getByText('No availability set')).toBeVisible();
  await page.getByRole('button', { name: 'Add time slot' }).click();
  await page.getByRole('button', { name: 'Save availability' }).click();
  await page.reload();
  await expect(page.getByText('No availability set')).toHaveCount(0);
  await expect(page.getByLabel('Day')).toHaveValue('1');

  // 5. Time off: request (admin on their behalf), then approve.
  await page.getByLabel('From', { exact: true }).last().fill('2027-03-01');
  await page.getByLabel('To', { exact: true }).last().fill('2027-03-03');
  await page.getByRole('button', { name: 'Request time off' }).click();
  await expect(page.getByText('pending', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('approved', { exact: true })).toBeVisible();
});

test('office staff manage people but never see pay, and cannot open Users', async ({ page }) => {
  await signIn(page, 'office.staff@demo.alora.test');
  await expect(nav(page).getByRole('link', { name: 'Users' })).toHaveCount(0);
  await nav(page).getByRole('link', { name: 'Staff' }).click();
  await page.getByRole('row').nth(1).getByRole('link').click();
  await expect(page.getByRole('heading', { name: 'Credentials' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pay' })).toHaveCount(0);
});

test('physicians: a mistyped NPI is caught before saving; a valid one saves', async ({ page }) => {
  await signIn(page, 'office.staff@demo.alora.test');
  await nav(page).getByRole('link', { name: 'Physicians' }).click();
  await page.getByRole('link', { name: 'Add physician' }).click();
  await page.getByLabel('First name').fill('Alex');
  await page.getByLabel('Last name').fill(`Doctor${Date.now()}`);
  await page.getByLabel('NPI').fill('1234567890');
  await expect(page.getByText('Not a valid NPI')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add physician' })).toBeDisabled();
  await page.getByLabel('NPI').fill('1234567893');
  await page.getByRole('button', { name: 'Add physician' }).click();
  await expect(page).toHaveURL(/\/physicians$/);
});

test('the credentials page lists the expired CPR card from the demo data', async ({ page }) => {
  await signIn(page, 'supervisor@demo.alora.test');
  await page.getByRole('link', { name: /Credentials expired or expiring/ }).click();
  await expect(page.getByRole('heading', { name: 'Credentials needing attention' })).toBeVisible();
  await expect(page.getByText('expired', { exact: true }).first()).toBeVisible();
});
