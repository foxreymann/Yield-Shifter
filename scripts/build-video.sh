#!/usr/bin/env bash
# Mux recorded screen + ElevenLabs narration at the logged offsets -> out/yieldshifter-demo.mp4
set -euo pipefail
cd "$(dirname "$0")/.."
args=(-i out/raw.webm); filters=""; labels=""; i=1
while read -r id at; do
  args+=(-i "out/voice/$id.mp3")
  filters+="[$i:a]adelay=${at}|${at},volume=1.0[a$i];"; labels+="[a$i]"; i=$((i+1))
done < <(node -e 'const t=require("./out/timeline.json");t.timeline.forEach(s=>console.log(s.id,s.at))')
n=$((i-1))
len=$(ffprobe -v error -show_entries format=duration -of csv=p=0 out/raw.webm)
ffmpeg -y -loglevel error "${args[@]}" \
  -filter_complex "${filters}${labels}amix=inputs=$n:normalize=0:duration=longest,apad=whole_dur=$len[aout];[0:v]scale=1920:1080:flags=lanczos,fps=30,format=yuv420p[v]" \
  -map "[v]" -map "[aout]" -t "$len" -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k out/yieldshifter-demo.mp4
ffprobe -v error -show_entries format=duration -of csv=p=0 out/yieldshifter-demo.mp4
