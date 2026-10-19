/** Recap copy in the six UI languages (each written in its own script). */
import type { UiLang } from "@/lib/i18n/ui-strings";

export interface RecapStrings {
  title: string;
  songs: string;
  languages: string;
  topSong: string;
  likes: string;
  listens: string;
  moods: string;
  collections: string;
  empty: string;
  /** BCP-47 locale for the month name. */
  locale: string;
}

export const RECAP_STRINGS: Record<UiLang, RecapStrings> = {
  en: { title: "My month in music", songs: "songs made", languages: "languages", topSong: "top song", likes: "likes", listens: "listens", moods: "moods", collections: "collections", empty: "No songs this month yet", locale: "en-IN" },
  hi: { title: "संगीत में मेरा महीना", songs: "गाने बनाए", languages: "भाषाएँ", topSong: "सबसे हिट गाना", likes: "लाइक", listens: "बार सुना गया", moods: "मूड", collections: "कलेक्शन", empty: "इस महीने अभी कोई गाना नहीं", locale: "hi-IN" },
  ta: { title: "இசையில் என் மாதம்", songs: "பாடல்கள் உருவாக்கினேன்", languages: "மொழிகள்", topSong: "சிறந்த பாடல்", likes: "விருப்பங்கள்", listens: "முறை கேட்கப்பட்டது", moods: "மனநிலைகள்", collections: "தொகுப்புகள்", empty: "இந்த மாதம் இன்னும் பாடல்கள் இல்லை", locale: "ta-IN" },
  te: { title: "సంగీతంలో నా నెల", songs: "పాటలు చేశాను", languages: "భాషలు", topSong: "టాప్ పాట", likes: "లైకులు", listens: "సార్లు విన్నారు", moods: "మూడ్స్", collections: "కలెక్షన్లు", empty: "ఈ నెలలో ఇంకా పాటలు లేవు", locale: "te-IN" },
  kn: { title: "ಸಂಗೀತದಲ್ಲಿ ನನ್ನ ತಿಂಗಳು", songs: "ಹಾಡುಗಳನ್ನು ಮಾಡಿದೆ", languages: "ಭಾಷೆಗಳು", topSong: "ಅತ್ಯುತ್ತಮ ಹಾಡು", likes: "ಲೈಕ್‌ಗಳು", listens: "ಬಾರಿ ಕೇಳಲಾಗಿದೆ", moods: "ಮೂಡ್‌ಗಳು", collections: "ಸಂಗ್ರಹಗಳು", empty: "ಈ ತಿಂಗಳು ಇನ್ನೂ ಹಾಡುಗಳಿಲ್ಲ", locale: "kn-IN" },
  mr: { title: "संगीतातला माझा महिना", songs: "गाणी बनवली", languages: "भाषा", topSong: "सर्वात आवडते गाणे", likes: "लाइक्स", listens: "वेळा ऐकले", moods: "मूड", collections: "संग्रह", empty: "या महिन्यात अजून गाणी नाहीत", locale: "mr-IN" },
  bn: { title: "গানে আমার মাস", songs: "গান বানিয়েছি", languages: "ভাষা", topSong: "সেরা গান", likes: "লাইক", listens: "বার শোনা হয়েছে", moods: "মুড", collections: "কালেকশন", empty: "এই মাসে এখনও কোনও গান নেই", locale: "bn-IN" },
};

/** "October 2026" in the user's language, with Latin digits. */
export function monthLabel(month: string, lang: UiLang): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1, 15));
  try {
    return new Intl.DateTimeFormat(`${RECAP_STRINGS[lang].locale}-u-nu-latn`, { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
  } catch {
    return month;
  }
}
