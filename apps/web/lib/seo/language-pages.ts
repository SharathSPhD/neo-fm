/**
 * Per-language landing pages (/ai-songs/<slug>). Copy is written for each
 * language rather than translated from a template: the page is meant to
 * be found by, and make sense to, someone searching in that language.
 */

export interface LanguagePage {
  /** Language code stored on song documents and used as hreflang. */
  code: "hi" | "mr" | "ta" | "te" | "kn" | "bn";
  slug: string;
  /** Name in English, for the English-language admin and sitemap surfaces. */
  english: string;
  /** Name in its own script. */
  native: string;
  title: string;
  h1: string;
  intro: string;
  points: readonly string[];
  cta: string;
  /** Primary call to action: start listening to the free station. */
  listen: string;
  browse: string;
  songsHeading: string;
  empty: string;
  play: string;
}

export const LANGUAGE_PAGES: readonly LanguagePage[] = [
  {
    code: "hi",
    slug: "hindi",
    english: "Hindi",
    native: "हिन्दी",
    title: "हिन्दी में AI गाने बनाइए | neo-fm",
    h1: "हिन्दी में अपना गाना बनाइए",
    intro:
      "बस अपना मूड, मौक़ा और अंदाज़ बताइए। neo-fm हिन्दी में सीधे गीत लिखता है, अनुवाद नहीं करता, फिर उसे गायक की आवाज़ में सुनाता है।",
    points: [
      "सीधे हिन्दी में लिखे बोल",
      "कई मसौदों में से सबसे अच्छा चुना जाता है",
      "उच्चारण की जाँच: सुनकर दिखाते हैं कि गायक ने आपके शब्द कितने सही गाए",
      "हर गाना साफ़ तौर पर AI-निर्मित चिह्नित",
    ],
    cta: "अपना गाना बनाइए",
    listen: "मुफ़्त स्टेशन सुनिए",
    browse: "सारे गाने देखिए",
    songsHeading: "हिन्दी में समुदाय के गाने सुनिए",
    empty: "जल्द ही यहाँ हिन्दी गाने दिखेंगे। पहला गाना आप ही बनाइए।",
    play: "▶ सुनिए",
  },
  {
    code: "mr",
    slug: "marathi",
    english: "Marathi",
    native: "मराठी",
    title: "मराठीत AI गाणी बनवा | neo-fm",
    h1: "मराठीत तुमचं स्वतःचं गाणं बनवा",
    intro:
      "तुमचा मूड, प्रसंग आणि शैली सांगा. neo-fm मराठीतच थेट गीत लिहितं, भाषांतर करत नाही, आणि मग गायकाच्या आवाजात ऐकवतं.",
    points: [
      "थेट मराठीत लिहिलेले बोल",
      "अनेक मसुद्यांतून सर्वोत्तम निवडला जातो",
      "उच्चार तपासणी: गायकाने तुमचे शब्द किती अचूक गायले ते ऐकून दाखवतो",
      "प्रत्येक गाणं स्पष्टपणे AI-निर्मित म्हणून चिन्हांकित",
    ],
    cta: "तुमचं गाणं बनवा",
    listen: "मोफत स्टेशन ऐका",
    browse: "सर्व गाणी पाहा",
    songsHeading: "मराठीतली समुदायाची गाणी ऐका",
    empty: "लवकरच इथे मराठी गाणी दिसतील. पहिलं गाणं तुम्हीच बनवा.",
    play: "▶ ऐका",
  },
  {
    code: "ta",
    slug: "tamil",
    english: "Tamil",
    native: "தமிழ்",
    title: "தமிழில் AI பாடல்களை உருவாக்குங்கள் | neo-fm",
    h1: "தமிழில் உங்கள் சொந்தப் பாடலை உருவாக்குங்கள்",
    intro:
      "மனநிலை, சந்தர்ப்பம், பாணி ஆகியவற்றைச் சொல்லுங்கள். neo-fm தமிழிலேயே நேரடியாகப் பாடல் வரிகளை எழுதுகிறது; மொழிபெயர்ப்பு அல்ல. பிறகு ஒரு பாடகரின் குரலில் ஒலிக்கச் செய்கிறது.",
    points: [
      "தமிழிலேயே எழுதப்படும் வரிகள்",
      "பல வரைவுகளில் சிறந்ததைத் தேர்ந்தெடுக்கிறோம்",
      "உச்சரிப்புச் சரிபார்ப்பு: பாடகர் உங்கள் வார்த்தைகளை எவ்வளவு சரியாகப் பாடினார் என்று கேட்டுக் காட்டுகிறோம்",
      "ஒவ்வொரு பாடலும் AI உருவாக்கியது என்று தெளிவாகக் குறிக்கப்படும்",
    ],
    cta: "உங்கள் பாடலை உருவாக்குங்கள்",
    listen: "இலவச ஸ்டேஷனைக் கேளுங்கள்",
    browse: "அனைத்துப் பாடல்களையும் பாருங்கள்",
    songsHeading: "தமிழில் சமூகப் பாடல்களைக் கேளுங்கள்",
    empty: "விரைவில் தமிழ்ப் பாடல்கள் இங்கே தோன்றும். முதல் பாடலை நீங்களே உருவாக்குங்கள்.",
    play: "▶ கேளுங்கள்",
  },
  {
    code: "te",
    slug: "telugu",
    english: "Telugu",
    native: "తెలుగు",
    title: "తెలుగులో AI పాటలు సృష్టించండి | neo-fm",
    h1: "తెలుగులో మీ సొంత పాటను సృష్టించండి",
    intro:
      "మీ మూడ్, సందర్భం, శైలి చెప్పండి. neo-fm తెలుగులోనే నేరుగా సాహిత్యం రాస్తుంది; అనువాదం కాదు. తర్వాత ఒక గాయకుడి గొంతులో వినిపిస్తుంది.",
    points: [
      "తెలుగులోనే రాసిన సాహిత్యం",
      "అనేక ప్రయత్నాల్లో ఉత్తమమైనది ఎంపిక అవుతుంది",
      "ఉచ్చారణ తనిఖీ: గాయకుడు మీ మాటలను ఎంత సరిగ్గా పాడాడో విని చూపిస్తాం",
      "ప్రతి పాట AI సృష్టి అని స్పష్టంగా గుర్తించబడుతుంది",
    ],
    cta: "మీ పాటను సృష్టించండి",
    listen: "ఉచిత స్టేషన్ వినండి",
    browse: "అన్ని పాటలను చూడండి",
    songsHeading: "తెలుగులో కమ్యూనిటీ పాటలు వినండి",
    empty: "త్వరలో ఇక్కడ తెలుగు పాటలు కనిపిస్తాయి. మొదటి పాటను మీరే సృష్టించండి.",
    play: "▶ వినండి",
  },
  {
    code: "kn",
    slug: "kannada",
    english: "Kannada",
    native: "ಕನ್ನಡ",
    title: "ಕನ್ನಡದಲ್ಲಿ AI ಹಾಡುಗಳನ್ನು ರಚಿಸಿ | neo-fm",
    h1: "ಕನ್ನಡದಲ್ಲಿ ನಿಮ್ಮದೇ ಹಾಡನ್ನು ರಚಿಸಿ",
    intro:
      "ನಿಮ್ಮ ಮನಸ್ಥಿತಿ, ಸಂದರ್ಭ ಮತ್ತು ಶೈಲಿಯನ್ನು ಹೇಳಿ. neo-fm ಕನ್ನಡದಲ್ಲೇ ನೇರವಾಗಿ ಸಾಹಿತ್ಯ ಬರೆಯುತ್ತದೆ; ಅನುವಾದ ಮಾಡುವುದಿಲ್ಲ. ನಂತರ ಗಾಯಕರ ಧ್ವನಿಯಲ್ಲಿ ಹಾಡಿಸುತ್ತದೆ.",
    points: [
      "ಕನ್ನಡದಲ್ಲೇ ಬರೆದ ಸಾಹಿತ್ಯ",
      "ಹಲವು ಕರಡುಗಳಲ್ಲಿ ಉತ್ತಮವಾದುದನ್ನು ಆರಿಸಲಾಗುತ್ತದೆ",
      "ಉಚ್ಚಾರಣೆ ಪರಿಶೀಲನೆ: ಗಾಯಕ ನಿಮ್ಮ ಪದಗಳನ್ನು ಎಷ್ಟು ಸರಿಯಾಗಿ ಹಾಡಿದ್ದಾರೆ ಎಂದು ಕೇಳಿ ತೋರಿಸುತ್ತೇವೆ",
      "ಪ್ರತಿ ಹಾಡನ್ನೂ AI ರಚಿತ ಎಂದು ಸ್ಪಷ್ಟವಾಗಿ ಗುರುತಿಸಲಾಗುತ್ತದೆ",
    ],
    cta: "ನಿಮ್ಮ ಹಾಡನ್ನು ರಚಿಸಿ",
    listen: "ಉಚಿತ ಸ್ಟೇಷನ್ ಆಲಿಸಿ",
    browse: "ಎಲ್ಲಾ ಹಾಡುಗಳನ್ನು ನೋಡಿ",
    songsHeading: "ಕನ್ನಡದಲ್ಲಿ ಸಮುದಾಯದ ಹಾಡುಗಳನ್ನು ಆಲಿಸಿ",
    empty: "ಶೀಘ್ರದಲ್ಲೇ ಇಲ್ಲಿ ಕನ್ನಡ ಹಾಡುಗಳು ಕಾಣಿಸುತ್ತವೆ. ಮೊದಲ ಹಾಡನ್ನು ನೀವೇ ರಚಿಸಿ.",
    play: "▶ ಆಲಿಸಿ",
  },
  {
    code: "bn",
    slug: "bengali",
    english: "Bengali",
    native: "বাংলা",
    title: "বাংলায় AI গান তৈরি করুন | neo-fm",
    h1: "বাংলায় নিজের গান তৈরি করুন",
    intro:
      "আপনার মেজাজ, উপলক্ষ আর ধরন বলুন। neo-fm সরাসরি বাংলায় গানের কথা লেখে, অনুবাদ করে না। তারপর একজন গায়কের কণ্ঠে শোনায়।",
    points: [
      "সরাসরি বাংলায় লেখা কথা",
      "একাধিক খসড়া থেকে সেরাটি বেছে নেওয়া হয়",
      "উচ্চারণ যাচাই: গায়ক আপনার শব্দগুলো কতটা ঠিকভাবে গাইলেন, তা শুনে মিলিয়ে দেখা হয়",
      "প্রতিটি গান স্পষ্টভাবে AI-নির্মিত বলে চিহ্নিত",
    ],
    cta: "আপনার গান তৈরি করুন",
    listen: "বিনামূল্যে স্টেশন শুনুন",
    browse: "সব গান দেখুন",
    songsHeading: "কমিউনিটির বাংলা গান শুনুন",
    empty: "শীঘ্রই এখানে বাংলা গান দেখা যাবে। প্রথম গানটি আপনিই তৈরি করুন।",
    play: "▶ শুনুন",
  },
];

export const LANGUAGE_PAGE_ROOT = "/ai-songs";

export function languagePageBySlug(slug: string): LanguagePage | undefined {
  return LANGUAGE_PAGES.find((p) => p.slug === slug);
}

export function languagePagePath(p: LanguagePage): string {
  return `${LANGUAGE_PAGE_ROOT}/${p.slug}`;
}

/**
 * hreflang cluster shared by the landing page and every language page.
 * Each member must list all the others (and itself) or search engines
 * ignore the annotation, so every page uses this one map.
 */
export function hreflangPaths(): Record<string, string> {
  const map: Record<string, string> = { en: "/", "x-default": "/" };
  for (const p of LANGUAGE_PAGES) map[p.code] = languagePagePath(p);
  return map;
}

/** Language code for a request path under /ai-songs/<slug> (the explainer included), else undefined. Drives <html lang>. */
export function languageCodeForPath(path: string | null | undefined): LanguagePage["code"] | undefined {
  const slug = /^\/ai-songs\/([^/?#]+)/.exec(path ?? "")?.[1];
  return slug ? languagePageBySlug(slug)?.code : undefined;
}
