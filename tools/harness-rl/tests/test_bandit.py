import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bandit import Bandit, Posterior
import replay, sim


class T(unittest.TestCase):
    def test_posterior_ties(self):
        p = Posterior(); p.update(0.5)
        self.assertAlmostEqual(p.mean(), 0.5)

    def test_promote_needs_evidence(self):
        b = Bandit(["x"], seed=1)
        for _ in range(3): b.update("x", 1.0)
        self.assertFalse(b.promote("x"))  # too few battles
        for _ in range(12): b.update("x", 1.0)
        self.assertTrue(b.promote("x"))

    def test_thompson_beats_ab_regret(self):
        truth = {"live": 0.5, "refs": 0.65}
        ab = sum(sim.run_harness("ab", truth, 60, s)[0] for s in range(200))
        ts = sum(sim.run_harness("thompson", truth, 60, s)[0] for s in range(200))
        self.assertLess(ts, ab)

    def test_replay_telugu_is_clean_sweep(self):
        p = replay.per_language("harness-refs", "prod-haiku6-pce-sonnet-polish")
        self.assertGreater(p["te"].mean(), 0.8)
        self.assertLess(p["ta"].mean(), 0.4)

    def test_stated_taste_helps_when_right(self):
        st = {"a": 0.8, "b": 0.3, "c": 0.3}
        good = sum(sim.run_taste("a", st, 15, s) for s in range(200))
        none = sum(sim.run_taste(None, st, 15, s) for s in range(200))
        self.assertGreater(good, none)


if __name__ == "__main__":
    unittest.main()
