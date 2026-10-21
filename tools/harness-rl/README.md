# harness-rl

Free offline prototype for tuning harness choices with bandits. Design: [DESIGN.md](DESIGN.md).
```sh
cd tools/harness-rl
python3 replay.py     # per-language posterior from the arena's real battles (no model calls)
python3 sim.py        # simulated harness and taste environments
python3 -m unittest discover -s tests
```
Stdlib only; not imported by the web app.
