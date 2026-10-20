/**
 * Alexa custom skill ("neo-fm") over the AudioPlayer interface: the station as a voice-controlled stream. Pure
 * request -> response logic with the track source injected (lib/alexa/tracks.ts), so it is unit-testable without
 * Alexa, Supabase or Storage. The endpoint (app/api/alexa/route.ts) verifies the request and adds the flag gate.
 *
 * Stateless on purpose: Alexa hands back the stream `token` on every playback event, so the token carries the locked
 * language and the last few track ids, and the next track is chosen from that alone. No session store is needed.
 */

export interface AlexaTrack {
  id: string;
  title: string;
  language: string;
  url: string;
}

export interface NextTrackQuery {
  /** Pool language code (hi, ta, ...) or null for the mixed station. */
  language: string | null;
  /** Track ids heard lately in this stream, oldest first; never repeated while the pool allows. */
  recentIds: string[];
  energy?: "up" | "down";
  /** Seed for "more like this". */
  moreLike?: string;
}

export interface TrackSource {
  next(q: NextTrackQuery): Promise<AlexaTrack | null>;
  byId(id: string): Promise<AlexaTrack | null>;
}

/** The slice of the Alexa request envelope this skill reads. */
export interface AlexaEnvelope {
  request: {
    type: string;
    locale?: string;
    intent?: { name: string; slots?: Record<string, SlotValue | undefined> };
    token?: string;
    error?: { type?: string };
  };
  context?: {
    AudioPlayer?: { token?: string; offsetInMilliseconds?: number };
    System?: { application?: { applicationId?: string } };
  };
}

interface SlotValue {
  value?: string;
  resolutions?: { resolutionsPerAuthority?: { status?: { code?: string }; values?: { value?: { id?: string } }[] }[] };
}

export interface AlexaResponse {
  version: "1.0";
  response: {
    outputSpeech?: { type: "PlainText"; text: string };
    directives?: unknown[];
    shouldEndSession?: boolean;
  };
}

const TOKEN_PREFIX = "nf1";
const RECENT_KEEP = 8;
/** Alexa caps a token at 1024 characters; UUID ids keep ours near 330. */
const LANGUAGES = new Set(["hi", "ta", "te", "kn", "bn", "en"]);

export interface StreamToken {
  language: string | null;
  recentIds: string[];
}

export function encodeToken(t: StreamToken): string {
  return [TOKEN_PREFIX, t.language ?? "any", t.recentIds.slice(-RECENT_KEEP).join(",")].join("|");
}

export function decodeToken(raw: string | undefined): StreamToken | null {
  const [prefix, lang, ids] = (raw ?? "").split("|");
  if (prefix !== TOKEN_PREFIX || !lang) return null;
  return { language: LANGUAGES.has(lang) ? lang : null, recentIds: (ids ?? "").split(",").filter(Boolean) };
}

type Strings = {
  launch: string;
  next: string;
  like: string;
  calmer: string;
  livelier: string;
  noPrevious: string;
  noTracks: string;
  help: string;
  unsupported: string;
};

// The hi strings are a first pass and are gated on a Gemini nativeness score (launch/indic-copy-review.md) before certification.
const STRINGS: Record<"en" | "hi", Strings> = {
  en: {
    launch: "Tuning in to neo-fm. Every song here is made by AI.",
    next: "Here's the next song.",
    like: "Glad you like it. Here's more like this.",
    calmer: "Slowing things down.",
    livelier: "Picking up the pace.",
    noPrevious: "A station only moves forward. Say next for another song.",
    noTracks: "The station is quiet right now. Please try again in a little while.",
    help: "Say play neo-fm, play Tamil, next, more like this, or play something calmer.",
    unsupported: "That doesn't apply to a live station. Say next for another song.",
  },
  hi: {
    launch: "नियो एफ़एम चालू हो रहा है। यहाँ हर गाना एआई से बना है।",
    next: "अगला गाना।",
    like: "अच्छा लगा! ऐसे ही और गाने।",
    calmer: "थोड़ा धीमा करते हैं।",
    livelier: "थोड़ा तेज़ करते हैं।",
    noPrevious: "स्टेशन आगे ही बढ़ता है। दूसरा गाना सुनने के लिए अगला कहिए।",
    noTracks: "अभी स्टेशन में गाने नहीं हैं। थोड़ी देर बाद फिर कोशिश कीजिए।",
    help: "कहिए: नियो एफ़एम चलाओ, तमिल गाने चलाओ, अगला, ऐसा ही और, या कुछ धीमा चलाओ।",
    unsupported: "यह लाइव स्टेशन पर लागू नहीं होता। दूसरा गाना सुनने के लिए अगला कहिए।",
  },
};

