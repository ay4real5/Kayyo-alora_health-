import { expect, test, type Page } from '@playwright/test';
import { wcagViolations } from './axe';

const PASSWORD = 'Demo-Password-1!';

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
}

test('office gives a family member portal access; they sign in, read, and message the care team', async ({ page }) => {
  test.setTimeout(180_000);
  const familyEmail = `family-${Date.now()}@example.test`;
  const docTitle = `Welcome packet ${Date.now()}`;

  // Office: grant access (the temporary password is shown once) and share a document.
  await signIn(page, 'office.staff@demo.alora.test', PASSWORD);
  await expect(page.getByRole('heading', { name: /Welcome|Good (morning|afternoon|evening)/ })).toBeVisible();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Patients' }).click();
  await page.getByLabel('Search').fill('DEMO-0005');
  const row = page.getByRole('row').filter({ hasText: 'DEMO-0005' });
  await expect(row).toHaveCount(1);
  await row.getByRole('link').first().click();
  await expect(page.getByText('MRN DEMO-0005')).toBeVisible();
  // The staff heading reads "Last, First <status>"; the portal says "First Last".
  const [, last, first] = /^(.+?), (\S+)/.exec((await page.getByRole('heading', { level: 1 }).textContent())!.trim())!;
  const patientName = `${first} ${last}`;

  await page.getByLabel('Portal email').fill(familyEmail);
  await page.getByLabel('First name', { exact: true }).fill('Pat');
  await page.getByLabel('Last name', { exact: true }).fill('Family');
  await page.getByRole('button', { name: 'Give portal access' }).click();
  const temporary = (await page.getByLabel('Temporary password').textContent())!.trim();
  expect(temporary).toMatch(/^\S{4}-\S{4}-\S{4}$/);
  await expect(page.getByText('Has not signed in with their own password yet.')).toBeVisible();

  await page.getByLabel('Document type').selectOption('correspondence');
  await page.getByLabel('Document title').fill(docTitle);
  await page.getByLabel(/^File/).setInputFiles({
    name: 'welcome.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n% welcome\n%%EOF\n'),
  });
  await page.getByLabel('Share with the patient/family in the portal').check();
  await page.getByRole('button', { name: 'Upload document' }).click();
  await expect(page.getByRole('list', { name: 'Documents' }).getByRole('listitem').filter({ hasText: docTitle })).toContainText('In portal');
  await signOut(page);

  // Family: first sign-in forces a new password, then the portal.
  await signIn(page, familyEmail, temporary);
  await expect(page).toHaveURL(/\/change-password/, { timeout: 20_000 }); // sign-in + first compile can be slow
  await page.getByLabel('Current password').fill(temporary);
  await page.getByLabel('New password', { exact: true }).fill('Family-Portal-2!');
  await page.getByLabel('Confirm new password').fill('Family-Portal-2!');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page).toHaveURL(/\/portal$/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Hello, Pat' })).toBeVisible();
  await expect(page.getByText(`You are viewing care information for ${patientName}`)).toBeVisible();
  expect(await wcagViolations(page), 'portal home').toEqual([]);

  // Staff pages are off limits.
  await page.goto('/patients');
  await expect(page).toHaveURL(/\/portal$/);

  const portalNav = page.getByRole('navigation', { name: 'Portal' });
  await portalNav.getByRole('link', { name: 'Visits' }).click();
  await expect(page.getByRole('heading', { name: 'Visits', exact: true })).toBeVisible();
  expect(await wcagViolations(page), 'portal visits').toEqual([]);
  await portalNav.getByRole('link', { name: 'Documents' }).click();
  const docs = page.getByRole('list', { name: 'Documents' });
  await expect(docs).toContainText(docTitle);
  expect(await wcagViolations(page), 'portal documents').toEqual([]);
  const downloading = page.waitForEvent('download');
  await docs.getByRole('listitem').filter({ hasText: docTitle }).getByRole('button', { name: 'Download' }).click();
  expect((await downloading).suggestedFilename()).toBe('welcome.pdf');

  await portalNav.getByRole('link', { name: 'Messages' }).click();
  await page.getByLabel('Write to the care team').fill('Thank you! Is the nurse coming this week?');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('list', { name: 'Messages' })).toContainText('Is the nurse coming this week?', {
    timeout: 15_000,
  });
  expect(await wcagViolations(page), 'portal messages').toEqual([]);
  await signOut(page);

  // Office: the message is waiting in Messages, labelled as a portal thread.
  await signIn(page, 'office.staff@demo.alora.test', PASSWORD);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /Messages/ }).click();
  await page.getByRole('list', { name: 'Conversations' }).getByRole('button', { name: new RegExp(`Portal · ${patientName}`) }).click();
  await expect(page.getByText(/the patient's family member reads your replies/)).toBeVisible();
  await expect(page.getByRole('list', { name: 'Messages' })).toContainText('Is the nurse coming this week?');
});
