import json, os, sys, tempfile, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ["ARENA_HOME"] = tempfile.mkdtemp()
from arena import store, lyrics, songs, leaderboard, cost  # noqa: E402

D = {d: 3 for d in lyrics.DIMS}


def verdict(a_delta, winner):
    a = dict(D); a["imagery"] += a_delta
    return {"reason": "x", "A": a, "B": D, "winner": winner}


class Lyrics(unittest.TestCase):
    def setUp(self):
        store.write_json("briefs/lyrics.json", [{"id": "hi-1", "lang": "hi", "language": "Hindi", "style": "s", "brief": "b"},
                                                {"id": "ta-1", "lang": "ta", "language": "Tamil", "style": "s", "brief": "b"}])
        store.write_json("entries/lyrics/x.json", {"hi-1": "xa", "ta-1": "xb"})
        store.write_json("entries/lyrics/y.json", {"hi-1": "ya", "ta-1": "yb"})
        open(store.HOME / "battles.jsonl", "w").close()

    def test_parse_skips_prose_and_rejects_bad_scores(self):
        t = "thinking {not json} first\n" + json.dumps(verdict(1, "A"))
        self.assertEqual(lyrics.parse_verdict(t)["winner"], "A")
        bad = verdict(1, "A"); bad["A"]["imagery"] = 9
        self.assertIsNone(lyrics.parse_verdict(json.dumps(bad)))

    def test_jobs_cover_both_orders_and_swap_text(self):
        body = lyrics.make_jobs("x", "y")
        ids = {j["id"] for j in body["jobs"]}
        self.assertEqual(len(ids), 4)
        ab = next(j for j in body["jobs"] if j["id"] == "lyr|x|y|hi-1|ab")["prompt"]
        ba = next(j for j in body["jobs"] if j["id"] == "lyr|x|y|hi-1|ba")["prompt"]
        self.assertLess(ab.index("xa"), ab.index("ya")); self.assertLess(ba.index("ya"), ba.index("xa"))
        self.assertGreater(body["_estimate_usd"], 0)

    def test_pure_position_bias_is_a_tie(self):
        # judge always says "A wins by one point" regardless of content: cancels to a tie
        r = {"lyr|x|y|hi-1|ab": [json.dumps(verdict(1, "A"))], "lyr|x|y|hi-1|ba": [json.dumps(verdict(1, "A"))]}
        out = lyrics.ingest({"results": r}, "x", "y", "t")
        self.assertEqual(out["added"], 1)
        self.assertEqual(store.read_jsonl("battles.jsonl")[0]["score"], 0.5)

    def test_consistent_winner_and_resume(self):
        r = {"lyr|x|y|hi-1|ab": [json.dumps(verdict(2, "A"))],
             "lyr|x|y|hi-1|ba": [json.dumps({**verdict(0, "B"), "B": {**D, "imagery": 5}})]}  # x in slot B wins
        lyrics.ingest(r, "x", "y", "t")
        self.assertEqual(store.read_jsonl("battles.jsonl")[0]["score"], 1.0)
        remaining = {j["id"] for j in lyrics.make_jobs("x", "y")["jobs"]}
        self.assertTrue(all("hi-1" not in i for i in remaining))  # judged briefs are not paid for twice

    def test_unparsed_reported_not_dropped_silently(self):
        r = {"lyr|x|y|hi-1|ab": ["garbage"], "lyr|x|y|hi-1|ba": ["garbage"]}
        self.assertEqual(lyrics.ingest(r, "x", "y", "t"), {"added": 0, "unparsed": ["hi-1"]})


class Songs(unittest.TestCase):
    def test_blend_compares_on_shared_scorers_and_ties_within_margin(self):
        store.write_json("briefs/songs.json", [{"id": "s1", "lang": "hi", "language": "Hindi", "style": "s", "brief": "b"},
                                               {"id": "s2", "lang": "hi", "language": "Hindi", "style": "s", "brief": "b"}])
        store.write_json("entries/songs/p.json", {"s1": {"scores": {"gemini_audio": 4.5, "sung_word_acc": 0.9}},
                                                  "s2": {"scores": {"gemini_audio": 3.0, "audio_quality": 0.5}}})
        store.write_json("entries/songs/q.json", {"s1": {"scores": {"gemini_audio": 3.0, "sung_word_acc": 0.5}},
                                                  "s2": {"scores": {"gemini_audio": 3.02, "sung_word_acc": 0.1}}})
        rows = {r["brief"]: r for r in songs.battles("p", "q", "t")}
        self.assertEqual(rows["s1"]["score"], 1.0)
        self.assertEqual(rows["s2"]["score"], 0.5)  # only gemini_audio shared, 3.0 vs 3.02


class Board(unittest.TestCase):
    def test_cost_and_page(self):
        store.write_json("variants.json", {"x": {"kind": "lyrics", "label": "X", "reference": True}, "y": {"kind": "lyrics", "label": "Y"}})
        store.append_jsonl("costs.jsonl", [{"variant": "x", "brief": "b", "usd": 0.02}, {"variant": "x", "brief": "c", "usd": 0.04}])
        self.assertAlmostEqual(cost.per_variant()["x"]["mean_usd"], 0.03)
        open(store.HOME / "battles.jsonl", "w").close()
        store.append_jsonl("battles.jsonl", [{"kind": "lyrics", "a": "y", "b": "x", "brief": f"b{i}", "score": 1.0, "judge": "j"} for i in range(12)])
        html = leaderboard.page("now")
        self.assertIn("<td>Y", html.replace("<td>1</td><td>", "<td>"))
        self.assertIn("beats reference", html)


if __name__ == "__main__":
    unittest.main()
