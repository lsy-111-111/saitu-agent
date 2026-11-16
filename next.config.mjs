import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";
import { readConfiguredEffortPolicy, effortPolicySha256 } from "./src/lib/ai/effort-policy.mjs";
import {readExecutionMode} from "./src/lib/ai/execution-policy.mjs";
import {readConfiguredDetailLayoutV7} from "./src/lib/competitions/v7/detail-layout.mjs";

/** @type {(phase: string) => import('next').NextConfig} */
const createNextConfig = (phase) => ({
  ...(process.env.SAITU_V7_SOURCE_SHA256 ? {
    env: { SAITU_V7_SOURCE_SHA256: process.env.SAITU_V7_SOURCE_SHA256,
      SAITU_V7_EFFORT_POLICY: JSON.stringify(readConfiguredEffortPolicy()),
      SAITU_V7_EFFORT_POLICY_SHA256: effortPolicySha256(readConfiguredEffortPolicy()),
      SAITU_V7_DETAIL_LAYOUT: readConfiguredDetailLayoutV7(),
      ...(readExecutionMode()==="user-unbounded"?{SAITU_AI_EXECUTION_MODE:readExecutionMode()}:{}) }
  } : {}),
  // Keep development output separate so a production build cannot overwrite
  // assets that a running dev server still references.
  distDir:
    process.env.NEXT_DIST_DIR ??
    (phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next"),
  reactStrictMode: true,
  // Local catalog metadata must replace the previous page's canonical before
  // navigation completes; streaming can leave both canonical links in the DOM.
  htmlLimitedBots: /.*/,
  outputFileTracingIncludes: { "/community/*": ["./private/team-qr/*.png"] },
  // Transport security headers are owned by the reverse proxy. Keeping them
  // out of Next prevents duplicate values after a canary/release switch.
  poweredByHeader: false
});

export default createNextConfig;
