# Shared security-state PostgreSQL verification

The real integration suite is disabled by default because it truncates only the
shared security-state tables in its target database. It refuses to run unless:

- `RUN_POSTGRES_SECURITY_STATE_TESTS=1` is set;
- `POSTGRES_SECURITY_STATE_TEST_DATABASE_URL` identifies the disposable database owner;
- `POSTGRES_SECURITY_STATE_RUNTIME_DATABASE_URL` identifies a different, non-owner login;
- that URL is different from `DATABASE_URL`; and
- the dedicated database name contains `test`, `tmp`, or `scratch`.

The suite applies migrations and clears fixtures only through the owner URL. It
then revokes table `DELETE` from the runtime role, grants only the seven approved
fixed-predicate deletion functions, and runs all application code through the
runtime URL. Never point any variable at the production database. A local
example is:

```sh
createuser --login resume_ai_security_owner
createuser --login resume_ai_security_runtime
createdb --owner=resume_ai_security_owner resume_ai_security_test
psql --dbname=resume_ai_security_test --command='grant connect on database resume_ai_security_test to resume_ai_security_runtime'
export RUN_POSTGRES_SECURITY_STATE_TESTS=1
export POSTGRES_SECURITY_STATE_TEST_DATABASE_URL='postgresql://resume_ai_security_owner:REDACTED@127.0.0.1:5432/resume_ai_security_test'
export POSTGRES_SECURITY_STATE_RUNTIME_DATABASE_URL='postgresql://resume_ai_security_runtime:REDACTED@127.0.0.1:5432/resume_ai_security_test'
unset DATABASE_URL
pnpm exec vitest run tests/security/competition-shared-state-postgres.integration.test.ts
psql "$POSTGRES_SECURITY_STATE_TEST_DATABASE_URL" --no-psqlrc --set=ON_ERROR_STOP=1 \
  --file=db/verification/competition_shared_security_state.sql
psql "$POSTGRES_SECURITY_STATE_TEST_DATABASE_URL" --no-psqlrc --set=ON_ERROR_STOP=1 \
  --file=db/verification/runtime_delete_functions.sql
dropdb resume_ai_security_test
dropuser resume_ai_security_runtime
dropuser resume_ai_security_owner
```

For a production-host gate, first take the approved snapshot, create a separate
temporary database, run the same two checks as the unprivileged application
test role, and drop that temporary database afterward. The suite covers two
fresh module instances (the 3000/3001 canary model), encrypted replay, the
thirteenth session transition, ciphertext row swapping, a 50-session shared NAT,
the 60/61 minute and 600/601 daily boundaries, 8 active plus 32 queued model
calls, safe queue overflow, no-table-DELETE state transitions, queue cleanup,
lease release, and daily-budget persistence.
