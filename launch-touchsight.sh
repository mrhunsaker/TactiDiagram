#!/usr/bin/env bash
# Launch TactiDiagram: ./launch-touchsight.sh [desktop|web]
set -euo pipefail

cd "$(dirname "$0")"

MODE="${1:-}"
case "${MODE,,}" in
    desktop) RUN_CMD="npm run desktop" ;;
    web)     RUN_CMD="npm run serve"   ;;
    *)
        echo "Usage: $0 [desktop|web]" >&2
        echo "  desktop - run the Neutralino desktop app" >&2
        echo "  web     - run the dev web server" >&2
        exit 1
        ;;
esac

# Debug logging on by default (override with VERBOSE=0)
if [[ "${VERBOSE:-1}" == "1" ]]; then
    export DEBUG="*"
    export NODE_OPTIONS="${NODE_OPTIONS:-} --trace-warnings"
    set -x
fi

echo "==> Installing dependencies"
npm install
npm ci
npm run vendor

echo "==> Starting TactiDiagram (${MODE})"
exec $RUN_CMD