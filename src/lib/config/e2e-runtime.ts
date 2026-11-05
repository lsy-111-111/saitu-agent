/**
 * Production-build browser tests exercise the real Next route handlers without
 * being allowed to reach production databases or AI/analytics providers. This
 * escape hatch is deliberately absent from the production environment
 * allowlist and requires every independent synthetic-runtime guard.
 */
export function isEphemeralE2eSecurityStateAllowed() {
  return (
    process.env.E2E_ALLOW_EPHEMERAL_SECURITY_STATE === "1" &&
    process.env.AI_PROVIDER === "mock" &&
    process.env.AI_TEST_MODE === "1" &&
    process.env.ALLOW_AI_MOCK === "1" &&
    process.env.NEXT_PUBLIC_AI_TEST_MODE === "1"
  );
}
