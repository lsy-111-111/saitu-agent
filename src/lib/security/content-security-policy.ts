const productionScriptSources = (nonce: string) =>
  `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`;

export function createContentSecurityPolicy(
  nonce: string,
  environment = process.env.NODE_ENV
) {
  const scriptSources = [
    productionScriptSources(nonce),
    // React's development diagnostics use eval. This exception is never
    // emitted by a production build.
    environment === "development" ? "'unsafe-eval'" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return [
    "default-src 'self'",
    scriptSources,
    // A few UI elements use narrowly scoped React style attributes. Scripts
    // remain nonce-only; style-src is kept compatible until those are migrated.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests"
  ].join("; ");
}
