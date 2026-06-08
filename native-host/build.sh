#!/usr/bin/env bash
# Cross-compile the native messaging host for all supported platforms.
# Output binaries land in native-host/bin/.
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p bin

build() {
  local goos="$1" goarch="$2" out="$3"
  echo "building $out ($goos/$goarch)"
  GOOS="$goos" GOARCH="$goarch" CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o "bin/$out" .
}

build darwin  arm64 native-host-darwin-arm64
build darwin  amd64 native-host-darwin-amd64
build windows amd64 native-host-windows-amd64.exe
build linux   amd64 native-host-linux-amd64

echo "done -> native-host/bin/"
