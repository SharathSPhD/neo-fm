const SECTION_WORDS = /^(hook|verse|chorus|bridge|pallavi|anupallavi|charanam|lullaby|পল্লবী|হুক|অন্তরা|মুখড়া|मुखड़ा|अंतरा|பல்லவி|சரணம்|పల్లవి|చరణం|ಪಲ್ಲವಿ|ಚರಣ|ಅನುಪಲ್ಲವಿ)/i; // no \b: it is ASCII-only and never matches Indic scripts

/** Lyric lines that are actually sung: drops section headers, markdown and blank lines. */
export function singableLines(raw: string): string[] {
  return raw.split("\n").map((l) => l.trim()).filter((l) => {
    if (!l) return false;
    if (/^#/.test(l) || /^\*\*.*\*\*$/.test(l) || /^\[.*\]$/.test(l)) return false;
    const words = l.replace(/[*()\d]/g, "").trim().split(/\s+/);
    return !(words.length <= 3 && SECTION_WORDS.test(words[0] ?? "") && !/[,.!?]/.test(l));
  });
}
