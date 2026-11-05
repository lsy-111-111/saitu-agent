#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ "$#" -eq 0 ] || fail "this helper accepts no arguments"
APP_ENV_READER=/usr/local/lib/resume-ai/validate-app-env.sh
[ -f "$APP_ENV_READER" ] && [ ! -L "$APP_ENV_READER" ] \
  || fail "trusted application environment reader is unavailable"

# Pass the credential only through the environment of this short-lived root
# parser.  Its stdout contains the non-secret role and database names only.
DATABASE_URL="$($APP_ENV_READER get DATABASE_URL)" \
python3 - <<'PY'
import os
import urllib.parse

parsed = urllib.parse.urlsplit(os.environ["DATABASE_URL"])
if parsed.scheme not in {"postgres", "postgresql"}:
    raise SystemExit("DATABASE_URL must use PostgreSQL")
if parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
    raise SystemExit("DATABASE_URL must target the local PostgreSQL service")
if parsed.port not in {None, 5432}:
    raise SystemExit("DATABASE_URL must use the local PostgreSQL port 5432")
if parsed.query or parsed.fragment:
    raise SystemExit("DATABASE_URL query strings and fragments are not approved")
if parsed.username is None or parsed.password is None or not parsed.password:
    raise SystemExit("DATABASE_URL must include the dedicated SCRAM role credential")
role = urllib.parse.unquote(parsed.username)
database = urllib.parse.unquote(parsed.path.removeprefix("/"))
if not role or not database or "/" in database:
    raise SystemExit("DATABASE_URL must identify one role and one database")
print(f"{role}\t{database}", end="")
PY
