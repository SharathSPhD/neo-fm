import { describe, expect, it } from "vitest";
import { generateMusic } from "../lib/agent/lyria";

const audioBody = { candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/mpeg", data: Buffer.from("abc").toString("base64") } }] } }] };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

function setup(responses: Response[]) {
  const log = { reserved: 0, released: 0, calls: 0 };
  const guard = { reserve: async () => { log.reserved++; return true; }, release: async () => { log.released++; } };
  const fetchImpl = (async () => { log.calls++; return responses.shift() ?? json({}, 500); }) as unknown as typeof fetch;
  const run = () => generateMusic({ stylePrompt: "s", lyrics: "l", durationClass: "full" }, { guard, apiKey: "k", fetchImpl, retryDelayMs: 0 });
  return { log, run };
}

describe("generateMusic retries", () => {
  it("recovers from a response with no audio part using one reservation", async () => {
    const { log, run } = setup([json({ candidates: [{ content: { parts: [{ text: "sorry" }] } }] }), json(audioBody)]);
    const r = await run();
    expect(r.audio.byteLength).toBe(3);
    expect(log).toEqual({ reserved: 1, released: 0, calls: 2 });
  });
  it("retries 5xx and releases the reservation when every attempt fails", async () => {
    const { log, run } = setup([json({}, 503), json({}, 503), json({}, 503)]);
    await expect(run()).rejects.toThrow(/503/);
    expect(log).toEqual({ reserved: 1, released: 1, calls: 3 });
  });
  it("does not retry a non-429 client error", async () => {
    const { log, run } = setup([json({ error: "bad" }, 400), json(audioBody)]);
    await expect(run()).rejects.toThrow(/400/);
    expect(log.calls).toBe(1);
    expect(log.released).toBe(1);
  });
});
