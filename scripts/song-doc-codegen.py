#!/usr/bin/env python3
"""
Generates `packages/song-doc/python/neo_fm_song_doc/_generated.py` from
`packages/song-doc/song-doc.schema.json`.

Why a custom codegen instead of `datamodel-code-generator`?

- We only need to handle the small Song Document schema (one root object,
  a handful of nested objects, all enum-typed leaves).
- We want stable output: deterministic ordering, no version stamp, idiomatic
  Pydantic v2 with `ConfigDict(extra="forbid")` and `Field(...)` constraints
  matching the Zod source. A general-purpose generator emits drift on every
  minor upstream tweak.
- CI drift is enforced by running this script and `git diff --exit-code`. A
  bespoke generator is the only way to keep that diff zero.

Cross-field validators (`raga.system` matches `style_family`,
`sum(section.target_seconds) == target_duration_seconds`) live in the
hand-written `models.py` — JSON Schema cannot express them.

Usage:
  python3 scripts/song-doc-codegen.py            # write _generated.py
  python3 scripts/song-doc-codegen.py --check    # exit 1 on drift
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "packages" / "song-doc" / "song-doc.schema.json"
OUT_PATH = (
    ROOT
    / "packages"
    / "song-doc"
    / "python"
    / "neo_fm_song_doc"
    / "_generated.py"
)


HEADER = '''"""
GENERATED FILE — DO NOT EDIT BY HAND.

Run `python3 scripts/song-doc-codegen.py` from the repo root after editing
`packages/song-doc/src/index.ts`. CI verifies this file matches the codegen
output via `python3 scripts/song-doc-codegen.py --check`.

