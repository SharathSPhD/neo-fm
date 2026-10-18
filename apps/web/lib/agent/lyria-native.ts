/**
 * Prompt text in the lyric's own language. Google's Lyria docs say 3.5 "generates lyrics in the language of your
 * prompt" and "adapts its vocal style and pronunciation to match the language", so the native arm of the language A/B
 * writes the label, the length instruction and the style direction in the target language (no English next to Indic
 * script) and anchors the voice with regional instruments and a vocal description.
 */
export interface PromptLabels { lyrics: string; duration: (seconds: number) => string }

export const NATIVE_LABELS: Record<string, PromptLabels> = {
  ta: { lyrics: "பாடல் வரிகள்:", duration: (n) => `கால அளவு: சரியாக ${n} வினாடிகள்; ${n} வினாடிகளுக்கு மேல் வேண்டாம். ` },
  te: { lyrics: "సాహిత్యం:", duration: (n) => `వ్యవధి: సరిగ్గా ${n} సెకన్లు; ${n} సెకన్లు మించకూడదు. ` },
  kn: { lyrics: "ಸಾಹಿತ್ಯ:", duration: (n) => `ಅವಧಿ: ಸರಿಯಾಗಿ ${n} ಸೆಕೆಂಡುಗಳು; ${n} ಸೆಕೆಂಡುಗಳನ್ನು ಮೀರಬಾರದು. ` },
  bn: { lyrics: "গানের কথা:", duration: (n) => `সময়কাল: ঠিক ${n} সেকেন্ড; ${n} সেকেন্ডের বেশি নয়। ` },
};

type Family = "classical" | "folk" | "light";
const STYLE: Record<string, Record<Family, string>> = {
  ta: {
    classical: "வீணை, மிருதங்கம் மற்றும் வயலின் இசையுடன் பாரம்பரிய கர்நாடக இசை பாணிப் பாடல். தெளிவான உயர்ந்த பெண் குரல், கமகங்களுடன் தெளிவான தமிழ் உச்சரிப்பு.",
    folk: "பறை, உடுக்கை மற்றும் புல்லாங்குழல் இசையுடன் தமிழ் நாட்டுப்புறப் பாடல். ஆழமான உணர்ச்சிமிக்க குரல், தெளிவான தமிழ் உச்சரிப்பு.",
    light: "வீணை, புல்லாங்குழல் மற்றும் மிருதங்கம் இசையுடன் மெல்லிசை பாணித் தமிழ்ப் பாடல். மென்மையான பெண் குரல், தெளிவான தமிழ் உச்சரிப்பு.",
  },
  te: {
    classical: "వీణ, మృదంగం మరియు వయోలిన్ వాద్యాలతో సంప్రదాయ కర్ణాటక సంగీత శైలి పాట. స్పష్టమైన ఎత్తైన స్త్రీ గళం, గమకాలతో స్పష్టమైన తెలుగు ఉచ్చారణ.",
    folk: "డప్పు, తబలా మరియు పిల్లనగ్రోవి వాద్యాలతో తెలుగు జానపద గీతం. లోతైన భావోద్వేగ గళం, స్పష్టమైన తెలుగు ఉచ్చారణ.",
    light: "వీణ, వేణువు మరియు మృదంగంతో లలిత సంగీత శైలి తెలుగు పాట. మృదువైన స్త్రీ గళం, స్పష్టమైన తెలుగు ఉచ్చారణ.",
  },
  kn: {
    classical: "ವೀಣೆ, ಮೃದಂಗ ಮತ್ತು ಪಿಟೀಲು ವಾದ್ಯಗಳೊಂದಿಗೆ ಸಾಂಪ್ರದಾಯಿಕ ಕರ್ನಾಟಕ ಸಂಗೀತ ಶೈಲಿಯ ಹಾಡು. ಸ್ಪಷ್ಟ ಎತ್ತರದ ಸ್ತ್ರೀ ಕಂಠ, ಗಮಕಗಳೊಂದಿಗೆ ಸ್ಪಷ್ಟ ಕನ್ನಡ ಉಚ್ಚಾರಣೆ.",
    folk: "ಡೋಲು, ತಮಟೆ ಮತ್ತು ಕೊಳಲು ವಾದ್ಯಗಳೊಂದಿಗೆ ಕನ್ನಡ ಜಾನಪದ ಗೀತೆ. ಆಳವಾದ ಭಾವಪೂರ್ಣ ಕಂಠ, ಸ್ಪಷ್ಟ ಕನ್ನಡ ಉಚ್ಚಾರಣೆ.",
    light: "ವೀಣೆ, ಕೊಳಲು ಮತ್ತು ಮೃದಂಗದೊಂದಿಗೆ ಭಾವಗೀತೆ ಶೈಲಿಯ ಕನ್ನಡ ಹಾಡು. ಮೃದುವಾದ ಸ್ತ್ರೀ ಕಂಠ, ಸ್ಪಷ್ಟ ಕನ್ನಡ ಉಚ್ಚಾರಣೆ.",
  },
  bn: {
    classical: "সরোদ, তবলা ও বাঁশির সুরে ধ্রুপদী ঢঙের বাংলা গান। স্পষ্ট ও গভীর কণ্ঠ, পরিষ্কার বাংলা উচ্চারণ।",
    folk: "দোতারা, খোল ও একতারার সুরে বাউল ও লোকগানের ঢঙের বাংলা গান। আবেগপূর্ণ কণ্ঠ, পরিষ্কার বাংলা উচ্চারণ।",
    light: "হারমোনিয়াম, বাঁশি ও তবলার সুরে রবীন্দ্রসংগীতের ঢঙের বাংলা গান। কোমল কণ্ঠ, পরিষ্কার বাংলা উচ্চারণ।",
  },
};

function familyOf(styleFamily: string): Family {
  const s = styleFamily.toLowerCase();
  if (/(folk|baul)/.test(s)) return "folk";
  if (/(light|rabindra|keerthana)/.test(s)) return "light";
  return "classical";
}

/** Style text in `language` (a pool code: ta, te, kn, bn), or undefined when there is no native preset. */
export function nativeStyle(language: string, styleFamily: string): string | undefined {
  return STYLE[language]?.[familyOf(styleFamily)];
}
