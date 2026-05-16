/**
 * @neo-fm/g2p — Grapheme-to-phoneme for the languages neo-fm sings in.
 *
 * Promised by ADR 0010 (Phase 6 / multilingual lyrics roadmap), never
 * landed. v1.3 Sprint 4 finally ships the rule-pack rewrite so the
 * vocal-synth backends receive a canonical pronunciation string
 * (`phonemes[]` on each Song Document section) instead of raw lyrics
 * that the upstream Svara / Parler tokenisers butcher for Indic input.
 *
 * Design rationale
 * ----------------
 *
 *   - **Rule-based, not model-based.** A neural G2P would beat us on
 *     coverage but binds the worker / sidecar to an extra model load
 *     and silently regresses on rare words. Rule packs are tiny,
 *     deterministic, and per-rule debuggable via `rule_traces`.
 *   - **Per-language, not per-script.** Hindi-in-Devanagari and
 *     Marathi-in-Devanagari share a script but not pronunciation
 *     conventions (schwa deletion, gemination, retroflex/dental
 *     contrast). We key on `language`, not script, and emit a
 *     `script` hint into the trace so downstream evaluators can group.
 *   - **Output is a string list, not IPA.** Each entry is a single
 *     phoneme token; the union of valid tokens is intentionally close
 *     to ARPAbet / SAMPA so a non-IPA-aware backend can still consume
 *     it. We do NOT emit IPA glyphs into the array because that turns
 *     a stem-by-character backend into a stem-by-codepoint backend
 *     and breaks Parler's tokenizer.
 *   - **Tamil is canonicalisation-only for v1.3.** A real Tamil G2P
 *     needs sandhi rules and is a v1.4 ask. We canonicalise
 *     Tamil-script input to a Roman intermediate (UoM-style) so the
 *     vocal-synth side has something better than raw lyrics; the
 *     phonemes array is the canonical romanisation broken into
 *     syllable nuclei. The trace flags `script:tamil-canonicalised`
 *     so the eval harness counts these separately.
 *
 * Output contract: see `G2PResult`.
 */

export type Language = "hi" | "kn" | "ta" | "en";

export type Script =
  | "latin"
  | "devanagari"
  | "kannada"
  | "tamil"
  | "telugu"
  | "bengali";

export interface Syllable {
  onset: string;
  nucleus: string;
  coda: string;
}

export interface G2PResult {
  phonemes: string[];
  syllables: Syllable[];
  rule_traces: string[];
  /** Final script after canonicalisation (e.g. Tamil → "latin"). */
  script: Script;
  language: Language;
}

export interface G2PInput {
  text: string;
  language: Language;
  /** Optional. If unset, we infer from the codepoint range. */
  script?: Script;
}

export function phonemize(input: G2PInput): G2PResult {
  const text = input.text.normalize("NFC");
  const script = input.script ?? inferScript(text);
  switch (input.language) {
    case "hi":
      return phonemizeHindi(text, script);
    case "kn":
      return phonemizeKannada(text, script);
    case "ta":
      return phonemizeTamil(text, script);
    case "en":
      return phonemizeEnglish(text, script);
    default: {
      const _exhaustive: never = input.language;
      throw new Error(`unsupported g2p language: ${String(_exhaustive)}`);
    }
  }
}

export function inferScript(text: string): Script {
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c === undefined) continue;
    if (c >= 0x0900 && c <= 0x097f) return "devanagari";
    if (c >= 0x0c80 && c <= 0x0cff) return "kannada";
    if (c >= 0x0b80 && c <= 0x0bff) return "tamil";
    if (c >= 0x0c00 && c <= 0x0c7f) return "telugu";
    if (c >= 0x0980 && c <= 0x09ff) return "bengali";
  }
  return "latin";
}

// =====================================================================
// Hindi rule pack
// =====================================================================
//
// Coverage targets: schwa deletion (word-final, between non-clustered
// consonants), nasalization (anusvara + chandrabindu), voicing
// assimilation across virama clusters, aspirated-stop pairs. Tested
// via the minimal-pair fixture in `tests/minimal-pairs/hi-schwa.json`.

