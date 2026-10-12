import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// Vitest compiles TSX with the classic runtime; Next uses the automatic one. Provide React for the pages under test.
(globalThis as { React?: typeof React }).React = React;
const { default: ContentPolicyPage } = await import("../app/(marketing)/content-policy/page");
const { default: PrivacyPage } = await import("../app/(marketing)/privacy/page");
const { default: TermsPage } = await import("../app/(marketing)/terms/page");
const { default: TrustPage } = await import("../app/(marketing)/trust/page");

const html = (el: JSX.Element) => renderToStaticMarkup(el);

describe("legal pages", () => {
  const pages = { terms: html(<TermsPage />), privacy: html(<PrivacyPage />), content: html(<ContentPolicyPage />), trust: html(<TrustPage />) };

  it("each of terms, privacy and content policy opens with a plain-language summary and a dated update", () => {
    for (const k of ["terms", "privacy", "content"] as const) {
      expect(pages[k], k).toContain("In plain language");
      expect(pages[k], k).toContain("Last updated: 13 October 2026");
      expect(pages[k].indexOf("In plain language"), k).toBeLessThan(pages[k].indexOf("<section"));
    }
  });
  it("terms cover AI-generated content and ownership, takedowns and dedications", () => {
    expect(pages.terms).toContain("AI-generated content and ownership");
    expect(pages.terms).toContain("Reports, takedowns and appeals");
    expect(pages.terms).toContain("dedication");
  });
  it("privacy covers the DPDP essentials: notice, consent, grievance, retention, rights, children", () => {
    for (const h of ["Who we are and who to contact", "Why we use it, and your consent", "How long we keep it", "Your rights", "Children", "Data Protection Board"])
      expect(pages.privacy, h).toContain(h);
    expect(pages.privacy).toContain("grievance@neo-fm.com");
  });
  it("the grievance address and response times agree across pages", () => {
    for (const k of ["terms", "privacy", "content", "trust"] as const) expect(pages[k], k).toContain("grievance@neo-fm.com");
    for (const k of ["privacy", "content", "trust"] as const) { expect(pages[k], k).toContain("24 hours"); expect(pages[k], k).toContain("15 days"); }
  });
  it("trust links to the content policy", () => expect(pages.trust).toContain('href="/content-policy"'));
});
