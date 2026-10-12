/**
 * Phrases that turn a mention into a request. Matched after normaliseText(), so no punctuation / ZWNJ here.
 * Indic cues are postpositions / particles ("-की आवाज़ में", "குரலில்", "గొంతుతో", "ಧ್ವನಿಯಲ್ಲಿ", "কণ্ঠে"); Hinglish is included
 * because people type Hindi in Latin.
 */
import { normaliseText } from "./normalise";

const n = (xs: string[]) => xs.map(normaliseText);

/** "Sound like / in the voice of / in the style of X". */
export const IMITATION_CUES = n([
  "in the voice of", "voice of", "sound like", "sounds like", "sounding like", "sing like", "sings like", "sung by", "as sung by",
  "in the style of", "style of", "like", "just like", "exactly like", "similar to", "in the manner of", "voice clone", "clone", "impersonate", "imitate", "mimic", "copy the voice",
  // Hindi
  "की आवाज", "की आवाज में", "आवाज में", "जैसी आवाज", "जैसा गाना", "जैसे गाना", "के अंदाज", "के अंदाज में", "की तरह", "जैसा", "जैसी", "जैसे", "की शैली", "के स्टाइल", "स्टाइल में", "की नकल",
  // Hinglish
  "jaisi awaaz", "ki awaaz", "ki awaz", "andaaz mein", "andaz mein", "style mein", "voice mein", "jaisa", "jaise", "ki tarah",
  // Tamil
  "குரலில்", "குரல் போல", "போல", "போன்ற", "பாணியில்", "ஸ்டைலில்",
  // Telugu
  "గొంతుతో", "గొంతులో", "లాగా", "వలె", "శైలిలో", "స్టైల్లో",
  // Kannada
  "ಧ್ವನಿಯಲ್ಲಿ", "ಧ್ವನಿಯಂತೆ", "ಹಾಗೆ", "ಅಂತೆ", "ಶೈಲಿಯಲ್ಲಿ", "ಸ್ಟೈಲ್ನಲ್ಲಿ", "ಸ್ಟೈಲ್ ನಲ್ಲಿ",
  // Bengali
  "কণ্ঠে", "গলায়", "মতো", "মত", "স্টাইলে", "ধাঁচে", "শৈলীতে",
]);

/** Unambiguous "give me the existing words" requests: block with no title needed. */
export const EXPLICIT_REPRODUCTION = n([
  "exact lyrics", "verbatim", "word for word", "same lyrics", "same words as", "copy the lyrics", "copy lyrics", "reproduce the song", "reproduce the lyrics",
  "हूबहू", "वही बोल", "जस का तस", "ஹூபஹூ", "அதே வரிகள்", "అదే సాహిత్యం", "అదే పదాలు", "ಅದೇ ಸಾಹಿತ್ಯ", "হুবহু", "একই কথা", "hubahu", "wahi bol", "same bol",
]);

/** Generic "lyrics of / the song X": a reproduction request only when it also names a title, quoted text or an artist. */
export const LYRICS_CUES = n([
  "lyrics of", "lyrics to", "lyrics from", "full lyrics", "write out the song", "recreate the song", "remake of", "cover of", "cover version of", "rewrite the song", "remix of",
  "गाने के बोल", "के बोल", "पूरा गाना", "பாடல் வரிகள்", "வரிகள்", "పాట సాహిత్యం", "సాహిత్యం", "ಹಾಡಿನ ಸಾಹಿತ್ಯ", "ಸಾಹಿತ್ಯ", "গানের কথা", "গানের লিরিক্স", "ke bol", "bol likh",
]);
