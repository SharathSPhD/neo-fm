import type { UiLang } from "@/lib/i18n/ui-strings";

/**
 * Song language the creation API understands for each guide language.
 * Identical today; kept as a map so the guide never sends an unknown code.
 */
export const GUIDE_LANGS: readonly UiLang[] = ["hi", "ta", "te", "kn", "bn", "en"];

/**
 * Three starter ideas per language, written in that language's own script
 * so the picker also shows the user that Hindi/Tamil/... input works.
 */
export const EXAMPLE_IDEAS: Record<UiLang, readonly [string, string, string]> = {
  hi: [
    "बारिश की पहली बूँद पर एक नर्म रोमांटिक गीत, जैसे 1960 के दशक की फ़िल्मों का",
    "माँ की लोरी: धीमी, गर्म आवाज़ में, तानपुरे के साथ",
    "दोस्ती पर एक जोशीला गीत, ढोलक और तालियों के साथ",
  ],
  ta: [
    "மழைக்காலத்தில் ஊரை நினைத்து ஏங்கும் உருக்கமான நாட்டுப்புறப் பாடல்",
    "அறுவடைத் திருநாளைக் கொண்டாடும் உற்சாகமான கிராமிய பாடல்",
    "அம்மாவின் தாலாட்டு: மெதுவான, இதமான குரலில்",
  ],
  te: [
    "వర్షపు సాయంత్రం ఇంటి కోసం ఎదురుచూసే భక్తి కీర్తన",
    "సంక్రాంతి పండుగ సందడిని వర్ణించే ఉత్సాహభరితమైన పాట",
    "అమ్మ జోలపాట: నెమ్మదిగా, ప్రేమగా",
  ],
  kn: [
    "ಪಶ್ಚಿಮ ಘಟ್ಟಗಳ ಸಂಜೆಯ ಸೌಂದರ್ಯದ ಬಗ್ಗೆ ಒಂದು ಭಾವಗೀತೆ",
    "ಹಬ್ಬದ ಸಂಭ್ರಮವನ್ನು ಸಾರುವ ಉತ್ಸಾಹದ ಜಾನಪದ ಗೀತೆ",
    "ಅಮ್ಮನ ಲಾಲಿ ಹಾಡು: ಮೃದುವಾಗಿ, ಮಮತೆಯಿಂದ",
  ],
  bn: [
    "বর্ষার সন্ধ্যায় প্রিয়জনের অপেক্ষা নিয়ে একটি রবীন্দ্রসংগীত-ধাঁচের গান",
    "শরতের আকাশ আর কাশফুল নিয়ে একটি হালকা, আনন্দের গান",
    "মায়ের ঘুমপাড়ানি গান: ধীর, উষ্ণ কণ্ঠে",
  ],
  en: [
    "A melancholic Carnatic raga about the monsoon and longing for home",
    "An energetic folk song celebrating the harvest festival, with dhol and claps",
    "A soft Hindi-film style love song, slow and warm, like the 1960s",
  ],
};
