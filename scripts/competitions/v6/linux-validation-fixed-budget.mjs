// Local isolated VM only. Credentials remain in the VM and never enter the output.
import {readFileSync,mkdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
if(process.platform!=='linux')throw Error('Linux validation VM only');
const credentials=JSON.parse(readFileSync(join(homedir(),'saitu-validation/private/database.json'),'utf8'));
if(process.argv.length>2)throw Error('No shared-database setup arguments accepted; tests create administrator-owned disposable databases.');
mkdirSync('artifacts/v6/linux-validation-20261105',{recursive:true});
const env={...process.env,CI:'1',AI_API_KEY:'',AI_PROVIDER:'mock',AI_TEST_MODE:'1',ALLOW_AI_MOCK:'1',RUN_DEEPSEEK_LIVE:'0',RUN_DEEPSEEK_NORMALIZE_LIVE:'0',DATABASE_URL:credentials.runtime,AI_SPEND_TEST_ADMIN_DATABASE_URL:credentials.admin,RUN_SPEND_LEDGER_POSTGRES_TESTS:'1'};
const child=spawn(process.execPath,['node_modules/vitest/vitest.mjs','run','tests/deployment/fixed-verifier-budget.test.ts','tests/deployment/fixed-budget-postgres.integration.test.ts','tests/ai/spend-transport-postgres.integration.test.ts','tests/ai/spend-ordinary-cli.test.ts','tests/ai/spend-ledger-postgres.integration.test.ts','tests/ai/product-observation-postgres.integration.test.ts','--maxWorkers=1','--reporter=json','--outputFile=artifacts/v6/linux-validation-20261105/fixed-budget-pg14.json'],{env,stdio:'inherit'});child.on('exit',code=>process.exitCode=code??1);