interface Consonant {
  /** Phoneme label emitted into `phonemes[]`. */
  base: string;
  /** True if this consonant carries an inherent /a/ vowel by default. */
  inherent: boolean;
  /** True if it's a nasal consonant (used by anusvara assimilation). */
  nasal?: boolean;
  /** Place of articulation for nasal assimilation. */
  place?: "labial" | "dental" | "alveolar" | "retroflex" | "palatal" | "velar";
  /** Voiced? Drives voicing-assimilation rule across virama clusters. */
  voiced: boolean;
}

// Devanagari consonants. The five varga rows + nasals + sibilants.
// Aspirated/unaspirated distinction is preserved as separate phonemes
// (`kh` vs `k`, `gh` vs `g`) because the Indic-Parler tokenizer keys
// on them.
const HI_CONSONANTS: Record<string, Consonant> = {
  क: { base: "k", inherent: true, voiced: false, place: "velar" },
  ख: { base: "kh", inherent: true, voiced: false, place: "velar" },
  ग: { base: "g", inherent: true, voiced: true, place: "velar" },
  घ: { base: "gh", inherent: true, voiced: true, place: "velar" },
  ङ: { base: "ng", inherent: true, nasal: true, voiced: true, place: "velar" },
  च: { base: "ch", inherent: true, voiced: false, place: "palatal" },
  छ: { base: "chh", inherent: true, voiced: false, place: "palatal" },
  ज: { base: "j", inherent: true, voiced: true, place: "palatal" },
  झ: { base: "jh", inherent: true, voiced: true, place: "palatal" },
  ञ: { base: "ny", inherent: true, nasal: true, voiced: true, place: "palatal" },
  ट: { base: "T", inherent: true, voiced: false, place: "retroflex" },
  ठ: { base: "Th", inherent: true, voiced: false, place: "retroflex" },
  ड: { base: "D", inherent: true, voiced: true, place: "retroflex" },
  ढ: { base: "Dh", inherent: true, voiced: true, place: "retroflex" },
  ण: { base: "N", inherent: true, nasal: true, voiced: true, place: "retroflex" },
  त: { base: "t", inherent: true, voiced: false, place: "dental" },
  थ: { base: "th", inherent: true, voiced: false, place: "dental" },
  द: { base: "d", inherent: true, voiced: true, place: "dental" },
  ध: { base: "dh", inherent: true, voiced: true, place: "dental" },
  न: { base: "n", inherent: true, nasal: true, voiced: true, place: "dental" },
  प: { base: "p", inherent: true, voiced: false, place: "labial" },
  फ: { base: "ph", inherent: true, voiced: false, place: "labial" },
  ब: { base: "b", inherent: true, voiced: true, place: "labial" },
  भ: { base: "bh", inherent: true, voiced: true, place: "labial" },
  म: { base: "m", inherent: true, nasal: true, voiced: true, place: "labial" },
  य: { base: "y", inherent: true, voiced: true, place: "palatal" },
  र: { base: "r", inherent: true, voiced: true, place: "alveolar" },
  ल: { base: "l", inherent: true, voiced: true, place: "alveolar" },
  व: { base: "v", inherent: true, voiced: true, place: "labial" },
  श: { base: "sh", inherent: true, voiced: false, place: "palatal" },
  ष: { base: "Sh", inherent: true, voiced: false, place: "retroflex" },
  स: { base: "s", inherent: true, voiced: false, place: "dental" },
  ह: { base: "h", inherent: true, voiced: true, place: "velar" },
};

// Devanagari independent vowels.
const HI_VOWELS: Record<string, string> = {
  अ: "a",
  आ: "aa",
  इ: "i",
  ई: "ii",
  उ: "u",
  ऊ: "uu",
  ऋ: "ri",
  ए: "e",
  ऐ: "ai",
  ओ: "o",
  औ: "au",
};

