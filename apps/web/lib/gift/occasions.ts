/** Pure helpers for the occasion-song ("gift a song") flow. Client-safe. */
import type { Language, StyleFamily } from "@neo-fm/song-doc";
import { z } from "zod";

import { cleanDedicationText, DEDICATION_MESSAGE_MAX, DEDICATION_TO_MAX } from "../share/dedication";

export const GIFT_LANGUAGES = ["hi", "ta", "te", "kn", "bn"] as const satisfies readonly Language[];
export type GiftLanguage = (typeof GIFT_LANGUAGES)[number];

/** Same pairing the free-form creator uses until a listener picks a style. */
export const GIFT_STYLE: Record<GiftLanguage, StyleFamily> = {
  hi: "bollywood-ballad",
  kn: "kannada-light-classical",
  ta: "tamil-folk",
  te: "telugu-keerthana",
  bn: "bengali-rabindrasangeet",
};

export const GIFT_DURATION_SECONDS = 60;
// The brief is capped at 500 chars by the free-form form; keep the note short enough that the whole brief fits.
export const GIFT_NOTE_MAX = 100;

export interface Occasion {
  id: string;
  /** Labels shown in the picker, in the UI languages. */
  label: Record<"en" | GiftLanguage, string>;
  /** What the brief tells the lyricist the song is for. */
  theme: string;
  kind: "personal" | "festival";
}

// Diwali and Dhanteras first (the launch window), then personal milestones, then other festivals.
export const OCCASIONS: readonly Occasion[] = [
  { id: "diwali", kind: "festival", label: { en: "Diwali", hi: "दीपावली", ta: "தீபாவளி", te: "దీపావళి", kn: "ದೀಪಾವಳಿ", bn: "দীপাবলি" }, theme: "a Diwali greeting: lamps, light over darkness, sweets and family gathered together" },
  { id: "dhanteras", kind: "festival", label: { en: "Dhanteras", hi: "धनतेरस", ta: "தனதேரஸ்", te: "ధన త్రయోదశి", kn: "ಧನತ್ರಯೋದಶಿ", bn: "ধনতেরাস" }, theme: "a Dhanteras blessing for health, prosperity and a bright new beginning" },
  { id: "birthday", kind: "personal", label: { en: "Birthday", hi: "जन्मदिन", ta: "பிறந்தநாள்", te: "పుట్టినరోజు", kn: "ಹುಟ್ಟುಹಬ್ಬ", bn: "জন্মদিন" }, theme: "a birthday celebration, warm wishes for the year ahead" },
  { id: "wedding", kind: "personal", label: { en: "Wedding / Sangeet", hi: "शादी / संगीत", ta: "திருமணம் / சங்கீத்", te: "పెళ్లి / సంగీత్", kn: "ಮದುವೆ / ಸಂಗೀತ", bn: "বিয়ে / সঙ্গীত" }, theme: "a wedding sangeet song: joy, blessings and dancing for the couple" },
  { id: "anniversary", kind: "personal", label: { en: "Anniversary", hi: "सालगिरह", ta: "திருமண நாள்", te: "పెళ్లిరోజు", kn: "ವಿವಾಹ ವಾರ್ಷಿಕೋತ್ಸವ", bn: "বিবাহবার্ষিকী" }, theme: "a wedding anniversary: years together, love that has grown, a toast to many more" },
  { id: "raksha-bandhan", kind: "festival", label: { en: "Raksha Bandhan", hi: "रक्षाबंधन", ta: "ரக்ஷா பந்தன்", te: "రక్షాబంధన్", kn: "ರಕ್ಷಾಬಂಧನ", bn: "রাখী বন্ধন" }, theme: "Raksha Bandhan: the bond between siblings, a promise to stand by each other" },
  { id: "holi", kind: "festival", label: { en: "Holi", hi: "होली", ta: "ஹோலி", te: "హోలీ", kn: "ಹೋಳಿ", bn: "দোল / হোলি" }, theme: "Holi: colours, laughter, forgiving and starting fresh with friends" },
  { id: "pongal", kind: "festival", label: { en: "Pongal / Sankranti", hi: "पोंगल / संक्रांति", ta: "பொங்கல்", te: "సంక్రాంతి", kn: "ಸಂಕ್ರಾಂತಿ", bn: "পৌষ সংক্রান্তি" }, theme: "the harvest festival: gratitude for the harvest, sweet pongal, kites and family" },
  { id: "durga-puja", kind: "festival", label: { en: "Durga Puja", hi: "दुर्गा पूजा", ta: "துர்கா பூஜை", te: "దుర్గా పూజ", kn: "ದುರ್ಗಾ ಪೂಜೆ", bn: "দুর্গাপূজা" }, theme: "Durga Puja: dhak drums, pandal evenings and a festive welcome to the goddess" },
  { id: "ugadi", kind: "festival", label: { en: "Ugadi / New Year", hi: "उगादि / नववर्ष", ta: "புத்தாண்டு", te: "ఉగాది", kn: "ಯುಗಾದಿ", bn: "নববর্ষ" }, theme: "a regional new year greeting: new hopes, the taste of all of life's flavours" },
] as const;

export interface Relationship {
  id: string;
  label: Record<"en" | GiftLanguage, string>;
  /** Phrase used in the brief, e.g. "my mother". */
  phrase: string;
}

