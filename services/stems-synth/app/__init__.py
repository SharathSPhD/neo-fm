"""neo-fm stems-synth sidecar (v1.4 Sprint 11).

Stable Audio Open 1.0 wrapped as a HMAC-authenticated FastAPI service.
Exposes `/v1/generate-stem` returning 16-bit / 44.1 kHz WAV bytes for
short clips (4-8s transitions, percussion beds, drone washes).
"""
