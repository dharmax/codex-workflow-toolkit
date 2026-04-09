#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TOOLKIT_ROOT_FILE="$SKILL_DIR/toolkit-root.txt"

if command -v ai-workflow >/dev/null 2>&1; then
  exec ai-workflow "$@"
fi

if [[ -n "${AI_WORKFLOW_TOOLKIT_ROOT:-}" && -f "${AI_WORKFLOW_TOOLKIT_ROOT}/cli/ai-workflow.mjs" ]]; then
  exec node "${AI_WORKFLOW_TOOLKIT_ROOT}/cli/ai-workflow.mjs" "$@"
fi

if [[ -f "$TOOLKIT_ROOT_FILE" ]]; then
  TOOLKIT_ROOT="$(cat "$TOOLKIT_ROOT_FILE")"
  if [[ -f "${TOOLKIT_ROOT}/cli/ai-workflow.mjs" ]]; then
    exec node "${TOOLKIT_ROOT}/cli/ai-workflow.mjs" "$@"
  fi
fi

echo "ai-workflow wrapper could not find the toolkit CLI." >&2
echo "Install ai-workflow on PATH, or set AI_WORKFLOW_TOOLKIT_ROOT to the toolkit repo root." >&2
exit 1
