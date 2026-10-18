/**
 * Voice choice for personal songs: which singer a listener may ask for, per tier, and the Lyria style-prompt hint it adds.
 *
 * Lab evidence (lab/m2/judge.json, voice-judge on the pool): Lyria follows gender and duet/chorus cues in the style prompt,
 * but finer timbre words barely move the voice, and pronunciation swings run to run. So choices stay coarse (station mix,
 * male, female, duet) and every render still goes through the diction gate. No voice cloning, no named singers.
 * Off unless VOICE_CHOICE=1; an entitlement miss degrades to the station mix, never fails the job.
 */
import type { UserTier } from "../agent/tiers";

export const VOICE_CHOICES = ["station", "female", "male", "duet"] as const;
export type VoiceChoice = (typeof VOICE_CHOICES)[number];

/** Pro-only delivery styles. Coarse on purpose: the lab found subtler descriptors do not change the voice. */
export const VOICE_STYLES = ["soft", "powerful", "folk", "devotional"] as const;
export type VoiceStyle = (typeof VOICE_STYLES)[number];

export interface VoicePref {
  choice: VoiceChoice;
  style?: VoiceStyle;
}

export interface VoiceEntitlement {
  choices: readonly VoiceChoice[];
  styles: readonly VoiceStyle[];
}

/**
 * Free: the station mix (no hint, Lyria picks). Creator: male or female lead. Station pass: adds duet. Pro: duet and
 * delivery styles. Developer accounts match Pro. A pass holder on a higher tier keeps that tier's choices.
 */
export function voiceEntitlement(tier: UserTier | null | undefined, hasPass = false): VoiceEntitlement {
  if (tier === "pro" || tier === "developer") return { choices: VOICE_CHOICES, styles: VOICE_STYLES };
  if (hasPass) return { choices: VOICE_CHOICES, styles: [] };
  if (tier === "creator") return { choices: ["station", "female", "male"], styles: [] };
  return { choices: ["station"], styles: [] };
}

/**
 * Duet is held back for these languages: the 2026-10-18 test judged the clips as two voices but nativeness only 3/5
 * (lab/voice-pool/duet-test.json). Remove a code after a native listen passes.
 */
export const DUET_HOLD_LANGUAGES: readonly string[] = ["ta", "gu"];

export function duetHeld(language: string | null | undefined): boolean {
  return !!language && DUET_HOLD_LANGUAGES.includes(language);
}

export function voiceChoiceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VOICE_CHOICE === "1";
}

/** Parses untrusted input (request body or stored metadata); anything unrecognised is dropped. */
export function parseVoicePref(raw: unknown): VoicePref | null {
  if (!raw || typeof raw !== "object") return null;
  const { choice, style } = raw as { choice?: unknown; style?: unknown };
  if (!VOICE_CHOICES.includes(choice as VoiceChoice)) return null;
  return {
    choice: choice as VoiceChoice,
    ...(VOICE_STYLES.includes(style as VoiceStyle) ? { style: style as VoiceStyle } : {}),
  };
}

/** Clamps a preference to what the tier includes. */
export function clampVoicePref(pref: VoicePref | null, ent: VoiceEntitlement): VoicePref {
  if (!pref || !ent.choices.includes(pref.choice)) return { choice: "station" };
  return { choice: pref.choice, ...(pref.style && ent.styles.includes(pref.style) ? { style: pref.style } : {}) };
}

const CHOICE_HINT: Record<VoiceChoice, string> = {
  station: "",
  female: "Female lead vocal.",
  male: "Male lead vocal.",
  duet: "Male and female duet, the two voices alternating and joining on the chorus.",
};

const STYLE_HINT: Record<VoiceStyle, string> = {
  soft: "Soft, intimate delivery.",
  powerful: "Strong, open-throated delivery.",
  folk: "Earthy folk delivery.",
  devotional: "Calm devotional delivery.",
};

/** The text appended to the Lyria style prompt; empty for the station mix. */
export function voiceHint(pref: VoicePref): string {
  if (pref.choice === "station") return "";
  return [CHOICE_HINT[pref.choice], pref.style ? STYLE_HINT[pref.style] : ""].filter(Boolean).join(" ");
}

/** Flag and entitlement in one call for the render path. The station mix whenever the choice is off or not included. */
export function voiceChoiceFor(raw: unknown, tier: UserTier | null | undefined, hasPass: boolean, env: NodeJS.ProcessEnv = process.env, language?: string | null): VoicePref {
  if (!voiceChoiceEnabled(env)) return { choice: "station" };
  const pref = clampVoicePref(parseVoicePref(raw), voiceEntitlement(tier, hasPass));
  return pref.choice === "duet" && duetHeld(language) ? { choice: "station" } : pref;
}

/** Convenience for callers that only need the prompt text. */
export function voiceHintFor(raw: unknown, tier: UserTier | null | undefined, hasPass: boolean, env: NodeJS.ProcessEnv = process.env): string {
  return voiceHint(voiceChoiceFor(raw, tier, hasPass, env));
}
