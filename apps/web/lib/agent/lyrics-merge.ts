/**
 * Merge the agent's sectioned lyrics (`[Tag]` blocks) into an existing Song Document so the
 * app's own pages (which read `sections[].lyrics`) show them. Pure and defensive: never throws,
 * never adds or removes sections, never exceeds the per-section character cap.
 */
export const LYRIC_SECTION_MAX = 2000; // keep in step with LYRIC_PER_SECTION_MAX_CHARS in @neo-fm/song-doc

const INSTRUMENTAL = new Set(["alaap", "alap", "intro", "outro", "instrumental", "jor", "jhala", "interlude", "tihai"]);

interface DocSection { id?: string; type?: string; lyrics?: string; [k: string]: unknown }

export function parseBlocks(md: string): { tag: string; text: string }[] {
  const blocks: { tag: string; text: string }[] = [];
  let cur: { tag: string; lines: string[] } | null = null;
  for (const line of md.replace(/\r/g, "").split("\n")) {
    const m = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (m) {
      if (cur) blocks.push({ tag: cur.tag, text: cur.lines.join("\n").trim() });
      cur = { tag: m[1]!.trim(), lines: [] };
    } else if (cur) cur.lines.push(line);
  }
  if (cur) blocks.push({ tag: cur.tag, text: cur.lines.join("\n").trim() });
  return blocks.filter((b) => b.text.length > 0);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

export function mergeLyrics<T extends { sections?: DocSection[] }>(doc: T, lyricsMd: string | null | undefined): T {
  try {
    const sections = doc.sections;
    if (!lyricsMd || !Array.isArray(sections) || sections.length === 0) return doc;
    const blocks = parseBlocks(lyricsMd);
    if (blocks.length === 0) return doc;
    const used = new Set<number>();
    const assigned: (string | undefined)[] = sections.map(() => undefined);

    // Pass 1: match by section type (e.g. [Mukhda] -> mukhda).
    sections.forEach((s, i) => {
      const t = norm(String(s.type ?? ""));
      if (!t || INSTRUMENTAL.has(t)) return;
      const j = blocks.findIndex((b, bi) => !used.has(bi) && (norm(b.tag).startsWith(t) || t.startsWith(norm(b.tag))));
      if (j >= 0) { used.add(j); assigned[i] = blocks[j]!.text; }
    });
    // Pass 2: remaining blocks fill remaining lyric-capable sections in order.
    const free = sections.map((s, i) => ({ s, i })).filter(({ s, i }) => assigned[i] === undefined && !INSTRUMENTAL.has(norm(String(s.type ?? ""))));
    blocks.forEach((b, bi) => {
      if (used.has(bi)) return;
      const slot = free.shift();
      if (slot) { used.add(bi); assigned[slot.i] = b.text; }
    });
    // Leftovers are appended to the last lyric section rather than dropped.
    const leftovers = blocks.filter((_, bi) => !used.has(bi)).map((b) => b.text);
    if (leftovers.length) {
      for (let i = sections.length - 1; i >= 0; i--) {
        if (assigned[i] !== undefined) { assigned[i] = `${assigned[i]}\n\n${leftovers.join("\n\n")}`; break; }
      }
    }
    return {
      ...doc,
      sections: sections.map((s, i) => (assigned[i] === undefined ? s : { ...s, lyrics: assigned[i]!.slice(0, LYRIC_SECTION_MAX) })),
    };
  } catch {
    return doc;
  }
}
