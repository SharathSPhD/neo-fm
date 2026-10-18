/**
 * Indian music genre catalog for the PCE/CMA engine (docs: strategy/pce-cma-engine.md).
 *
 * The Postgres `style_family_enum` has ten values, so a song's DB family stays coarse. A finer genre id travels in
 * `song_documents.document_json.metadata.genre` (jsonb, no migration) and decides the lyric form handed to the poets,
 * the prosody notes handed to the polisher and the English style fragment handed to Lyria.
 *
 * Entries are written from general knowledge and NOT native-checked (same honesty bar as EVAL-PCE.md). Nothing names a
 * real artist or composer as a style to imitate; traditions and forms are described instead.
 */
import type { StyleFamily } from "@neo-fm/song-doc";

export interface Genre {
  id: string;
  name: string;
  tradition: "carnatic" | "hindustani" | "devotional" | "folk" | "light-classical" | "popular" | "sufi";
  /** Coarsest DB family that keeps today's section template working. */
  family: StyleFamily;
  /** Language codes where this form is natural; first is the default. */
  languages: readonly string[];
  /** Section tags the lyric should use, in order. Matches the song-doc section vocabulary where one exists. */
  forms: readonly string[];
  /** One or two lines for the poets and polisher: what makes a lyric belong to this genre. */
  lyricNotes: string;
  /** English fragment appended to the Lyria style prompt. No artist names. */
  lyria: string;
  /** Lower-case routing keywords (English and transliterated); a native-script word is fine too. */
  keywords: readonly string[];
  /** Instrumental-friendly forms may legitimately have long wordless stretches. */
  instrumentalOk?: boolean;
}

