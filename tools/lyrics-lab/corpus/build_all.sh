#!/usr/bin/env bash
# Builds the licence-tracked verse corpus on the training box. Output stays OUT of git (data/ is ignored): per-work licence status is unverified.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/dumps data/out
python -m pip install -q mwparserfromhell
for l in kn ta te hi mr; do
  f=data/dumps/${l}wikisource.xml.bz2
  [ -s "$f" ] || curl -sS -o "$f" "https://dumps.wikimedia.org/${l}wikisource/latest/${l}wikisource-latest-pages-articles.xml.bz2"
  python corpus/build_wikisource.py "$f" "$l" "data/out/${l}.jsonl"
done
python corpus/stanza_filter.py data/out/stanzas.jsonl data/out/{kn,ta,te,hi,mr}.jsonl
python corpus/overlap.py build data/out/stanzas.jsonl data/out/ngram4.txt
echo "done: $(wc -l < data/out/stanzas.jsonl) stanzas"
