import { fileURLToPath } from 'node:url';
import { installSourceLoader } from '../../scripts/lib/load-typescript-source.mjs';
import { assertBrowserLiveExecutionMode } from './v7-browser-effort.mjs';

const HEADER = 'X-Saitu-Validation-Execution';
/** Refresh the loopback-bound capability for every local API request. Neither
 * the token nor the signing secret is returned or added to an evidence object. */
export async function installBrowserExecutionAuthorization(context, spend, baseUrl, tokenIssuer) {
  assertBrowserLiveExecutionMode(spend);
  const origin = new URL(baseUrl).origin;
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) throw new Error('loopback_validation_origin_required');
  if (!tokenIssuer) {
    installSourceLoader(fileURLToPath(new URL('../../', import.meta.url)));
    ({ createUserUnboundedValidationTokenV7: tokenIssuer } = await import('../../src/lib/ai/execution-authorization.ts'));
  }
  await context.route('**/api/**', async route => {
    const request = route.request(), headers = { ...request.headers() };
    for (const key of Object.keys(headers)) if (key.toLowerCase() === HEADER.toLowerCase()) delete headers[key];
    if (new URL(request.url()).origin === origin) headers[HEADER] = await tokenIssuer(origin);
    await route.fallback({ headers });
  });
  return { executionMode: spend.executionMode, boundOrigin: origin, header: HEADER, refresh: 'every_local_API_request', tokenPersisted: false };
}