// Devanagari dependent vowel signs (matras).
const HI_MATRA: Record<string, string> = {
  "\u093e": "aa", // ा
  "\u093f": "i", // ि
  "\u0940": "ii", // ी
  "\u0941": "u", // ु
  "\u0942": "uu", // ू
  "\u0943": "ri", // ृ
  "\u0947": "e", // े
  "\u0948": "ai", // ै
  "\u094b": "o", // ो
  "\u094c": "au", // ौ
};

const HI_VIRAMA = "\u094d"; // ्
const HI_ANUSVARA = "\u0902"; // ं
const HI_CHANDRABINDU = "\u0901"; // ँ
const HI_VISARGA = "\u0903"; // ः
const HI_NUKTA = "\u093c"; // ़

// Aksharas: one consonant + optional nukta + (optional virama+consonant)* +
// (optional matra | nothing) + (optional anusvara | chandrabindu | visarga)
function tokenizeHindi(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? "";
    if (HI_CONSONANTS[ch] || HI_VOWELS[ch]) {
      let end = i + 1;
      // Nukta and combining marks attach to the previous akshara.
      while (
        end < text.length &&
        (text[end] === HI_NUKTA ||
          text[end] === HI_VIRAMA ||
          (text[end] !== undefined &&
            (HI_MATRA[text[end] as string] ||
              text[end] === HI_ANUSVARA ||
              text[end] === HI_CHANDRABINDU ||
              text[end] === HI_VISARGA)))
      ) {
        const cur = text[end];
        if (cur === HI_VIRAMA && end + 1 < text.length) {
          const nxt = text[end + 1] ?? "";
          if (HI_CONSONANTS[nxt]) {
            end += 2;
            continue;
          }
        }
        end += 1;
      }
      out.push(text.slice(i, end));
      i = end;
      continue;
    }
    if (ch === " " || ch === "\n" || ch === "\t" || ch === "\u00a0") {
      out.push(" ");
      i += 1;
      continue;
    }
    // Ignore punctuation in the phoneme stream but keep word boundaries.
    if (",;:!?.।॥…\u200c\u200d-—".includes(ch)) {
      out.push(" ");
      i += 1;
      continue;
    }
    // Pass-through (latin letters, digits, anything else).
    out.push(ch);
    i += 1;
  }
  return out;
}

function phonemizeHindi(text: string, script: Script): G2PResult {
  const traces: string[] = [];
  if (script === "devanagari") {
    return phonemizeHindiDevanagari(text, traces);
  }
  if (script === "latin") {
    // Hinglish: light hint, falls through to a Roman-as-phonemes pass.
    return phonemizeHindiLatin(text, traces);
  }
  traces.push(`hi:unsupported-script:${script}:passthrough`);
  return latinPassthrough(text, "hi", script, traces);
}

