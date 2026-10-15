#!/usr/bin/env bash
# One command: start agent, record the demo, mux narration -> out/yieldshifter-demo.mp4
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f out/voice/s9_audit.mp3 ] || node scripts/voice.mjs
node server.js & SRV=$!; trap 'kill $SRV' EXIT; sleep 1
rm -rf out/raw; node scripts/record.mjs && bash scripts/build-video.sh
