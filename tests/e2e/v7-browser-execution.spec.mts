import { expect, test } from '@playwright/test';
// @ts-expect-error The native execution helper is a plain Node module.
import { installBrowserExecutionAuthorization } from './v7-browser-execution.mjs';
import { USER_UNBOUNDED_EXECUTION_LIMITS, USER_UNBOUNDED_GRANT_VERSION } from '../../src/lib/ai/execution-policy.mjs';

test.use({ launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {} });
test('per-request validation metadata survives scoped route fallback and is stripped from other origins', async ({ context, page, baseURL }) => {
  const previous = process.env.SAITU_AI_EXECUTION_MODE; process.env.SAITU_AI_EXECUTION_MODE = 'user-unbounded';
  const captured: { origin: string; capability: string | undefined }[] = [];
  let issued = 0;
  try {
    await context.route('**/execution-metadata-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><title>Offline execution metadata</title><body><h1>Offline execution metadata</h1></body></html>' }));
    await context.route('**/api/synthetic-execution', async route => {
      captured.push({ origin: new URL(route.request().url()).origin, capability: route.request().headers()['x-saitu-validation-execution'] });
      await route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: '{"synthetic":true}' });
    });
    const metadata = await installBrowserExecutionAuthorization(context, { executionMode: 'user-unbounded', grantVersion: USER_UNBOUNDED_GRANT_VERSION, executionLimits: USER_UNBOUNDED_EXECUTION_LIMITS, maxCalls: null, maxReservedMicros: null }, baseURL, () => `synthetic-metadata-${++issued}`);
    await page.goto(`${baseURL}/execution-metadata-fixture`);
    await expect(page).toHaveTitle('Offline execution metadata');
    for (const url of [`${baseURL}/api/synthetic-execution`, `${baseURL}/api/synthetic-execution`, 'https://external.example/api/synthetic-execution']) {
      await page.evaluate(async url => { const response = await fetch(url); if (!(await response.json()).synthetic) throw new Error('fixture_missing'); }, url);
    }
    expect(captured.map(row => row.capability)).toEqual(['synthetic-metadata-1', 'synthetic-metadata-2', undefined]);
    expect(issued).toBe(2); expect(JSON.stringify(metadata)).not.toContain('synthetic-metadata');
    await expect(page.locator('body')).toContainText('Offline execution metadata');
  } finally { if (previous === undefined) delete process.env.SAITU_AI_EXECUTION_MODE; else process.env.SAITU_AI_EXECUTION_MODE = previous; }
});
