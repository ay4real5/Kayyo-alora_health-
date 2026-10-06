import { expect, test } from '@playwright/test';

const PASSWORD = 'Demo-Password-1!';
/** A tiny FAKE PDF. */
const pdf = (text: string) => ({
  name: `${text.replace(/\W+/g, '-')}.pdf`,
  mimeType: 'application/pdf',
  buffer: Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`),
});

test('a supervisor uploads, signs and replaces a patient document', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('supervisor@demo.alora.test');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome|Good (morning|afternoon|evening)/ })).toBeVisible();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Patients' }).click();
  await page.getByLabel('Search').fill('DEMO-0004');
  const row = page.getByRole('row').filter({ hasText: 'DEMO-0004' });
  await expect(row).toHaveCount(1);
  await row.getByRole('link').first().click();
  await expect(page.getByText('MRN DEMO-0004')).toBeVisible();

  const title = `Admission consent ${Date.now()}`;
  const docs = page.getByRole('list', { name: 'Documents' });
  await page.getByLabel('Document type').selectOption('consent');
  await page.getByLabel('Document title').fill(title);
  await page.getByLabel(/^File/).setInputFiles(pdf('consent'));
  await page.getByRole('button', { name: 'Upload document' }).click();
  const item = docs.getByRole('listitem').filter({ hasText: title });
  await expect(item).toContainText('consent.pdf');

  // Download gives back the file.
  const downloading = page.waitForEvent('download');
  await item.getByRole('button', { name: 'Download' }).click();
  expect((await downloading).suggestedFilename()).toBe('consent.pdf');

  // E-signature: typed name, recorded on the document.
  page.once('dialog', (d) => void d.accept('Sam Supervisor, RN'));
  await item.getByRole('button', { name: 'Sign' }).click();
  await expect(item).toContainText('signed by Sam Supervisor, RN');

  // A corrected copy becomes version 2; the original stays in the history.
  await item.getByLabel(`New version of ${title}`).setInputFiles(pdf('consent corrected'));
  await expect(item).toContainText('v2');
  await expect(item).toContainText('consent-corrected.pdf');
  await expect(item.getByRole('button', { name: 'Sign' })).toBeVisible(); // the new file isn't signed
  await item.getByRole('button', { name: 'History' }).click();
  const versions = item.getByRole('list', { name: 'Versions' });
  await expect(versions.getByRole('listitem')).toHaveCount(2);
  await expect(versions).toContainText('v1 · consent.pdf');
});
