import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'Demo-Password-1!';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('an admin signs in, sees live numbers, navigates and signs out', async ({ page }) => {
  await signIn(page, 'agency.admin@demo.alora.test');
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();

  const activePatients = page.getByRole('link', { name: /Active patients/ });
  await expect(activePatients).toContainText('27'); // the demo agency has 27 active patients

  const nav = page.getByRole('navigation', { name: 'Main' });
  for (const item of ['Schedule', 'Patients', 'Staff', 'Physicians', 'Users']) {
    await expect(nav.getByRole('link', { name: item })).toBeVisible();
  }
  await nav.getByRole('link', { name: 'Patients' }).click();
  await expect(page).toHaveURL(/\/patients$/);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  // Signed out means signed out: going back to the app lands on the login page again.
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});

test('the session survives a page reload (refresh cookie), without storing tokens in the page', async ({ page }) => {
  await signIn(page, 'office.staff@demo.alora.test');
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();

  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie);
  expect(stored).not.toMatch(/eyJ/); // no JWT anywhere scripts can reach
  expect(stored).not.toContain('alora_rt'); // the refresh cookie is httpOnly
});

test('a caregiver only sees what their role allows', async ({ page }) => {
  await signIn(page, 'hha@demo.alora.test');
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Schedule' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Users' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Staff' })).toHaveCount(0);
});

test('a wrong password shows the generic error', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('agency.admin@demo.alora.test');
  await page.getByLabel('Password').fill('Wrong-Password-1!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Invalid email or password' })).toBeVisible();
});
