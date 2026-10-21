/**
 * Station host lines: a short templated greeting shown as text between tracks ("Good evening, Bengaluru. Here is an
 * AI-made song for you."). No model call and no spend. Every line says the music is AI-made. Non-English lines are
 * pending native-speaker review, like the rest of the UI copy.
 */
import { daypartOf, type Daypart } from "./program";

export type HostLang = "en" | "hi" | "ta" | "te" | "kn" | "bn" | "mr" | "pa" | "gu" | "ml" | "bho" | "or" | "ur" | "as";

type Greetings = Record<Daypart, string>;

const GREETING: Record<HostLang, Greetings> = {
  en: { dawn: "Good early morning", morning: "Good morning", midday: "Good afternoon", evening: "Good evening", dusk: "Good evening", night: "Late night listening" },
  hi: { dawn: "सुप्रभात", morning: "सुप्रभात", midday: "नमस्कार", evening: "शुभ संध्या", dusk: "शुभ संध्या", night: "शुभ रात्रि" },
  ta: { dawn: "காலை வணக்கம்", morning: "காலை வணக்கம்", midday: "மதிய வணக்கம்", evening: "மாலை வணக்கம்", dusk: "மாலை வணக்கம்", night: "இரவு வணக்கம்" },
  te: { dawn: "శుభోదయం", morning: "శుభోదయం", midday: "శుభ మధ్యాహ్నం", evening: "శుభ సాయంత్రం", dusk: "శుభ సాయంత్రం", night: "శుభ రాత్రి" },
  kn: { dawn: "ಶುಭೋದಯ", morning: "ಶುಭೋದಯ", midday: "ಶುಭ ಮಧ್ಯಾಹ್ನ", evening: "ಶುಭ ಸಂಜೆ", dusk: "ಶುಭ ಸಂಜೆ", night: "ಶುಭ ರಾತ್ರಿ" },
  bn: { dawn: "শুভ সকাল", morning: "শুভ সকাল", midday: "শুভ দুপুর", evening: "শুভ সন্ধ্যা", dusk: "শুভ সন্ধ্যা", night: "শুভ রাত্রি" },
  mr: { dawn: "सुप्रभात", morning: "सुप्रभात", midday: "शुभ दुपार", evening: "शुभ संध्याकाळ", dusk: "शुभ संध्याकाळ", night: "शुभ रात्री" },
  pa: { dawn: "ਸ਼ੁਭ ਸਵੇਰ", morning: "ਸ਼ੁਭ ਸਵੇਰ", midday: "ਸ਼ੁਭ ਦੁਪਹਿਰ", evening: "ਸ਼ੁਭ ਸ਼ਾਮ", dusk: "ਸ਼ੁਭ ਸ਼ਾਮ", night: "ਸ਼ੁਭ ਰਾਤ" },
  gu: { dawn: "સુપ્રભાત", morning: "સુપ્રભાત", midday: "શુભ બપોર", evening: "શુભ સાંજ", dusk: "શુભ સાંજ", night: "શુભ રાત્રિ" },
  ml: { dawn: "സുപ്രഭാതം", morning: "സുപ്രഭാതം", midday: "ശുഭ മധ്യാഹ്നം", evening: "ശുഭ സന്ധ്യ", dusk: "ശുഭ സന്ധ്യ", night: "ശുഭ രാത്രി" },
  bho: { dawn: "सुप्रभात", morning: "सुप्रभात", midday: "नमस्कार", evening: "शुभ संध्या", dusk: "शुभ संध्या", night: "शुभ रात्रि" },
  or: { dawn: "ଶୁଭ ସକାଳ", morning: "ଶୁଭ ସକାଳ", midday: "ଶୁଭ ଅପରାହ୍ନ", evening: "ଶୁଭ ସନ୍ଧ୍ୟା", dusk: "ଶୁଭ ସନ୍ଧ୍ୟା", night: "ଶୁଭ ରାତ୍ରି" },
  ur: { dawn: "صبح بخیر", morning: "صبح بخیر", midday: "دوپہر بخیر", evening: "شام بخیر", dusk: "شام بخیر", night: "شب بخیر" },
  as: { dawn: "শুভ ৰাতিপুৱা", morning: "শুভ ৰাতিপুৱা", midday: "শুভ দুপৰীয়া", evening: "শুভ সন্ধিয়া", dusk: "শুভ সন্ধিয়া", night: "শুভ ৰাতি" },
};

