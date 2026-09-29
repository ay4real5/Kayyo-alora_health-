import { expect, test } from '@playwright/test';

test('forgot password: from sign-in to a neutral answer; the reset page needs the emailed link', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible();
  await page.getByLabel('Email').fill('nobody@demo.alora.test');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  // Same answer whether or not the account exists; which one depends on whether email is connected (not in CI).
  await expect(page.getByRole('status')).toContainText(/If that address belongs to an Kayo Health account|isn’t set up for your agency/);

  await page.goto('/reset-password');
  await expect(page.getByText('This page needs the link from your reset email.')).toBeVisible();
  await page.goto('/reset-password#token=abc');
  await expect(page.getByLabel('New password', { exact: true })).toBeVisible();
});