function phonemizeHindiDevanagari(text: string, traces: string[]): G2PResult {
  const aksharas = tokenizeHindi(text);
  // First pass: convert each akshara into a struct { onset[], nucleus, coda }.
  interface Akshara {
    onsets: { c: Consonant; final: boolean }[]; // final=true on the last consonant
    nucleus: string; // "a" (inherent) or matra-derived or "" (after virama)
    nasal_coda: string; // "" | "n" | "m" | "ng" | "ny" | "N"
    visarga: boolean;
    is_word_break: boolean;
    raw: string;
  }

  const aks: Akshara[] = [];
  for (const tok of aksharas) {
    if (tok === " ") {
      aks.push({
        onsets: [],
        nucleus: "",
        nasal_coda: "",
        visarga: false,
        is_word_break: true,
        raw: tok,
      });
      continue;
    }
    if (tok.length > 0 && HI_VOWELS[tok[0] ?? ""]) {
      // Vowel-initial akshara (possibly with trailing nasal / visarga).
      const head = tok[0] ?? "";
      let nasalCoda = "";
      let visarga = false;
      for (let k = 1; k < tok.length; k++) {
        const m = tok[k];
        if (m === HI_ANUSVARA) nasalCoda = "n";
        else if (m === HI_CHANDRABINDU) nasalCoda = "~";
        else if (m === HI_VISARGA) visarga = true;
      }
      aks.push({
        onsets: [],
        nucleus: HI_VOWELS[head] ?? "a",
        nasal_coda: nasalCoda,
        visarga,
        is_word_break: false,
        raw: tok,
      });
      continue;
    }
    // Consonant-led akshara
    const onsets: { c: Consonant; final: boolean }[] = [];
    let nucleus = ""; // we'll decide at the end
    let hasInherent = true;
    let nasalCoda = "";
    let visarga = false;
    let i = 0;
    while (i < tok.length) {
      const ch = tok[i] ?? "";
      // Anusvara / chandrabindu / visarga can also trail a matra, in
      // which case the consonant branch below has already advanced
      // past the consonant + matra and we land here. Handle them
      // before the unconditional `i += 1` fallthrough.
      if (ch === HI_ANUSVARA) {
        nasalCoda = "n";
        if (hasInherent && !nucleus) nucleus = "a";
        i += 1;
        continue;
      }
      if (ch === HI_CHANDRABINDU) {
        nasalCoda = "~";
        if (hasInherent && !nucleus) nucleus = "a";
        i += 1;
        continue;
      }
      if (ch === HI_VISARGA) {
        visarga = true;
        if (hasInherent && !nucleus) nucleus = "a";
        i += 1;
        continue;
      }
      const con = HI_CONSONANTS[ch];
      if (con) {
        // peek for nukta -> we ignore the contrast in v1.3 except for
        // the well-known qa/za/fa pairings.
        let pushCon = con;
        if (tok[i + 1] === HI_NUKTA) {
          if (ch === "क") pushCon = { ...con, base: "q" };
          else if (ch === "ज") pushCon = { ...con, base: "z" };
          else if (ch === "फ") pushCon = { ...con, base: "f" };
          i += 1;
        }
        onsets.push({ c: pushCon, final: true });
        i += 1;
        // Next char drives whether this consonant is "final" (a vowel /
        // word boundary follows) or part of a cluster (virama follows).
        if (tok[i] === HI_VIRAMA) {
          const last = onsets[onsets.length - 1];
          if (last) last.final = false;
          hasInherent = false;
          i += 1;
          continue;
        }
        const m = tok[i];
        if (m !== undefined && HI_MATRA[m]) {
          nucleus = HI_MATRA[m] ?? "a";
          hasInherent = false;
          i += 1;
          continue;
        }
        if (m === HI_ANUSVARA) {
          nasalCoda = "n"; // placeholder, resolved later via place assimilation
          if (hasInherent && !nucleus) nucleus = "a";
          i += 1;
          continue;
        }
        if (m === HI_CHANDRABINDU) {
          nasalCoda = "~";
          if (hasInherent && !nucleus) nucleus = "a";
          i += 1;
          continue;
        }
        if (m === HI_VISARGA) {
          visarga = true;
          if (hasInherent && !nucleus) nucleus = "a";
          i += 1;
          continue;
        }
        // No further marks → akshara ends. If we never set a nucleus
        // and the inherent vowel is still in play, fill it.
        if (!nucleus && hasInherent) nucleus = "a";
        break;
      }
      i += 1;
    }
    aks.push({
      onsets,
      nucleus,
      nasal_coda: nasalCoda,
      visarga,
      is_word_break: false,
      raw: tok,
    });
  }

  // Resolve nasal-coda place assimilation (rule: anusvara takes the
  // place of the following stop, defaults to /n/ otherwise).
  for (let i = 0; i < aks.length; i++) {
    const a = aks[i];
    if (!a || a.nasal_coda !== "n") continue;
    // Look at the next non-empty akshara's onset
    let j = i + 1;
    while (j < aks.length && aks[j]?.is_word_break) j += 1;
    const next = aks[j];
    const firstOnset = next?.onsets[0]?.c;
    if (!firstOnset) {
      // word-final anusvara → keep /n/
      continue;
    }
    const before = a.nasal_coda;
    switch (firstOnset.place) {
      case "velar":
        a.nasal_coda = "ng";
        break;
      case "palatal":
        a.nasal_coda = "ny";
        break;
      case "retroflex":
        a.nasal_coda = "N";
        break;
      case "labial":
        a.nasal_coda = "m";
        break;
      case "dental":
      case "alveolar":
      default:
        a.nasal_coda = "n";
    }
    if (a.nasal_coda !== before) {
      traces.push(
        `hi:nasal-assimilation:${before}->${a.nasal_coda}/${firstOnset.base}`,
      );
    }
  }

  // Schwa deletion. Hindi deletes the inherent /a/ on a non-final
  // consonant at the end of a word and (recursively) on the
  // penultimate consonant if the antepenultimate has a vowel. We
  // implement the conservative "word-final schwa drop" rule because
  // it's the variant Hindi listeners notice; deeper variants are
  // a v1.4 ask.
  for (let i = 0; i < aks.length; i++) {
    const a = aks[i];
    if (!a) continue;
    if (a.nucleus !== "a") continue;
    if (a.is_word_break) continue;
    // Word-final if the next akshara is a word break or end-of-input.
    const next = aks[i + 1];
    const wordFinal = next === undefined || next.is_word_break;
    if (wordFinal && a.onsets.length > 0) {
      a.nucleus = "";
      traces.push(`hi:schwa-delete:final:${akshara_label(a)}`);
    }
  }

  // Emit phonemes + syllable structure.
  const phonemes: string[] = [];
  const syllables: Syllable[] = [];
  for (const a of aks) {
    if (a.is_word_break) {
      if (phonemes[phonemes.length - 1] !== " ") phonemes.push(" ");
      continue;
    }
    if (a.onsets.length === 0 && a.nucleus) {
      // Vowel-initial
      phonemes.push(a.nucleus);
      syllables.push({ onset: "", nucleus: a.nucleus, coda: a.nasal_coda });
      if (a.nasal_coda) phonemes.push(a.nasal_coda);
      if (a.visarga) phonemes.push("h");
      continue;
    }
    const onsetStr = a.onsets.map((o) => o.c.base).join("");
    for (const o of a.onsets) phonemes.push(o.c.base);
    if (a.nucleus) phonemes.push(a.nucleus);
    syllables.push({
      onset: onsetStr,
      nucleus: a.nucleus,
      coda: a.nasal_coda || (a.visarga ? "h" : ""),
    });
    if (a.nasal_coda) phonemes.push(a.nasal_coda);
    if (a.visarga) phonemes.push("h");
  }

  return {
    phonemes: dedupSpaces(phonemes),
    syllables,
    rule_traces: traces,
    script: "devanagari",
    language: "hi",
  };
}

