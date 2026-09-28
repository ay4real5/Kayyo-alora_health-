import { expect, test } from '@playwright/test';

test('every page carries a nonce-based CSP, and the app runs without violating it', async ({ page }) => {
  test.setTimeout(150_000);
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to (load|execute|connect|apply)/i.test(m.text())) violations.push(m.text());
  });

  const response = await page.goto('/login');
  const csp = response!.headers()['content-security-policy'] ?? '';
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  // A different nonce on every request.
  const again = (await page.request.get('/login')).headers()['content-security-policy'];
  expect(again).not.toBe(csp);

  await page.getByLabel('Email').fill('supervisor@demo.alora.test');
  await page.getByLabel('Password').fill('Demo-Password-1!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible({ timeout: 20_000 });
  const nav = page.getByRole('navigation', { name: 'Main' });

  await nav.getByRole('link', { name: 'Live monitor' }).click(); // Leaflet map + OpenStreetMap tiles + socket
  await expect(page.locator('.leaflet-tile-loaded').first()).toBeVisible({ timeout: 30_000 });
  await nav.getByRole('link', { name: 'Reports' }).click(); // Recharts
  await expect(page.getByRole('img', { name: /Visits per day/ })).toBeVisible({ timeout: 30_000 });
  await nav.getByRole('link', { name: 'Patients' }).click();
  await page.getByRole('row').nth(1).getByRole('link').first().click();
  await expect(page.getByText(/^MRN /)).toBeVisible({ timeout: 20_000 });

  expect(violations).toEqual([]);
});
