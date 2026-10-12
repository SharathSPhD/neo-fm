/** Reduce a browser CSP report (legacy `csp-report` or Reporting API array) to a few short, log-safe fields. */
export interface CspViolation {
  directive: string;
  blocked: string;
  document: string;
}

const clip = (v: unknown, n = 200): string =>
  (typeof v === "string" ? v : "").replace(/[\r\n\t]+/g, " ").replace(/[?#].*$/, "").slice(0, n);

export function summarizeCspReports(body: unknown): CspViolation[] {
  const items = Array.isArray(body) ? body : [body];
  const out: CspViolation[] = [];
  for (const it of items.slice(0, 10)) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const r = (o["csp-report"] ?? o.body ?? o) as Record<string, unknown>;
    if (!r || typeof r !== "object") continue;
    const directive = clip(r["effective-directive"] ?? r.effectiveDirective ?? r["violated-directive"] ?? r.violatedDirective, 60);
    if (!directive) continue;
    out.push({
      directive,
      blocked: clip(r["blocked-uri"] ?? r.blockedURL ?? r.blockedUri, 120),
      document: clip(r["document-uri"] ?? r.documentURL ?? r.documentUri, 120),
    });
  }
  return out;
}
