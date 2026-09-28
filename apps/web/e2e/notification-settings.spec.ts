import { expect, test } from '@playwright/test';

test('a caregiver mutes an alert from the bell’s settings; security alerts stay on', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('rn@demo.alora.test');
  await page.getByLabel('Password').fill('Demo-Password-1!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();

  await page.getByRole('button', { name: /Notifications/ }).click();
  await page.getByRole('region', { name: 'Notifications' }).getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Notification settings' })).toBeVisible({ timeout: 20_000 });

  const assigned = page.getByLabel('A visit is assigned to me: In the app');
  await expect(assigned).toBeChecked();
  await assigned.uncheck();
  await expect(assigned).not.toBeChecked();
  await expect(page.getByLabel('Security and serious-incident alerts: In the app')).toBeDisabled();

  await page.reload();
  await expect(page.getByLabel('A visit is assigned to me: In the app')).not.toBeChecked({ timeout: 15_000 }); // saved
  await page.getByLabel('A visit is assigned to me: In the app').check(); // leave the demo as it was
  await expect(page.getByLabel('A visit is assigned to me: In the app')).toBeChecked();
});
