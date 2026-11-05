#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
OPS_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
CONFIG_FILE="${1:-$OPS_DIR/config/quotas.conf}"
OUTPUT_DIR="${2:-$OPS_DIR/generated}"

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

[ -f "$CONFIG_FILE" ] || fail "quota config does not exist: $CONFIG_FILE"
mkdir -p -- "$OUTPUT_DIR"
OUTPUT_DIR="$(cd -- "$OUTPUT_DIR" && pwd -P)"

SESSION_STARTS_PER_IP_MINUTE=""
SESSION_STARTS_PER_IP_DAY=""
SESSION_TRANSITIONS_PER_SESSION=""
SESSION_TTL_SECONDS=""
MAX_TRACK_PER_IP_MINUTE=""
AI_CONCURRENCY_MAX=""
AI_QUEUE_MAX=""
AI_QUEUE_WAIT_MS=""
AI_REQUEST_DEADLINE_MS=""
AI_PRODUCER_DEADLINE_MS=""
IDEMPOTENCY_FINALIZE_DEADLINE_MS=""
IDEMPOTENCY_DUPLICATE_WAIT_MS=""
APP_RESPONSE_DEADLINE_MS=""
AI_MODEL_CALLS_PER_DAY=""
AI_BUDGET_TIMEZONE=""
NGINX_RECOMMEND_REQUESTS_PER_MINUTE=""
NGINX_RECOMMEND_BURST=""
NGINX_TRACK_REQUESTS_PER_MINUTE=""
NGINX_TRACK_BURST=""
NGINX_API_BODY_LIMIT_KIB=""

set_config_value() {
  local key=$1
  local value=$2
  case "$key" in
    SESSION_STARTS_PER_IP_MINUTE|SESSION_STARTS_PER_IP_DAY|SESSION_TRANSITIONS_PER_SESSION|SESSION_TTL_SECONDS|MAX_TRACK_PER_IP_MINUTE|AI_CONCURRENCY_MAX|AI_QUEUE_MAX|AI_QUEUE_WAIT_MS|AI_REQUEST_DEADLINE_MS|AI_PRODUCER_DEADLINE_MS|IDEMPOTENCY_FINALIZE_DEADLINE_MS|IDEMPOTENCY_DUPLICATE_WAIT_MS|APP_RESPONSE_DEADLINE_MS|AI_MODEL_CALLS_PER_DAY|AI_BUDGET_TIMEZONE|NGINX_RECOMMEND_REQUESTS_PER_MINUTE|NGINX_RECOMMEND_BURST|NGINX_TRACK_REQUESTS_PER_MINUTE|NGINX_TRACK_BURST|NGINX_API_BODY_LIMIT_KIB) ;;
    *) fail "unknown quota key: $key" ;;
  esac
  [ -z "${!key}" ] || fail "duplicate quota key: $key"
  printf -v "$key" '%s' "$value"
}

line_number=0
while IFS= read -r raw_line || [ -n "$raw_line" ]; do
  line_number=$((line_number + 1))
  case "$raw_line" in
    ''|'#'*) continue ;;
  esac
  case "$raw_line" in
    *$'\r'*) fail "CRLF is not accepted at line $line_number" ;;
  esac
  case "$raw_line" in
    *=*) ;;
    *) fail "expected KEY=VALUE at line $line_number" ;;
  esac
  key=${raw_line%%=*}
  value=${raw_line#*=}
  case "$key" in
    [A-Z][A-Z0-9_]*) ;;
    *) fail "invalid key at line $line_number" ;;
  esac
  [ -n "$value" ] || fail "empty value for $key"
  case "$value" in
    *[[:space:]]*) fail "whitespace is not accepted in $key" ;;
  esac
  set_config_value "$key" "$value"
done < "$CONFIG_FILE"

validate_integer() {
  local key=$1
  local minimum=$2
  local maximum=$3
  local value=${!key}
  [ -n "$value" ] || fail "missing quota key: $key"
  case "$value" in
    *[!0-9]*) fail "$key must be an integer" ;;
  esac
  [ "$value" -ge "$minimum" ] && [ "$value" -le "$maximum" ] \
    || fail "$key must be between $minimum and $maximum"
}

