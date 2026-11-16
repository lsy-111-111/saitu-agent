import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

/** Synthetic values only. No provider call is part of this configuration test. */
export function productionGrantEnvironment({ databaseUrl, runId, policySha256, conditionSha256, phase = 'formal', callLimit = '1' }) {
  return {
    DATABASE_URL: databaseUrl, AI_API_KEY: 'fixture-only-never-dispatched',
    AI_CONSENT_SALT: 'fixture-consent-salt-000000000000000000000000',
    AI_CONVERSATION_SIGNING_SECRET: 'fixture-signing-secret-000000000000000000000000',
    LOG_HASH_SECRET: 'fixture-log-hash-secret-000000000000000000000000',
    SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '',
    NEXT_PUBLIC_SITE_URL: 'https://siyuanjiaxin.com', NEXT_PUBLIC_CONTACT_EMAIL: 'privacy@siyuanjiaxin.com',
    FEATURE_AI: '1', FEATURE_COMPETITION_RECOMMENDER: '1', AI_PROVIDER: 'deepseek',
    AI_MODEL: 'deepseek-flash', AI_COMPETITION_NORMALIZE_MODEL: 'deepseek-flash',
    AI_COMPETITION_CLARIFY_MODEL: 'deepseek-flash', AI_COMPETITION_RECOMMEND_MODEL: 'deepseek-flash',
    AI_REASONING_EFFORT: 'high', AI_SPEND_AUTHORIZED_EFFORT: 'high',
    AI_SPEND_POLICY_SHA256: policySha256, AI_SPEND_HIGH_CONDITION_SHA256: conditionSha256,
    AI_SPEND_RUN_ID: runId, AI_SPEND_PHASE: phase, AI_SPEND_LIMIT_CNY: '1', AI_SPEND_FUNDED_CNY: '1',
    AI_CALIBRATION_CALL_LIMIT: callLimit, AI_TIMEOUT_MS: '30000', AI_RETRY_MAX_DELAY_MS: '5000',
    AI_TEST_MODE: '0', ALLOW_AI_MOCK: '0', NEXT_PUBLIC_AI_TEST_MODE: '0', SAITU_V7_WORKER_CONCURRENCY: '1'
  };
}

export const renderEnvironment = values => `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`;

/** Execute the real CJS parser and whitelist. Redirect only its two fixed env
 * paths to private test files. UID=0 is represented for a non-root local test;
 * actual file kind, link count, group and mode checks remain in the reader. */
export function loadProductionEcosystem({ root, releaseDirectory, appEnvFile, quotaEnvFile, port = '3000' }) {
  const filename = path.join(root, 'ops/pm2/ecosystem.config.cjs');
  const localRequire = createRequire(filename);
  const redirects = new Map([['/etc/resume-ai/app.env', appEnvFile], ['/etc/resume-ai/quota.env', quotaEnvFile]]);
  const target = value => redirects.get(value) || value;
  const fixtureFs = {
    ...fs,
    existsSync: value => fs.existsSync(target(value)),
    readFileSync: (value, ...args) => fs.readFileSync(target(value), ...args),
    lstatSync: value => {
      const metadata = fs.lstatSync(target(value));
      if (redirects.has(value)) metadata.uid = 0;
      return metadata;
    }
  };
  const fixtureModule = { exports: {} };
  runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: name => name === 'node:fs' ? fixtureFs : localRequire(name), module: fixtureModule,
    process: { env: { APP_RELEASE_DIR: releaseDirectory, APP_PORT: port, APP_PROCESS_NAME: `resume-ai-${port}` }, getgid: () => process.getgid() }
  }, { filename });
  return fixtureModule.exports;
}

export function pm2EntriesFromEcosystem(ecosystem, port = '3000') {
  return ecosystem.apps.map(app => ({
    name: app.name, pid: process.pid,
    pm2_env: {
      ...app.env, APP_RELEASE_DIR: app.cwd, APP_PORT: port, APP_PROCESS_NAME: app.name,
      HOME: '/var/lib/resume-ai', PM2_HOME: '/var/lib/resume-ai/.pm2',
      PATH: '/opt/nodejs/current/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      status: 'online', pm_cwd: app.cwd, pm_exec_path: app.script,
      exec_interpreter: app.interpreter, exec_mode: `${app.exec_mode}_mode`, args: app.args,
      instances: app.instances, autorestart: app.autorestart, watch: app.watch, merge_logs: app.combine_logs,
      max_memory_restart: Number(app.max_memory_restart.replace(/M$/u, '')) * 1024 * 1024,
      restart_delay: app.restart_delay, exp_backoff_restart_delay: app.exp_backoff_restart_delay,
      min_uptime: Number(app.min_uptime.replace(/s$/u, '')) * 1000, max_restarts: app.max_restarts,
      kill_timeout: app.kill_timeout, listen_timeout: app.listen_timeout,
      pm_out_log_path: app.out_file, pm_err_log_path: app.error_file
    }
  }));
}
