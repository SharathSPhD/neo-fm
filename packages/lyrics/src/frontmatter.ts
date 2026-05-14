/**
 * Minimal YAML frontmatter parser scoped to the shape ADR 0006 defines.
 *
 * We deliberately do NOT pull in `js-yaml` for this. Our frontmatter is a
 * fixed set of scalar fields and one multi-line `|` block (license_basis).
 * A handwritten parser is ~50 lines, has no transitive deps, and refuses
 * anything outside the expected shape (which means a contributor cannot
 * accidentally smuggle in nested YAML the provenance verifier wouldn't
 * understand).
 */
export interface FrontmatterAndBody {
  frontmatter: Record<string, string | number>;
  body: string;
}

export class FrontmatterError extends Error {}

const FRONTMATTER_OPEN = "---\n";
const FRONTMATTER_CLOSE = "\n---\n";

function unquote(value: string): string {
  const v = value.trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

function coerceScalar(raw: string): string | number {
  const v = unquote(raw);
  if (v === "") return v;
  if (/^-?\d+$/.test(v)) {
    return Number.parseInt(v, 10);
  }
  return v;
}

export function parseFrontmatter(text: string): FrontmatterAndBody {
  if (!text.startsWith(FRONTMATTER_OPEN)) {
    throw new FrontmatterError("missing opening `---` fence");
  }
  const closeIdx = text.indexOf(FRONTMATTER_CLOSE, FRONTMATTER_OPEN.length);
  if (closeIdx === -1) {
    throw new FrontmatterError("missing closing `---` fence");
  }
  const yamlBlock = text.slice(FRONTMATTER_OPEN.length, closeIdx);
  const body = text.slice(closeIdx + FRONTMATTER_CLOSE.length);

  const fm: Record<string, string | number> = {};
  const lines = yamlBlock.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) {
      throw new FrontmatterError(
        `unparseable frontmatter line: ${JSON.stringify(line)}`,
      );
    }
    const key = m[1] ?? "";
    const rest = m[2] ?? "";
    if (rest.trim() === "|") {
      // Block scalar. Capture indented continuation lines until dedent or EOF.
      i += 1;
      const blockLines: string[] = [];
      let indent: number | null = null;
      while (i < lines.length) {
        const next = lines[i] ?? "";
        if (next.trim() === "") {
          blockLines.push("");
          i += 1;
          continue;
        }
        const leading = next.match(/^(\s*)/)?.[1]?.length ?? 0;
        if (indent === null) indent = leading;
        if (leading < (indent ?? 0)) break;
        blockLines.push(next.slice(indent ?? 0));
        i += 1;
      }
      fm[key] = blockLines.join("\n").trim();
    } else {
      fm[key] = coerceScalar(rest);
      i += 1;
    }
  }

  return { frontmatter: fm, body: body.replace(/^\n+/, "") };
}
