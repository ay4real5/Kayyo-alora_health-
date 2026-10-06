import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const PASSWORD = 'Demo-Password-1!';
const answer271 = readFileSync(join(__dirname, '../../api/src/modules/billing/edi/__fixtures__/271-active.edi'), 'utf8');

test('billing checks a patient’s eligibility: 270 out, 271 back in', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/login');
  await page.getByLabel('Email').fill('billing.staff@demo.alora.test');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome|Good (morning|afternoon|evening)/ })).toBeVisible();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Patients' }).click();
  await page.getByLabel('Search').fill('DEMO-0002');
  const row = page.getByRole('row').filter({ hasText: 'DEMO-0002' });
  await expect(row).toHaveCount(1);
  await row.getByRole('link').first().click();
  await expect(page.getByText('MRN DEMO-0002')).toBeVisible();

  const waiting = page.getByText(/is waiting for the payer/);
  // A click that lands while the patient page is still settling can be lost (seen once in CI): click again until the
  // request goes out, and fail with the API's answer if it's refused.
  await expect(async () => {
    const posted = page.waitForResponse((r) => r.url().endsWith('/billing/eligibility') && r.request().method() === 'POST', { timeout: 5_000 });
    await page.getByRole('button', { name: 'Check eligibility' }).click();
    const response = await posted;
    expect(response.status(), await response.text()).toBe(201);
  }).toPass({ timeout: 30_000 });
  await expect(waiting).toBeVisible({ timeout: 15_000 });
  const trace = (await waiting.locator('.font-mono').textContent())!.trim();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download the 270' }).click();
  expect((await download).suggestedFilename()).toBe(`270-${trace}.x12`);

  await page.getByLabel('271 file').setInputFiles({
    name: 'answer.271',
    mimeType: 'text/plain',
    buffer: Buffer.from(answer271.replaceAll('ELG260928AB12', trace)),
  });
  await expect(page.getByText('VIRGINIA MEDICAID FFS')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Co-pay \$3\.00/)).toBeVisible();
  await expect(waiting).toHaveCount(0);
});
