/**
 * Native review of UI translations: pure helpers (no DB, no server-only) so they unit-test and the
 * apply script can share them. Locale files are one `"key": "value",` per line, so edits are line patches.
 */
import { createHash, randomBytes } from "node:crypto";

import { UI_LANGS, UI_STRINGS, type UiKey, type UiLang } from "../i18n/ui-strings";

export const REVIEW_LANGS = UI_LANGS.filter((l) => l !== "en");
export type ReviewLang = Exclude<UiLang, "en">;

export function isReviewLang(l: string): l is ReviewLang {
  return (REVIEW_LANGS as readonly string[]).includes(l);
}

export const MAX_SUGGESTION = 1000;
export const MAX_COMMENT = 500;
export const DEFAULT_TOKEN_DAYS = 14;
export const MAX_TOKEN_DAYS = 60;

const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
export const newToken = () => randomBytes(24).toString("base64url");
export const isWellFormedToken = (t: string) => TOKEN_RE.test(t);
/** Tokens are high-entropy random strings, so an unsalted SHA-256 is enough for lookup. */
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export function clampDays(v: string | null): number {
  const n = Number(v);
  if (!v || !Number.isFinite(n) || n < 1) return DEFAULT_TOKEN_DAYS;
  return Math.min(Math.floor(n), MAX_TOKEN_DAYS);
}

/** Screen context shown beside each string. `path` is only set for pages a reviewer can open without signing in. */
export interface Screen {
  id: string;
  label: string;
  path?: string;
}

const S = (id: string, label: string, path?: string): Screen => ({ id, label, path });
const SCREENS: Record<string, Screen> = {
  nav: S("nav", "Top navigation and menus", "/"),
  menu: S("menu", "Account menu (signed in)"),
  lang: S("lang", "Language switcher", "/"),
  palette: S("palette", "Command palette (Ctrl/Cmd+K, signed in)"),
  landing: S("landing", "Home page", "/"),
  footer: S("footer", "Footer", "/"),
  listen: S("listen", "Home page: listen first", "/"),
  cta: S("cta", "Upgrade banner", "/"),
  pricing: S("pricing", "Pricing page", "/pricing"),
  discover: S("discover", "Discover page", "/discover"),
  common: S("common", "Shared labels (pagination)", "/discover"),
  profile: S("profile", "Creator profile page"),
  help: S("help", "Help and FAQ", "/help"),
  trust: S("trust", "Trust and safety", "/trust"),
  templates: S("templates", "Templates page", "/templates"),
  feedback: S("feedback", "Feedback form", "/feedback"),
  auth: S("auth", "Sign in and sign up", "/sign-in"),
  handle: S("handle", "Choose a handle (signed in)"),
  legal: S("legal", "Terms and Privacy summaries", "/terms"),
  pub: S("pub", "Public song page"),
  share: S("share", "Share dialog on a song (signed in)"),
  ded: S("ded", "Dedication on a song"),
  fork: S("fork", "Remix and variation dialogs (signed in)"),
  cover: S("cover", "Cover art panel (signed in)"),
  stems: S("stems", "Stems panel (signed in)"),
  songact: S("songact", "Song page actions (signed in)"),
  songmeta: S("songmeta", "Song page: composition details (signed in)"),
  song: S("song", "Song page (signed in)"),
  compare: S("compare", "Compare two versions (signed in)"),
  guide: S("guide", "First-run guide (signed in)"),
  prompt: S("prompt", "Create a song: prompt tab (signed in)"),
  create: S("create", "Create a song: canvas (signed in)"),
  adv: S("adv", "Create a song: advanced options (signed in)"),
  voice: S("voice", "Create a song: voice picker (signed in)"),
  libpick: S("libpick", "Create a song: lyric library (signed in)"),
  job: S("job", "Song progress screen (signed in)"),
  lib: S("lib", "Library (signed in)"),
  acct: S("acct", "Account actions (signed in)"),
  account: S("account", "Account page (signed in)"),
  lyrics: S("lyrics", "Synced lyrics on a song"),
  player: S("player", "Mini-player and playback"),
  install: S("install", "Install prompt"),
  net: S("net", "Offline banner"),
  empty: S("empty", "Empty states"),
  error: S("error", "Error pages"),
  misc: S("misc", "Miscellaneous"),
};

export function screenFor(key: string): Screen {
  if (key.startsWith("legal.privacy.")) return S("legal-privacy", "Privacy summary", "/privacy");
  const ns = key.split(".")[0] ?? "";
  return SCREENS[ns] ?? S(ns, ns);
}

/** Paths the open-in-language redirect may target: only the public pages above. */
export const OPENABLE_PATHS: readonly string[] = [
  ...new Set(Object.values(SCREENS).flatMap((s) => (s.path ? [s.path] : [])).concat(["/privacy", "/offline"])),
];

export interface ReviewRow {
  key: string;
  en: string;
  current: string;
}
export interface ReviewSection extends Screen {
  rows: ReviewRow[];
}

/** Every key for a language, grouped by screen in the order screens first appear in the English source. */
export function buildSections(lang: ReviewLang): ReviewSection[] {
  const order: string[] = [];
  const by = new Map<string, ReviewSection>();
  for (const key of Object.keys(UI_STRINGS.en) as UiKey[]) {
    const sc = screenFor(key);
    let sec = by.get(sc.id);
    if (!sec) {
      sec = { ...sc, rows: [] };
      by.set(sc.id, sec);
      order.push(sc.id);
    }
    sec.rows.push({ key, en: UI_STRINGS.en[key], current: UI_STRINGS[lang][key] });
  }
  return order.map((id) => by.get(id) as ReviewSection);
}

