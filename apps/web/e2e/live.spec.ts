import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'Demo-Password-1!';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
}

test('the live monitor connects and shows today', async ({ page }) => {
  await signIn(page, 'supervisor@demo.alora.test');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Live monitor' })
    .click();
  await expect(page.getByRole('heading', { name: 'Live monitor' })).toBeVisible();
  await expect(page.getByText('● Live')).toBeVisible(); // the socket connected
  await expect(page.getByRole('region', { name: "Today's counts" })).toBeVisible();
  await expect(page.getByLabel('Map of active visits')).toBeVisible();
});

test('a supervisor reviews flagged EVV records: verify one, request a correction on another', async ({
  page,
}) => {
  await signIn(page, 'supervisor@demo.alora.test');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'EVV review' })
    .click();

  // The demo data has two flagged records from yesterday.
  const away = page.getByRole('row').filter({ hasText: 'Clocked in away from the home' });
  await expect(away).toHaveCount(1);
  await away.getByRole('link').click();
  await expect(page.getByRole('heading', { name: /EVV record/ })).toBeVisible();
  await expect(page.getByText(/outside the geofence/)).toBeVisible();
  await page.getByLabel(/Note/).fill('Confirmed with the family; parked down the road');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText(/^Verified /)).toBeVisible();

  await page.goBack();
  const short = page.getByRole('row').filter({ hasText: 'Visit much shorter than scheduled' });
  await short.getByRole('link').click();
  await page.getByLabel('Which time').selectOption('clock_out_time');
  await page.getByLabel('Corrected time').fill(
    await page.evaluate(() => {
      const d = new Date(Date.now() - 20 * 3_600_000);
      d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
      return d.toISOString().slice(0, 16);
    }),
  );
  await page.getByLabel('Reason').fill('Phone died; the patient confirmed a full visit');
  await page.getByRole('button', { name: 'Request correction' }).click();
  await expect(page.getByText('Someone else must decide your request')).toBeVisible();
  // Can't verify while a correction is pending.
  await expect(page.getByRole('button', { name: 'Verify' })).toBeDisabled();
});

test('the office adds a task to a visit and offers it as an open shift', async ({ page }) => {
  await signIn(page, 'office.staff@demo.alora.test');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Schedule' })
    .click();
  await page.getByRole('button', { name: 'Next week' }).click();
  // Open the first aide visit next week (every assigned aide visit has the demo checklist).
  await page
    .getByRole('link', { name: /Home health aide/ })
    .filter({ hasNotText: 'Unassigned' })
    .first()
    .click();
  await expect(page.getByRole('list', { name: 'Visit tasks' })).toContainText(
    'Assist with bathing',
  );
  await page.getByLabel('New task').fill('Check the smoke alarm');
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByRole('list', { name: 'Visit tasks' })).toContainText(
    'Check the smoke alarm',
  );

  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Offer and notify' }).click();
  await expect(page).toHaveURL(/\/schedule\/open-shifts$/, { timeout: 20_000 }); // offer + broadcast
  await expect(
    page.getByText(/Notified \d+ caregivers?/).or(page.getByRole('list', { name: 'Open shifts' })),
  ).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Open shifts' }).getByText('open', { exact: true }).first(),
  ).toBeVisible();
});

test('the notification bell opens the inbox', async ({ page }) => {
  await signIn(page, 'hha@demo.alora.test');
  await page.getByRole('button', { name: /Notifications/ }).click();
  await expect(page.getByRole('region', { name: 'Notifications' })).toBeVisible();
});
