/**
 * Raga-led vocal songs for the pool (lab/raga-queue/items.json): hi, ta, te, kn, bn and mr. Punjabi and Gujarati items wait for the engine. Ids are frozen: `raga-<item id>`. Run with pce-eval `set=raga`.
 */
import type { EvalBrief } from "./briefs";

export const RAGA_BRIEFS: EvalBrief[] = [
  { id: "raga-hi-bhairav-bhajan", language: "Hindi", style: "bhajan-hindi", text: "A quiet morning bhajan at sunrise, harmonium and dholak, simple refrain (raga Bhairav)" },
  { id: "raga-hi-bhoopali-bhajan", language: "Hindi", style: "bhajan-hindi", text: "An evening bhajan at lamp-lighting time, peaceful and warm (raga Bhoopali)" },
  { id: "raga-hi-yaman-ghazal", language: "Hindi", style: "ghazal", text: "A slow ghazal about an unsent letter, harmonium, tabla and sarangi (raga Yaman)" },
  { id: "raga-hi-malkauns-night", language: "Hindi", style: "hindustani-thumri", text: "A deep-night song of stillness and quiet, slow and meditative (raga Malkauns)" },
  { id: "raga-hi-desh-monsoon", language: "Hindi", style: "hindustani-seasonal-chaiti-kajri-hori", text: "A monsoon kajri about waiting for rain and a loved one (raga Desh)" },
  { id: "raga-ta-mohanam-kriti", language: "Tamil", style: "carnatic-kriti", text: "A bright devotional Carnatic kriti to Murugan, veena and mridangam (raga Mohanam)" },
  { id: "raga-ta-anandabhairavi-thalattu", language: "Tamil", style: "ta-thalattu", text: "A mother's lullaby, very soft, aararo refrain (raga Anandabhairavi)" },
  { id: "raga-te-hamsadhwani-sankirtana", language: "Telugu", style: "carnatic-annamacharya-sankirtana", text: "A morning Annamayya-style sankirtana, pallavi and two charanams (raga Hamsadhwani)" },
  { id: "raga-te-kalyani-kriti", language: "Telugu", style: "carnatic-kriti", text: "An evening devotional kriti in a grand, calm mood (raga Kalyani)" },
  { id: "raga-kn-mayamalavagowla-dasara", language: "Kannada", style: "kn-dasara-padagalu", text: "A Dasara pada in plain Kannada, tambura and taal (raga Mayamalavagowla)" },
  { id: "raga-kn-bhoopalam-bhavageethe", language: "Kannada", style: "kn-bhavageethe", text: "A bhavageethe about the first light of morning, poem-like (raga Bhoopalam)" },
  { id: "raga-bn-bhairavi-rabindra", language: "Bengali", style: "bn-rabindrasangeet", text: "A Rabindrasangeet-style song of an early autumn morning (raga Bhairavi)" },
  { id: "raga-bn-desh-monsoon", language: "Bengali", style: "bn-rabindrasangeet", text: "A Rabindrasangeet-style monsoon song, rain on the window (raga Desh)" },
  { id: "raga-mr-bhoopali-abhang", language: "Marathi", style: "mr-abhang", text: "A Varkari abhang with taal and mridanga, group refrain (raga Bhoopali)" },
  { id: "raga-mr-bhimpalasi-bhavgeet", language: "Marathi", style: "mr-bhavgeet", text: "A bhavgeet about an afternoon in a grandmother's courtyard (raga Bhimpalasi)" },
  { id: "raga-kn-hamsadhwani-dasara", language: "Kannada", style: "kn-dasara-padagalu", text: "A Purandara Dasa-style pada at sunrise in plain Kannada, tambura and cymbals (raga Hamsadhwani)" },
  { id: "raga-kn-kalyani-bhavageethe", language: "Kannada", style: "kn-bhavageethe", text: "A bhavageethe at lamp-lighting time, soft and warm, about evening in the village (raga Kalyani)" },
  { id: "raga-kn-shankarabharana-keerthane", language: "Kannada", style: "kn-dasara-padagalu", text: "A bright morning devotional keerthane to Krishna, violin and mridanga (raga Shankarabharana)" },
  { id: "raga-hi-bageshri-thumri", language: "Hindi", style: "hindustani-thumri", text: "A thumri of waiting at midnight for someone who promised to come, harmonium and tabla (raga Bageshri)" },
  { id: "raga-hi-bhimpalasi-bhajan", language: "Hindi", style: "bhajan-hindi", text: "A gentle afternoon-to-evening bhajan, harmonium and dholak, simple refrain (raga Bhimpalasi)" },
];

/** Item id -> raga, for tagging after admission. */
export const RAGA_OF: Record<string, string> = {
  "raga-hi-bhairav-bhajan": "Bhairav",
  "raga-hi-bhoopali-bhajan": "Bhoopali",
  "raga-hi-yaman-ghazal": "Yaman",
  "raga-hi-malkauns-night": "Malkauns",
  "raga-hi-desh-monsoon": "Desh",
  "raga-ta-mohanam-kriti": "Mohanam",
  "raga-ta-anandabhairavi-thalattu": "Anandabhairavi",
  "raga-te-hamsadhwani-sankirtana": "Hamsadhwani",
  "raga-te-kalyani-kriti": "Kalyani",
  "raga-kn-mayamalavagowla-dasara": "Mayamalavagowla",
  "raga-kn-bhoopalam-bhavageethe": "Bhoopalam",
  "raga-bn-bhairavi-rabindra": "Bhairavi",
  "raga-bn-desh-monsoon": "Desh",
  "raga-mr-bhoopali-abhang": "Bhoopali",
  "raga-mr-bhimpalasi-bhavgeet": "Bhimpalasi",
  "raga-kn-hamsadhwani-dasara": "Hamsadhwani",
  "raga-kn-kalyani-bhavageethe": "Kalyani",
  "raga-kn-shankarabharana-keerthane": "Shankarabharana",
  "raga-hi-bageshri-thumri": "Bageshri",
  "raga-hi-bhimpalasi-bhajan": "Bhimpalasi",
};
