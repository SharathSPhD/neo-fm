import { describe, it, expect } from "vitest";
import { geminiInteract } from "../lib/gemini/interactions";

function fakeFetch(reply: unknown, seen: { url?: string; body?: Record<string, unknown>; key?: string | null }) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : undefined;
    seen.url = req?.url ?? String(input);
    seen.body = JSON.parse(String(req ? await req.text() : init?.body));
    seen.key = new Headers(req?.headers ?? init?.headers).get("x-goog-api-key");
    return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

const done = (text: string) => ({
  id: "int_1", status: "completed",
  steps: [{ type: "model_output", content: [{ type: "text", text }] }],
  usage: { total_input_tokens: 1200, total_output_tokens: 30, total_thought_tokens: 10, total_cached_tokens: 4 },
});

describe("geminiInteract", () => {
  it("posts to the interactions endpoint with audio input, JSON format and no server retention", async () => {
    const seen: { url?: string; body?: Record<string, unknown>; key?: string | null } = {};
    const r = await geminiInteract({
      apiKey: "k", model: "gemini-test", text: "transcribe", json: true,
      audio: { data: new Uint8Array([1, 2, 3]), mimeType: "audio/mpeg" }, fetchImpl: fakeFetch(done('{"transcript":"x"}'), seen),
    });
    expect(seen.url).toContain("/interactions");
    expect(seen.key).toBe("k");
    expect(seen.body).toMatchObject({ model: "gemini-test", store: false, response_format: { type: "text", mime_type: "application/json" } });
    expect(JSON.stringify(seen.body?.input)).toContain("AQID");
    expect(r.text).toBe('{"transcript":"x"}');
    expect(r.usage).toEqual({ model: "gemini-test", in: 1200, out: 40, cache_read: 4 });
    expect(r.id).toBe("int_1");
  });

  it("sends previous_interaction_id and system_instruction when given", async () => {
    const seen: { body?: Record<string, unknown> } = {};
    await geminiInteract({ apiKey: "k", model: "m", text: "next", system: "be brief", previousInteractionId: "int_0", keep: true, fetchImpl: fakeFetch(done("ok"), seen) });
    expect(seen.body).toMatchObject({ previous_interaction_id: "int_0", system_instruction: "be brief", store: true, input: "next" });
  });

  it("throws on an HTTP error so callers keep their existing failure handling", async () => {
    const bad = (async () => new Response('{"error":{"message":"nope"}}', { status: 500, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    await expect(geminiInteract({ apiKey: "k", model: "m", text: "x", fetchImpl: bad })).rejects.toThrow();
  });
});