validate_integer SESSION_STARTS_PER_IP_MINUTE 1 10000
validate_integer SESSION_STARTS_PER_IP_DAY 1 100000
validate_integer SESSION_TRANSITIONS_PER_SESSION 1 100
validate_integer SESSION_TTL_SECONDS 60 86400
validate_integer MAX_TRACK_PER_IP_MINUTE 1 10000
validate_integer AI_CONCURRENCY_MAX 1 128
validate_integer AI_QUEUE_MAX 1 10000
validate_integer AI_QUEUE_WAIT_MS 100 300000
validate_integer AI_REQUEST_DEADLINE_MS 1000 65000
validate_integer AI_PRODUCER_DEADLINE_MS 1000 65000
validate_integer IDEMPOTENCY_FINALIZE_DEADLINE_MS 1000 65000
validate_integer IDEMPOTENCY_DUPLICATE_WAIT_MS 1000 65000
validate_integer APP_RESPONSE_DEADLINE_MS 1000 65000
validate_integer AI_MODEL_CALLS_PER_DAY 1 1000000
validate_integer NGINX_RECOMMEND_REQUESTS_PER_MINUTE 1 100000
validate_integer NGINX_RECOMMEND_BURST 1 10000
validate_integer NGINX_TRACK_REQUESTS_PER_MINUTE 1 100000
validate_integer NGINX_TRACK_BURST 1 10000
validate_integer NGINX_API_BODY_LIMIT_KIB 1 10240
[ "$AI_REQUEST_DEADLINE_MS" -gt "$AI_QUEUE_WAIT_MS" ] \
  || fail "AI_REQUEST_DEADLINE_MS must exceed AI_QUEUE_WAIT_MS"
[ "$AI_REQUEST_DEADLINE_MS" -lt "$AI_PRODUCER_DEADLINE_MS" ] \
  && [ "$AI_PRODUCER_DEADLINE_MS" -lt "$IDEMPOTENCY_FINALIZE_DEADLINE_MS" ] \
  && [ "$IDEMPOTENCY_FINALIZE_DEADLINE_MS" -lt "$IDEMPOTENCY_DUPLICATE_WAIT_MS" ] \
  && [ "$IDEMPOTENCY_DUPLICATE_WAIT_MS" -lt "$APP_RESPONSE_DEADLINE_MS" ] \
  || fail "application deadline layers must be strictly increasing"
[ "$APP_RESPONSE_DEADLINE_MS" -le 65000 ] \
  || fail "APP_RESPONSE_DEADLINE_MS must preserve ten seconds before the 75s proxy timeout"

case "$AI_BUDGET_TIMEZONE" in
  [A-Za-z_]*'/'[A-Za-z_]*) ;;
  *) fail "AI_BUDGET_TIMEZONE must be an IANA Area/Location name" ;;
esac
QUOTA_GENERATION_SHA256="$(sha256sum "$CONFIG_FILE" | awk '{print $1}')"
[[ "$QUOTA_GENERATION_SHA256" =~ ^[a-f0-9]{64}$ ]] \
  || fail "quota source generation hash is invalid"

temp_dir="$(mktemp -d "$OUTPUT_DIR/.quota-render.XXXXXX")"
cleanup() {
  rm -rf -- "$temp_dir"
}
trap cleanup EXIT

cat > "$temp_dir/application-quota.env" <<EOF
# Generated from ops/config/quotas.conf. Do not edit.
# Quota-Generation-SHA256: $QUOTA_GENERATION_SHA256
SESSION_STARTS_PER_IP_MINUTE=$SESSION_STARTS_PER_IP_MINUTE
SESSION_STARTS_PER_IP_DAY=$SESSION_STARTS_PER_IP_DAY
SESSION_TRANSITIONS_PER_SESSION=$SESSION_TRANSITIONS_PER_SESSION
SESSION_TTL_SECONDS=$SESSION_TTL_SECONDS
MAX_TRACK_PER_IP_MINUTE=$MAX_TRACK_PER_IP_MINUTE
AI_CONCURRENCY_MAX=$AI_CONCURRENCY_MAX
AI_QUEUE_MAX=$AI_QUEUE_MAX
AI_QUEUE_WAIT_MS=$AI_QUEUE_WAIT_MS
AI_REQUEST_DEADLINE_MS=$AI_REQUEST_DEADLINE_MS
AI_PRODUCER_DEADLINE_MS=$AI_PRODUCER_DEADLINE_MS
IDEMPOTENCY_FINALIZE_DEADLINE_MS=$IDEMPOTENCY_FINALIZE_DEADLINE_MS
IDEMPOTENCY_DUPLICATE_WAIT_MS=$IDEMPOTENCY_DUPLICATE_WAIT_MS
APP_RESPONSE_DEADLINE_MS=$APP_RESPONSE_DEADLINE_MS
AI_MODEL_CALLS_PER_DAY=$AI_MODEL_CALLS_PER_DAY
AI_BUDGET_TIMEZONE=$AI_BUDGET_TIMEZONE
EOF

