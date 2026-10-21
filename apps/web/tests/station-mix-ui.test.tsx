import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// useUiLang reads the router to refresh on a language change; there is no app router in a unit render.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

import { StationMix } from "@/app/(station)/station/station-mix";

const name = (c: string) => ({ ta: "Tamil", hi: "Hindi", kn: "Kannada" })[c] ?? c;
const render = (state: "on" | "locked", picks: { lang: string; weight: 1 | 2 | 3 }[] = []) =>
  renderToStaticMarkup(createElement(StationMix, { state, langs: ["ta", "hi", "kn"], picks, name, onChange: () => undefined }));

describe("StationMix", () => {
  it("shows only a link to the pass when locked", () => {
    const html = render("locked");
    expect(html).toContain('href="/pricing/pass"');
    expect(html).not.toContain("station-mix");
  });

  it("lists the languages, hints at a second pick and has no weights for a single pick", () => {
    const html = render("on", [{ lang: "ta", weight: 2 }]);
    expect(html).toContain("Tamil");
    expect(html).toContain("Pick one more language");
    expect(html).not.toContain('role="radiogroup"');
  });

  it("shows a less/even/more control per pick once two languages are chosen, with the chosen weight checked", () => {
    const html = render("on", [{ lang: "ta", weight: 3 }, { lang: "hi", weight: 1 }]);
    expect(html.match(/role="radiogroup"/g)).toHaveLength(2);
    expect(html).toContain("Clear mix");
    expect(html.match(/aria-checked="true"/g)).toHaveLength(2);
  });
});
