/** Friendly refusals + a rewrite suggestion, per language. Plain, warm, no legalese; the suggestion is what the user can do next. */
import type { Lang } from "./normalise";

export type RightsKind = "artist_imitation" | "lyrics_reproduction" | "verbatim_overlap";

interface Msg { message: string; suggestion: string }

export const MESSAGES: Record<RightsKind, Record<Lang, Msg>> = {
  artist_imitation: {
    en: { message: "We can't make songs that imitate a real artist's voice or style.", suggestion: "Describe the sound instead: the mood, instruments, tempo, raga or era, and we'll write something original." },
    hi: { message: "हम किसी असली कलाकार की आवाज़ या शैली की नकल वाले गाने नहीं बना सकते।", suggestion: "इसके बजाय बताइए कि गाना कैसा लगे: मूड, वाद्य, रफ़्तार, राग या दौर, और हम कुछ मौलिक लिखेंगे।" },
    ta: { message: "உண்மையான கலைஞரின் குரல் அல்லது பாணியைப் பின்பற்றும் பாடல்களை எங்களால் உருவாக்க முடியாது.", suggestion: "அதற்குப் பதிலாக இசையை விவரியுங்கள்: மனநிலை, இசைக்கருவிகள், வேகம், ராகம் அல்லது காலம். நாங்கள் புதிதாக எழுதுவோம்." },
    te: { message: "నిజమైన కళాకారుల గొంతు లేదా శైలిని అనుకరించే పాటలను మేము తయారు చేయలేము.", suggestion: "బదులుగా సంగీతాన్ని వివరించండి: మూడ్, వాయిద్యాలు, వేగం, రాగం లేదా కాలం. మేము కొత్తగా రాస్తాము." },
    kn: { message: "ನಿಜವಾದ ಕಲಾವಿದರ ಧ್ವನಿ ಅಥವಾ ಶೈಲಿಯನ್ನು ಅನುಕರಿಸುವ ಹಾಡುಗಳನ್ನು ನಾವು ಮಾಡಲು ಸಾಧ್ಯವಿಲ್ಲ.", suggestion: "ಬದಲಾಗಿ ಸಂಗೀತವನ್ನು ವಿವರಿಸಿ: ಭಾವ, ವಾದ್ಯಗಳು, ವೇಗ, ರಾಗ ಅಥವಾ ಕಾಲ. ನಾವು ಹೊಸದಾಗಿ ಬರೆಯುತ್ತೇವೆ." },
    bn: { message: "আমরা কোনো আসল শিল্পীর কণ্ঠ বা ধরন নকল করা গান বানাতে পারি না।", suggestion: "বরং গানটা কেমন শোনাবে তা বলুন: মেজাজ, বাদ্যযন্ত্র, গতি, রাগ বা যুগ। আমরা নতুন করে লিখব।" },
  },
  lyrics_reproduction: {
    en: { message: "We write original lyrics and can't reproduce an existing song's words.", suggestion: "Tell us the story, feeling or setting that song gives you, and we'll write new lyrics in that spirit." },
    hi: { message: "हम मौलिक बोल लिखते हैं और किसी मौजूदा गाने के बोल दोहरा नहीं सकते।", suggestion: "बताइए कि वह गाना आपको कैसी कहानी, भावना या माहौल देता है, हम उसी भाव में नए बोल लिखेंगे।" },
    ta: { message: "நாங்கள் புதிய வரிகளை எழுதுகிறோம்; ஏற்கனவே உள்ள பாடலின் வரிகளை மீண்டும் தர முடியாது.", suggestion: "அந்தப் பாடல் உங்களுக்குத் தரும் கதை, உணர்வு அல்லது சூழலைச் சொல்லுங்கள்; அதே உணர்வில் புதிய வரிகளை எழுதுவோம்." },
    te: { message: "మేము కొత్త సాహిత్యం రాస్తాము; ఇప్పటికే ఉన్న పాట పదాలను తిరిగి ఇవ్వలేము.", suggestion: "ఆ పాట మీకు ఇచ్చే కథ, భావన లేదా వాతావరణాన్ని చెప్పండి; అదే భావంతో కొత్త సాహిత్యం రాస్తాము." },
    kn: { message: "ನಾವು ಹೊಸ ಸಾಹಿತ್ಯ ಬರೆಯುತ್ತೇವೆ; ಈಗಾಗಲೇ ಇರುವ ಹಾಡಿನ ಸಾಲುಗಳನ್ನು ಪುನರಾವರ್ತಿಸಲು ಸಾಧ್ಯವಿಲ್ಲ.", suggestion: "ಆ ಹಾಡು ನಿಮಗೆ ನೀಡುವ ಕಥೆ, ಭಾವ ಅಥವಾ ಪರಿಸರವನ್ನು ಹೇಳಿ; ಅದೇ ಭಾವದಲ್ಲಿ ಹೊಸ ಸಾಹಿತ್ಯ ಬರೆಯುತ್ತೇವೆ." },
    bn: { message: "আমরা নতুন কথা লিখি; বিদ্যমান কোনো গানের কথা হুবহু দিতে পারি না।", suggestion: "ওই গানটা আপনাকে কোন গল্প, অনুভূতি বা পরিবেশ দেয় তা বলুন; একই আবেগে আমরা নতুন কথা লিখব।" },
  },
  verbatim_overlap: {
    en: { message: "Those lyrics are too close to an existing song, so we stopped before making audio.", suggestion: "Try again with a fresh brief, or add your own images and details so the words come out original." },
    hi: { message: "ये बोल किसी मौजूदा गाने से बहुत मिलते हैं, इसलिए हमने ऑडियो बनाने से पहले रोक दिया।", suggestion: "नए विवरण के साथ दोबारा कोशिश कीजिए, या अपनी बातें और तस्वीरें जोड़िए ताकि बोल मौलिक बनें।" },
    ta: { message: "இந்த வரிகள் ஏற்கனவே உள்ள பாடலுடன் மிகவும் ஒத்திருக்கின்றன; அதனால் ஆடியோ உருவாக்கும் முன் நிறுத்தினோம்.", suggestion: "புதிய விவரத்துடன் மீண்டும் முயலுங்கள், அல்லது உங்கள் சொந்த காட்சிகளைச் சேர்த்தால் வரிகள் புதிதாக வரும்." },
    te: { message: "ఈ సాహిత్యం ఇప్పటికే ఉన్న పాటకు చాలా దగ్గరగా ఉంది, అందుకే ఆడియో తయారు చేసే ముందే ఆపాము.", suggestion: "కొత్త వివరాలతో మళ్లీ ప్రయత్నించండి, లేదా మీ స్వంత దృశ్యాలను జోడిస్తే పదాలు కొత్తగా వస్తాయి." },
    kn: { message: "ಈ ಸಾಹಿತ್ಯ ಈಗಿರುವ ಹಾಡಿಗೆ ತುಂಬಾ ಹತ್ತಿರವಾಗಿದೆ, ಆದ್ದರಿಂದ ಆಡಿಯೋ ಮಾಡುವ ಮೊದಲೇ ನಿಲ್ಲಿಸಿದ್ದೇವೆ.", suggestion: "ಹೊಸ ವಿವರಗಳೊಂದಿಗೆ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ, ಅಥವಾ ನಿಮ್ಮದೇ ಚಿತ್ರಣಗಳನ್ನು ಸೇರಿಸಿದರೆ ಪದಗಳು ಹೊಸದಾಗಿ ಬರುತ್ತವೆ." },
    bn: { message: "এই কথাগুলো বিদ্যমান একটি গানের খুব কাছাকাছি, তাই অডিও বানানোর আগেই থামিয়ে দিয়েছি।", suggestion: "নতুন বিবরণ দিয়ে আবার চেষ্টা করুন, বা নিজের ছবি ও খুঁটিনাটি যোগ করুন যাতে কথাগুলো মৌলিক হয়।" },
  },
};
