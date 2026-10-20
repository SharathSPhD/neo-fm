import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from arena import ratings


def synth(p_ab, n=60):
    # deterministic: a wins round(p*n) of n briefs against b
    k = round(p_ab * n)
    return [("a", "b", 1.0 if i < k else 0.0, f"br{i}") for i in range(n)]


class Ratings(unittest.TestCase):
    def test_recovers_order_and_gap(self):
        bt = synth(0.75) + [("b", "c", 1.0 if i < 45 else 0.0, f"br{i}") for i in range(60)]
        elo = ratings.to_elo(ratings.bradley_terry(bt), "c")
        self.assertGreater(elo["a"], elo["b"]); self.assertGreater(elo["b"], elo["c"])
        # 75% win rate is about +191 Elo
        self.assertAlmostEqual(elo["a"] - elo["b"], 191, delta=25)

    def test_undefeated_stays_finite(self):
        elo = ratings.to_elo(ratings.bradley_terry(synth(1.0)))
        self.assertLess(abs(elo["a"] - 1000), 1500)

    def test_ties_are_even(self):
        elo = ratings.to_elo(ratings.bradley_terry([("a", "b", 0.5, f"x{i}") for i in range(20)]))
        self.assertAlmostEqual(elo["a"], elo["b"], places=3)

    def test_interval_separates_clear_gap_not_noise(self):
        rows = ratings.table(synth(0.9), rounds=100)
        self.assertTrue(ratings.beats(rows, "a", "b"))
        rows = ratings.table(synth(0.5), rounds=100)
        self.assertIsNone(ratings.beats(rows, "a", "b"))


if __name__ == "__main__":
    unittest.main()
