# neo-fm pwm-api

Thin FastAPI wrapper around the Pratyabhijñā World Model (PWM) creative-generation backend.

See `serve.py` for endpoints and `../../infra/docker-compose.dgx.yml`
for the deployment config. The wrapper exists so the neo-fm stack can
call PWM with neo-fm's HMAC + StyleFamily vocabulary without
duplicating PWM's heavy ML dependencies into a neo-fm image.

## Endpoints

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /healthz` | none | liveness + `pwm_ready` |
| `GET /v1/health` | none | detailed status incl. upstream PWM health |
| `POST /v1/generate-lyric` | HMAC (ADR 0003) | neo-fm-shaped lyric generation |
| `/pwm/*` | HMAC | original PWM API mounted as-is |

## Local development

```bash
uv sync --all-groups
PWM_SKIP_BACKEND_IMPORT=1 uv run pytest -q
```
