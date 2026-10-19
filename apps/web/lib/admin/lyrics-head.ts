/** First sung lines of a stored lyric, for the 30 s clip model: it sings only the opening, so scoring or rendering the whole text fails the diction gate. */
const SECTION_WORDS = /^(hook|verse|chorus|bridge|outro|intro|pallavi|anupallavi|charanam|charanam|mukhda|mukhra|antara|sthayi|reprise|పల్లవి|అనుపల్లవి|చరణం|ಪಲ್ಲವಿ|ಅನುಪಲ್ಲವಿ|ಚರಣ|பல்லவி|அனுபல்லவி|சரணம்|मुखड़ा|मुखड़ा|अंतरा|हुक)(\b|\s|\d|\(|$)/i;

export function isSungLine(raw: string): boolean {
  const line = raw.replace(/[#*_]/g, "").trim();
  if (!line) return false;
  if (/^\[.*\]$/.test(line)) return false;
  if (SECTION_WORDS.test(line) && line.length <= 40 && !/[,.!?;:।]/.test(line)) return false;
  if (/^\(.*\)$/.test(line)) return false;
  if (/vimarsa|\b\d+\s*s\b.*lines?\b/i.test(line)) return false;
  return true;
}

export function headLines(lyrics: string, n: number): string {
  return lyrics.split(/\r?\n/).filter(isSungLine).map((l) => l.replace(/[*_#]/g, "").trim()).slice(0, Math.max(1, Math.floor(n))).join("\n");
}
