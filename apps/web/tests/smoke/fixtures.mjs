/**
 * Stable public-song fixtures shared by the fake backend, the smoke specs and
 * the visual-regression specs. Fixed copy and fixed dates on purpose: nothing
 * here may depend on the clock, the network or a random value, so screenshots
 * only move when the UI moves.
 *
 * Public ids are 10 chars from the alphabet 0-9a-z minus i, l, o, u.
 */
const LINES = {
  hi: {
    title: "बारिश की पहली बूँद",
    lyrics: "बारिश की पहली बूँद गिरी, मिट्टी की ख़ुशबू छाई\nयादों के पन्ने खुल गए, तेरी बातें लौट आईं",
    translit: "baarish ki pehli boond giri, mitti ki khushboo chhaai",
  },
  ta: {
    title: "முதல் மழைத்துளி",
    lyrics: "முதல் மழைத்துளி விழுந்தது, மண்வாசனை எழுந்தது\nநினைவுகளின் பக்கங்கள் திறந்தன, உன் சொற்கள் திரும்பின",
    translit: "mudhal mazhaithuli vizhundhadhu, man vaasanai ezhundhadhu",
  },
  te: {
    title: "తొలి వాన చినుకు",
    lyrics: "తొలి వాన చినుకు రాలింది, మట్టి వాసన లేచింది\nజ్ఞాపకాల పేజీలు తెరుచుకున్నాయి, నీ మాటలు తిరిగొచ్చాయి",
    translit: "toli vaana chinuku raalindi, matti vaasana lechindi",
  },
  kn: {
    title: "ಮೊದಲ ಮಳೆಹನಿ",
    lyrics: "ಮೊದಲ ಮಳೆಹನಿ ಬಿದ್ದಿತು, ಮಣ್ಣಿನ ಪರಿಮಳ ಎದ್ದಿತು\nನೆನಪುಗಳ ಪುಟಗಳು ತೆರೆದವು, ನಿನ್ನ ಮಾತುಗಳು ಮರಳಿದವು",
    translit: "modala malehani biddithu, mannina parimala eddithu",
  },
  bn: {
    title: "প্রথম বৃষ্টির ফোঁটা",
    lyrics: "প্রথম বৃষ্টির ফোঁটা ঝরল, মাটির গন্ধ ছড়াল\nস্মৃতির পাতা খুলে গেল, তোমার কথা ফিরে এল",
    translit: "prothom brishtir fonta jhorlo, matir gondho choralo",
  },
  en: {
    title: "First Raindrop",
    lyrics: "The first raindrop fell, the earth let out its scent\nThe pages of memory opened, and your words came home",
    translit: "",
  },
};

/** One fixture per UI language, plus one with a dedication. */
export const SONG_FIXTURES = {
  hi: { publicId: "vrhd234567", style: "bollywood-ballad" },
  ta: { publicId: "vrta234567", style: "carnatic-fusion" },
  te: { publicId: "vrte234567", style: "tollywood-melody" },
  kn: { publicId: "vrkn234567", style: "sugama-sangeetha" },
  bn: { publicId: "vrbn234567", style: "rabindra-sangeet" },
  en: { publicId: "vren234567", style: "indie-pop" },
};

export const DEDICATED = {
  publicId: "vrdd234567",
  lang: "en",
  to: "Asha Menon",
  message: "For the monsoon we spent in Kochi.\nHappy anniversary.",
};

function job(publicId, lang, style) {
  const l = LINES[lang];
  return {
    id: `00000000-0000-4000-8000-${publicId.replace(/[^0-9a-f]/g, "0").padEnd(12, "0").slice(0, 12)}`,
    status: "completed",
    public_id: publicId,
    published_at: "2026-01-01T00:00:00Z",
    published_visibility: "public",
    song_documents: {
      language: lang,
      style_family: style,
      title: l.title,
      document_json: {
        style_family: style,
        language: lang,
        target_duration_seconds: 90,
        sections: [
          { type: "verse", lyrics: l.lyrics, script: l.lyrics, transliteration: l.translit || undefined, target_seconds: 45 },
          { type: "chorus", lyrics: l.lyrics.split("\n")[0], script: l.lyrics.split("\n")[0], target_seconds: 45 },
        ],
      },
    },
    tracks: [],
  };
}

/** publicId -> job row, for every visual fixture. */
export const FIXTURE_JOBS = {
  ...Object.fromEntries(Object.values(SONG_FIXTURES).map((f, i) => {
    const lang = Object.keys(SONG_FIXTURES)[i];
    return [f.publicId, job(f.publicId, lang, f.style)];
  })),
  [DEDICATED.publicId]: job(DEDICATED.publicId, DEDICATED.lang, "indie-pop"),
};
