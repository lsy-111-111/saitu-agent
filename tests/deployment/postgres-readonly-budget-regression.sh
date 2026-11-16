#!/usr/bin/env bash
set -Eeuo pipefail
umask 022
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
: "${PG_BINDIR:?explicit PostgreSQL binary directory required}"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/saitu-readonly-budget.XXXXXX")"
mkdir -m 0700 "$TEST_ROOT/socket"
cleanup(){ local status=$?; trap - EXIT; "$PG_BINDIR/pg_ctl" -D "$TEST_ROOT/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf -- "$TEST_ROOT"; exit "$status"; };trap cleanup EXIT
"$PG_BINDIR/initdb" -D "$TEST_ROOT/data" --encoding=UTF8 --locale=C --auth=trust >/dev/null
"$PG_BINDIR/pg_ctl" -D "$TEST_ROOT/data" -l "$TEST_ROOT/server.log" -o "-c listen_addresses='' -k '$TEST_ROOT/socket' -p 55441" -w start >/dev/null
export PGHOST="$TEST_ROOT/socket" PGPORT=55441 PGDATABASE=postgres
PSQL=("$PG_BINDIR/psql" -X --set=ON_ERROR_STOP=1 --quiet)
"$PG_BINDIR/createdb" saitu_contract_base
for file in "$REPO_ROOT"/db/migrations/*.sql; do PGDATABASE=saitu_contract_base "${PSQL[@]}" --file="$file" >/dev/null; done
verify(){ PGDATABASE="$1" PGOPTIONS='-c default_transaction_read_only=on' "${PSQL[@]}" --set=expected_session="$(id -un)" --file="$REPO_ROOT/ops/postgresql/verify-production-database-readonly.sql"; }
# Exercise the explicit administrator initializer on this disposable database only.
PGDATABASE=saitu_contract_base "${PSQL[@]}" --command="INSERT INTO ai_spend_budgets(run_id,hard_limit_micros) VALUES('existing-main',300000000),('other-existing',300000000); INSERT INTO ai_spend_ledger(id,run_id,model,effort,operation,price_version,reserved_micros,charged_micros,state) VALUES(gen_random_uuid(),'existing-main','deepseek-flash','max','prior-app-call','test',100,100,'usage_estimated')" >/dev/null
PGDATABASE=saitu_contract_base "${PSQL[@]}" --set=main_run_id=existing-main --file="$REPO_ROOT/ops/postgresql/initialize-spend-authority.sql" >/dev/null
for wrong in missing-run other-existing; do
 if PGDATABASE=saitu_contract_base "${PSQL[@]}" --set=main_run_id="$wrong" --file="$REPO_ROOT/ops/postgresql/initialize-spend-authority.sql" > "$TEST_ROOT/init-negative.log" 2>&1; then printf 'FAIL initializer accepted %s\n' "$wrong"; exit 1; fi
 printf 'PASS initializer rejected %s\n' "$wrong"
done
[ "$(PGDATABASE=saitu_contract_base "${PSQL[@]}" -Atc "SELECT (SELECT run_id FROM ai_spend_authority)='existing-main' AND (SELECT count(*) FROM ai_spend_budgets)=2 AND (SELECT sum(charged_micros) FROM ai_spend_ledger)=100")" = t ]
printf 'PASS initializer preserved existing authority and prior spend\n'
verify saitu_contract_base > "$TEST_ROOT/valid.log" 2>&1 || { cat "$TEST_ROOT/valid.log"; exit 1; }
printf 'PASS valid full readonly production contract\n'
reject(){ local name=$1 sql=$2; "$PG_BINDIR/createdb" --template=saitu_contract_base saitu_contract_mutant; PGDATABASE=saitu_contract_mutant "${PSQL[@]}" --command="$sql" >/dev/null; if verify saitu_contract_mutant > "$TEST_ROOT/mutant.log" 2>&1; then printf 'FAIL accepted %s\n' "$name"; exit 1; fi; printf 'PASS rejected %s: ' "$name"; grep -E 'contract failed|foreign key contract|content column|forbidden content-bearing' "$TEST_ROOT/mutant.log" | head -1; "$PG_BINDIR/dropdb" saitu_contract_mutant; }
reject missing_budget_cap 'ALTER TABLE ai_spend_budgets DROP CONSTRAINT ai_spend_budgets_hard_limit_micros_check'
reject weakened_budget_cap 'ALTER TABLE ai_spend_budgets DROP CONSTRAINT ai_spend_budgets_hard_limit_micros_check; ALTER TABLE ai_spend_budgets ADD CHECK(hard_limit_micros>0 AND hard_limit_micros<=999999999)'
reject unvalidated_budget_cap 'ALTER TABLE ai_spend_budgets DROP CONSTRAINT ai_spend_budgets_hard_limit_micros_check; ALTER TABLE ai_spend_budgets ADD CHECK(hard_limit_micros>0 AND hard_limit_micros<=300000000) NOT VALID'
reject missing_ledger_fk 'ALTER TABLE ai_spend_ledger DROP CONSTRAINT ai_spend_ledger_run_id_fkey'
reject missing_authority_fk 'ALTER TABLE ai_spend_authority DROP CONSTRAINT ai_spend_authority_run_id_fkey'
reject ledger_prompt 'ALTER TABLE ai_spend_ledger ADD COLUMN prompt text'
reject decision_payload 'ALTER TABLE competition_decision_states ADD COLUMN payload text'
reject innocuous_named_plaintext 'ALTER TABLE ai_spend_budgets ADD COLUMN notes text'
reject missing_usage_counter 'ALTER TABLE ai_spend_ledger DROP COLUMN input_tokens'
reject missing_charge_state_constraint 'ALTER TABLE ai_spend_ledger DROP CONSTRAINT ai_spend_ledger_check'
reject missing_iv_constraint 'ALTER TABLE competition_decision_states DROP CONSTRAINT competition_decision_states_iv_check'
printf 'PASS 12 readonly contracts; mutations isolated; no provider calls\n'
