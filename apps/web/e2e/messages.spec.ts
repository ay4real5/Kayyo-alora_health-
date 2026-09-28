import { expect, test } from '@playwright/test';

const PASSWORD = 'Demo-Password-1!';

test('office staff read the care-team thread, reply, and start a group message', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('office.staff@demo.alora.test');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();

  // The seeded demo has unread messages for the office.
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByLabel(/unread/)).toBeVisible();
  await nav.getByRole('link', { name: /Messages/ }).click();
  await expect(page.getByRole('heading', { name: 'Messages' })).toBeVisible();

  const list = page.getByRole('list', { name: 'Conversations' });
  await list.getByRole('button', { name: /Care team/ }).click();
  const thread = page.getByRole('list', { name: 'Messages' });
  await expect(thread).toContainText('Client was a little tired today but ate a full lunch.');
  await expect(page.getByText(/· About/)).toBeVisible(); // linked to the patient

  await page.getByLabel('Message', { exact: true }).fill('Noted. I will let the family know.');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(thread).toContainText('Noted. I will let the family know.');

  // Reading both threads clears the badge.
  await list.getByRole('button').filter({ hasNotText: 'Care team' }).first().click();
  await expect(thread).toContainText('Yes, please add it to my schedule.');
  await expect(nav.getByLabel(/unread/)).toHaveCount(0);

  // A new group message with a subject.
  await page.getByRole('button', { name: 'New message' }).click();
  const people = page.getByRole('list', { name: 'People' });
  await expect(people.getByRole('checkbox').nth(1)).toBeVisible();
  await people.getByRole('checkbox').nth(0).check();
  await people.getByRole('checkbox').nth(1).check();
  const subject = `Weekend coverage ${Date.now()}`;
  await page.getByLabel('Subject (optional)').fill(subject);
  await page.getByLabel('Message', { exact: true }).fill('Who can cover Saturday morning?');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('heading', { name: subject })).toBeVisible();
  await expect(thread).toContainText('Who can cover Saturday morning?');
  await expect(list).toContainText(subject);
});
