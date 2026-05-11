# Phase 0 demo evidence

What's committed here:

- [`phase-0-dgx.txt`](phase-0-dgx.txt) — captured DGX runtime state on the day of bootstrap:
  - `uname -a` confirms Linux 6.17 aarch64 (NVIDIA Spark).
  - `nvidia-smi` confirms NVIDIA GB10 GPU, driver 580.142, CUDA 13.0.
  - `docker --version` 29.2.1.
  - `tailscale status` confirms node membership in the personal tailnet.
  - `node`, `pnpm`, `python3`, `uv`, `gh` versions.
- `phase-0.png` — repo home-page screenshot. To be added after the first push to GitHub renders. Use:

  ```sh
  # After `gh repo create … --push`, capture the rendered home page:
  open https://github.com/SharathSPhD/neo-fm
  # Save the screenshot here as demos/phase-0.png and amend the Phase 0 commit
  # (only if you have NOT pushed yet — otherwise commit fresh).
  ```

Phase 0 gating contract:

1. Tests green: pnpm tests (6) + Python tests (4 song-doc + 3 music-inference) — see CI.
2. Containers build: docker-build CI workflow verifies all three service Dockerfiles build.
3. Endpoint returns real output: `GET /healthz` (music-inference + Next.js `/api/healthz`) verified locally.
4. Demo artifact committed: this file + `phase-0-dgx.txt`.
