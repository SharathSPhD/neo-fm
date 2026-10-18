import { describe, expect, it } from "vitest";

import { uiDaypart } from "@/lib/ui/daypart";

describe("uiDaypart", () => {
  it("maps hours to bands", () => {
    expect(uiDaypart(5)).toBe("dawn");
    expect(uiDaypart(8)).toBe("dawn");
    expect(uiDaypart(9)).toBe("day");
    expect(uiDaypart(15)).toBe("day");
    expect(uiDaypart(16)).toBe("dusk");
    expect(uiDaypart(19)).toBe("dusk");
    expect(uiDaypart(20)).toBe("night");
    expect(uiDaypart(0)).toBe("night");
    expect(uiDaypart(4)).toBe("night");
  });

  it("wraps out-of-range hours", () => {
    expect(uiDaypart(24)).toBe("night");
    expect(uiDaypart(-1)).toBe("night");
    expect(uiDaypart(30)).toBe("dawn");
  });
});
