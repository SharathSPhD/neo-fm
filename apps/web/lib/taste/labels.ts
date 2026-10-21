/**
 * Display names for the taste vocabulary, per UI language. The stored values stay the English tokens of brief.ts (the
 * pipeline and the tuning work read those); only the chips and menus are translated. Machine-translated like the other
 * locales; anything missing falls back to the English token.
 */
import type { UiLang } from "../i18n/ui-strings";

type Labels = Readonly<Record<string, string>>;

const hi: Labels = {
  pop: "पॉप", rock: "रॉक", "indie folk": "इंडी फ़ोक", "hip-hop": "हिप-हॉप", "r&b": "आर एंड बी", country: "कंट्री", electronic: "इलेक्ट्रॉनिक", jazz: "जैज़", "lo-fi": "लो-फ़ाई", ballad: "बैलेड", gospel: "गॉस्पेल",
  carnatic: "कर्नाटक", hindustani: "हिन्दुस्तानी", "film melody": "फ़िल्मी धुन", folk: "लोक", devotional: "भक्ति", ghazal: "ग़ज़ल", sufi: "सूफ़ी", bhavageete: "भावगीत", rabindrasangeet: "रवीन्द्र संगीत",
  joyful: "आनंदमय", romantic: "रूमानी", wistful: "उदास-सी चाह", calm: "शांत", energetic: "ऊर्जावान", playful: "चंचल", melancholic: "विषादपूर्ण", hopeful: "आशावान", nostalgic: "यादों भरा",
  "acoustic guitar": "अकूस्टिक गिटार", piano: "पियानो", strings: "स्ट्रिंग्स", synth: "सिंथ", drums: "ड्रम", bass: "बास", veena: "वीणा", violin: "वायलिन", mridangam: "मृदंगम", ghatam: "घटम", flute: "बाँसुरी", nadaswaram: "नादस्वरम", sitar: "सितार", sarod: "सरोद", santoor: "संतूर", tabla: "तबला", harmonium: "हारमोनियम", dholak: "ढोलक",
  classic: "क्लासिक", "70s-80s": "70-80 का दशक", "90s": "90 का दशक", "2000s": "2000 का दशक", modern: "आधुनिक",
  medium: "मध्यम", high: "तेज़", formal: "औपचारिक", colloquial: "बोलचाल", city: "शहर", village: "गाँव", diaspora: "प्रवासी",
};
const mr: Labels = {
  pop: "पॉप", rock: "रॉक", "indie folk": "इंडी फोक", "hip-hop": "हिप-हॉप", "r&b": "आर अँड बी", country: "कंट्री", electronic: "इलेक्ट्रॉनिक", jazz: "जॅझ", "lo-fi": "लो-फाय", ballad: "बॅलड", gospel: "गॉस्पेल",
  carnatic: "कर्नाटक", hindustani: "हिंदुस्तानी", "film melody": "चित्रपट गीत", folk: "लोक", devotional: "भक्ती", ghazal: "गझल", sufi: "सुफी", bhavageete: "भावगीत", rabindrasangeet: "रवींद्र संगीत",
  joyful: "आनंदी", romantic: "रोमँटिक", wistful: "हुरहुर", calm: "शांत", energetic: "उत्साही", playful: "खेळकर", melancholic: "विषण्ण", hopeful: "आशावादी", nostalgic: "आठवणींनी भरलेला",
  "acoustic guitar": "अकूस्टिक गिटार", piano: "पियानो", strings: "स्ट्रिंग्ज", synth: "सिंथ", drums: "ड्रम", bass: "बास", veena: "वीणा", violin: "व्हायोलिन", mridangam: "मृदंगम", ghatam: "घटम", flute: "बासरी", nadaswaram: "नादस्वरम", sitar: "सतार", sarod: "सरोद", santoor: "संतूर", tabla: "तबला", harmonium: "हार्मोनियम", dholak: "ढोलकी",
  classic: "क्लासिक", "70s-80s": "७०-८० चं दशक", "90s": "९० चं दशक", "2000s": "२००० चं दशक", modern: "आधुनिक",
  medium: "मध्यम", high: "जोशपूर्ण", formal: "औपचारिक", colloquial: "बोलीभाषा", city: "शहर", village: "गाव", diaspora: "प्रवासी",
};
const ta: Labels = {
  pop: "பாப்", rock: "ராக்", "indie folk": "இண்டி நாட்டுப்புறம்", "hip-hop": "ஹிப்-ஹாப்", "r&b": "ஆர் அண்ட் பி", country: "கன்ட்ரி", electronic: "எலக்ட்ரானிக்", jazz: "ஜாஸ்", "lo-fi": "லோ-ஃபை", ballad: "பாலட்", gospel: "காஸ்பல்",
  carnatic: "கர்நாடக இசை", hindustani: "ஹிந்துஸ்தானி", "film melody": "திரை மெலடி", folk: "நாட்டுப்புறம்", devotional: "பக்தி", ghazal: "கஜல்", sufi: "சூஃபி", bhavageete: "பாவகீதே", rabindrasangeet: "ரவீந்திர சங்கீதம்",
  joyful: "மகிழ்ச்சி", romantic: "காதல்", wistful: "ஏக்கம்", calm: "அமைதி", energetic: "உற்சாகம்", playful: "குறும்பு", melancholic: "சோகம்", hopeful: "நம்பிக்கை", nostalgic: "பழைய நினைவுகள்",
  "acoustic guitar": "அகோஸ்டிக் கிடார்", piano: "பியானோ", strings: "தந்தி இசைக்கருவிகள்", synth: "சிந்த்", drums: "டிரம்ஸ்", bass: "பேஸ்", veena: "வீணை", violin: "வயலின்", mridangam: "மிருதங்கம்", ghatam: "கடம்", flute: "புல்லாங்குழல்", nadaswaram: "நாதஸ்வரம்", sitar: "சிதார்", sarod: "சரோட்", santoor: "சந்தூர்", tabla: "தபலா", harmonium: "ஹார்மோனியம்", dholak: "டோலக்",
  classic: "பழைய கிளாசிக்", "70s-80s": "70-80களின் காலம்", "90s": "90களின் காலம்", "2000s": "2000களின் காலம்", modern: "நவீனம்",
  medium: "மிதம்", high: "வேகம்", formal: "இலக்கிய நடை", colloquial: "பேச்சு நடை", city: "நகரம்", village: "கிராமம்", diaspora: "புலம்பெயர்ந்தோர்",
};
const te: Labels = {
  pop: "పాప్", rock: "రాక్", "indie folk": "ఇండీ ఫోక్", "hip-hop": "హిప్-హాప్", "r&b": "ఆర్ అండ్ బి", country: "కంట్రీ", electronic: "ఎలక్ట్రానిక్", jazz: "జాజ్", "lo-fi": "లో-ఫై", ballad: "బ్యాలడ్", gospel: "గాస్పెల్",
  carnatic: "కర్ణాటక సంగీతం", hindustani: "హిందుస్థానీ", "film melody": "సినిమా మెలొడీ", folk: "జానపదం", devotional: "భక్తి", ghazal: "గజల్", sufi: "సూఫీ", bhavageete: "భావగీతం", rabindrasangeet: "రవీంద్ర సంగీతం",
  joyful: "ఆనందం", romantic: "ప్రేమ", wistful: "ఆరాటం", calm: "ప్రశాంతం", energetic: "ఉత్సాహం", playful: "చిలిపి", melancholic: "విషాదం", hopeful: "ఆశ", nostalgic: "జ్ఞాపకాలు",
  "acoustic guitar": "అకౌస్టిక్ గిటార్", piano: "పియానో", strings: "తంత్రీ వాద్యాలు", synth: "సింథ్", drums: "డ్రమ్స్", bass: "బాస్", veena: "వీణ", violin: "వయోలిన్", mridangam: "మృదంగం", ghatam: "ఘటం", flute: "వేణువు", nadaswaram: "నాదస్వరం", sitar: "సితార్", sarod: "సరోద్", santoor: "సంతూర్", tabla: "తబలా", harmonium: "హార్మోనియం", dholak: "ధోలక్",
  classic: "క్లాసిక్", "70s-80s": "70-80ల కాలం", "90s": "90ల కాలం", "2000s": "2000ల కాలం", modern: "ఆధునికం",
  medium: "మధ్యస్థం", high: "ఉధృతం", formal: "గ్రాంథిక శైలి", colloquial: "వ్యావహారిక శైలి", city: "నగరం", village: "పల్లె", diaspora: "ప్రవాసం",
};
const kn: Labels = {
  pop: "ಪಾಪ್", rock: "ರಾಕ್", "indie folk": "ಇಂಡೀ ಫೋಕ್", "hip-hop": "ಹಿಪ್-ಹಾಪ್", "r&b": "ಆರ್ ಅಂಡ್ ಬಿ", country: "ಕಂಟ್ರಿ", electronic: "ಎಲೆಕ್ಟ್ರಾನಿಕ್", jazz: "ಜಾಝ್", "lo-fi": "ಲೋ-ಫೈ", ballad: "ಬ್ಯಾಲಡ್", gospel: "ಗಾಸ್ಪೆಲ್",
  carnatic: "ಕರ್ನಾಟಕ ಸಂಗೀತ", hindustani: "ಹಿಂದೂಸ್ತಾನಿ", "film melody": "ಚಿತ್ರಗೀತೆ", folk: "ಜಾನಪದ", devotional: "ಭಕ್ತಿ", ghazal: "ಗಜಲ್", sufi: "ಸೂಫಿ", bhavageete: "ಭಾವಗೀತೆ", rabindrasangeet: "ರವೀಂದ್ರ ಸಂಗೀತ",
  joyful: "ಸಂತೋಷ", romantic: "ಪ್ರೇಮ", wistful: "ಹಂಬಲ", calm: "ಶಾಂತ", energetic: "ಉತ್ಸಾಹ", playful: "ತುಂಟತನ", melancholic: "ವಿಷಾದ", hopeful: "ಆಶಾವಾದ", nostalgic: "ನೆನಪುಗಳು",
  "acoustic guitar": "ಅಕೌಸ್ಟಿಕ್ ಗಿಟಾರ್", piano: "ಪಿಯಾನೊ", strings: "ತಂತಿ ವಾದ್ಯಗಳು", synth: "ಸಿಂತ್", drums: "ಡ್ರಮ್ಸ್", bass: "ಬಾಸ್", veena: "ವೀಣೆ", violin: "ಪಿಟೀಲು", mridangam: "ಮೃದಂಗ", ghatam: "ಘಟಂ", flute: "ಕೊಳಲು", nadaswaram: "ನಾದಸ್ವರ", sitar: "ಸಿತಾರ್", sarod: "ಸರೋದ್", santoor: "ಸಂತೂರ್", tabla: "ತಬಲಾ", harmonium: "ಹಾರ್ಮೋನಿಯಂ", dholak: "ಢೋಲಕ್",
  classic: "ಕ್ಲಾಸಿಕ್", "70s-80s": "70-80ರ ದಶಕ", "90s": "90ರ ದಶಕ", "2000s": "2000ರ ದಶಕ", modern: "ಆಧುನಿಕ",
  medium: "ಮಧ್ಯಮ", high: "ತೀವ್ರ", formal: "ಗ್ರಂಥಸ್ಥ ಶೈಲಿ", colloquial: "ಆಡುಮಾತಿನ ಶೈಲಿ", city: "ನಗರ", village: "ಹಳ್ಳಿ", diaspora: "ಪ್ರವಾಸಿ",
};
const bn: Labels = {
  pop: "পপ", rock: "রক", "indie folk": "ইন্ডি ফোক", "hip-hop": "হিপ-হপ", "r&b": "আর অ্যান্ড বি", country: "কান্ট্রি", electronic: "ইলেকট্রনিক", jazz: "জ্যাজ", "lo-fi": "লো-ফাই", ballad: "ব্যালাড", gospel: "গসপেল",
  carnatic: "কর্ণাটকী", hindustani: "হিন্দুস্তানি", "film melody": "সিনেমার সুর", folk: "লোকগীতি", devotional: "ভক্তিগীতি", ghazal: "গজল", sufi: "সুফি", bhavageete: "ভাবগীতি", rabindrasangeet: "রবীন্দ্রসংগীত",
  joyful: "আনন্দময়", romantic: "রোমান্টিক", wistful: "উদাস", calm: "শান্ত", energetic: "প্রাণবন্ত", playful: "চঞ্চল", melancholic: "বিষণ্ণ", hopeful: "আশাভরা", nostalgic: "স্মৃতিময়",
  "acoustic guitar": "অ্যাকোস্টিক গিটার", piano: "পিয়ানো", strings: "তারের বাদ্য", synth: "সিন্থ", drums: "ড্রামস", bass: "বেস", veena: "বীণা", violin: "বেহালা", mridangam: "মৃদঙ্গম", ghatam: "ঘটম", flute: "বাঁশি", nadaswaram: "নাদস্বরম", sitar: "সেতার", sarod: "সরোদ", santoor: "সন্তুর", tabla: "তবলা", harmonium: "হারমোনিয়াম", dholak: "ঢোলক",
  classic: "ক্লাসিক", "70s-80s": "৭০-৮০-র দশক", "90s": "৯০-এর দশক", "2000s": "২০০০-এর দশক", modern: "আধুনিক",
  medium: "মাঝারি", high: "তীব্র", formal: "সাধু ঢং", colloquial: "চলিত ঢং", city: "শহর", village: "গ্রাম", diaspora: "প্রবাসী",
};

const LABELS: Partial<Record<UiLang, Labels>> = { hi, mr, ta, te, kn, bn };

/** The label for a vocabulary token in the UI language, or the token itself. */
export function tasteLabel(token: string, lang: string): string {
  return LABELS[lang as UiLang]?.[token] ?? token;
}
