#!/usr/bin/env bash
# Launch TactiDiagram: ./launch-touchsight.sh [desktop|web]
set -euo pipefail

cd "$(dirname "$0")"

MODE="${1:-}"
case "${MODE,,}" in
    desktop) RUN_CMD="npm run desktop" ;;
    web)     RUN_CMD="npm run serve" ;;
    *)
        echo "Usage: $0 [desktop|web]" >&2
        echo "  desktop - run the Neutralino desktop app" >&2
        echo "  web     - start the web server and open the preferred browser" >&2
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

if [[ "${MODE,,}" == "web" ]]; then
    PORT="${PORT:-5173}"
    URL="http://localhost:${PORT}/"
    echo "==> Starting TactiDiagram web server on $URL"
    node scripts/serve.mjs &
    SERVER_PID=$!
    cleanup() {
        kill "$SERVER_PID" 2>/dev/null || true
    }
    trap cleanup EXIT INT TERM

    # Wait for the local server before opening the browser.
    READY=0
    for _ in {1..60}; do
        if (echo >"/dev/tcp/127.0.0.1/$PORT") >/dev/null 2>&1; then
            READY=1
            break
        fi
        sleep 0.25
    done
    if [[ "$READY" != "1" ]]; then
        echo "Error: TactiDiagram web server did not start on port $PORT." >&2
        exit 1
    fi

    # Prefer Flatpak browsers, in the requested order, before system installs.
    FLATPAK_IDS=(
        "io.github.ungoogled_software.ungoogled_chromium"
        "org.chromium.Chromium"
        "com.microsoft.Edge"
        "com.google.Chrome"
    )
    if command -v flatpak >/dev/null 2>&1; then
        for APP_ID in "${FLATPAK_IDS[@]}"; do
            if flatpak info "$APP_ID" >/dev/null 2>&1; then
                echo "==> Opening TactiDiagram with Flatpak $APP_ID"
                flatpak run "$APP_ID" "$URL" >/dev/null 2>&1 &
                wait "$SERVER_PID"
                exit $?
            fi
        done
    fi

    # Fall back to system-installed browsers, preserving the same priority.
    SYSTEM_BROWSERS=(
        "ungoogled-chromium" "ungoogled_chromium"
        "chromium" "chromium-browser"
        "microsoft-edge" "microsoft-edge-stable" "msedge"
        "google-chrome" "google-chrome-stable" "google-chrome-beta" "chrome"
    )
    for BROWSER in "${SYSTEM_BROWSERS[@]}"; do
        if command -v "$BROWSER" >/dev/null 2>&1; then
            echo "==> Opening TactiDiagram with $BROWSER"
            "$BROWSER" "$URL" >/dev/null 2>&1 &
            wait "$SERVER_PID"
            exit $?
        fi
    done

    echo "Error: No supported browser found. Install Ungoogled Chromium, Chromium, Edge, or Chrome." >&2
    exit 1
fi

echo "==> Starting TactiDiagram (desktop)"
exec $RUN_CMD
