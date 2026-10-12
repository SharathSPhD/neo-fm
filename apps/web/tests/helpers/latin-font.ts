import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";

import type { CardFont } from "@/lib/share/card";

/** next/og's bundled Latin face, for tests that run outside Next. */
export async function latin(): Promise<CardFont[]> {
  const nextDir = dirname(createRequire(import.meta.url).resolve("next/package.json"));
  const buf = await readFile(join(nextDir, "dist/compiled/@vercel/og/noto-sans-v27-latin-regular.ttf"));
  const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return [{ name: "Noto Sans", data, weight: 400, style: "normal" }];
}
