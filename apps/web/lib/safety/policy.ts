/**
 * Deterministic first line of defence (fast, free, no model call). The LLM
 * moderator (moderate.ts) is the second line; both run before any paid call.
 * Rules are intentionally conservative: a false block costs a retry, a false
 * allow can cost a person harm or a legal problem.
 */
export type Verdict =
  | { allowed: true }
  | { allowed: false; category: SafetyCategory; reason: string };

export type SafetyCategory =
  | "artist_impersonation"
  | "copyrighted_lyrics"
  | "sexual_minors"
  | "hate_harassment"
  | "self_harm"
  | "violent_extremism"
  | "real_person_likeness"
  | "election_persuasion"
  | "defamation"
  | "prompt_injection"
  | "too_long"
  | "moderation_unavailable";

export const MAX_BRIEF_CHARS = 1200;
export const MAX_LYRICS_CHARS = 6000;

interface Rule { category: SafetyCategory; re: RegExp; reason: string }

const RULES: Rule[] = [
  { category: "artist_impersonation", re: /\b(in the voice of|sound(?:s|ing)? (?:exactly )?like|sing(?:s|ing)? like|clone (?:the )?voice|voice clone|impersonat\w+|in the style of [A-Z][a-z]+ [A-Z][a-z]+|(?:ar rahman|arijit singh|shreya ghoshal|lata mangeshkar|sid sriram|taylor swift|drake|beyonc\w+)\b)/i, reason: "Imitating a real artist's voice or naming a real artist as a target is not allowed. Describe the sound (instruments, mood, raga) instead." },
  { category: "copyrighted_lyrics", re: /\b(exact lyrics|full lyrics of|lyrics (?:of|from) ["“']|reproduce (?:the )?song|copy (?:the )?lyrics|remix of ["“']|cover version of ["“'])/i, reason: "neo-fm writes original lyrics and cannot reproduce existing songs." },
  { category: "sexual_minors", re: /\b(child|children|minor|underage|schoolgirl|schoolboy|teen(?:age)?r?|\d{1,2}[- ]year[- ]old)\b[\s\S]{0,80}\b(sexual|sensual|erotic|nude|seduc\w+|lust)\b|\b(sexual|sensual|erotic|nude|seduc\w+|lust)\b[\s\S]{0,80}\b(child|children|minor|underage|schoolgirl|schoolboy|teen(?:age)?r?|\d{1,2}[- ]year[- ]old)/i, reason: "Sexual content involving minors is never allowed." },
  { category: "self_harm", re: /\b(how to (?:kill|hurt) myself|glorif\w+ suicide|suicide (?:anthem|song to encourage)|encourage (?:self[- ]harm|suicide))\b/i, reason: "Content encouraging self-harm is not allowed. If you are struggling, please reach out to a local helpline." },
  { category: "violent_extremism", re: /\b(genocide (?:anthem|song)|ethnic cleansing|join (?:isis|al[- ]qaeda)|kill all (?:the )?\w+)\b/i, reason: "Violent extremist content is not allowed." },
  { category: "hate_harassment", re: /\b(slur|dehumani[sz]\w+|inferior race|subhuman)\b/i, reason: "Hateful or harassing content is not allowed." },
  // Real-person voice or likeness beyond named artists: deepfakes and "as if X said it" requests. Naming a person in a loving dedication stays fine.
  { category: "real_person_likeness", re: /\b(deep[- ]?fake|fake (?:audio|voice|speech|call) (?:of|from)|(?:voice|speech) of (?:the )?(?:prime minister|president|chief minister|minister|pm|cm|actor|actress|cricketer|politician)|(?:pretend|act|speak|sing) (?:to be|as if (?:you are|i am|he is|she is)) (?:the )?(?:prime minister|president|chief minister|minister|actor|actress|cricketer|politician))\b/i, reason: "We can't recreate the voice or likeness of a real person. Describe a character or a feeling instead." },
  // Election persuasion only: jingles that ask people to vote for or against a party or candidate. Satire and protest songs about public issues are allowed.
  { category: "election_persuasion", re: /\b(?:(?:election|campaign|party|rally) (?:jingle|anthem|slogan|propaganda)|(?:jingle|anthem|song|slogan) (?:for|to promote) (?:the )?(?:\w+ )?(?:campaign|candidate|party)|(?:vote for|don'?t vote for|vote against|vote out) (?:the )?(?:\\w+ )?(?:party|candidate|bjp|congress|aap|tmc|dmk|aiadmk|tdp|ysrcp|jdu|rjd|bsp|bjd|ncp|modi|rahul gandhi|kejriwal))\b/i, reason: "We don't make songs that campaign for or against a party or candidate. A song about an issue you care about is fine." },
  { category: "prompt_injection", re: /(ignore (?:all |the )?(?:previous|above|prior) (?:instructions|rules)|system prompt|you are now|disregard (?:your|the) (?:rules|instructions)|<\/?(?:system|tool|instructions)>)/i, reason: "The brief looks like an instruction aimed at the system, not a song description." },
];

/** Normalise cheap evasion tricks (zero-width chars, homoglyph spacing) before matching. */
export function normalise(text: string): string {
  return text.normalize("NFKC").replace(/[​-‏⁠﻿]/g, "");
}

export function screenText(raw: string, kind: "brief" | "lyrics" = "brief"): Verdict {
  const limit = kind === "brief" ? MAX_BRIEF_CHARS : MAX_LYRICS_CHARS;
  if (raw.length > limit) {
    return { allowed: false, category: "too_long", reason: `Please keep the ${kind} under ${limit} characters.` };
  }
  const text = normalise(raw);
  for (const rule of RULES) {
    if (rule.re.test(text)) return { allowed: false, category: rule.category, reason: rule.reason };
  }
  return { allowed: true };
}
