# neo-fm-song-doc (Python)

Pydantic v2 mirror of the canonical [`@neo-fm/song-doc`](../) Zod schema.

Phase 0: hand-written models. Phase 2 replaces this with codegen from the JSON Schema
emitted by `zod-to-json-schema` so both sides stay in lockstep automatically.

## Install (uv)

```sh
uv sync --project packages/song-doc/python
```

## Use

```python
from neo_fm_song_doc import SongDocument

doc = SongDocument.model_validate_json(open("fixtures/carnatic-kalyani.json").read())
print(doc.style_family, len(doc.sections))
```
