import { describe, expect, it } from "vitest";

import { embedEngine, embedderUsed, safeEmbedUrl } from "../lib/agent/embed-url";

describe("safeEmbedUrl", () => {
  it("accepts a public https service and normalises it", () => {
    expect(safeEmbedUrl(" https://neo-fm-embedder-abc.a.run.app/ ")).toBe("https://neo-fm-embedder-abc.a.run.app");
  });
  it.each([
    "http://embedder.example.com",
    "https://localhost:8080",
    "https://127.0.0.1",
    "https://169.254.169.254/latest",
    "https://10.0.0.5",
    "https://192.168.1.1",
    "https://172.20.0.1",
    "https://100.64.0.1",
    "https://[::1]",
    "https://user:pw@embedder.example.com",
    "https://db.internal",
    "https://2130706433",
    "file:///etc/passwd",
    "not a url",
    "",
  ])("rejects %s", (u) => expect(safeEmbedUrl(u)).toBeUndefined());
  it("embedEngine needs both a safe url and the master token, and scopes the token", () => {
    const env = { EMBED_URL: "https://e.example.com", EMBED_TOKEN: "m" } as unknown as NodeJS.ProcessEnv;
    expect(embedEngine("job-1", 60, env)?.token.startsWith("v2.")).toBe(true);
    expect(embedEngine("job-1", 60, { ...env, EMBED_URL: "http://e.example.com" } as unknown as NodeJS.ProcessEnv)).toBeUndefined();
    expect(embedEngine("job-1", 60, { EMBED_URL: "https://e.example.com" } as unknown as NodeJS.ProcessEnv)).toBeUndefined();
  });
});

describe("embedderUsed (best-effort embedding)", () => {
  it("is none when no embedder is configured", () => expect(embedderUsed(false, null)).toBe("none"));
  it("is service when the cascade used the service, or ran without a cascade audit", () => {
    expect(embedderUsed(true, { embedder: "multilingual-embedding@service" })).toBe("service");
    expect(embedderUsed(true, null)).toBe("service");
  });
  it("is none when the service refused the token or was down and the engine fell back to the lexical embedder", () => {
    expect(embedderUsed(true, { embedder: "hash-ngram-512" })).toBe("none");
  });
});
