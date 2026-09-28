import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'Demo-Password-1!';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
}

/** A Wednesday far enough ahead that nothing in the demo data is scheduled on it. */
function futureWednesday(weeksAhead: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + weeksAhead * 7);
  d.setUTCDate(d.getUTCDate() + ((3 - d.getUTCDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
}

async function startBooking(page: Page, mrn: string, date: string, start: string, end: string) {
  await page.goto('/schedule/new');
  await page.getByLabel('Patient').fill(mrn);
  await page.getByRole('listbox', { name: 'Matching patients' }).getByRole('option').first().click();
  await page.getByLabel('Visit type').selectOption('home_health_aide');
  const caregiver = page.getByLabel('Caregiver', { exact: true });
  const hhaOption = caregiver.locator('option', { hasText: '(HHA)' }).first();
  await expect(hhaOption).toBeAttached(); // the caregiver list loads asynchronously
  const hha = await hhaOption.getAttribute('value');
  await caregiver.selectOption(hha!);
  await page.getByLabel('Date', { exact: true }).fill(date);
  await page.getByLabel('Start', { exact: true }).fill(start);
  await page.getByLabel('End', { exact: true }).fill(end);
}

test('book, double-book (blocked), override as supervisor, reschedule and cancel', async ({ page }) => {
  const date = futureWednesday(8);

  await signIn(page, 'office.staff@demo.alora.test');
  await startBooking(page, 'DEMO-0006', date, '12:00', '13:00'); // inside the caregiver's stated hours
  await expect(page.getByText('No conflicts.')).toBeVisible();
  await page.getByRole('button', { name: 'Book visit' }).click();
  await expect(page.getByRole('heading', { name: /Home health aide visit/ })).toBeVisible();
  const firstVisitUrl = page.url();

  // Same caregiver, overlapping time: the live check blocks it, and office staff can't override.
  await startBooking(page, 'DEMO-0007', date, '12:30', '13:30');
  await expect(page.getByText(/Blocks booking: The caregiver already has a visit/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Book visit' })).toBeDisabled();
  await expect(page.getByText(/Book anyway/)).toHaveCount(0);

  // A supervisor can override; it goes through.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn(page, 'supervisor@demo.alora.test');
  await startBooking(page, 'DEMO-0007', date, '12:30', '13:30');
  await expect(page.getByText(/Blocks booking/)).toBeVisible();
  await page.getByLabel(/Book anyway/).check();
  await page.getByRole('button', { name: 'Book visit' }).click();
  await expect(page.getByRole('heading', { name: /Home health aide visit/ })).toBeVisible();

  // Reschedule the first visit to a free time, then cancel it with a reason.
  await page.goto(firstVisitUrl);
  await page.getByLabel('Start', { exact: true }).fill('15:00');
  await page.getByLabel('End', { exact: true }).fill('15:45');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText(/3:00 PM–3:45 PM/)).toBeVisible();
  await page.getByLabel('Reason').fill('Family visiting');
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Cancel visit' }).click();
  await expect(page.getByText('cancelled', { exact: true })).toBeVisible();
  await expect(page.getByText('Family visiting')).toBeVisible();
});

test('recurring booking reports what it booked', async ({ page }) => {
  await signIn(page, 'office.staff@demo.alora.test');
  await startBooking(page, 'DEMO-0008', futureWednesday(10), '19:00', '20:00');
  await page.getByLabel('Repeat every week').check();
  await page.getByLabel('Wed').check();
  await page.getByLabel(/number of visits/).fill('2');
  await page.getByRole('button', { name: 'Book recurring visits' }).click();
  await expect(page.getByRole('heading', { name: 'Recurring visits booked' })).toBeVisible();
});

test('the calendar shows the week, and caregivers see only their own visits', async ({ page }) => {
  await signIn(page, 'office.staff@demo.alora.test');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Schedule' }).click();
  await expect(page.getByRole('region')).toHaveCount(7); // Monday–Sunday
  await page.getByRole('button', { name: 'Next week' }).click();
  const count = async () => Number((await page.getByText(/\d+ visits?$/).textContent())!.match(/(\d+) visit/)![1]);
  await expect(page.getByText(/\d+ visits?$/)).toBeVisible(); // loaded (not "loading…")
  const officeCount = await count();
  expect(officeCount).toBeGreaterThan(0); // demo data covers the next two weeks

  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn(page, 'hha@demo.alora.test');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Schedule' }).click();
  await expect(page.getByRole('link', { name: 'Book visit' })).toHaveCount(0);
  await expect(page.getByLabel('Caregiver')).toHaveCount(0);
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(page.getByText(/\d+ visits?$/)).toBeVisible();
  expect(await count()).toBeLessThan(officeCount);
});
