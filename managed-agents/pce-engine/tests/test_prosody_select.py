"""Prosody selection (brief key `prosody_select`): off by default, deterministic, never more than 4 candidates."""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # CI runs pytest from the repo root

from pce.operators.ananda import ananda  # noqa: E402
from pce.operators.lyric_form import form_score  # noqa: E402
from pce.substrate.embed import Embedder  # noqa: E402
ananda_mod = sys.modules["pce.operators.ananda"]  # (the package attribute `ananda` is the function)
from pce.types import Candidate, Constraint  # noqa: E402

ENGINE = Path(__file__).resolve().parent.parent
GOOD = "सपनों की रात आई\nयादों की बात आई\nचाँदनी की छाँव में\nबारिश की चाल में\n"
RAGGED = "रात\nमेरे दिल की गहराइयों में छिपी हुई एक अनकही पुरानी कहानी बार बार लौट आती है\nहाँ\nतुम\n"


def test_form_score_prefers_matched_rhymed_couplets_and_ignores_latin() -> None:
    g, r = form_score(GOOD), form_score(RAGGED)
    assert g is not None and r is not None and g > r + 0.2
    assert form_score("a plain english line\nanother english line") is None
    assert form_score("") is None


def _cand(embed: Embedder, text: str) -> Candidate:
    return Candidate(seed=0, sampler={"tau": 1.0}, tokens=(), text=text, logp=0.0, embedding=embed.encode(text))


def test_ananda_is_unchanged_unless_prosody_select_is_on() -> None:
    embed = Embedder()
    constraint = Constraint(text="four lines, singable", embedding=embed.encode("four lines, singable"), must_avoid=())
    c = _cand(embed, GOOD)
    base = ananda(c, constraint=constraint, embed=embed)
    assert ananda(c, constraint=constraint, embed=embed) == base
    ananda_mod.PROSODY_SELECT = True
    try:
        assert ananda(_cand(embed, GOOD), constraint=constraint, embed=embed) > ananda(_cand(embed, RAGGED), constraint=constraint, embed=embed)
    finally:
        ananda_mod.PROSODY_SELECT = False
    assert ananda(c, constraint=constraint, embed=embed) == base


def test_driver_caps_candidates_at_four_when_prosody_select_is_set(tmp_path: Path) -> None:
    brief = {"topic": "a rainy night", "constraint": "four lines, wistful, singable", "must_avoid": [], "aspects": [], "K": 6, "prosody_select": True}
    (tmp_path / "brief.json").write_text(json.dumps(brief))
    assert subprocess.run([sys.executable, str(ENGINE / "run_cascade.py"), str(tmp_path)], capture_output=True, text=True).returncode == 3
    assert json.loads((tmp_path / "needs.json").read_text())["need"] == 4
    brief.pop("prosody_select")
    (tmp_path / "brief.json").write_text(json.dumps(brief))
    assert subprocess.run([sys.executable, str(ENGINE / "run_cascade.py"), str(tmp_path)], capture_output=True, text=True).returncode == 3
    assert json.loads((tmp_path / "needs.json").read_text())["need"] == 6
