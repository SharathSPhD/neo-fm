/** Deterministic expansion of the frozen pilot set to 30 briefs per language (150 total). Ids are stable; never reorder. */
import { PILOT_BRIEFS, type EvalBrief } from "./briefs";

const LANGS: { code: string; language: string; styles: string[] }[] = [
  { code: "kn", language: "Kannada", styles: ["kannada-light-classical", "kannada-folk", "carnatic"] },
  { code: "ta", language: "Tamil", styles: ["tamil-folk", "carnatic", "tamil-light-classical"] },
  { code: "te", language: "Telugu", styles: ["telugu-keerthana", "carnatic", "telugu-folk"] },
  { code: "hi", language: "Hindi", styles: ["bollywood-ballad", "hindustani", "hindi-folk"] },
  { code: "bn", language: "Bengali", styles: ["bengali-rabindrasangeet", "bengali-folk", "bengali-baul"] },
];
const SCENES = [
  "a mother's lullaby on a hot summer night", "the first day of school for a child", "a fishing village at dawn",
  "a wedding procession arriving at the bride's home", "an old teacher remembered by a former student", "a festival of lamps in the neighbourhood",
  "a farmer praying for a good harvest", "a long-distance love letter read aloud", "a temple bell heard from across the river",
  "a rainy bus ride back to the hometown", "friends parting at a railway station", "a grandmother telling stories at twilight",
  "the quiet pride of a soldier's family", "spring blossoms and a new beginning", "a street singer at a crowded market",
  "a lost childhood home, now sold", "dancers rehearsing before an evening show", "the sea at night and a sailor's longing",
  "a devotional morning prayer in a small shrine", "a harvest-moon night with folk drums", "a bride's farewell to her village",
  "an exhausted city worker dreaming of the village", "a river crossing in monsoon floods", "a mountain village waiting for snow-melt",
];
const MOODS = ["tender", "joyful", "wistful", "devotional", "playful", "bittersweet"];

export function allEvalBriefs(): EvalBrief[] {
  const out = [...PILOT_BRIEFS];
  const have = new Set(out.map((b) => b.id));
  for (const l of LANGS) {
    for (let i = 1; out.filter((b) => b.id.startsWith(l.code + "-")).length < 30; i++) {
      const id = `${l.code}-${i + 2}`; // pilot used -1 and -2
      if (have.has(id)) continue;
      const k = i - 1;
      out.push({ id, language: l.language, style: l.styles[k % l.styles.length]!, text: `A ${MOODS[(k + l.code.length) % MOODS.length]} song about ${SCENES[(k * 7 + l.code.charCodeAt(0)) % SCENES.length]}` });
      have.add(id);
    }
  }
  return out;
}
