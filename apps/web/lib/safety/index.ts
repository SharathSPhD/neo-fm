import { anthropicClient } from "../agent/adapters";
import { moderate } from "./moderate";
import { screenText, type Verdict } from "./policy";

/**
 * Screens text before any paid generation. `NEO_FM_MODERATION=rules-only` is a
 * local-dev escape hatch (deterministic rules only); production must not set it.
 */
export async function screenRequest(text: string, kind: "brief" | "lyrics" = "brief"): Promise<Verdict> {
  if (process.env.NEO_FM_MODERATION === "rules-only") return screenText(text, kind);
  return moderate(anthropicClient(), text, kind);
}

export { screenText } from "./policy";
export type { Verdict } from "./policy";