const tokensOf = (s: string) => [...s.matchAll(/\{\w+\}|\[\[|\]\]/g)].map((m) => m[0]).sort();

/** A suggestion must keep every {placeholder} and [[marker]] the English has, or the UI would break. */
export function validateSuggestion(en: string, text: string): "ok" | "empty" | "too_long" | "placeholders" {
  const t = text.trim();
  if (!t) return "empty";
  if (t.length > MAX_SUGGESTION) return "too_long";
  return JSON.stringify(tokensOf(en)) === JSON.stringify(tokensOf(t)) ? "ok" : "placeholders";
}

export interface EditRow {
  token_id: string;
  key: string;
  action: "approve" | "edit";
  suggestion: string | null;
  comment: string | null;
  /** Translation text the reviewer saw. Rows whose base no longer matches the current text are stale. */
  base_text: string;
  updated_at: string;
}

export interface PatchEdit {
  key: string;
  old: string;
  new: string;
  comments: string[];
  /** Other suggestions for the same key from different reviewers (latest wins above). */
  alternatives: string[];
}
export interface Patch {
  language: ReviewLang;
  generated_at: string;
  total_keys: number;
  approved_keys: string[];
  edits: PatchEdit[];
  stale: number;
  /** Every key approved or edited by someone, so the locale can be marked reviewed. */
  complete: boolean;
}

export function buildPatch(lang: ReviewLang, rows: readonly EditRow[], now = new Date()): Patch {
  const keys = Object.keys(UI_STRINGS.en) as UiKey[];
  const cur = UI_STRINGS[lang];
  const byKey = new Map<string, EditRow[]>();
  let stale = 0;
  for (const r of rows) {
    if (!(r.key in cur)) continue;
    if (r.base_text !== cur[r.key as UiKey]) {
      stale++;
      continue;
    }
    byKey.set(r.key, [...(byKey.get(r.key) ?? []), r]);
  }
  const approved: string[] = [];
  const edits: PatchEdit[] = [];
  for (const key of keys) {
    const rs = (byKey.get(key) ?? []).slice().sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
    if (rs.length === 0) continue;
    const editRows = rs.filter((r) => r.action === "edit" && r.suggestion);
    const latest = editRows[0];
    if (latest && validateSuggestion(UI_STRINGS.en[key], latest.suggestion as string) === "ok") {
      const text = (latest.suggestion as string).trim();
      if (text !== cur[key]) {
        edits.push({
          key,
          old: cur[key],
          new: text,
          comments: rs.flatMap((r) => (r.comment ? [r.comment] : [])),
          alternatives: [...new Set(editRows.slice(1).map((r) => (r.suggestion as string).trim()).filter((s) => s !== text))],
        });
        continue;
      }
    }
    approved.push(key);
  }
  const touched = new Set([...approved, ...edits.map((e) => e.key)]);
  return {
    language: lang,
    generated_at: now.toISOString(),
    total_keys: keys.length,
    approved_keys: approved,
    edits,
    stale,
    complete: touched.size === keys.length,
  };
}

/** Markdown table for the PR description. */
export function patchMarkdown(p: Patch): string {
  const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const lines = [
    `### ${p.language}: ${p.edits.length} edits, ${p.approved_keys.length} approved as-is, ${p.total_keys - p.edits.length - p.approved_keys.length} not yet reviewed`,
    "",
  ];
  if (p.edits.length) {
    lines.push("| key | current | suggested | reviewer comment |", "| --- | --- | --- | --- |");
    for (const e of p.edits) lines.push(`| \`${e.key}\` | ${esc(e.old)} | ${esc(e.new)} | ${esc(e.comments.join(" / "))} |`);
  }
  const alts = p.edits.filter((e) => e.alternatives.length);
  if (alts.length) {
    lines.push("", "Competing suggestions (latest was used):");
    for (const e of alts) lines.push(`- \`${e.key}\`: ${e.alternatives.map(esc).join(" ; ")}`);
  }
  return lines.join("\n");
}

/** Replace the value on each edited key's line in a locale source file. Throws if a key's line is missing. */
export function applyEditsToSource(source: string, edits: readonly { key: string; new: string }[]): string {
  let out = source;
  for (const e of edits) {
    const prefix = `  ${JSON.stringify(e.key)}: `;
    const start = out.indexOf(`\n${prefix}`);
    if (start < 0) throw new Error(`key not found in locale file: ${e.key}`);
    const lineStart = start + 1;
    const lineEnd = out.indexOf("\n", lineStart);
    out = out.slice(0, lineStart) + `${prefix}${JSON.stringify(e.new)},` + out.slice(lineEnd);
  }
  return out;
}

/** Flip one locale's status to "reviewed" in ui-strings.ts. */
export function markReviewed(source: string, lang: ReviewLang): string {
  const re = new RegExp(`(\\n\\s+${lang}: )"pending-review"`);
  if (!re.test(source)) throw new Error(`status for ${lang} is not pending-review`);
  return source.replace(re, '$1"reviewed"');
}
