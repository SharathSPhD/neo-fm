/** "Your week on neo-fm" copy in the seven UI languages (each in its own script). Machine-translated: the UI-string review pass should cover it. */
import type { UiLang } from "@/lib/i18n/ui-strings";

export interface WeekStrings {
  title: string;
  minutes: string;
  songs: string;
  streak: string;
  days: string;
  languages: string;
  moods: string;
  favourite: string;
  empty: string;
  share: string;
  listen: string;
}

export const WEEK_STRINGS: Record<UiLang, WeekStrings> = {
  en: { title: "Your week on neo-fm", minutes: "minutes listened", songs: "songs", streak: "day streak", days: "days active", languages: "languages", moods: "moods", favourite: "this week's favourite", empty: "No listening yet this week. Tune in to the station.", share: "Share my week", listen: "Open the station" },
  hi: { title: "neo-fm पर आपका हफ़्ता", minutes: "मिनट सुना", songs: "गाने", streak: "दिन की लड़ी", days: "दिन सक्रिय", languages: "भाषाएँ", moods: "मूड", favourite: "इस हफ़्ते का पसंदीदा", empty: "इस हफ़्ते अभी कुछ नहीं सुना। स्टेशन चालू कीजिए।", share: "मेरा हफ़्ता शेयर करें", listen: "स्टेशन खोलें" },
  ta: { title: "neo-fm இல் உங்கள் வாரம்", minutes: "நிமிடங்கள் கேட்டீர்கள்", songs: "பாடல்கள்", streak: "நாள் தொடர்", days: "நாட்கள் செயலில்", languages: "மொழிகள்", moods: "மனநிலைகள்", favourite: "இந்த வாரத்தின் விருப்பம்", empty: "இந்த வாரம் இன்னும் கேட்கவில்லை. ஸ்டேஷனை இயக்குங்கள்.", share: "என் வாரத்தைப் பகிர்", listen: "ஸ்டேஷனைத் திற" },
  te: { title: "neo-fm లో మీ వారం", minutes: "నిమిషాలు విన్నారు", songs: "పాటలు", streak: "రోజుల వరుస", days: "రోజులు యాక్టివ్", languages: "భాషలు", moods: "మూడ్స్", favourite: "ఈ వారం ఇష్టమైనది", empty: "ఈ వారం ఇంకా వినలేదు. స్టేషన్ ఆన్ చేయండి.", share: "నా వారాన్ని షేర్ చేయి", listen: "స్టేషన్ తెరవండి" },
  kn: { title: "neo-fm ನಲ್ಲಿ ನಿಮ್ಮ ವಾರ", minutes: "ನಿಮಿಷ ಕೇಳಿದಿರಿ", songs: "ಹಾಡುಗಳು", streak: "ದಿನಗಳ ಸರಣಿ", days: "ದಿನ ಸಕ್ರಿಯ", languages: "ಭಾಷೆಗಳು", moods: "ಮೂಡ್‌ಗಳು", favourite: "ಈ ವಾರದ ಮೆಚ್ಚಿನದು", empty: "ಈ ವಾರ ಇನ್ನೂ ಕೇಳಿಲ್ಲ. ಸ್ಟೇಷನ್ ಆನ್ ಮಾಡಿ.", share: "ನನ್ನ ವಾರವನ್ನು ಹಂಚಿ", listen: "ಸ್ಟೇಷನ್ ತೆರೆಯಿರಿ" },
  mr: { title: "neo-fm वर तुमचा आठवडा", minutes: "मिनिटे ऐकले", songs: "गाणी", streak: "दिवसांची मालिका", days: "दिवस सक्रिय", languages: "भाषा", moods: "मूड", favourite: "या आठवड्याचे आवडते", empty: "या आठवड्यात अजून काही ऐकले नाही. स्टेशन सुरू करा.", share: "माझा आठवडा शेअर करा", listen: "स्टेशन उघडा" },
  bn: { title: "neo-fm এ আপনার সপ্তাহ", minutes: "মিনিট শুনেছেন", songs: "গান", streak: "দিনের ধারা", days: "দিন সক্রিয়", languages: "ভাষা", moods: "মুড", favourite: "এই সপ্তাহের প্রিয়", empty: "এই সপ্তাহে এখনও কিছু শোনা হয়নি। স্টেশন চালু করুন।", share: "আমার সপ্তাহ শেয়ার করুন", listen: "স্টেশন খুলুন" },
};
