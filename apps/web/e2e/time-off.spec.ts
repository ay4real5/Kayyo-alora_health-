import { expect, request, test } from '@playwright/test';

const API = (process.env.API_URL ?? 'http://localhost:3001/api/v1') + '/'; // trailing slash so relative paths keep the prefix
const PASSWORD = 'Demo-Password-1!';

/** Log in over the API and return a bearer token (test data setup only — the UI does the real flow). */
async function apiToken(email: string): Promise<string> {
  const api = await request.newContext({ baseURL: API });
  const res = await api.post('auth/login', { data: { email, password: PASSWORD } });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { data: { accessToken: string } };
  await api.dispose();
  return body.data.accessToken;
}

/** A weekday range far enough ahead to never collide with demo data or other runs. */
function futureRange(weeksAhead: number): { startDate: string; endDate: string } {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + weeksAhead * 7);
  start.setUTCDate(start.getUTCDate() + ((3 - start.getUTCDay() + 7) % 7)); // Wednesday
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

test('a supervisor sees a caregiver’s pending time off and approves it', async ({ page }) => {
  // A demo caregiver asks for time off (created over the API; the mobile app is the real client for this).
  const { startDate, endDate } = futureRange(12 + Math.floor(Math.random() * 4)); // fresh dates each run — leftovers block overlaps
  const notes = `E2E ${Date.now()}`;
  const token = await apiToken('hha@demo.alora.test');
  const api = await request.newContext({ baseURL: API, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
  const post = await api.post('time-off', { data: { startDate, endDate, type: 'vacation', notes } });
  expect(post.status()).toBe(201);
  const requestId = ((await post.json()) as { data: { id: string } }).data.id;

  try {
    // The supervisor reviews it on the open-shifts page and approves it; it then leaves the pending list.
    await page.goto('/login');
    await page.getByLabel('Email').fill('supervisor@demo.alora.test');
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: /Welcome|Good (morning|afternoon|evening)/ })).toBeVisible();
    await page.goto('/schedule/open-shifts');

    const row = page.getByRole('list', { name: 'Time off requests' }).getByRole('listitem').filter({ hasText: notes });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Approve' }).click();
    await expect(row).toHaveCount(0);
  } finally {
    // Leave nothing behind: an approved request the dates haven't reached yet can still be cancelled.
    await api.post(`time-off/${requestId}/cancel`).catch(() => undefined);
    await api.dispose();
  }
});
