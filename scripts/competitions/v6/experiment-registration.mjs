import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateBatchPolicy} from "./ranking-batches.mjs";
import {canonicalHash} from './frozen-ranking-executor.mjs';
import {runtimeConfiguration,runtimeConfigurationHash} from './runtime-configuration.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function validateFormalConfig(config) {
  if(config.schemaVersion!=='saitu.ranking-registration-config.v1'||config.purpose!=='ai_proxy_acceptance'||config.phase!=='E2'||config.candidatePolicy!=='full'||config.seed!==Math.floor(config.seed)||config.seed<0||config.seed>4294967295||config.effort!=='max'||config.repeats!==5||JSON.stringify(config.algorithms)!=='["A1","B","C"]'||config.profileCount!==120) throw new Error('formal_ranking_matrix_must_be_120x5x_A1_B_C_max_full');
  for(const key of ['inputSha256','challengeManifestSha256','sourceSnapshotSha256'])if(!/^[a-f0-9]{64}$/.test(config[key]))throw new Error('formal_input_challenge_and_source_hashes_required');
  if (config.batchPolicy !== undefined) {
    validateBatchPolicy(config.batchPolicy);
    if (!config.baselineSelection || !["A1","B"].includes(config.baselineSelection.algorithm) ||
        !/^[a-f0-9]{64}$/.test(config.baselineSelection.sha256) || !config.baselineSelection.path)
      throw new Error("formal_batch_requires_preselected_development_baseline");
  }
  return config;
}
export async function verifyFormalRegistration(options,implementation) {
  if(!options.registration)return null;
  if(!options.open||!options.registrationSha256||!options.output)throw new Error('formal_opening_requires_registration_hash_and_new_output');
  const bytes=await readFile(options.registration);if(sha(bytes)!==options.registrationSha256)throw new Error('formal_registration_hash_mismatch');
  const registration=JSON.parse(bytes),config=validateFormalConfig(registration.config);
  if(registration.schemaVersion!=='saitu.ranking-registration.v1'||registration.inputOpened!==false||registration.implementationSha256!==canonicalHash(implementation))throw new Error('formal_implementation_changed_since_registration');
  if(registration.runtimeConfigurationSha256!==runtimeConfigurationHash())throw new Error('formal_runtime_configuration_changed_since_registration');
  if(config.batchPolicy && !options.deferC) {
    const {verifyPaidCAdmission}=await import("./c-page-admission.mjs");
    await verifyPaidCAdmission(path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../.."),config);
  }
  for(const key of ['phase','candidatePolicy','seed','effort','algorithms'])if(canonicalHash(options[key])!==canonicalHash(config[key]))throw new Error('formal_configuration_changed_since_registration');
  return registration;
}
export function validateFormalProfiles(input) {
  const groups=['software_data','engineering_design','experimental_agriculture','business_practice','survey_education','arts_language'];
  if(input.origin!=='ai_authored_sealed'||input.profiles.length!==120||new Set(input.profiles.map(p=>p.familyId)).size!==120||new Set(input.profiles.map(p=>p.caseId)).size!==120||input.profiles.some(p=>!p.caseId||!p.input||p.profile.schemaVersion!=='saitu.profile.v6')||groups.some(g=>input.profiles.filter(p=>p.taskGroup===g).length!==20))throw new Error('formal_requires_120_canonical_cases_six_independent_groups');
}
async function main(){
  const args=process.argv.slice(2);if(args.length!==4||args[0]!=='--config'||args[2]!=='--output')throw new Error('usage_config_FILE_output_NEW_FILE');
  const config=validateFormalConfig(JSON.parse(await readFile(args[1],'utf8')));
  const {sourceManifest}=await import('./run-experiment.mjs');
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
  if (config.baselineSelection) {
    const {readDevelopmentSelection} = await import("./select-development-baseline.mjs");
    const selected = await readDevelopmentSelection(root, config.baselineSelection);
    if (selected.algorithm !== config.baselineSelection.algorithm) throw new Error("preselected_baseline_mismatch");
  }
  const {default:nextEnv}=await import('@next/env');nextEnv.loadEnvConfig(root);
  const implementation=await sourceManifest(root);
  const runtime=runtimeConfiguration();
  const registration={schemaVersion:'saitu.ranking-registration.v1',registeredAt:new Date().toISOString(),inputOpened:false,config,runtimeConfiguration:runtime,runtimeConfigurationSha256:canonicalHash(runtime),implementationSha256:canonicalHash(implementation),implementation};
  await writeFile(args[3],JSON.stringify(registration,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({path:args[3],sha256:sha(await readFile(args[3])),rankingReports:1800,selectedArmReuseReports:600,otherProductCases:680,labels:'pending'}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
