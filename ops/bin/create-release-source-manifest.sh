#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  printf '%s\n' "ERROR: $*" >&2
  exit 1
}

SOURCE_DIR=${1:-$PWD}
PATHS_OUTPUT=${RELEASE_SOURCE_PATHS_NUL:-}
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
case "$SOURCE_DIR" in /*) ;; *) fail "source path must be absolute" ;; esac
if [ ! -d "$SOURCE_DIR" ] || [ -L "$SOURCE_DIR" ]; then
  fail "source directory is missing or unsafe"
fi
[ -e "$SOURCE_DIR/.git" ] || fail "source directory is not a Git working tree"
if [ -n "$PATHS_OUTPUT" ]; then
  case "$PATHS_OUTPUT" in /*) ;; *) fail "RELEASE_SOURCE_PATHS_NUL must be absolute" ;; esac
  [ ! -e "$PATHS_OUTPUT" ] || fail "source path-list output already exists"
fi

GIT_BIN=${RELEASE_GIT_BIN:-/usr/bin/git}
PYTHON_BIN=${RELEASE_PYTHON_BIN:-/usr/bin/python3}
[ -x "$GIT_BIN" ] || fail "fixed Git executable is missing: $GIT_BIN"
# Ubuntu Jammy intentionally exposes /usr/bin/python3 through a root-owned
# alternatives symlink.  Rejecting the final path merely because it is linked
# makes the reviewed builder impossible to use; prepare separately verifies
# that every fixed executable resolves to root-owned, non-writable bytes.
[ -x "$PYTHON_BIN" ] || fail "fixed Python executable is missing: $PYTHON_BIN"

SOURCE_DIR="$(cd -- "$SOURCE_DIR" && pwd -P)"
temporary_paths="$(mktemp "${TMPDIR:-/tmp}/resume-ai-source-paths.XXXXXX")"
deleted_paths="$(mktemp "${TMPDIR:-/tmp}/resume-ai-deleted-paths.XXXXXX")"
cleanup() { rm -f -- "$temporary_paths" "$deleted_paths"; }
trap cleanup EXIT

# This is the sole release member inventory. It intentionally includes tracked
# modifications and non-ignored untracked source without touching the index.
"$GIT_BIN" -C "$SOURCE_DIR" ls-files --cached --others --exclude-standard -z -- . \
  > "$temporary_paths"
"$GIT_BIN" -C "$SOURCE_DIR" ls-files --deleted -z -- . > "$deleted_paths"

helper_arguments=(
  --source "$SOURCE_DIR"
  --git-paths-nul "$temporary_paths"
  --git-deleted-paths-nul "$deleted_paths"
)
if [ -n "$PATHS_OUTPUT" ]; then
  helper_arguments+=(--write-filtered-paths-nul "$PATHS_OUTPUT")
fi
"$PYTHON_BIN" -I "$SCRIPT_DIR/create-release-source-manifest.py" \
  "${helper_arguments[@]}"
