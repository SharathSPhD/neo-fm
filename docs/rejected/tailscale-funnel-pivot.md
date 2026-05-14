# Rejected pivot: Tailscale Funnel + Bearer auth for Vercel→DGX inference

**Status: Rejected for v1.** Archived 2026-05-14.

## Why this exists

This document captures a proposed network pivot — exposing DGX `music-inference`
publicly via Tailscale Funnel and having Vercel functions call it directly with
a bearer token. We considered it as a way to simplify the Vercel↔DGX path.

## Why we did not adopt it

It contradicts the authoritative trust boundary in
[`docs/SPEC.md`](../SPEC.md) §2.1: **cloud → DGX traffic is impossible by
design.** The merged v1 architecture has the DGX worker pulling from `pgmq`
and calling `music-inference` over the internal docker-compose bridge with
HMAC ([ADR 0003](../DECISIONS/0003-internal-api-hmac.md),
[ADR 0004](../DECISIONS/0004-worker-db-role.md)).

Specifically the pivot was rejected because:

1. It puts a DGX-internal secret (the inference auth token) in Vercel env.
   ADR 0003 explicitly forbids this.
2. It opens public ingress to the GPU box, multiplying the attack surface
   for free-tier abuse and prompt injection beyond what HMAC + outbound-only
   covers today.
3. It couples Vercel function timeouts to multi-minute music generation,
   undoing the async pgmq queue design.
4. Funnel quota is metered per-tailnet and would clip streaming WAVs at
   modest volume.

## What we keep from this doc

Two pieces are still useful and should be respected operationally — *not*
as a production architecture, but as a developer-ergonomics constraint:

1. **Day-to-day SSH must not depend on Tailscale.** Use
   `sudo tailscale set --ssh=false` so OpenSSH on the DGX serves port 22
   directly; Cursor / VSCode / `ssh dgx-spark` reach the box over plain LAN.
2. **Tailscale, if used at all in v1, is only for the DGX's outbound paths**
   (e.g. egress hardening to Supabase / Hugging Face), and even that is
   optional. It is *never* the API trust boundary for neo-fm.

The original raw transcript and proposed steps follow for archival reference.
Do not implement them.

---

sharaths@spark-5208:~$ sudo tailscale up --hostname=spark-5208 --advertise-tags=tag:neo-fm-dgx --ssh

[sudo] password for sharaths: 

Error: changing settings via 'tailscale up' requires mentioning all

non-default flags. To proceed, either re-run your command with --reset or

use the command below to explicitly mention the current value of

all non-default settings:

if i enter access policy html, it goes to rules...how to complete this...also verify from your end

	tailscale up --advertise-tags=tag:neo-fm-dgx --hostname=spark-5208 --ssh --operator=sharaths



sharaths@spark-5208:~$ tailscale up --advertise-tags=tag:neo-fm-dgx --hostname=spark-5208 --ssh --operator=sharaths

Tailscale SSH enabled, but access controls don't allow anyone to access this device. Update your tailnet's ACLs at https://tailscale.com/s/ssh-policy

sharaths@spark-5208:~$ 

// Example/default ACLs for unrestricted connections.

