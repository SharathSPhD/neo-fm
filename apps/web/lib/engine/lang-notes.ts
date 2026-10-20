/**
 * Per-language craft notes for languages whose poets and polish drift toward a neighbour (Marathi toward Hindi).
 * No model call and no flag: a language without a note returns "" and behaves exactly as before.
 */
const NOTES: Record<string, string> = {
  mr: "Craft notes (Marathi): write Marathi, not Hindi in Devanagari. Use Marathi forms: आहे/आहेस/आहेत (not है), नाही (not नहीं), मी, तू, तुम्ही, आम्ही, and the case endings ला, ना, चा/ची/चे/च्या agreeing with the noun. Keep ळ where Marathi has it (डोळे, सावळा, ओळ). Prefer spoken-poetic tadbhava words over Sanskrit-heavy or Hindi borrowings. Rhyme paired lines (antyaprasa) and keep them to equal mātrā so both sing to one tune. If the brief names a form, follow it: abhang and ovi use short lines with a returning refrain, bhavgeet runs mukhda then antara and returns to the mukhda, lavani is quick and playful with a rhythmic refrain.",
};

export const languageNote = (code: string): string => NOTES[code] ?? "";
