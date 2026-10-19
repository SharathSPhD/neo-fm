/**
 * User-facing release notes, written in plain language (no PR numbers or jargon).
 * Each entry is localized per language; a missing language falls back to English.
 * Newest first. The first entry's id drives the in-app "new" badge.
 */
export const WHATS_NEW_LANGS = ["en", "hi", "ta", "te", "kn", "mr", "bn"] as const;
export type WhatsNewLang = (typeof WHATS_NEW_LANGS)[number];

type Text = { en: string } & Partial<Record<Exclude<WhatsNewLang, "en">, string>>;

export interface WhatsNewEntry {
  id: string;
  date: string; // ISO yyyy-mm-dd
  title: Text;
  body: Text;
}

export const WHATS_NEW: readonly WhatsNewEntry[] = [
  {
    id: "2026-10-12-report-song",
    date: "2026-10-12",
    title: { en: "Report a song", hi: "किसी गाने की रिपोर्ट करें", ta: "பாடலைப் புகாரளிக்கவும்" },
    body: {
      en: "If a shared song worries you, you can report it. Reports are reviewed, and a takedown is handled with a notice to the creator.",
      hi: "अगर कोई साझा किया गया गाना आपको ठीक नहीं लगता, तो आप उसकी रिपोर्ट कर सकते हैं। रिपोर्ट की समीक्षा होती है और ज़रूरत पड़ने पर रचयिता को सूचना के साथ गाना हटाया जाता है।",
      ta: "பகிரப்பட்ட பாடல் குறித்து கவலை இருந்தால் புகாரளிக்கலாம். புகார்கள் பரிசீலிக்கப்படும்; தேவைப்பட்டால் படைப்பாளருக்கு அறிவிப்புடன் பாடல் நீக்கப்படும்.",
    },
  },
  {
    id: "2026-10-12-share-card",
    date: "2026-10-12",
    title: { en: "Share your lyrics as a card", hi: "अपने बोल कार्ड के रूप में साझा करें", ta: "வரிகளை அட்டையாகப் பகிருங்கள்" },
    body: {
      en: "Pick a line from your song and share it as a pretty image, in Hindi, Tamil, Telugu, Kannada or Bengali script, with one tap on Share.",
      hi: "अपने गाने की कोई पंक्ति चुनें और एक टैप में उसे सुंदर तस्वीर के रूप में साझा करें। हिन्दी, तमिल, तेलुगु, कन्नड़ और बांग्ला लिपि में।",
      ta: "உங்கள் பாடலில் ஒரு வரியைத் தேர்ந்தெடுத்து, ஒரே தட்டலில் அழகான படமாகப் பகிருங்கள். தமிழ், இந்தி, தெலுங்கு, கன்னடம், வங்காளம் எழுத்துகளில்.",
    },
  },
  {
    id: "2026-10-12-first-song",
    date: "2026-10-12",
    title: { en: "A guided first song", hi: "पहला गाना, कदम-दर-कदम", ta: "முதல் பாடலுக்கு வழிகாட்டி" },
    body: {
      en: "New here? Pick your language, tap an idea, hear the mood and create. Lyrics now scroll along with the song, and the main screens speak your language.",
      hi: "नए हैं? अपनी भाषा चुनें, कोई विचार टैप करें, मूड सुनें और गाना बनाएँ। बोल अब गाने के साथ चलते हैं और मुख्य स्क्रीन आपकी भाषा में हैं।",
      ta: "புதியவரா? உங்கள் மொழியைத் தேர்ந்தெடுங்கள், ஒரு யோசனையைத் தட்டுங்கள், மனநிலையைக் கேட்டு உருவாக்குங்கள். வரிகள் பாடலுடன் நகரும்; முக்கிய திரைகள் உங்கள் மொழியில் உள்ளன.",
    },
  },
  {
    id: "2026-10-12-live-progress",
    date: "2026-10-12",
    title: { en: "See your song being made", hi: "गाना बनते हुए देखें", ta: "பாடல் உருவாவதைப் பாருங்கள்" },
    body: {
      en: "A live progress view shows each step while your song is created, so you always know what is happening.",
      hi: "गाना बनते समय एक लाइव प्रगति दृश्य हर चरण दिखाता है, ताकि आप हमेशा जानें कि क्या हो रहा है।",
      ta: "பாடல் உருவாகும்போது ஒவ்வொரு படியையும் நேரடி முன்னேற்றக் காட்சி காட்டும்; என்ன நடக்கிறது என்று எப்போதும் தெரியும்.",
    },
  },
  {
    id: "2026-10-12-email",
    date: "2026-10-12",
    title: { en: "Song-ready emails in your language", hi: "आपकी भाषा में ईमेल", ta: "உங்கள் மொழியில் மின்னஞ்சல்" },
    body: {
      en: "When your song is ready we can email you, in the language you write in, with a link straight to it.",
      hi: "गाना तैयार होने पर हम आपको आपकी भाषा में ईमेल भेज सकते हैं, सीधे गाने के लिंक के साथ।",
      ta: "பாடல் தயாரானதும் நீங்கள் எழுதும் மொழியிலேயே, நேரடி இணைப்புடன் மின்னஞ்சல் அனுப்புவோம்.",
    },
  },
  {
    id: "2026-10-12-faster",
    date: "2026-10-12",
    title: { en: "Faster, steadier songs", hi: "तेज़ और भरोसेमंद गाने", ta: "வேகமான, நம்பகமான பாடல்கள்" },
    body: {
      en: "Finished songs now reach you right away, brief hiccups are retried automatically, and a stuck song is picked up again on its own.",
      hi: "तैयार गाने अब तुरंत आप तक पहुँचते हैं, छोटी रुकावटों पर अपने आप दोबारा कोशिश होती है और अटका हुआ गाना खुद फिर शुरू हो जाता है।",
      ta: "முடிந்த பாடல்கள் உடனே உங்களை வந்தடையும்; சிறு தடங்கல்கள் தானாக மீண்டும் முயற்சிக்கப்படும்; சிக்கிய பாடல் தானாகவே தொடரும்.",
    },
  },
  {
    id: "2026-10-12-clear-errors",
    date: "2026-10-12",
    title: { en: "Clearer messages when a song can't be made", hi: "गाना न बन पाने पर साफ़ संदेश", ta: "பாடல் உருவாகாதபோது தெளிவான செய்திகள்" },
    body: {
      en: "If a song hits your monthly allowance, a render hiccup, or our content policy, you now get a plain explanation and what to do next.",
      hi: "अगर गाना मासिक सीमा, किसी तकनीकी रुकावट या हमारी सामग्री नीति के कारण नहीं बन पाता, तो अब आपको सरल कारण और अगला कदम बताया जाता है।",
      ta: "மாதாந்திர வரம்பு, தொழில்நுட்பத் தடங்கல் அல்லது உள்ளடக்கக் கொள்கை காரணமாகப் பாடல் உருவாகாவிட்டால், இப்போது எளிய விளக்கமும் அடுத்து என்ன செய்வதும் காட்டப்படும்.",
    },
  },
  {
    id: "2026-10-12-your-data",
    date: "2026-10-12",
    title: { en: "Your data, your control", hi: "आपका डेटा, आपका नियंत्रण", ta: "உங்கள் தரவு, உங்கள் கட்டுப்பாடு" },
    body: {
      en: "You can export or erase everything we hold about you, and payments are now safe against duplicate charges. Stronger security checks protect your account.",
      hi: "आप हमारे पास मौजूद अपना सारा डेटा निकाल या मिटा सकते हैं, भुगतान दोहरे चार्ज से सुरक्षित हैं और खाते की सुरक्षा जाँचें और मज़बूत हुई हैं।",
      ta: "எங்களிடம் உள்ள உங்கள் தரவு அனைத்தையும் ஏற்றுமதி செய்யலாம் அல்லது அழிக்கலாம்; கட்டணங்கள் இரட்டை வசூலிலிருந்து பாதுகாக்கப்படுகின்றன; கணக்குப் பாதுகாப்பும் வலுப்படுத்தப்பட்டுள்ளது.",
    },
  },
];

export const LATEST_ID = WHATS_NEW[0]!.id;

/** Page chrome, same fallback rule as the entries. */
const CHROME = {
  title: { en: "What's new", hi: "नया क्या है", ta: "புதியது என்ன" },
  intro: {
    en: "Everything we shipped recently, in plain words.",
    hi: "हाल में जो कुछ नया जोड़ा गया है, सरल शब्दों में।",
    ta: "சமீபத்தில் சேர்த்தவை அனைத்தும், எளிய சொற்களில்.",
  },
  badge: { en: "New", hi: "नया", ta: "புதிது" },
} as const satisfies Record<string, Text>;
export type ChromeKey = keyof typeof CHROME;

export function pick(t: Text, lang: WhatsNewLang): string {
  return (lang !== "en" ? t[lang] : undefined) ?? t.en;
}

export function chrome(key: ChromeKey, lang: WhatsNewLang): string {
  return pick(CHROME[key], lang);
}
