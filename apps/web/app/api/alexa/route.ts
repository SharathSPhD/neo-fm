/**
 * POST /api/alexa -- endpoint for the neo-fm Alexa custom skill (alexa/skill-package). Off unless ALEXA_SKILL_ENABLED=1,
 * so merging it changes nothing in production. Every request is checked as Alexa's docs require before it is handled:
 * the cert-chain signature, the timestamp (150 s) and the skill's own application id (ALEXA_SKILL_ID).
 */
import { NextResponse, type NextRequest } from "next/server";
import { SkillRequestSignatureVerifier, TimestampVerifier } from "ask-sdk-express-adapter";

import { handleAlexa, type AlexaEnvelope } from "@/lib/alexa/skill";
import { poolTrackSource } from "@/lib/alexa/tracks";

export const dynamic = "force-dynamic";

// Module scope so the verifier's certificate cache survives between requests on a warm instance.
const signatureVerifier = new SkillRequestSignatureVerifier();
const timestampVerifier = new TimestampVerifier();

export async function POST(req: NextRequest) {
  if (process.env.ALEXA_SKILL_ENABLED !== "1") return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.text();
  try {
    const headers = Object.fromEntries(req.headers.entries());
    await signatureVerifier.verify(body, headers);
    await timestampVerifier.verify(body);
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  let env: AlexaEnvelope;
  try {
    env = JSON.parse(body) as AlexaEnvelope;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  // Without a configured id the endpoint would answer any Alexa skill that points at it, so fail closed.
  const expected = process.env.ALEXA_SKILL_ID;
  if (!expected || env.context?.System?.application?.applicationId !== expected) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  return NextResponse.json(await handleAlexa(env, { source: poolTrackSource }));
}
