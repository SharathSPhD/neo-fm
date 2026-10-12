/** Frozen pilot brief set for the PCE-vs-single-shot evaluation (extend to the 60-brief set; never edit existing ids). */
export interface EvalBrief { id: string; language: string; style: string; text: string }

export const PILOT_BRIEFS: EvalBrief[] = [
  { id: "kn-1", language: "Kannada", style: "kannada-light-classical", text: "A tender bhavageete about a daughter leaving home after marriage, remembering the courtyard and her mother's lullabies" },
  { id: "kn-2", language: "Kannada", style: "kannada-folk", text: "A village folk song about farmers waiting for the first rain, with a call-and-response chorus" },
  { id: "ta-1", language: "Tamil", style: "tamil-folk", text: "A joyful harvest song about Pongal morning, kolam patterns and a grandmother's blessing" },
  { id: "ta-2", language: "Tamil", style: "tamil-folk", text: "A bittersweet song about a fisherman's wife watching the sea at dusk, waiting for the boats" },
  { id: "te-1", language: "Telugu", style: "telugu-keerthana", text: "A devotional keerthana welcoming dawn at a temple by the river, surrender and gratitude" },
  { id: "te-2", language: "Telugu", style: "carnatic", text: "A song of longing for the monsoon in a drought-struck village, hope against the sky" },
  { id: "hi-1", language: "Hindi", style: "bollywood-ballad", text: "A nostalgic ballad about old train journeys and a letter that was never sent" },
  { id: "hi-2", language: "Hindi", style: "hindustani", text: "A slow evening khayal about the first rain after a long summer, memory and distance" },
  { id: "bn-1", language: "Bengali", style: "bengali-rabindrasangeet", text: "A gentle song about monsoon clouds gathering over the river at dusk, a quiet yearning" },
  { id: "bn-2", language: "Bengali", style: "bengali-rabindrasangeet", text: "An autumn song about kash flowers and the sound of dhak before Durga Puja, homecoming" },
];