const TAGLINES: Record<HostLang, readonly [string, string]> = {
  en: ["Here is an AI-made song for you.", "Up next, an AI-made song from your station."],
  hi: ["यह रहा आपके लिए एआई से बना एक गीत।", "आपके स्टेशन से अगला गीत, एआई से बना।"],
  ta: ["உங்களுக்காக AI உருவாக்கிய ஒரு பாடல்.", "உங்கள் ஸ்டேஷனில் அடுத்து, AI உருவாக்கிய பாடல்."],
  te: ["మీ కోసం AI రూపొందించిన ఒక పాట.", "మీ స్టేషన్‌లో తర్వాత, AI రూపొందించిన పాట."],
  kn: ["ನಿಮಗಾಗಿ AI ರಚಿಸಿದ ಒಂದು ಹಾಡು.", "ನಿಮ್ಮ ಸ್ಟೇಷನ್‌ನಲ್ಲಿ ಮುಂದೆ, AI ರಚಿಸಿದ ಹಾಡು."],
  bn: ["আপনার জন্য AI-র তৈরি একটি গান।", "আপনার স্টেশনে এবার, AI-র তৈরি একটি গান।"],
  mr: ["हे तुमच्यासाठी एआयने बनवलेले एक गाणे.", "तुमच्या स्टेशनवर पुढे, एआयने बनवलेले गाणे."],
  pa: ["ਇਹ ਰਿਹਾ ਤੁਹਾਡੇ ਲਈ ਏਆਈ ਦਾ ਬਣਾਇਆ ਇੱਕ ਗੀਤ।", "ਤੁਹਾਡੇ ਸਟੇਸ਼ਨ ਤੋਂ ਅਗਲਾ, ਏਆਈ ਦਾ ਬਣਾਇਆ ਗੀਤ।"],
  gu: ["આ રહ્યું તમારા માટે AI એ બનાવેલું એક ગીત.", "તમારા સ્ટેશન પર હવે, AI એ બનાવેલું ગીત."],
  ml: ["നിങ്ങൾക്കായി AI ഒരുക്കിയ ഒരു ഗാനം.", "നിങ്ങളുടെ സ്റ്റേഷനിൽ അടുത്തത്, AI ഒരുക്കിയ ഗാനം."],
  bho: ["रउरा खातिर एआई के बनावल एगो गीत।", "रउरा स्टेशन पर अगिला, एआई के बनावल गीत।"],
  or: ["ଆପଣଙ୍କ ପାଇଁ AI ତିଆରି ଏକ ଗୀତ।", "ଆପଣଙ୍କ ଷ୍ଟେସନରେ ପରବର୍ତ୍ତୀ, AI ତିଆରି ଗୀତ।"],
  ur: ["یہ رہا آپ کے لیے اے آئی کا بنایا ہوا ایک گانا۔", "آپ کے اسٹیشن پر اگلا، اے آئی کا بنایا ہوا گانا۔"],
  as: ["আপোনাৰ বাবে AI-এ বনোৱা এটা গীত।", "আপোনাৰ ষ্টেচনত এতিয়া, AI-এ বনোৱা গীত।"],
};

/** Pool languages without their own template (hinglish, sa, unknown) read best in English. */
export function hostLang(language: string | null | undefined): HostLang {
  return language && language in GREETING ? (language as HostLang) : "en";
}

/** A stable small number from an id, so a given track always gets the same wording but neighbours differ. */
function pick(seed: string): 0 | 1 {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 2) as 0 | 1;
}

export interface HostLineInput {
  hour: number;
  language: string | null | undefined;
  /** Listener city when the edge supplied one; omitted from the line otherwise. */
  city?: string | null;
  /** Seed for wording variation, normally the track id. */
  seed: string;
  /** Optional extra sentence (the saved-taste mood note, lib/station/taste-bias.ts); appended as is. */
  note?: string | null;
}

export function hostLine({ hour, language, city, seed, note }: HostLineInput): string {
  const lang = hostLang(language);
  const greeting = GREETING[lang][daypartOf(hour)];
  return `${greeting}${city ? `, ${city}` : ""}. ${TAGLINES[lang][pick(seed)]}${note ? ` ${note}` : ""}`;
}

/**
 * City from the edge header (x-vercel-ip-city is URL-encoded). It is used for this response only and never stored.
 * Anything that is not a plain place name is dropped.
 */
export function cityFromHeader(raw: string | null): string | null {
  if (!raw) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(raw).trim(); } catch { return null; }
  return decoded.length > 0 && decoded.length <= 40 && /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(decoded) ? decoded : null;
}
