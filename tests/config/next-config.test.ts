import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER
} from "next/constants.js";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const nextConfigPath = path.resolve(process.cwd(), "next.config.mjs");

const inspectConfigScript = String.raw`
  import { pathToFileURL } from "node:url";

  const configModule = await import(pathToFileURL(process.argv[1]).href);
  if (typeof configModule.default !== "function") {
    throw new TypeError("next.config.mjs must export a phase-aware config function");
  }

  const config = await configModule.default(process.argv[2]);
  process.stdout.write(JSON.stringify({
    distDir: config.distDir,
    poweredByHeader: config.poweredByHeader,
    hasHeadersHook: typeof config.headers === "function"
  }));
`;

type InspectedConfig = {
  distDir?: unknown;
  poweredByHeader?: unknown;
  hasHeadersHook?: unknown;
};

async function inspectConfig(phase: string, override?: string) {
  const env = { ...process.env };
  if (override === undefined) {
    delete env.NEXT_DIST_DIR;
  } else {
    env.NEXT_DIST_DIR = override;
  }

  const { stdout } = await execFileAsync(
    process.execPath,
    ["--input-type=module", "--eval", inspectConfigScript, nextConfigPath, phase],
    { env }
  );
  return JSON.parse(stdout) as InspectedConfig;
}

async function resolveDistDir(phase: string, override?: string) {
  const result = await inspectConfig(phase, override);

  if (typeof result.distDir !== "string") {
    throw new TypeError("next.config.mjs must return a string distDir");
  }

  return result.distDir;
}

describe("Next.js output directory isolation", () => {
  it("uses .next-dev for the development server by default", async () => {
    await expect(resolveDistDir(PHASE_DEVELOPMENT_SERVER)).resolves.toBe(".next-dev");
  });

  it.each([
    ["production build", PHASE_PRODUCTION_BUILD],
    ["production server", PHASE_PRODUCTION_SERVER]
  ])("uses .next for the %s by default", async (_label, phase) => {
    await expect(resolveDistDir(phase)).resolves.toBe(".next");
  });

  it.each([
    ["development server", PHASE_DEVELOPMENT_SERVER],
    ["production build", PHASE_PRODUCTION_BUILD],
    ["production server", PHASE_PRODUCTION_SERVER]
  ])("lets NEXT_DIST_DIR override the %s output", async (_label, phase) => {
    await expect(resolveDistDir(phase, ".next-custom")).resolves.toBe(".next-custom");
  });
});

describe("Next.js security header ownership", () => {
  it("hides the framework signature and leaves transport headers to the proxy", async () => {
    const config = await inspectConfig(PHASE_PRODUCTION_SERVER);

    expect(config.poweredByHeader).toBe(false);
    expect(config.hasHeadersHook).toBe(false);
  });
});
