/**
 * Mood labels for the recap in the six UI languages. Moods are free-form `mood:*` section tags, so this covers
 * the common ones and anything else falls back to the stored (English) word. Machine-translated: the native-speaker
 * review pass for the UI strings should cover this table too.
 */
import type { UiLang } from "@/lib/i18n/ui-strings";

const MOODS: Record<string, Record<Exclude<UiLang, "en" | "mr">, string>> = {
  calm: { hi: "शांत", ta: "அமைதி", te: "ప్రశాంతం", kn: "ಶಾಂತ", bn: "শান্ত" },
  peaceful: { hi: "सुकून भरा", ta: "நிம்மதி", te: "ప్రశాంతమైన", kn: "ನೆಮ್ಮದಿ", bn: "প্রশান্ত" },
  serene: { hi: "निर्मल", ta: "தெளிவான அமைதி", te: "నిర్మలం", kn: "ನಿರ್ಮಲ", bn: "নির্মল" },
  joyful: { hi: "आनंदमय", ta: "மகிழ்ச்சி", te: "ఆనందం", kn: "ಆನಂದ", bn: "আনন্দময়" },
  happy: { hi: "खुशनुमा", ta: "சந்தோஷம்", te: "సంతోషం", kn: "ಸಂತೋಷ", bn: "খুশি" },
  bright: { hi: "उजला", ta: "பிரகாசம்", te: "ప్రకాశవంతం", kn: "ಪ್ರಕಾಶಮಾನ", bn: "উজ্জ্বল" },
  uplifting: { hi: "हौसला बढ़ाने वाला", ta: "உற்சாகமூட்டும்", te: "ఉత్సాహభరితం", kn: "ಉತ್ಸಾಹಕರ", bn: "অনুপ্রেরণাদায়ী" },
  energetic: { hi: "जोशीला", ta: "ஆற்றல்மிக்க", te: "ఉత్సాహం", kn: "ಚೈತನ್ಯಭರಿತ", bn: "প্রাণবন্ত" },
  festive: { hi: "उत्सवी", ta: "பண்டிகை", te: "పండుగ", kn: "ಹಬ್ಬದ", bn: "উৎসবমুখর" },
  celebratory: { hi: "जश्न", ta: "கொண்டாட்டம்", te: "వేడుక", kn: "ಸಂಭ್ರಮ", bn: "উদযাপন" },
  devotional: { hi: "भक्तिमय", ta: "பக்தி", te: "భక్తి", kn: "ಭಕ್ತಿ", bn: "ভক্তিমূলক" },
  meditative: { hi: "ध्यानमय", ta: "தியானம்", te: "ధ్యానం", kn: "ಧ್ಯಾನ", bn: "ধ্যানমগ্ন" },
  romantic: { hi: "रोमानी", ta: "காதல்", te: "ప్రేమ", kn: "ಪ್ರೇಮ", bn: "রোমান্টিক" },
  tender: { hi: "कोमल", ta: "மென்மையான", te: "మృదువైన", kn: "ಮೃದುವಾದ", bn: "কোমল" },
  nostalgic: { hi: "यादों भरा", ta: "நினைவலைகள்", te: "జ్ఞాపకాలు", kn: "ನೆನಪಿನ", bn: "স্মৃতিমাখা" },
  wistful: { hi: "उदास-सा", ta: "ஏக்கம்", te: "ఆరాటం", kn: "ಹಂಬಲ", bn: "আনমনা" },
  melancholic: { hi: "गमगीन", ta: "சோகம்", te: "విషాదం", kn: "ವಿಷಾದ", bn: "বিষণ্ণ" },
  sad: { hi: "उदास", ta: "சோகமான", te: "బాధ", kn: "ದುಃಖ", bn: "বিষাদ" },
  soulful: { hi: "रूहानी", ta: "ஆத்மார்த்தம்", te: "ఆత్మీయం", kn: "ಭಾವಪೂರ್ಣ", bn: "আত্মিক" },
  playful: { hi: "चंचल", ta: "குறும்பு", te: "చిలిపి", kn: "ತುಂಟ", bn: "দুষ্টু-মিষ্টি" },
  dreamy: { hi: "ख्वाबों जैसा", ta: "கனவுபோல்", te: "కలలాంటి", kn: "ಕನಸಿನಂತೆ", bn: "স্বপ্নিল" },
  majestic: { hi: "भव्य", ta: "கம்பீரம்", te: "గంభీరం", kn: "ಭವ್ಯ", bn: "রাজকীয়" },
};

/** Label for a mood tag in `lang`; unknown moods and English keep the stored word. */
export function moodLabel(mood: string, lang: UiLang): string {
  if (lang === "en") return mood;
  return MOODS[mood.toLowerCase()]?.[lang as Exclude<UiLang, "en" | "mr">] ?? mood;
}
