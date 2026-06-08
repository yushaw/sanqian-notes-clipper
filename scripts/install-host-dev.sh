#!/usr/bin/env bash
# Dev-only: register the native messaging host manifest so Chrome can launch
# the clipper's Go host. The production app will do this itself later (§4.1 of
# docs/design.md); for development we install it manually.
#
# Usage: scripts/install-host-dev.sh <extension-id>
#   Find <extension-id> at chrome://extensions (enable Developer mode, then
#   "Load unpacked" the output/chrome-mv3 dir; copy the ID shown on the card).
set -euo pipefail

EXT_ID="${1:-}"
if [[ -z "$EXT_ID" ]]; then
  echo "Usage: $0 <extension-id>" >&2
  echo "Get the ID from chrome://extensions after Load unpacked." >&2
  exit 1
fi

HOST_NAME="com.sanqian_notes.native"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

ARCH="$(uname -m)"
case "$ARCH" in
  arm64)  BIN="$ROOT/native-host/bin/native-host-darwin-arm64" ;;
  x86_64) BIN="$ROOT/native-host/bin/native-host-darwin-amd64" ;;
  *) echo "Unsupported arch: $ARCH" >&2; exit 1 ;;
esac

if [[ ! -x "$BIN" ]]; then
  echo "Native host binary missing, building..."
  (cd "$ROOT/native-host" && go build -trimpath -ldflags "-s -w" -o "$BIN" .)
fi

MANIFEST=$(cat <<JSON
{
  "name": "$HOST_NAME",
  "description": "Sanqian Notes Web Clipper native messaging host",
  "path": "$BIN",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXT_ID/"
  ]
}
JSON
)

SUPPORT="$HOME/Library/Application Support"
DIRS=(
  "$SUPPORT/Google/Chrome/NativeMessagingHosts"
  "$SUPPORT/Google/Chrome Beta/NativeMessagingHosts"
  "$SUPPORT/Google/Chrome Canary/NativeMessagingHosts"
  "$SUPPORT/Chromium/NativeMessagingHosts"
  "$SUPPORT/Microsoft Edge/NativeMessagingHosts"
  "$SUPPORT/BraveSoftware/Brave-Browser/NativeMessagingHosts"
)

installed=0
for d in "${DIRS[@]}"; do
  parent="$(dirname "$d")"
  if [[ -d "$parent" ]]; then
    mkdir -p "$d"
    printf '%s\n' "$MANIFEST" > "$d/$HOST_NAME.json"
    echo "installed: $d/$HOST_NAME.json"
    installed=$((installed + 1))
  fi
done

if [[ "$installed" -eq 0 ]]; then
  echo "No Chromium-based browser found under $SUPPORT." >&2
  exit 1
fi

echo
echo "Done."
echo "  host binary : $BIN"
echo "  extension   : $EXT_ID"
echo "Reload the extension at chrome://extensions, then click the toolbar icon."