function akshara_label(a: {
  onsets: { c: Consonant }[];
  nucleus: string;
}): string {
  return `${a.onsets.map((o) => o.c.base).join("")}${a.nucleus}`;
}

function phonemizeHindiLatin(text: string, traces: string[]): G2PResult {
  // Hinglish heuristic: route through a small longest-match table so
  // "th"/"ph"/"kh" land on aspirated stops and "aa"/"ee"/"oo" land on
  // long vowels. Then break by whitespace into syllable-ish chunks.
  const HINTS: [string, string][] = [
    ["aa", "aa"],
    ["ee", "ii"],
    ["oo", "uu"],
    ["ai", "ai"],
    ["au", "au"],
    ["th", "th"],
    ["ph", "ph"],
    ["kh", "kh"],
    ["gh", "gh"],
    ["dh", "dh"],
    ["bh", "bh"],
    ["ch", "ch"],
    ["sh", "sh"],
    ["ng", "ng"],
    ["ny", "ny"],
  ];
  const lowered = text.toLowerCase();
  const phonemes: string[] = [];
  const syllables: Syllable[] = [];
  let buf = "";
  let i = 0;
  let applied = 0;
  const flushBuf = () => {
    if (buf) {
      // Treat the buffered Roman chars as one syllable nucleus group.
      syllables.push({ onset: "", nucleus: buf, coda: "" });
      buf = "";
    }
  };
  while (i < lowered.length) {
    const ch = lowered[i] ?? "";
    if (/[a-z]/.test(ch)) {
      let matched = false;
      for (const [k, v] of HINTS) {
        if (lowered.startsWith(k, i)) {
          phonemes.push(v);
          buf += v;
          i += k.length;
          applied += 1;
          matched = true;
          break;
        }
      }
      if (!matched) {
        phonemes.push(ch);
        buf += ch;
        i += 1;
      }
      continue;
    }
    flushBuf();
    if (phonemes[phonemes.length - 1] !== " ") phonemes.push(" ");
    i += 1;
  }
  flushBuf();
  traces.push(`hi:hinglish-hints-applied:${applied}`);
  return {
    phonemes: dedupSpaces(phonemes),
    syllables,
    rule_traces: traces,
    script: "latin",
    language: "hi",
  };
}

