import { anthropicClient } from "../agent/adapters";
import { screenRights } from "../rights";
import { moderate } from "./moderate";
import { screenText, type Verdict } from "./policy";

/**
 * Screens text before any paid generation. `NEO_FM_MODERATION=rules-only` is a
 * local-dev escape hatch (deterministic rules only); production must not set it.
 */
export async function screenRequest(text: string, kind: "brief" | "lyrics" = "brief", opts: { lang?: string } = {}): Promise<Verdict> {
  // Rights first: deterministic, multilingual, free. Imitating a named artist / reproducing a song never reaches a paid call.
  const rights = screenRights(text, kind, { lang: opts.lang });
  if (!rights.allowed) return { allowed: false, category: rights.category, reason: rights.reason };
  if (process.env.NEO_FM_MODERATION === "rules-only") return screenText(text, kind);
  return moderate(anthropicClient(), text, kind);
}

export { screenText } from "./policy";
export type { Verdict } from "./policy";
