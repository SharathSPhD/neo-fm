/**
 * Style-routed cases for the PCE_STYLES gate: each brief names a form the style router recognises, so the candidate arm
 * gets that style's form notes and the live arm does not. Ids are frozen: `sty-<lang code>-<n>`.
 */
export const STYLED_BRIEFS: { id: string; language: string; code: string; style: string; text: string }[] = [
  { id: "sty-kn-1", language: "Kannada", code: "kn", style: "kannada-light-classical", text: "A bhavageethe about the first rain on the red soil of my village" },
  { id: "sty-ta-1", language: "Tamil", code: "ta", style: "tamil-folk", text: "A thalattu lullaby for a baby girl asleep on a moonlit veranda" },
  { id: "sty-te-1", language: "Telugu", code: "te", style: "telugu-keerthana", text: "A keerthana at dawn, offering flowers and lamps at the temple steps" },
  { id: "sty-hi-1", language: "Hindi", code: "hi", style: "hindustani", text: "A thumri of waiting in the rain for someone who promised to return" },
  { id: "sty-hi-2", language: "Hindi", code: "hi", style: "hindustani", text: "A khayal in raga Yaman about the quiet of dusk" },
  { id: "sty-bn-1", language: "Bengali", code: "bn", style: "bengali-folk", text: "A baul song about the river and the wandering mind" },
  { id: "sty-mr-1", language: "Marathi", code: "mr", style: "marathi-devotional", text: "An abhang for the Pandharpur wari, walking with the palkhi to the sound of the tal" },
  { id: "sty-mr-2", language: "Marathi", code: "mr", style: "marathi-light", text: "A bhavgeet about a mother waiting at the doorstep at dusk" },
  { id: "sty-pa-1", language: "Punjabi", code: "pa", style: "punjabi-folk", text: "A bhangra for the Baisakhi wheat harvest, dhol beating and the whole village dancing" },
  { id: "sty-pa-2", language: "Punjabi", code: "pa", style: "punjabi-folk", text: "A heer-style song of a lover waiting by the river Chenab" },
  { id: "sty-gu-1", language: "Gujarati", code: "gu", style: "gujarati-folk", text: "A garba for the nine nights of Navratri, circling the lamp" },
  { id: "sty-gu-2", language: "Gujarati", code: "gu", style: "gujarati-devotional", text: "A prabhatiya at dawn, greeting the sun with folded hands" },
  { id: "sty-kn-2", language: "Kannada", code: "kn", style: "kannada-folk", text: "A janapada song of the harvest, women pounding rice and singing together" },
  { id: "sty-ta-2", language: "Tamil", code: "ta", style: "tamil-folk", text: "A kuthu for the village temple festival, drums and a dancing crowd" },
  { id: "sty-te-2", language: "Telugu", code: "te", style: "telugu-keerthana", text: "A keerthana for the evening lamp, a prayer for the family" },
  { id: "sty-hi-3", language: "Hindi", code: "hi", style: "hindustani", text: "A kajri of the monsoon swing and the sound of rain" },
  { id: "sty-hi-4", language: "Hindi", code: "hi", style: "hindi-folk", text: "A chaiti for spring evenings in the village" },
  { id: "sty-bn-2", language: "Bengali", code: "bn", style: "bengali-folk", text: "A bhatiyali sung by a boatman on the river at dusk" },
];
