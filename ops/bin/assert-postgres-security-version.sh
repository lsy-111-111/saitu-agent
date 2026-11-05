#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

assert_apt_policy_source() {
  local version=$1 uri=$2 security_suite=$3 approved_suites=$4
  awk -v version="$version" -v uri="$uri" -v security_suite="$security_suite" \
    -v approved_suites="$approved_suites" '
    BEGIN {
      count = split(approved_suites, suite_list, ",")
      for (i = 1; i <= count; i++) approved[suite_list[i]] = 1
    }
    $1 == version || ($1 == "***" && $2 == version) { in_version = 1; next }
    in_version && $1 ~ /^[0-9]+$/ {
      if ($2 ~ /^https?:\/\//) {
        if ($2 != uri || !($3 in approved)) bad = 1
        if ($2 == uri && $3 == security_suite) security_found = 1
      } else if ($2 != "/var/lib/dpkg/status") {
        bad = 1
      }
    }
    in_version && (($1 == "***" && $2 != version) ||
      ($1 != "***" && $1 !~ /^[0-9]+$/)) { in_version = 0 }
    END { exit security_found && !bad ? 0 : 1 }
  '
}

if [ "${1:-}" = --verify-apt-policy-source ]; then
  [ "$#" -eq 6 ] \
    || fail "usage: assert-postgres-security-version.sh --verify-apt-policy-source FILE VERSION URI SECURITY_SUITE APPROVED_SUITES"
  fixture_file=$2
  case "$fixture_file" in /*) ;; *) fail "APT policy fixture path must be absolute" ;; esac
  [ -f "$fixture_file" ] && [ ! -L "$fixture_file" ] \
    || fail "APT policy fixture must be a non-linked regular file"
  assert_apt_policy_source "$3" "$4" "$5" "$6" < "$fixture_file"
  exit 0
fi

[ "${EUID:-$(id -u)}" -eq 0 ] || fail "run as root"
[ "$#" -eq 1 ] || fail "usage: assert-postgres-security-version.sh /absolute/policy"
policy_file=$1
case "$policy_file" in /*) ;; *) fail "PostgreSQL policy path must be absolute" ;; esac
[ -f "$policy_file" ] && [ ! -L "$policy_file" ] \
  && [ "$(stat -c '%h' "$policy_file")" = 1 ] \
  && [ -z "$(find "$policy_file" -perm /022 -print -quit)" ] \
  || fail "PostgreSQL security policy is missing or writable"

declare -A policy=()
while IFS= read -r policy_line || [ -n "$policy_line" ]; do
  case "$policy_line" in ''|'#'*) continue ;; esac
  key=${policy_line%%=*}
  value=${policy_line#*=}
  [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] && [ "$value" != "$policy_line" ] \
    || fail "invalid PostgreSQL policy row"
  case "$key" in
    POSTGRES_MAJOR|POSTGRES_SERVER_VERSION_NUM|POSTGRES_PACKAGE_VERSION|POSTGRES_PACKAGE_ARCHITECTURE|POSTGRES_SERVER_PACKAGE|POSTGRES_CLIENT_PACKAGE|POSTGRES_LIBPQ_PACKAGE|POSTGRES_DATA_DIRECTORY|POSTGRES_PORT|POSTGRES_APT_SECURITY_URI|POSTGRES_APT_SECURITY_SUITE|POSTGRES_APT_APPROVED_SUITES|POSTGRES_SECURITY_REVIEW_BY) ;;
    *) fail "unknown PostgreSQL policy key: $key" ;;
  esac
  [ -z "${policy[$key]:-}" ] || fail "duplicate PostgreSQL policy key: $key"
  policy[$key]=$value
done < "$policy_file"

[ "${policy[POSTGRES_MAJOR]:-}" = 14 ] \
  && [ "${policy[POSTGRES_SERVER_VERSION_NUM]:-}" = 140024 ] \
  && [ "${policy[POSTGRES_PACKAGE_VERSION]:-}" = 14.24-0ubuntu0.22.04.1 ] \
  && [ "${policy[POSTGRES_PACKAGE_ARCHITECTURE]:-}" = amd64 ] \
  && [ "${policy[POSTGRES_SERVER_PACKAGE]:-}" = postgresql-14 ] \
  && [ "${policy[POSTGRES_CLIENT_PACKAGE]:-}" = postgresql-client-14 ] \
  && [ "${policy[POSTGRES_LIBPQ_PACKAGE]:-}" = libpq5 ] \
  && [ "${policy[POSTGRES_DATA_DIRECTORY]:-}" = /var/lib/postgresql/14/main ] \
  && [ "${policy[POSTGRES_PORT]:-}" = 5432 ] \
  && [ "${policy[POSTGRES_APT_SECURITY_URI]:-}" = http://mirrors.tencentyun.com/ubuntu ] \
  && [ "${policy[POSTGRES_APT_SECURITY_SUITE]:-}" = jammy-security/main ] \
  && [ "${policy[POSTGRES_APT_APPROVED_SUITES]:-}" = jammy-security/main,jammy-updates/main ] \
  || fail "PostgreSQL policy is not the reviewed Jammy 14.24 contract"
review_by=${policy[POSTGRES_SECURITY_REVIEW_BY]:-}
[[ "$review_by" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] \
  && [ "$(date -u +%F)" \< "$review_by" ] \
  || fail "PostgreSQL security policy is malformed or expired"

for command_name in apt-cache apt-mark dpkg-query psql runuser; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is unavailable"
done
packages=(
  "${policy[POSTGRES_SERVER_PACKAGE]}"
  "${policy[POSTGRES_CLIENT_PACKAGE]}"
  "${policy[POSTGRES_LIBPQ_PACKAGE]}"
)
held_packages="$(apt-mark showhold)"
for package_name in "${packages[@]}"; do
  if printf '%s\n' "$held_packages" | grep -Fxq "$package_name"; then
    fail "approved PostgreSQL package is held: $package_name"
  fi
  installed_contract="$(dpkg-query -W -f='${Status}\t${Version}\t${Architecture}' "$package_name" 2>/dev/null)" \
    || fail "approved PostgreSQL package is not installed: $package_name"
  [ "$installed_contract" = $'install ok installed\t'"${policy[POSTGRES_PACKAGE_VERSION]}"$'\t'"${policy[POSTGRES_PACKAGE_ARCHITECTURE]}" ] \
    || fail "installed PostgreSQL package differs from the exact security revision: $package_name"
  candidate="$(apt-cache policy "$package_name" | awk '/Candidate:/ { print $2; exit }')"
  [ "$candidate" = "${policy[POSTGRES_PACKAGE_VERSION]}" ] \
    || fail "PostgreSQL APT candidate is stale or unreviewed for $package_name: $candidate"
  apt-cache madison "$package_name" \
    | awk -v version="${policy[POSTGRES_PACKAGE_VERSION]}" '$3 == version { found=1 } END { exit found ? 0 : 1 }' \
    || fail "approved PostgreSQL security revision is absent from APT metadata: $package_name"
  apt_policy="$(apt-cache policy "$package_name")"
  printf '%s\n' "$apt_policy" | assert_apt_policy_source \
    "${policy[POSTGRES_PACKAGE_VERSION]}" \
    "${policy[POSTGRES_APT_SECURITY_URI]}" \
    "${policy[POSTGRES_APT_SECURITY_SUITE]}" \
    "${policy[POSTGRES_APT_APPROVED_SUITES]}" \
    || fail "approved PostgreSQL package is absent from the signed Ubuntu security pocket: $package_name"
done
unset held_packages installed_contract candidate apt_policy

server_contract="$(runuser -u postgres -- env -i PATH=/usr/bin:/bin \
  PGHOST=/var/run/postgresql PGPORT="${policy[POSTGRES_PORT]}" PGUSER=postgres \
  psql --no-psqlrc --tuples-only --no-align --field-separator=$'\t' \
  --command="SELECT current_setting('server_version_num'),inet_server_addr() IS NULL,
    current_setting('data_directory'),current_setting('port'),
    (pg_control_system()).system_identifier::text;")" \
  || fail "approved local PostgreSQL server is unavailable"
IFS=$'\t' read -r server_version_num peer_is_local data_directory server_port system_identifier \
  <<< "$server_contract"
[ "$server_version_num" = "${policy[POSTGRES_SERVER_VERSION_NUM]}" ] \
  && [ "$peer_is_local" = t ] \
  && [ "$data_directory" = "${policy[POSTGRES_DATA_DIRECTORY]}" ] \
  && [ "$server_port" = "${policy[POSTGRES_PORT]}" ] \
  && [[ "$system_identifier" =~ ^[0-9]{10,}$ ]] \
  || fail "live PostgreSQL server differs from the approved local 14.24 cluster"

printf '%s\n' "PostgreSQL 14.24 server, client and libpq packages are exact and unheld."