// =====================================================================
// Kannada rule pack
// =====================================================================

const KN_CONSONANTS: Record<string, string> = {
  ಕ: "k",
  ಖ: "kh",
  ಗ: "g",
  ಘ: "gh",
  ಙ: "ng",
  ಚ: "ch",
  ಛ: "chh",
  ಜ: "j",
  ಝ: "jh",
  ಞ: "ny",
  ಟ: "T",
  ಠ: "Th",
  ಡ: "D",
  ಢ: "Dh",
  ಣ: "N",
  ತ: "t",
  ಥ: "th",
  ದ: "d",
  ಧ: "dh",
  ನ: "n",
  ಪ: "p",
  ಫ: "ph",
  ಬ: "b",
  ಭ: "bh",
  ಮ: "m",
  ಯ: "y",
  ರ: "r",
  ಲ: "l",
  ವ: "v",
  ಶ: "sh",
  ಷ: "Sh",
  ಸ: "s",
  ಹ: "h",
  ಳ: "L",
};

const KN_VOWELS: Record<string, string> = {
  ಅ: "a",
  ಆ: "aa",
  ಇ: "i",
  ಈ: "ii",
  ಉ: "u",
  ಊ: "uu",
  ಋ: "ri",
  ಎ: "e",
  ಏ: "ee",
  ಐ: "ai",
  ಒ: "o",
  ಓ: "oo",
  ಔ: "au",
};

const KN_MATRA: Record<string, string> = {
  "\u0cbe": "aa",
  "\u0cbf": "i",
  "\u0cc0": "ii",
  "\u0cc1": "u",
  "\u0cc2": "uu",
  "\u0cc3": "ri",
  "\u0cc6": "e",
  "\u0cc7": "ee",
  "\u0cc8": "ai",
  "\u0cca": "o",
  "\u0ccb": "oo",
  "\u0ccc": "au",
};

const KN_VIRAMA = "\u0ccd";
const KN_ANUSVARA = "\u0c82";
const KN_VISARGA = "\u0c83";

function phonemizeKannada(text: string, script: Script): G2PResult {
  const traces: string[] = [];
  if (script !== "kannada") {
    if (script === "latin") {
      traces.push("kn:latin-passthrough");
      return latinPassthrough(text, "kn", "latin", traces);
    }
    traces.push(`kn:unsupported-script:${script}:passthrough`);
    return latinPassthrough(text, "kn", script, traces);
  }
  const phonemes: string[] = [];
  const syllables: Syllable[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? "";
    if (KN_VOWELS[ch]) {
      const v = KN_VOWELS[ch] ?? "a";
      phonemes.push(v);
      syllables.push({ onset: "", nucleus: v, coda: "" });
      i += 1;
      continue;
    }
    if (KN_CONSONANTS[ch]) {
      let onset = KN_CONSONANTS[ch] ?? "";
      phonemes.push(onset);
      i += 1;
      while (text[i] === KN_VIRAMA && i + 1 < text.length) {
        const nxt = text[i + 1];
        if (nxt && KN_CONSONANTS[nxt]) {
          const next_con = KN_CONSONANTS[nxt] ?? "";
          phonemes.push(next_con);
          onset += next_con;
          i += 2;
          traces.push(`kn:cluster:${onset}`);
          continue;
        }
        break;
      }
      // Trailing matra?
      let nucleus = "a"; // Kannada inherent vowel is /a/, like Hindi
      const m = text[i];
      if (m !== undefined && KN_MATRA[m]) {
        nucleus = KN_MATRA[m] ?? "a";
        i += 1;
      } else if (m === KN_VIRAMA) {
        nucleus = "";
        i += 1;
      }
      let coda = "";
      if (text[i] === KN_ANUSVARA) {
        coda = "n";
        i += 1;
      } else if (text[i] === KN_VISARGA) {
        coda = "h";
        i += 1;
      }
      if (nucleus) phonemes.push(nucleus);
      if (coda) phonemes.push(coda);
      syllables.push({ onset, nucleus, coda });
      continue;
    }
    if (ch === " " || ch === "\n" || ch === "\t" || ch === "\u00a0") {
      if (phonemes[phonemes.length - 1] !== " ") phonemes.push(" ");
      i += 1;
      continue;
    }
    if (",;:!?.।॥…-—".includes(ch)) {
      if (phonemes[phonemes.length - 1] !== " ") phonemes.push(" ");
      i += 1;
      continue;
    }
    i += 1; // unknown char: skip
  }
  return {
    phonemes: dedupSpaces(phonemes),
    syllables,
    rule_traces: traces,
    script: "kannada",
    language: "kn",
  };
}

