import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

/** @type {(phase: string) => import('next').NextConfig} */
const createNextConfig = (phase) => ({
  // Keep development output separate so a production build cannot overwrite
  // assets that a running dev server still references.
  distDir:
    process.env.NEXT_DIST_DIR ??
    (phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next"),
  reactStrictMode: true,
  outputFileTracingIncludes: { "/community/*": ["./private/team-qr/*.png"] },
  // Transport security headers are owned by the reverse proxy. Keeping them
  // out of Next prevents duplicate values after a canary/release switch.
  poweredByHeader: false
});

export default createNextConfig;