const stringsFor = (locale: string | undefined): Strings => (locale?.toLowerCase().startsWith("hi") ? STRINGS.hi : STRINGS.en);

const NAME_TO_CODE: Record<string, string> = {
  hindi: "hi", tamil: "ta", telugu: "te", kannada: "kn", bengali: "bn", bangla: "bn", english: "en",
};

/** Entity-resolution id first (the interaction model maps synonyms to codes), spoken name as the fallback. */
function languageFromSlot(slot: SlotValue | undefined): string | null {
  const id = slot?.resolutions?.resolutionsPerAuthority?.find((a) => a.status?.code === "ER_SUCCESS_MATCH")?.values?.[0]?.value?.id;
  if (id && LANGUAGES.has(id)) return id;
  const spoken = slot?.value?.trim().toLowerCase();
  return spoken ? (NAME_TO_CODE[spoken] ?? null) : null;
}

const speak = (text: string) => ({ type: "PlainText" as const, text });

function say(text: string, endSession = true): AlexaResponse {
  return { version: "1.0", response: { outputSpeech: speak(text), shouldEndSession: endSession } };
}

const empty = (): AlexaResponse => ({ version: "1.0", response: {} });

function stop(): AlexaResponse {
  return { version: "1.0", response: { directives: [{ type: "AudioPlayer.Stop" }], shouldEndSession: true } };
}

function playDirective(track: AlexaTrack, token: string, behavior: "REPLACE_ALL" | "ENQUEUE", expectedPreviousToken?: string, offsetMs = 0) {
  return {
    type: "AudioPlayer.Play",
    playBehavior: behavior,
    audioItem: {
      stream: {
        url: track.url,
        token,
        offsetInMilliseconds: offsetMs,
        ...(behavior === "ENQUEUE" && expectedPreviousToken ? { expectedPreviousToken } : {}),
      },
      metadata: { title: track.title, subtitle: "neo-fm · made by AI" },
    },
  };
}

/** Speech (if any) plus a Play. AudioPlayer.* requests may not carry speech, so those pass `speech` as undefined. */
function play(track: AlexaTrack, tok: StreamToken, behavior: "REPLACE_ALL" | "ENQUEUE", opts: { speech?: string; expectedPreviousToken?: string; offsetMs?: number } = {}): AlexaResponse {
  const token = encodeToken({ language: tok.language, recentIds: [...tok.recentIds, track.id] });
  return {
    version: "1.0",
    response: {
      ...(opts.speech ? { outputSpeech: speak(opts.speech) } : {}),
      directives: [playDirective(track, token, behavior, opts.expectedPreviousToken, opts.offsetMs)],
      shouldEndSession: true,
    },
  };
}

export interface SkillOptions {
  source: TrackSource;
}