export const RELATIONSHIPS: readonly Relationship[] = [
  { id: "mother", phrase: "my mother", label: { en: "Mother", hi: "माँ", ta: "அம்மா", te: "అమ్మ", kn: "ಅಮ್ಮ", bn: "মা" } },
  { id: "father", phrase: "my father", label: { en: "Father", hi: "पिता", ta: "அப்பா", te: "నాన్న", kn: "ಅಪ್ಪ", bn: "বাবা" } },
  { id: "spouse", phrase: "my husband or wife", label: { en: "Spouse", hi: "जीवनसाथी", ta: "வாழ்க்கைத் துணை", te: "జీవిత భాగస్వామి", kn: "ಜೀವನ ಸಂಗಾತಿ", bn: "জীবনসঙ্গী" } },
  { id: "partner", phrase: "my partner", label: { en: "Partner", hi: "साथी", ta: "துணை", te: "తోడు", kn: "ಸಂಗಾತಿ", bn: "সঙ্গী" } },
  { id: "sibling", phrase: "my brother or sister", label: { en: "Sibling", hi: "भाई-बहन", ta: "சகோதர சகோதரி", te: "అన్నదమ్ములు / అక్కచెల్లెళ్లు", kn: "ಒಡಹುಟ್ಟಿದವರು", bn: "ভাইবোন" } },
  { id: "grandparent", phrase: "my grandparent", label: { en: "Grandparent", hi: "दादा-दादी / नाना-नानी", ta: "தாத்தா பாட்டி", te: "తాతయ్య / అమ్మమ్మ", kn: "ಅಜ್ಜ ಅಜ್ಜಿ", bn: "ঠাকুমা-ঠাকুরদা / দাদু-দিদা" } },
  { id: "child", phrase: "my child", label: { en: "Child", hi: "बच्चा", ta: "குழந்தை", te: "బిడ్డ", kn: "ಮಗು", bn: "সন্তান" } },
  { id: "friend", phrase: "my friend", label: { en: "Friend", hi: "दोस्त", ta: "நண்பர்", te: "స్నేహితుడు", kn: "ಸ್ನೇಹಿತ", bn: "বন্ধু" } },
  { id: "colleague", phrase: "my colleague", label: { en: "Colleague", hi: "सहकर्मी", ta: "சக ஊழியர்", te: "సహోద్యోగి", kn: "ಸಹೋದ್ಯೋಗಿ", bn: "সহকর্মী" } },
];

const OCCASION_BY_ID = new Map(OCCASIONS.map((o) => [o.id, o] as const));
const RELATIONSHIP_BY_ID = new Map(RELATIONSHIPS.map((r) => [r.id, r] as const));

export function occasionById(id: string | null | undefined): Occasion | null {
  return (id && OCCASION_BY_ID.get(id)) || null;
}

export const GiftRequestSchema = z.object({
  occasion: z.string().refine((v) => OCCASION_BY_ID.has(v), "unknown_occasion"),
  relationship: z.string().refine((v) => RELATIONSHIP_BY_ID.has(v), "unknown_relationship"),
  language: z.enum(GIFT_LANGUAGES),
  name: z.string().max(DEDICATION_TO_MAX * 2),
  note: z.string().max(GIFT_NOTE_MAX * 2).optional(),
});
export type GiftRequest = z.infer<typeof GiftRequestSchema>;

export interface GiftPlan {
  /** Free-text brief for POST /api/songs (moderated there, before any job exists). */
  prompt: string;
  /** Dedication fields for PUT /api/songs/[id]/dedication; the note is already inside the screened prompt. */
  to: string;
  message: string | null;
  language: GiftLanguage;
  styleFamily: StyleFamily;
}

/** Validate a gift request and turn it into the brief and dedication that the existing endpoints take. */
export function planGift(input: unknown): { ok: true; plan: GiftPlan } | { ok: false; error: "invalid_request" | "name_required" | "name_too_long" | "note_too_long" } {
  const parsed = GiftRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_request" };
  const occasion = OCCASION_BY_ID.get(parsed.data.occasion)!;
  const relationship = RELATIONSHIP_BY_ID.get(parsed.data.relationship)!;
  const name = cleanDedicationText(parsed.data.name);
  const note = cleanDedicationText(parsed.data.note ?? "");
  if (!name) return { ok: false, error: "name_required" };
  if (Array.from(name).length > DEDICATION_TO_MAX) return { ok: false, error: "name_too_long" };
  if (Array.from(note).length > Math.min(GIFT_NOTE_MAX, DEDICATION_MESSAGE_MAX)) return { ok: false, error: "note_too_long" };

  const parts = [
    `A personalised gift song for ${occasion.theme}.`,
    `It is for ${name}, ${relationship.phrase}. Use ${name}'s name in the lyrics.`,
    "Warm and easy to sing along to.",
    note ? `Include this personal touch: ${note}` : "",
  ].filter(Boolean);
  return {
    ok: true,
    plan: {
      prompt: parts.join(" "),
      to: name,
      message: note || null,
      language: parsed.data.language,
      styleFamily: GIFT_STYLE[parsed.data.language],
    },
  };
}

/** WhatsApp text for a finished gift. Pure; the caller supplies the absolute link. */
export function giftShareUrl(opts: { name: string; occasion: string; url: string }): string {
  const text = `🎁 ${opts.occasion}: a song made just for ${opts.name}\n${opts.url}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
