# Cloud Run setup — multilingual embedder (≈15 minutes, ~free)

What you get: one small, stateless HTTPS service that turns text into 384‑dim vectors with
`multilingual-e5-small` (ONNX, int8, 100+ languages incl. Kannada/Tamil/Telugu/Hindi/Bengali).
The Pratyabhijna engine in the Managed Agents sandbox calls it to score lyrics. The model is **baked into the
container image at build time** (no download at runtime, no Hugging Face dependency). Scales to zero.

Cost: Cloud Run's monthly free tier (2M requests, 180k vCPU‑s, 360k GiB‑s) comfortably covers thousands of songs.
A GCP project with **billing enabled** is required even for free usage — set the budget alert in step 6.
This is a separate GCP project; it does not touch your Google AI Studio (Lyria) key or its £4 cap.

## 1. Project + billing (console, 3 clicks)
1. https://console.cloud.google.com → project picker → **New project** → name `neo-fm`.
2. Billing → link a billing account to it (free‑trial credit also works).

## 2. Open Cloud Shell (nothing to install locally)
Click the **>_** icon (top right) in the console. Then:
```bash
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
git clone --branch claude/sleepy-keller-8eiz4s https://github.com/SharathSPhD/neo-fm.git
cd neo-fm/services/embedder
```

## 3. Deploy (builds the image in the cloud, downloads the model during the build)
```bash
export EMBED_TOKEN=$(openssl rand -hex 24)
echo "$EMBED_TOKEN"        # <- copy this; it is the shared secret

gcloud run deploy neo-fm-embedder \
  --source . \
  --region asia-south1 \
  --allow-unauthenticated \
  --memory 1Gi --cpu 1 --cpu-boost \
  --concurrency 4 \
  --min-instances 0 --max-instances 3 \
  --timeout 30 \
  --set-env-vars EMBED_TOKEN=$EMBED_TOKEN
```
Accept the prompt to create an Artifact Registry repo. It prints a **Service URL** like
`https://neo-fm-embedder-xxxxx-el.a.run.app`. (`--allow-unauthenticated` only opens the door; every `/embed`
call still needs the bearer token. `--max-instances 3` caps cost and abuse.)

## 4. Smoke test (still in Cloud Shell)
```bash
URL=$(gcloud run services describe neo-fm-embedder --region asia-south1 --format 'value(status.url)')
curl -s -X POST $URL/embed -H "Authorization: Bearer $EMBED_TOKEN" -H "content-type: application/json" -d '{"texts":["hello"]}' | head -c 80
curl -s -X POST $URL/embed -H "Authorization: Bearer $EMBED_TOKEN" -H 'content-type: application/json' \
  -d '{"texts":["ಮಳೆ ಬಂತು ಮನೆ ನೆನಪಾಯ್ತು"]}' | head -c 200
```
Expect a `"dim":384` vector. First call after idle takes a few seconds (cold start).

## 5. Give it to the app (Vercel project → Settings → Environment Variables, **Preview**, mark Sensitive)
| Name | Value |
|---|---|
| `EMBED_URL` | the Service URL from step 3 |
| `EMBED_TOKEN` | the master token from step 3 (the app derives short-lived scoped tokens for agents; the master never enters a sandbox) |

Then redeploy the preview (push any commit, or Deployments → Redeploy). You do **not** need to paste either
value into chat; the app reads them from Vercel.

## 6. Guard rails (2 minutes)
- Billing → **Budgets & alerts** → budget £5/month with alerts at 50/90/100 %.
- To rotate the token: `gcloud run services update neo-fm-embedder --region asia-south1 --update-env-vars EMBED_TOKEN=NEW`, then update Vercel.
- To stop everything: `gcloud run services delete neo-fm-embedder --region asia-south1`.

## Later (optional)
- Move the song worker here too (the Vercel function‑time lever): same pattern, `services/worker/`.
- Reuse the same project for Cloud Storage/CDN for audio if bandwidth becomes the main cost.