// =====================================================================
// Tamil canonicalisation (v1.3 stopgap; full phonology punted to v1.4)
// =====================================================================

const TA_CONSONANTS: Record<string, string> = {
  க: "k",
  ங: "ng",
  ச: "c",
  ஞ: "ny",
  ட: "T",
  ண: "N",
  த: "t",
  ந: "n",
  ன: "n",
  ப: "p",
  ம: "m",
  ய: "y",
  ர: "r",
  ற: "R",
  ல: "l",
  ள: "L",
  ழ: "zh",
  வ: "v",
  ஶ: "sh",
  ஷ: "Sh",
  ஸ: "s",
  ஹ: "h",
  ஜ: "j",
};

const TA_VOWELS: Record<string, string> = {
  அ: "a",
  ஆ: "aa",
  இ: "i",
  ஈ: "ii",
  உ: "u",
  ஊ: "uu",
  எ: "e",
  ஏ: "ee",
  ஐ: "ai",
  ஒ: "o",
  ஓ: "oo",
  ஔ: "au",
};

const TA_MATRA: Record<string, string> = {
  "\u0bbe": "aa",
  "\u0bbf": "i",
  "\u0bc0": "ii",
  "\u0bc1": "u",
  "\u0bc2": "uu",
  "\u0bc6": "e",
  "\u0bc7": "ee",
  "\u0bc8": "ai",
  "\u0bca": "o",
  "\u0bcb": "oo",
  "\u0bcc": "au",
};

const TA_VIRAMA = "\u0bcd";

function phonemizeTamil(text: string, script: Script): G2PResult {
  const traces: string[] = ["ta:canonicalisation-only:v1.3"];
  if (script !== "tamil") {
    if (script === "latin") {
      traces.push("ta:latin-passthrough");
      return latinPassthrough(text, "ta", "latin", traces);
    }
    traces.push(`ta:unsupported-script:${script}:passthrough`);
    return latinPassthrough(text, "ta", script, traces);
  }
  const phonemes: string[] = [];
  const syllables: Syllable[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? "";
    if (TA_VOWELS[ch]) {
      const v = TA_VOWELS[ch] ?? "a";
      phonemes.push(v);
      syllables.push({ onset: "", nucleus: v, coda: "" });
      i += 1;
      continue;
    }
    if (TA_CONSONANTS[ch]) {
      const onset = TA_CONSONANTS[ch] ?? "";
      phonemes.push(onset);
      i += 1;
      let nucleus = "a";
      const m = text[i];
      if (m !== undefined && TA_MATRA[m]) {
        nucleus = TA_MATRA[m] ?? "a";
        i += 1;
      } else if (m === TA_VIRAMA) {
        nucleus = "";
        i += 1;
      }
      if (nucleus) phonemes.push(nucleus);
      syllables.push({ onset, nucleus, coda: "" });
      continue;
    }
    if (ch === " " || ch === "\n" || ch === "\t" || ch === "\u00a0") {
      if (phonemes[phonemes.length - 1] !== " ") phonemes.push(" ");
      i += 1;
      continue;
    }
    if (",;:!?.।॥…-—".includes(ch)) {
      if (phonemes[phonemes.length - 1] !== " ") phonemes.push(" ");
      i += 1;
      continue;
    }
    i += 1;
  }
  return {
    phonemes: dedupSpaces(phonemes),
    syllables,
    rule_traces: traces,
    script: "tamil",
    language: "ta",
  };
}

