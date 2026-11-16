#!/bin/zsh
set -eu
saitu_preview_root="${0:A:h}"
saitu_preview_node="/Users/jiumian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
cd "$saitu_preview_root"
exec "$saitu_preview_node" scripts/competitions/v7/local-preview.mjs "${1:-start}"
