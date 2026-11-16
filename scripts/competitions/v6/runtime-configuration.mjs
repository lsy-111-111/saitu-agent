import {canonicalHash} from './frozen-ranking-executor.mjs';
import {readExecutionMode,USER_UNBOUNDED_EXECUTION_MODE,USER_UNBOUNDED_EXECUTION_LIMITS} from '../../../src/lib/ai/execution-policy.mjs';
import {readConfiguredEffortPolicy,resolveDecisionModelSettingsForOperation,effortPolicySha256} from '../../../src/lib/ai/effort-policy.mjs';

// Public execution controls only. Never serialize keys, database URLs, signing
// secrets or arbitrary environment variables into an experiment artifact.
const keys=['AI_PROVIDER','AI_MODEL','AI_COMPETITION_NORMALIZE_MODEL','AI_COMPETITION_RECOMMEND_MODEL',
  'AI_TIMEOUT_MS','AI_REQUEST_DEADLINE_MS','AI_RETRY_MAX_DELAY_MS','AI_TEST_MODE','ALLOW_AI_MOCK',
  'AI_SPEND_RUN_ID','AI_SPEND_PHASE','AI_SPEND_FUNDED_CNY','AI_SPEND_LIMIT_CNY','AI_CALIBRATION_CALL_LIMIT','AI_BUDGET_TIMEZONE',
  'AI_REASONING_EFFORT','SAITU_DECISION_STRATEGY','SAITU_CATALOG_SNAPSHOT_PATH','SAITU_FROZEN_EVIDENCE_INDEX',
  'SAITU_FROZEN_EVIDENCE_INDEX_SHA256','SAITU_FROZEN_EVIDENCE_ROOT','NODE_ENV'];
export function runtimeConfiguration(environment=process.env){
  const executionMode=readExecutionMode(environment),unbounded=executionMode===USER_UNBOUNDED_EXECUTION_MODE;
  const policy=readConfiguredEffortPolicy(environment),rank=resolveDecisionModelSettingsForOperation('competition_v7_rank',policy);
  const mode=rank.thinking==='disabled'?{effortPolicySha256:effortPolicySha256(policy),rankModelSettings:{...rank,wireReasoningEffort:null}}:{};
  const values=Object.fromEntries(keys.map(key=>[key,environment[key]?.trim()??null]));
  // Vite's effective default; make it explicit before its module loader runs.
  values.NODE_ENV=environment.NODE_ENV?.trim()||'development';
  if(unbounded){
    values.SAITU_AI_EXECUTION_MODE=executionMode;
    values.AI_SPEND_LIMIT_CNY=null;values.AI_SPEND_FUNDED_CNY=null;values.AI_CALIBRATION_CALL_LIMIT=null;
  }else{
    const callLimit=environment.AI_CALIBRATION_CALL_LIMIT?.trim()||'100';
    if(!/^[1-9][0-9]*$/.test(callLimit)||!Number.isSafeInteger(Number(callLimit))||Number(callLimit)>100)throw new Error('calibration_call_limit_can_only_lower_100');
    values.AI_CALIBRATION_CALL_LIMIT=callLimit;
  }
  if(environment.AI_API_URL){
    const url=new URL(environment.AI_API_URL);
    if(url.username||url.password||url.search||url.hash)throw new Error('credential_bearing_api_url_not_allowed_in_experiment');
    values.AI_API_URL=url.href;
  }else values.AI_API_URL=null;
  return unbounded?{schemaVersion:'saitu.runtime-configuration.v7.user-unbounded.v1',executionMode,executionLimits:USER_UNBOUNDED_EXECUTION_LIMITS,values,...mode}:{schemaVersion:'saitu.runtime-configuration.v1',values,...mode};
}
export const runtimeConfigurationHash=environment=>canonicalHash(runtimeConfiguration(environment));
