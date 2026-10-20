/**
 * Station nudge push copy in the five launch languages. Machine-written and not yet read by a native speaker
 * (see the PR). Bodies were reworked after the Gemini nativeness gate (#353); English is the fallback for every other language. Claims stay inside what the station does:
 * songs picked from our library.
 */
export const NUDGE_LANGS = ["en", "hi", "kn", "te", "ta", "mr"] as const;
export type NudgeLang = (typeof NUDGE_LANGS)[number];

export const NUDGE_COPY: Record<NudgeLang, { title: string; body: string }> = {
  en: { title: "Your station is ready", body: "Tune in: songs picked from our library." },
  hi: { title: "आपका स्टेशन तैयार है", body: "सुनिए: हमारी लाइब्रेरी से चुने हुए गाने।" },
  kn: { title: "ನಿಮ್ಮ ಸ್ಟೇಷನ್ ಸಿದ್ಧವಾಗಿದೆ", body: "ಕೇಳಿ: ನಮ್ಮ ಸಂಗ್ರಹದಿಂದ ಆರಿಸಿದ ಹಾಡುಗಳು." },
  te: { title: "మీ స్టేషన్ సిద్ధంగా ఉంది", body: "మా లైబ్రరీ నుంచి ఎంచుకున్న పాటలను వినండి." },
  ta: { title: "உங்கள் ஸ்டேஷன் தயார்", body: "கேளுங்கள்: எங்கள் இசைத் தொகுப்பிலிருந்து தேர்ந்தெடுக்கப்பட்ட பாடல்கள்." },
  mr: { title: "तुमचे स्टेशन तयार आहे", body: "ऐका: आमच्या संग्रहातून निवडलेली गाणी." },
};

export const nudgeLang = (v: unknown): NudgeLang =>
  typeof v === "string" && (NUDGE_LANGS as readonly string[]).includes(v) ? (v as NudgeLang) : "en";
