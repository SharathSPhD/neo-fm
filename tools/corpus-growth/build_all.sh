#!/usr/bin/env bash
# Rebuild the public-domain lyric-reference corpus and the music metadata catalogue. Free: stdlib + mwparserfromhell (+ torch/transformers for the probe).
# Output root: ${OUT:-/mnt/project-files/corpus}. Dumps are untrusted downloads: keep them in their own directory.
set -euo pipefail
OUT=${OUT:-/mnt/project-files/corpus}; W=${W:-/tmp/corpus-work}; H=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$W/dumps" "$W/ws" "$OUT/lyrics-pd" "$OUT/music"
for l in ${LANGS:-hi kn te mr gu}; do
  [ -f "$W/dumps/$l.xml.bz2" ] || curl -sSL -o "$W/dumps/$l.xml.bz2" "https://dumps.wikimedia.org/${l}wikisource/latest/${l}wikisource-latest-pages-articles.xml.bz2"
  python3 -I "$H/wikisource_extract.py" "$W/dumps/$l.xml.bz2" "$l" "$W/ws/$l.jsonl"
  python3 -I "$H/wikisource_pages.py" "$W/dumps/$l.xml.bz2" "$l" "$W/ws/${l}_pages.jsonl"
  python3 -I "$H/pd_gate.py" "$l" "$W/ws/$l.jsonl" "$W/ws/${l}_pages.jsonl" "$OUT/lyrics-pd/$l.jsonl"
done
python3 -I "$H/harvest_gutenberg.py" "$W/ws/en_pg.jsonl" && python3 -I "$H/harvest_en_wikisource.py" "$W/ws/en_ws.jsonl"   # English: see docs/corpus-growth.md for the prose filter applied before en.jsonl
for k in ia commons saraga; do python3 -I "$H/music_catalogue.py" $k "$OUT/music/$k.jsonl"; done
python3 -I "$H/manifest.py" "$OUT/lyrics-pd"