cat > "$temp_dir/00-resume-ai-global.conf" <<EOF
# Generated from ops/config/quotas.conf. Do not edit.
# Quota-Generation-SHA256: $QUOTA_GENERATION_SHA256
limit_req_zone \$binary_remote_addr zone=resume_ai_recommend:20m rate=${NGINX_RECOMMEND_REQUESTS_PER_MINUTE}r/m;
limit_req_zone \$binary_remote_addr zone=resume_ai_track:10m rate=${NGINX_TRACK_REQUESTS_PER_MINUTE}r/m;
map \$http_upgrade \$resume_ai_connection_upgrade {
    default upgrade;
    '' '';
}
map \$host \$resume_ai_quota_generation {
    default "$QUOTA_GENERATION_SHA256";
}
map \$uri \$resume_ai_log_endpoint {
    default other;
    /api/competitions/recommend/normalize competition-normalize;
    /api/ai/competition-clarify competition-clarify;
    /api/ai/competition-recommend competition-recommend;
    /api/track analytics-track;
}
map \$uri \$resume_ai_log_rate_bucket {
    default none;
    /api/competitions/recommend/normalize recommend-ip-minute;
    /api/ai/competition-clarify recommend-ip-minute;
    /api/ai/competition-recommend recommend-ip-minute;
    /api/track track-ip-minute;
}
map \$limit_req_status \$resume_ai_log_stage {
    REJECTED gateway-coarse-limit;
    default upstream-or-handler;
}
map "\$status:\$limit_req_status" \$resume_ai_log_rate_source {
    "429:REJECTED" gateway;
    "429:PASSED" application;
    "429:DELAYED" application;
    "429:" application;
    default none;
}
log_format resume_ai_json escape=json '{"timestamp":"\$time_iso8601","requestId":"\$request_id","method":"\$request_method","uri":"\$uri","endpoint":"\$resume_ai_log_endpoint","stage":"\$resume_ai_log_stage","rateBucket":"\$resume_ai_log_rate_bucket","rateSource":"\$resume_ai_log_rate_source","status":\$status,"bytes":\$body_bytes_sent,"duration":\$request_time,"upstreamStatus":"\$upstream_status","upstreamDuration":"\$upstream_response_time"}';
EOF

cat > "$temp_dir/nginx-quota.inc" <<EOF
# Generated from ops/config/quotas.conf. Do not edit.
# Quota-Generation-SHA256: $QUOTA_GENERATION_SHA256
limit_req zone=resume_ai_recommend burst=$NGINX_RECOMMEND_BURST nodelay;
limit_req_status 429;
client_max_body_size ${NGINX_API_BODY_LIMIT_KIB}k;
EOF

cat > "$temp_dir/nginx-track-quota.inc" <<EOF
# Generated from ops/config/quotas.conf. Do not edit.
# Quota-Generation-SHA256: $QUOTA_GENERATION_SHA256
limit_req zone=resume_ai_track burst=$NGINX_TRACK_BURST nodelay;
limit_req_status 429;
client_max_body_size ${NGINX_API_BODY_LIMIT_KIB}k;
EOF

for generated_file in application-quota.env 00-resume-ai-global.conf nginx-quota.inc nginx-track-quota.inc; do
  chmod 0644 "$temp_dir/$generated_file"
  sync -f "$temp_dir/$generated_file"
done
cat > "$temp_dir/quota-generation.env" <<EOF
SCHEMA_VERSION=1
GENERATION_SHA256=$QUOTA_GENERATION_SHA256
APPLICATION_QUOTA_SHA256=$(sha256sum "$temp_dir/application-quota.env" | awk '{print $1}')
NGINX_GLOBAL_SHA256=$(sha256sum "$temp_dir/00-resume-ai-global.conf" | awk '{print $1}')
NGINX_RECOMMEND_SHA256=$(sha256sum "$temp_dir/nginx-quota.inc" | awk '{print $1}')
NGINX_TRACK_SHA256=$(sha256sum "$temp_dir/nginx-track-quota.inc" | awk '{print $1}')
EOF
chmod 0644 "$temp_dir/quota-generation.env"
sync -f "$temp_dir/quota-generation.env"
sync -f "$temp_dir"

# The manifest is the commit marker. A crash between individual renames leaves
# either the previous manifest or a hash mismatch, so every consumer fails
# closed instead of accepting a mixed generation.
for generated_file in application-quota.env 00-resume-ai-global.conf nginx-quota.inc nginx-track-quota.inc; do
  mv -f -- "$temp_dir/$generated_file" "$OUTPUT_DIR/$generated_file"
  sync -f "$OUTPUT_DIR/$generated_file"
done
mv -f -- "$temp_dir/quota-generation.env" "$OUTPUT_DIR/quota-generation.env"
sync -f "$OUTPUT_DIR/quota-generation.env"
sync -f "$OUTPUT_DIR"

printf '%s\n' "Rendered quota configuration in $OUTPUT_DIR"