Source of truth: packages/song-doc/song-doc.schema.json (exported from Zod).
Cross-field validators live in `models.py`, not here, because JSON Schema
cannot represent them.
"""

# ruff: noqa: E501, I001
from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field
'''


def _enum_literal(values: list[str | int]) -> str:
    rendered = ", ".join(repr(v) for v in values)
    return f"Literal[{rendered}]"


def _field_constraints(prop: dict[str, object]) -> str:
    parts: list[str] = []
    if "minimum" in prop:
        parts.append(f"ge={prop['minimum']}")
    if "maximum" in prop:
        parts.append(f"le={prop['maximum']}")
    if "minLength" in prop:
        parts.append(f"min_length={prop['minLength']}")
    if "maxLength" in prop:
        parts.append(f"max_length={prop['maxLength']}")
    if "minItems" in prop:
        parts.append(f"min_length={prop['minItems']}")
    if "maxItems" in prop:
        parts.append(f"max_length={prop['maxItems']}")
    if prop.get("format") == "uuid":
        # JSON Schema "format: uuid" — emit a Pydantic UUID pattern. We don't
        # use the uuid.UUID type because that would change the runtime shape
        # of the field (UUID vs str); a pattern keeps the str interface.
        parts.append(
            'pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-'
            '[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"'
        )
    return ", ".join(parts)


def _annotate(
    name: str,
    prop: dict,
    required: bool,
    nested_classes: list[str],
    schema_obj_name: str,
) -> tuple[str, str | None]:
    """Returns (annotation, optional_class_definition)."""
    t = prop.get("type")
    py_type: str
    extra_class: str | None = None

    if "enum" in prop:
        py_type = _enum_literal(prop["enum"])
    elif t == "string":
        py_type = "str"
    elif t == "integer":
        py_type = "int"
    elif t == "number":
        py_type = "float"
    elif t == "boolean":
        py_type = "bool"
    elif t == "object" and "properties" not in prop:
        # Free-form metadata: pydantic dict[str, Any]
        py_type = "dict[str, Any]"
    elif t == "object" and "properties" in prop:
        class_name = _nested_class_name(schema_obj_name, name)
        extra_class = _render_object(class_name, prop)
        py_type = class_name
        nested_classes.append(extra_class)
    elif t == "array":
        items = prop["items"]
        if items.get("type") == "object" and "properties" in items:
            inner = _nested_class_name(schema_obj_name, name, singular=True)
            extra_class = _render_object(inner, items)
            nested_classes.append(extra_class)
            py_type = f"list[{inner}]"
        elif "enum" in items:
            py_type = f"list[{_enum_literal(items['enum'])}]"
        else:
            scalar = items.get("type", "Any")
            scalar_map = {
                "string": "str",
                "integer": "int",
                "number": "float",
                "boolean": "bool",
            }
            py_type = f"list[{scalar_map.get(scalar, 'Any')}]"
    else:
        raise NotImplementedError(f"unsupported property shape: {prop}")

    constraints = _field_constraints(prop)
    if required:
        if constraints:
            rendered = f"{py_type} = Field({constraints})"
        else:
            rendered = py_type
    else:
        if constraints:
            rendered = f"{py_type} | None = Field(default=None, {constraints})"
        else:
            rendered = f"{py_type} | None = None"

    return rendered, extra_class


def _nested_class_name(parent: str, prop_name: str, *, singular: bool = False) -> str:
    if singular and prop_name.endswith("s"):
        prop_name = prop_name[:-1]
    return f"{_pascal(prop_name)}"


def _pascal(s: str) -> str:
    return "".join(p.capitalize() for p in s.replace("_", " ").split())


def _render_object(class_name: str, obj_schema: dict) -> str:
    required = set(obj_schema.get("required", []))
    props: dict[str, dict] = obj_schema.get("properties", {})

    body_lines: list[str] = [
        f"class {class_name}(BaseModel):",
        "    model_config = ConfigDict(extra=\"forbid\")",
        "",
    ]

    nested_classes: list[str] = []
    for prop_name, prop in props.items():
        if "additionalProperties" in prop and prop.get("type") == "object":
            # metadata: dict[str, Any] — handled in _annotate
            pass
        rendered, _extra = _annotate(
            prop_name, prop, prop_name in required, nested_classes, class_name
        )
        body_lines.append(f"    {prop_name}: {rendered}")

    # Indent nested class blocks above the main class so refs resolve at
    # module load. We accumulate them and the caller arranges the order.
    body = "\n".join(body_lines)
    out_blocks = nested_classes + [body]
    return "\n\n\n".join(out_blocks)


def _resolve_top_level(schema: dict) -> dict:
    if "$ref" in schema:
        ref = schema["$ref"]
        assert ref.startswith("#/definitions/")
        key = ref.split("/")[-1]
        return schema["definitions"][key]
    return schema


def _generate(schema: dict) -> str:
    top = _resolve_top_level(schema)
    block = _render_object("_SongDocumentBase", top)
    return HEADER + "\n" + block + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--check",
        action="store_true",
        help="exit 1 if the on-disk _generated.py differs from the codegen output",
    )
    args = ap.parse_args()

    if not SCHEMA_PATH.exists():
        print(
            f"::error::{SCHEMA_PATH} missing; run "
            "`pnpm --filter @neo-fm/song-doc export-schema` first",
            file=sys.stderr,
        )
        return 2

    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    rendered = _generate(schema)

    if args.check:
        if not OUT_PATH.exists():
            print(
                f"::error::{OUT_PATH} missing; run "
                "`python3 scripts/song-doc-codegen.py` and commit the result",
                file=sys.stderr,
            )
            return 1
        on_disk = OUT_PATH.read_text(encoding="utf-8")
        if on_disk != rendered:
            print(
                "::error::song-doc Python codegen is out of sync. "
                "Run `python3 scripts/song-doc-codegen.py` and commit "
                f"{OUT_PATH.relative_to(ROOT)}.",
                file=sys.stderr,
            )
            return 1
        print(f"[song-doc] {OUT_PATH.relative_to(ROOT)} is in sync")
        return 0

    OUT_PATH.write_text(rendered, encoding="utf-8")
    print(f"[song-doc] wrote {OUT_PATH.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
