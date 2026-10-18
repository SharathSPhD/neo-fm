#!/usr/bin/env bash
# Builds a publishable vertical clip: loops a silent-or-ambient Veo clip over the pool song's audio.
# Veo clips carry only their own ambient sound, so the song must be muxed in before upload (found the hard way:
# the first YouTube test had no song). Usage: build-video.sh <veo.mp4> <song-audio-file-or-url> <out.mp4> [seconds=60]
set -euo pipefail
video=${1:?veo clip}; audio=${2:?song audio file or url}; out=${3:?output mp4}; secs=${4:-60}
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
case "$audio" in http*) curl -fsS -o "$tmp/a" "$audio"; audio="$tmp/a" ;; esac
fade=$((secs - 3))
ffmpeg -v error -y -stream_loop -1 -i "$video" -i "$audio" -map 0:v:0 -map 1:a:0 -t "$secs" \
  -af "afade=t=out:st=${fade}:d=3" -c:v libx264 -preset veryfast -crf 24 -pix_fmt yuv420p \
  -c:a aac -b:a 160k -movflags +faststart "$out"
# Guard against shipping a silent video again.
mean=$(ffmpeg -hide_banner -nostats -i "$out" -af volumedetect -vn -f null - 2>&1 | sed -n 's/.*mean_volume: \(-\?[0-9.]*\) dB.*/\1/p')
awk -v m="${mean:--99}" 'BEGIN { if (m < -50) { print "output is silent (mean " m " dB)"; exit 1 } }'
echo "ok: $out (mean volume ${mean} dB)"