{

	// Declare static groups of users. Use autogroups for all users or users with a specific role.

	// "groups": {

	//   "group:example": ["alice@example.com", "bob@example.com"],

	// },



	// Define the tags which can be applied to devices and by which users.

	// "tagOwners": {

	//   "tag:example": ["autogroup:admin"],

	// },



	// Define grants that govern access for users, groups, autogroups, tags,

	// Tailscale IP addresses, and subnet ranges.

	"grants": [

		// Allow all connections.

		// Comment this section out if you want to define specific restrictions.

		{

			"src": ["*"],

			"dst": ["*"],

			"ip":  ["*"],

		},



		// Allow users in "group:example" to access "tag:example", but only from

		// devices that are running macOS and have enabled Tailscale client auto-updating.

		// {"src": ["group:example"], "dst": ["tag:example"], "ip": ["*"], "srcPosture":["posture:autoUpdateMac"]},

	],



	// Define postures that will be applied to all rules without any specific

	// srcPosture definition.

	// "defaultSrcPosture": [

	//      "posture:anyMac",

	// ],



	// Define device posture rules requiring devices to meet

	// certain criteria to access parts of your system.

	// "postures": {

	//      // Require devices running macOS, a stable Tailscale

	//      // version and auto update enabled for Tailscale.

	//  "posture:autoUpdateMac": [

	//      "node:os == 'macos'",

	//      "node:tsReleaseTrack == 'stable'",

	//      "node:tsAutoUpdate",

	//  ],

	//      // Require devices running macOS and a stable

	//      // Tailscale version.

	//  "posture:anyMac": [

	//      "node:os == 'macos'",

	//      "node:tsReleaseTrack == 'stable'",

	//  ],

	// },



	// Define users and devices that can use Tailscale SSH.

	"ssh": [

		// Allow all users to SSH into their own devices in check mode.

		// Comment this section out if you want to define specific restrictions.

		{

			"action": "check",

			"src":    ["autogroup:member"],

			"dst":    ["autogroup:self"],

			"users":  ["autogroup:nonroot", "root"],

		},

	],



	"tagOwners": {

		"tag:neo-fm-dgx": [

			"sharath.ai.colab@gmail.com",

			"autogroup:owner",

			"autogroup:admin",

			"autogroup:tagged",

		],

	},



	// Test access rules every time they're saved.

	// "tests": [

	//   {

	//       "src": "alice@example.com",

	//       "accept": ["tag:example"],

	//       "deny": ["100.101.102.103:443"],

	//   },

	// ],

}

 this already exists on the json page (i haven't added anything yet)...also tailscale for this project was becuase i will route a vercel app to connect to dgx spark for local inference...provide correct direction to enable this use case and use dgx spark normally without any tailscale hassle outside this project

Your Funnel URL will be:

https://spark-5208.tailec14b1.ts.net
That's reachable from any Vercel runtime once Funnel is on. Now the three changes:

1. Replace the tailnet policy
Open Access Controls → JSON editor and replace the entire policy with this. The changes vs. what you have: check → accept for SSH, added nodeAttrs for Funnel, and tightened the SSH dst to also cover the tagged Spark:

{
  "tagOwners": {
    "tag:neo-fm-dgx": ["sharath.ai.colab@gmail.com", "autogroup:admin"]
  },
  "grants": [
    { "src": ["*"], "dst": ["*"], "ip": ["*"] }
  ],
  "nodeAttrs": [
    { "target": ["tag:neo-fm-dgx"], "attr": ["funnel"] }
  ],
  "ssh": [
    {
      "action": "accept",
      "src":    ["autogroup:member"],
      "dst":    ["autogroup:self", "tag:neo-fm-dgx"],
      "users":  ["autogroup:nonroot", "root"]
    }
  ]
}
Save. (Tests run automatically; this should pass.)

2. On the DGX Spark — restore OpenSSH, enable Funnel
tailscale set is the modern surgical command — it only touches the flag you name, so you won't hit the "mention all non-default flags" error again:

sudo tailscale set --ssh=false
sudo tailscale set --advertise-tags=tag:neo-fm-dgx
sudo systemctl enable --now ssh
sudo tailscale funnel --bg 8000
sudo tailscale funnel status
Replace 8000 with whatever port your inference server listens on locally (Ollama default 11434, vLLM default 8000, llama.cpp 8080, etc.). You can also do sudo tailscale funnel --bg 11434 — Funnel maps the public 443 to that local port.

Verify on the Spark:

tailscale status
curl -sI https://localhost/ -k 2>&1 | head -5
curl -sI https://spark-5208.tailec14b1.ts.net/ | head -5
The curl to the public URL should return 200/401/403/etc. depending on your inference server — anything that isn't a connection error means Funnel is working end to end.

3. Inference server — mandatory bearer-token auth
Funnel exposes the URL to the entire public internet. Bearer-token check at the app layer is non-negotiable. Pick a strong token:

TOKEN=$(openssl rand -hex 32)
echo "$TOKEN"
How you enforce it depends on your inference stack:

Ollama: doesn't have native auth; put nginx or caddy in front of it that checks Authorization: Bearer … and proxies to localhost:11434. Then tailscale funnel 8443 (or whichever port caddy listens on).
vLLM (OpenAI-compatible server): launch with --api-key "$TOKEN"; it'll require Authorization: Bearer ….
llama.cpp server: launch with --api-key "$TOKEN".
TGI / Triton / custom FastAPI: add a middleware that 401s without the right Authorization header. Plus IP/rate limiting at the Spark or Cloudflare layer if you want defense-in-depth.
A minimal Caddy fronting Ollama looks like:

:8443 {
  @authed {
    header Authorization "Bearer YOUR_TOKEN_HERE"
  }
  handle @authed {
    reverse_proxy localhost:11434
  }
  respond "Unauthorized" 401
}
Then sudo tailscale funnel --bg 8443.

4. On Vercel — call the Funnel URL from a Function
Set the env vars on the project (Production + Preview + Development) using the Vercel CLI:

vercel link
vercel env add DGX_INFERENCE_URL
vercel env add DGX_INFERENCE_TOKEN
Enter https://spark-5208.tailec14b1.ts.net for the URL and the token from step 3 for the secret. Pull them locally with vercel env pull .env.local.

A minimal Next.js Route Handler that proxies to the Spark:

export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(req: Request) {
  const upstream = await fetch(
    `${process.env.DGX_INFERENCE_URL}/v1/chat/completions`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.DGX_INFERENCE_TOKEN!}`,
        "Content-Type": "application/json",
      },
      body: await req.text(),
    },
  );
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
  });
}
Two production-tightening notes:

runtime = "nodejs" (not "edge") so the streaming body and long timeouts work properly with inference workloads.
maxDuration controls the function timeout; bump it to your model's worst-case generation length. On Fluid Compute / Pro plan this can go higher.
If your client is using the AI SDK, even cleaner — point a custom OpenAI-compatible provider at the Funnel URL:

import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
const dgx = createOpenAI({
  baseURL: `${process.env.DGX_INFERENCE_URL}/v1`,
  apiKey: process.env.DGX_INFERENCE_TOKEN!,
});
const { text } = await generateText({
  model: dgx("llama-3.1-70b-instruct"),
  prompt: "...",
});
5. SSH after all this
After sudo tailscale set --ssh=false on the Spark, tailscaled stops intercepting port 22. OpenSSH on the Spark serves it again and id_dgx works. The ~/.ssh/config override we put in yesterday continues to work as-is:

ssh spark-5208.local 'hostname; uptime'
ssh dgx-spark 'nvidia-smi | head'
And in Cursor: Connect to Host… → spark-5208.local — no Tailscale ACL involvement. Day-to-day SSH is now divorced from the Funnel/Vercel path; the only shared piece is that tailscaled is running.

I'll verify from this end as soon as you've applied step 1 + step 2; just say "done" and I'll re-probe.

A few sharp edges worth flagging up front
Funnel quota. Free-tier Funnel has a per-tailnet quota (currently bytes/month). Streaming long inference responses will count. If you'll be hammering it, watch usage in the admin → Services → Funnel, and consider an OAuth-based mesh approach later.
Funnel always uses 443 publicly. Locally you can map any port. If your inference server returns relative redirects (e.g., to localhost:8000) it'll break — make sure responses are path-relative.
Headers. Funnel forwards X-Forwarded-For and identity headers so your inference server can log requesting Vercel region. Optional but useful for rate-limiting.
Don't tag your Mac. The autogroup:self SSH rule depends on Mac and Spark being owned by the same identity — leave the Mac untagged (it currently is) and only tag the Spark.
Rolling back to no-Tailscale-at-all for SSH is trivial: sudo systemctl disable --now tailscaled (Spark and Mac both work over plain LAN/Internet again, but Funnel stops). No reconfig of Cursor needed since ~/.ssh/config already points to the Tailscale IP — you'd then change HostName 100.98.74.5 to HostName spark-5208.local (or 192.168.0.71) in ~/.ssh/config and you're back on LAN. Not recommended while you're actively using Funnel, but good to know.



now the dgx terminal reads
sharaths@spark-5208:~$ tailscale status
curl -sI https://localhost/ -k 2>&1 | head -5
curl -sI https://spark-5208.tailec14b1.ts.net/ | head -5
100.98.74.5      spark-5208                sharath.ai.colab@  linux    -                                                           
100.109.131.126  nvsync-sharaths-mac-mini  sharath.ai.colab@  macOS    -                                                           
100.86.240.15    sharaths-mac-mini         sharath.ai.colab@  macOS    active; direct 192.168.0.201:41641, tx 65715520 rx 8138992  
100.101.149.68   ss-g22                    sharath.ai.colab@  android  offline, last seen 2d ago                                   
100.118.63.97    zen1                      sharath.ai.colab@  windows  offline, last seen 32d ago                                  

# Funnel on:
#     - https://spark-5208.tailec14b1.ts.net