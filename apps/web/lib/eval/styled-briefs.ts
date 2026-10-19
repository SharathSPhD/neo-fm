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
];