export const GENRES: readonly Genre[] = [
  { id: "carnatic-kriti", name: "Carnatic kriti", tradition: "carnatic", family: "carnatic", languages: ["te", "ta", "kn", "sa"], forms: ["pallavi", "anupallavi", "charanam"],
    lyricNotes: "Devotional address to a deity in the three-part kriti form; the pallavi is a short refrain that returns after each part; elevated, simple vocabulary; no film-song rhyme chasing.",
    lyria: "Carnatic kriti: violin, mridangam, ghatam and tanpura, measured Adi tala, classical female or male voice with gamakas, devotional and unhurried.",
    keywords: ["kriti", "carnatic", "keertana", "kirtana", "pallavi", "adi tala", "thyagaraja", "kalyani", "shankarabharanam"] },
  { id: "devaranama", name: "Devaranama (Haridasa pada)", tradition: "devotional", family: "carnatic", languages: ["kn"], forms: ["pallavi", "charanam", "charanam"],
    lyricNotes: "Short, plain Kannada devotional verses in the Haridasa tradition: simple everyday imagery, a refrain, gentle moral or surrender theme. Do not sign it with a real composer's pen-name.",
    lyria: "Kannada devaranama: tambura, light mridangam, harmonium, simple tune that a congregation could sing back, warm and devotional.",
    keywords: ["devaranama", "dasara pada", "haridasa", "dasa sahitya", "devotional kannada"] },
  { id: "tamil-bhakti", name: "Tamil bhakti pann", tradition: "devotional", family: "carnatic", languages: ["ta"], forms: ["pallavi", "charanam", "charanam"],
    lyricNotes: "Tamil devotional hymn with rhythmic, alliterative lines (the tiruppugazh chandam feel) and a returning refrain; clear zh/ள/ல distinctions.",
    lyria: "Tamil devotional hymn: nadaswaram or violin, thavil or mridangam, rhythmic syllabic singing, bright temple atmosphere.",
    keywords: ["thevaram", "tiruppugazh", "thirupugazh", "tamil bhakti", "murugan", "pann", "temple hymn"] },
  { id: "thillana", name: "Thillana", tradition: "carnatic", family: "carnatic", languages: ["ta", "kn", "te"], forms: ["pallavi", "anupallavi", "charanam"],
    lyricNotes: "A brisk dance-closing piece: mostly rhythmic jati syllables with a short sahitya (text) in the charanam; keep words few and bright.",
    lyria: "Carnatic thillana: fast mridangam and nattuvangam rhythm, violin, flute, joyful dance energy.",
    keywords: ["thillana", "tillana", "bharatanatyam", "dance piece"], instrumentalOk: true },
  { id: "hindustani-khayal", name: "Hindustani khayal / bandish", tradition: "hindustani", family: "hindustani", languages: ["hi", "ur"], forms: ["alaap", "mukhda", "antara"],
    lyricNotes: "A short bandish (two to four lines): sthayi (mukhda) and antara, in Braj-flavoured Hindi, one mood tied to the raga and hour; the rest is melodic elaboration, so keep text sparse.",
    lyria: "Hindustani khayal bandish: tanpura drone, tabla in Teentaal, harmonium or sarangi, slow alaap opening then lively taan passages.",
    keywords: ["khayal", "bandish", "hindustani", "raga", "yaman", "bhairav", "teentaal", "classical hindi", "bhimpalasi", "malkauns"], instrumentalOk: true },
  { id: "thumri-dadra", name: "Thumri / Dadra", tradition: "light-classical", family: "hindustani", languages: ["hi", "ur"], forms: ["mukhda", "antara", "mukhda"],
    lyricNotes: "Light-classical romantic text from the beloved's side: longing, separation, monsoon, Krishna-Radha imagery; Braj or Awadhi colour; every line can be re-phrased melodically.",
    lyria: "Thumri: expressive female or male voice, harmonium, tabla in a light 6- or 7-beat cycle, sarangi, flirtatious yearning mood.",
    keywords: ["thumri", "dadra", "purab ang", "radha krishna", "viraha", "baithak"] },
  { id: "ghazal", name: "Ghazal", tradition: "light-classical", family: "hindustani", languages: ["ur", "hi"], forms: ["matla", "sher", "sher", "maqta"],
    lyricNotes: "Self-contained couplets (sher) sharing a refrain (radif) and rhyme (qafia); first couplet states both (matla); a closing couplet may carry a pen-name (maqta). Restrained, allusive, Persian-Urdu vocabulary done carefully.",
    lyria: "Ghazal: soft poetic voice, harmonium or acoustic guitar, tabla in Dadra or Keherwa, santoor or sitar fills, intimate late-night mood.",
    keywords: ["ghazal", "sher", "shayari", "radif", "matla", "urdu poetry"] },
  { id: "qawwali", name: "Qawwali", tradition: "sufi", family: "hindustani", languages: ["ur", "hi", "pa"], forms: ["mukhda", "antara", "refrain"],
    lyricNotes: "Sufi devotional with a short repeated refrain that builds; call-and-response between lead and chorus; themes of divine love, the beloved, surrender; avoid sectarian claims.",
    lyria: "Qawwali: lead voice with group chorus, harmonium, dholak, hand-claps, building tempo and ecstatic call-and-response.",
    keywords: ["qawwali", "sufi", "dargah", "khwaja", "mast qalandar", "sufiana"] },
  { id: "bhajan", name: "Hindi bhajan / kirtan", tradition: "devotional", family: "hindustani", languages: ["hi", "gu", "bho"], forms: ["mukhda", "antara", "mukhda"],
    lyricNotes: "Simple devotional lines with a refrain the listener can join; names of the deity as repeated mantra-like hooks; warm, humble register.",
    lyria: "Hindi bhajan: harmonium, dholak, manjira cymbals, tanpura, congregational call-and-response, sincere and calm.",
    keywords: ["bhajan", "kirtan", "aarti", "arti", "hanuman", "ram", "krishna", "shiv", "ganesh", "devotional"] },
  { id: "abhang", name: "Abhang (Varkari)", tradition: "devotional", family: "hindustani", languages: ["mr"], forms: ["mukhda", "charan", "charan", "refrain"],
    lyricNotes: "Marathi devotional couplet-stanzas in the Varkari tradition: plain speech, Vitthal/Pandurang devotion, a cheerful refrain (Vithoba-Rakhumai style invocations) that the group repeats.",
    lyria: "Marathi abhang: pakhawaj or mridang, taal cymbals, harmonium, veena, ektari, devotional group singing with a lively walking pulse.",
    keywords: ["abhang", "varkari", "vitthal", "vithoba", "pandharpur", "warkari", "tukaram", "dnyaneshwar", "wari"] },
  { id: "lavani", name: "Lavani", tradition: "folk", family: "hindustani", languages: ["mr"], forms: ["mukhda", "antara", "mukhda"],
    lyricNotes: "Fast Marathi folk dance song: playful, teasing, dholki-driven, quick rhythmic phrases. Keep it family-safe and cheerful, not explicit.",
    lyria: "Marathi lavani: fast dholki, tuntune, harmonium, ghungroo, brisk playful female lead and cheerful energy.",
    keywords: ["lavani", "dholki", "tamasha"] },
  { id: "powada", name: "Powada (ballad)", tradition: "folk", family: "hindustani", languages: ["mr"], forms: ["verse", "verse", "refrain"],
    lyricNotes: "Marathi heroic narrative ballad: bold storytelling lines, a stirring refrain, historical pride told respectfully.",
    lyria: "Marathi powada: bold voice, daf and tuntuna, hand drums, rousing storytelling rhythm.",
    keywords: ["powada", "shahiri", "ballad of valour", "shivaji"] },
  { id: "bhavageete", name: "Bhavageete / sugama sangeetha", tradition: "light-classical", family: "kannada-light-classical", languages: ["kn"], forms: ["mukhda", "antara", "mukhda"],
    lyricNotes: "Poetry-first light music: the poem leads, melody serves it; nature, love, nostalgia or awe in refined modern Kannada; mukhda returns after each antara; unforced rhyme.",
    lyria: "Kannada bhavageete: soft clear voice, acoustic guitar or violin, flute, light tabla, unhurried and poetic, no loud percussion.",
    keywords: ["bhavageete", "bhavageethe", "bhavagite", "sugama sangeetha", "sugama sangeeta", "kannada poem", "kavana"] },
  { id: "kannada-janapada", name: "Kannada janapada (folk)", tradition: "folk", family: "kannada-folk", languages: ["kn"], forms: ["folk_stanza", "folk_refrain", "folk_stanza", "folk_refrain"],
    lyricNotes: "Village folk idiom: call-and-response stanza with a repeated refrain, earthy images (field, harvest, river, bullock), plain colloquial words.",
    lyria: "Kannada folk: dollu or tamate drums, ektara, harmonium, group refrain, earthy and communal.",
    keywords: ["janapada", "kannada folk", "dollu", "harvest song", "village song"] },
  { id: "rabindrasangeet", name: "Rabindrasangeet-style", tradition: "light-classical", family: "bengali-rabindrasangeet", languages: ["bn"], forms: ["asthayi", "antara", "sanchari", "abhoga"],
    lyricNotes: "Reflective Bengali lyric on nature, seasons, love and longing in a Tagore-inspired register. Write NEW words in that spirit; never reproduce Tagore's text.",
    lyria: "Bengali Rabindrasangeet-style: gentle voice, esraj or harmonium, light tabla, piano, soft and contemplative.",
    keywords: ["rabindrasangeet", "rabindra sangeet", "tagore", "puja parjay", "bengali classical"] },
  { id: "nazrul-geeti", name: "Nazrul geeti-style", tradition: "light-classical", family: "bengali-rabindrasangeet", languages: ["bn"], forms: ["asthayi", "antara", "sanchari", "abhoga"],
    lyricNotes: "Bengali lyric with raga-based colour, rebellion, devotion or romance; write new text in the spirit, do not reproduce existing songs.",
    lyria: "Bengali Nazrul geeti-style: expressive voice, harmonium, tabla, bansuri, a mix of devotion and fire.",
    keywords: ["nazrul", "nazrul geeti", "shyama sangeet"] },
  { id: "baul", name: "Baul", tradition: "folk", family: "kannada-folk", languages: ["bn"], forms: ["verse", "refrain", "verse", "refrain"],
    lyricNotes: "Wandering-mystic Bengali songs: the divine within, the 'man of the heart' (moner manush), river and road imagery, simple startling metaphors, a refrain.",
    lyria: "Bengali baul: ektara, dotara, khamak, dugi drum, ghungroo on the ankle, barefoot mystic folk energy.",
    keywords: ["baul", "moner manush", "ektara", "lalon", "fakir", "wandering mystic"] },
  { id: "bhatiyali", name: "Bhatiyali (river song)", tradition: "folk", family: "kannada-folk", languages: ["bn", "as"], forms: ["verse", "refrain", "verse"],
    lyricNotes: "Long-breathed boatman's song: the river, the boat, the beloved far away; slow open vowels suited to drawn-out singing.",
    lyria: "Bhatiyali: solo yearning voice with long phrases, dotara or bamboo flute, minimal percussion, open river-air feel.",
    keywords: ["bhatiyali", "boatman", "majhi", "river song"] },
  { id: "punjabi-folk", name: "Punjabi folk / bhangra", tradition: "folk", family: "kannada-folk", languages: ["pa"], forms: ["verse", "refrain", "verse", "refrain"],
    lyricNotes: "Energetic Punjabi folk: boliyan-style short punchy couplets, harvest and wedding joy, refrain on a shout-able hook. Family-safe.",
    lyria: "Punjabi bhangra: dhol, tumbi, chimta, high-energy shout-along chorus.",
    keywords: ["bhangra", "punjabi folk", "boliyan", "dhol", "giddha", "tumbi", "baisakhi"] },
  { id: "punjabi-sufi", name: "Punjabi sufi kalam", tradition: "sufi", family: "hindustani", languages: ["pa"], forms: ["mukhda", "antara", "mukhda"],
    lyricNotes: "Sufi-flavoured Punjabi verse on divine love in the wandering-lover idiom; sincere, allusive. Not Gurbani style.",
    lyria: "Punjabi sufi: earthy voice, harmonium, dholak, tumbi, slow-building devotional mood.",
    keywords: ["punjabi sufi", "kalam", "heer", "bulleh", "sufi punjabi"] },
  { id: "garba-raas", name: "Garba / Raas", tradition: "folk", family: "kannada-folk", languages: ["gu"], forms: ["verse", "refrain", "verse", "refrain"],
    lyricNotes: "Gujarati navratri circle-dance song: Ambe Maa devotion or festive joy, a clap-along refrain, steady 8-beat dancing pulse.",
    lyria: "Gujarati garba: dholak, dhol, clapping, harmonium, bright festive tempo built for circle dancing.",
    keywords: ["garba", "raas", "dandiya", "navratri", "ambe maa", "gujarati folk"] },
  { id: "gujarati-bhajan", name: "Gujarati bhajan / prabhatiya", tradition: "devotional", family: "hindustani", languages: ["gu"], forms: ["mukhda", "antara", "mukhda"],
    lyricNotes: "Gentle morning devotional in the prabhatiya or bhakti-pad tradition; humble and contemplative; plain Gujarati.",
    lyria: "Gujarati bhajan: tanpura, harmonium, manjira, soft dholak, dawn devotional calm.",
    keywords: ["prabhatiya", "gujarati bhajan", "narsinh", "bhakti pad"] },
  { id: "mappila-pattu", name: "Mappila pattu", tradition: "folk", family: "kannada-folk", languages: ["ml"], forms: ["verse", "refrain", "verse"],
    lyricNotes: "Malabar Mappila song tradition: romantic or devotional narrative, Arabi-Malayalam flavour, handclapped rhythmic phrasing, wedding-song warmth.",
    lyria: "Malayalam Mappila pattu: daf or dabbas hand-percussion, harmonium, clapping, joyful Malabar wedding feel.",
    keywords: ["mappila", "mappilapattu", "oppana", "malabar", "kerala muslim", "daff"] },
  { id: "vanchipattu", name: "Vanchippattu (boat song)", tradition: "folk", family: "kannada-folk", languages: ["ml"], forms: ["verse", "refrain", "verse", "refrain"],
    lyricNotes: "Rowing rhythm Malayalam folk: the Onam snake-boat call-and-response, short lines timed to oars.",
    lyria: "Malayalam vanchippattu: group chant, steady oar-stroke rhythm, drums, cheerful Onam energy.",
    keywords: ["vanchippattu", "vallam kali", "snake boat", "onam boat", "onam song"] },
  { id: "malayalam-light", name: "Malayalam light melody", tradition: "popular", family: "bollywood-ballad", languages: ["ml"], forms: ["mukhda", "antara", "mukhda", "antara"],
    lyricNotes: "Soft melodic Malayalam song: poetic, gentle, rainy-evening and nostalgia imagery; tidy rhyme.",
    lyria: "Malayalam melody: warm voice, piano, flute, violin, light percussion, rainy-evening nostalgia.",
    keywords: ["malayalam melody", "malayalam song", "kerala song", "light melody"] },
  { id: "tamil-gaana", name: "Chennai gaana / Tamil kuthu", tradition: "popular", family: "tamil-folk", languages: ["ta"], forms: ["verse", "refrain", "verse", "refrain"],
    lyricNotes: "Street-smart, rhythmic Tamil with colloquial wit and a catchy hook; stays respectful and family-safe.",
    lyria: "Tamil gaana/kuthu: parai or dappankuthu drums, bass, brass stabs, high-energy street party rhythm.",
    keywords: ["gaana", "kuthu", "dappankuthu", "parai", "chennai", "tamil dance"] },
  { id: "tamil-folk", name: "Tamil nattupura paadal", tradition: "folk", family: "tamil-folk", languages: ["ta"], forms: ["folk_stanza", "folk_refrain", "folk_stanza"],
    lyricNotes: "Village folk: work songs, lullabies, festival songs in rural Tamil idiom; refrain with ho-style vocables.",
    lyria: "Tamil folk: parai, udukku, thavil, pipe, communal refrain.",
    keywords: ["nattupura", "tamil folk", "oppari", "pongal song", "villupattu", "thaalattu", "lullaby tamil"] },
  { id: "telugu-keerthana", name: "Telugu keerthana (padam style)", tradition: "carnatic", family: "telugu-keerthana", languages: ["te"], forms: ["pallavi", "anupallavi", "charanam"],
    lyricNotes: "Devotional or sringara keerthana in clear Telugu (the sankirtana tradition): pallavi refrain, devotional address, simple melodious words with ending open vowels.",
    lyria: "Telugu keerthana: violin, mridangam, tanpura, flute, devotional with graceful gamakas.",
    keywords: ["keerthana", "keertana", "annamayya", "sankirtana", "telugu devotional", "padam"] },
  { id: "telugu-janapada", name: "Telugu janapada / folk", tradition: "folk", family: "kannada-folk", languages: ["te"], forms: ["folk_stanza", "folk_refrain", "folk_stanza", "folk_refrain"],
    lyricNotes: "Telugu village folk idiom: call-and-response, festival (Bathukamma, Sankranti) imagery, earthy words, rhythmic refrain.",
    lyria: "Telugu janapada: dappu drums, folk chorus, clapping, lively festival rhythm.",
    keywords: ["janapada", "bathukamma", "telugu folk", "dappu", "sankranti", "burrakatha"] },
  { id: "odia-bhajan", name: "Odia janana / bhajan", tradition: "devotional", family: "hindustani", languages: ["or"], forms: ["mukhda", "antara", "mukhda"],
    lyricNotes: "Odia devotional supplication addressed to Jagannath in humble, simple Odia (the janana tradition).",
    lyria: "Odia bhajan: mardala, harmonium, gini cymbals, tanpura, temple devotional atmosphere.",
    keywords: ["janana", "jagannath", "odia bhajan", "odissi sangeet", "rath yatra"] },
  { id: "bihu", name: "Bihu geet", tradition: "folk", family: "kannada-folk", languages: ["as"], forms: ["verse", "refrain", "verse", "refrain"],
    lyricNotes: "Assamese spring festival (Rongali Bihu) song: young love, the cuckoo, new year joy, springy quick lines.",
    lyria: "Assamese bihu: dhol, pepa horn, gogona, toka, cheerful dance rhythm.",
    keywords: ["bihu", "rongali", "assamese folk", "husori", "gogona"] },
  { id: "bhojpuri-folk", name: "Bhojpuri folk (kajari / chaita / sohar)", tradition: "folk", family: "kannada-folk", languages: ["bho"], forms: ["verse", "refrain", "verse", "refrain"],
    lyricNotes: "Seasonal and life-event Bhojpuri songs: monsoon kajari, spring chaita, birth sohar, wedding songs; own dialect (not Hindi); family-safe default.",
    lyria: "Bhojpuri folk: dholak, harmonium, jhal cymbals, earthy lead with chorus.",
    keywords: ["kajari", "chaita", "sohar", "birha", "bhojpuri", "purvanchal", "faag", "bidesiya"] },
  { id: "lori", name: "Lullaby (lori / thalattu / jogula)", tradition: "folk", family: "kannada-folk", languages: ["hi", "ta", "kn", "te", "ml", "bn", "mr", "gu"], forms: ["verse", "refrain", "verse"],
    lyricNotes: "Slow soothing repetition in the listener's language; gentle imagery (moon, cradle, stars); a sleepy refrain; no startling words.",
    lyria: "Lullaby: very soft sustained voice, tanpura or harp, soft flute, slow rocking 6/8 pulse, minimal percussion.",
    keywords: ["lullaby", "lori", "thalattu", "jogula", "jola", "tharattu", "ghumpaadi", "sleep song", "baby"], instrumentalOk: true },
  { id: "film-melody", name: "Film melody", tradition: "popular", family: "bollywood-ballad", languages: ["hi", "ta", "te", "kn", "ml", "bn", "mr"], forms: ["mukhda", "antara", "mukhda", "antara", "mukhda"],
    lyricNotes: "Modern romantic or reflective song: strong hook (mukhda), two contrasting antaras, specific imagery, natural spoken-poetic register.",
    lyria: "Indian film melody: emotive vocal, piano, strings, acoustic guitar, tabla/drums, cinematic build.",
    keywords: ["film song", "movie song", "bollywood", "love song", "romantic", "ballad", "kollywood", "tollywood", "sandalwood"] },
  { id: "wedding-sangeet", name: "Wedding / sangeet", tradition: "popular", family: "bollywood-ballad", languages: ["hi", "pa", "gu", "mr", "ta", "te"], forms: ["mukhda", "antara", "mukhda"],
    lyricNotes: "Celebratory song for a named couple or family: affectionate teasing, blessings, shared memories; names woven in naturally.",
    lyria: "Indian wedding sangeet: dhol, shehnai accents, dance-floor beat, joyful group chorus.",
    keywords: ["wedding", "sangeet", "shaadi", "vivah", "mehndi", "haldi", "baraat", "engagement", "anniversary"] },
];

const BY_ID = new Map(GENRES.map((g) => [g.id, g]));
export const genreById = (id: string | null | undefined): Genre | undefined => (id ? BY_ID.get(id) : undefined);