export async function handleAlexa(env: AlexaEnvelope, { source }: SkillOptions): Promise<AlexaResponse> {
  const { request } = env;
  const s = stringsFor(request.locale);
  // Playback events carry the token in the request; intents carry it in context.AudioPlayer while a stream is active.
  const current = decodeToken(request.token ?? env.context?.AudioPlayer?.token);
  const fresh: StreamToken = current ?? { language: null, recentIds: [] };

  const start = async (tok: StreamToken, speech: string, q: Partial<NextTrackQuery> = {}) => {
    const track = await source.next({ language: tok.language, recentIds: tok.recentIds, ...q });
    return track ? play(track, tok, "REPLACE_ALL", { speech }) : say(s.noTracks);
  };

  switch (request.type) {
    case "LaunchRequest":
      return start({ language: null, recentIds: [] }, s.launch);

    case "AudioPlayer.PlaybackNearlyFinished": {
      if (!current) return empty();
      const track = await source.next({ language: current.language, recentIds: current.recentIds });
      return track ? play(track, current, "ENQUEUE", { expectedPreviousToken: request.token }) : empty();
    }

    case "AudioPlayer.PlaybackFailed": {
      // A bad URL or device hiccup should not end the station: move on to a different track.
      if (!current) return empty();
      const track = await source.next({ language: current.language, recentIds: current.recentIds });
      return track ? play(track, current, "REPLACE_ALL") : empty();
    }

    case "PlaybackController.NextCommandIssued":
      return start(current ?? fresh, "", {});

    case "PlaybackController.PreviousCommandIssued":
    case "PlaybackController.PauseCommandIssued":
      return stop();

    case "PlaybackController.PlayCommandIssued":
      return resume(source, current, env, s);

    case "IntentRequest":
      break;

    // PlaybackStarted / Finished / Stopped, SessionEndedRequest, System.ExceptionEncountered: nothing to do.
    default:
      return empty();
  }

  const name = request.intent?.name ?? "";
  switch (name) {
    case "PlayStationIntent": {
      const language = languageFromSlot(request.intent?.slots?.language);
      return start({ language, recentIds: current?.recentIds ?? [] }, s.launch);
    }
    case "AMAZON.NextIntent":
      return start(current ?? fresh, s.next);
    case "LikeIntent": {
      const tok = current ?? fresh;
      return start(tok, s.like, { moreLike: tok.recentIds[tok.recentIds.length - 1] });
    }
    case "CalmerIntent":
      return start(current ?? fresh, s.calmer, { energy: "down" });
    case "LivelierIntent":
      return start(current ?? fresh, s.livelier, { energy: "up" });
    case "AMAZON.ResumeIntent":
      return resume(source, current, env, s);
    case "AMAZON.PauseIntent":
    case "AMAZON.StopIntent":
    case "AMAZON.CancelIntent":
      return stop();
    case "AMAZON.PreviousIntent":
      return say(s.noPrevious, false);
    case "AMAZON.HelpIntent":
      return say(s.help, false);
    case "AMAZON.LoopOnIntent":
    case "AMAZON.LoopOffIntent":
    case "AMAZON.ShuffleOnIntent":
    case "AMAZON.ShuffleOffIntent":
    case "AMAZON.RepeatIntent":
    case "AMAZON.StartOverIntent":
      return say(s.unsupported, false);
    default:
      return say(s.help, false);
  }
}

/** Resume re-signs the paused track (the old URL may have expired) and continues from where it stopped. */
async function resume(source: TrackSource, current: StreamToken | null, env: AlexaEnvelope, s: Strings): Promise<AlexaResponse> {
  const id = current?.recentIds[current.recentIds.length - 1];
  const track = id ? await source.byId(id) : null;
  if (!current || !track) {
    const next = await source.next({ language: current?.language ?? null, recentIds: current?.recentIds ?? [] });
    return next ? play(next, current ?? { language: null, recentIds: [] }, "REPLACE_ALL") : say(s.noTracks);
  }
  // `track.id` is already the last id in the token, so play() would append it twice; drop it first.
  const base = { language: current.language, recentIds: current.recentIds.slice(0, -1) };
  return play(track, base, "REPLACE_ALL", { offsetMs: env.context?.AudioPlayer?.offsetInMilliseconds ?? 0 });
}
