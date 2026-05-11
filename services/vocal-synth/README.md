# services/vocal-synth (Phase 7)

Indic singing voice synthesis built on `kenpath/svara-tts`. Takes:

- Melody / F0 contour (from co-composer in Phase 6).
- Phoneme sequence (from AI4Bharat Indic-TTS + IITM Common Label Set G2P in Phase 7a).
- Voice timbre selection.

Produces vocal stems that the mixer in `dgx-worker` overlays on the HeartMuLa instrumental.

Phase 0 is a do-nothing placeholder so the docker-compose service slot exists.
Build is `nvcr.io/nvidia/pytorch:24.08-py3`-based starting Phase 7.