// =====================================================================
// English passthrough (with light Hinglish probe)
// =====================================================================

function phonemizeEnglish(text: string, script: Script): G2PResult {
  const traces: string[] = ["en:roman-passthrough"];
  // If the text is mostly Indic phonotactics ('th'/'kh'/'aa' density),
  // we route to the Hinglish hinter so the singer hears a Devanagari-
  // aware utterance. Heuristic: count Hindi hint hits per word.
  const lowered = text.toLowerCase();
  const HINT_KEYS = ["aa", "ee", "oo", "ai", "au", "th", "ph", "kh", "gh", "dh"];
  let hits = 0;
  for (const k of HINT_KEYS) {
    let idx = 0;
    while ((idx = lowered.indexOf(k, idx)) !== -1) {
      hits += 1;
      idx += k.length;
    }
  }
  const words = lowered.split(/\s+/).filter(Boolean).length || 1;
  const density = hits / words;
  if (density > 1.5) {
    traces.push(`en:hinglish-route:density=${density.toFixed(2)}`);
    const hi = phonemizeHindi(text, "latin");
    return { ...hi, rule_traces: [...traces, ...hi.rule_traces] };
  }
  return latinPassthrough(text, "en", script, traces);
}

function latinPassthrough(
  text: string,
  language: Language,
  script: Script,
  traces: string[],
): G2PResult {
  // Word-by-word emission so the consumer (vocal-synth backend) has
  // visible word boundaries to time on.
  const words = text.split(/(\s+)/);
  const phonemes: string[] = [];
  const syllables: Syllable[] = [];
  for (const w of words) {
    if (w.trim() === "") {
      if (phonemes[phonemes.length - 1] !== " ") phonemes.push(" ");
      continue;
    }
    phonemes.push(w.toLowerCase());
    syllables.push({ onset: "", nucleus: w.toLowerCase(), coda: "" });
  }
  return {
    phonemes: dedupSpaces(phonemes),
    syllables,
    rule_traces: traces,
    script,
    language,
  };
}

function dedupSpaces(xs: string[]): string[] {
  const out: string[] = [];
  for (const x of xs) {
    if (x === " " && (out.length === 0 || out[out.length - 1] === " ")) continue;
    out.push(x);
  }
  while (out.length > 0 && out[out.length - 1] === " ") out.pop();
  return out;
}

// =====================================================================
// Public helper: build phonemes for a Song Document section.
// =====================================================================

export interface PhonemizeSectionInput {
  language: Language;
  lyrics?: string;
  transliteration?: string;
  script?: Script;
}

/**
 * Convenience wrapper used by co-composers: returns `[]` for sections
 * without lyrics, otherwise returns `phonemize(...).phonemes`.
 *
 * Prefers `transliteration` over `lyrics` because a producer who
 * supplied a transliteration has earned veto power over our rule
 * pack.
 */
export function phonemesForSection(input: PhonemizeSectionInput): string[] {
  const text = input.transliteration ?? input.lyrics ?? "";
  if (!text.trim()) return [];
  const res = phonemize({
    text,
    language: input.language,
    script: input.script,
  });
  // Drop word-boundary spaces from the phonemes array — the
  // SongDocument is the canonical surface for *phoneme tokens*, not
  // a phoneme-with-spaces stream. Backends that want word boundaries
  // can re-derive them from the section text.
  return res.phonemes.filter((p) => p !== " ");
}
