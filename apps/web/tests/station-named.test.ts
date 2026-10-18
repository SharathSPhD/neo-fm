import { describe, expect, it } from "vitest";

import { findStation, MIN_STATION_TRACKS, NAMED_STATIONS, stationPool } from "../lib/station/named";
import { programQueue } from "../lib/station/program";

const t = (id: string, tags: string[]) => ({ id, language: "hi", tags });

describe("named stations", () => {
  it("looks stations up by slug and rejects unknown ones", () => {
    expect(findStation("subah")?.name).toBe("Subah");
    expect(findStation("nope")).toBeNull();
    expect(findStation(undefined)).toBeNull();
    expect(new Set(NAMED_STATIONS.map((s) => s.slug)).size).toBe(NAMED_STATIONS.length);
  });

  it("filters to the station's tracks when there are enough", () => {
    const station = findStation("raat")!;
    const pool = [...Array.from({ length: MIN_STATION_TRACKS }, (_, i) => t(`c${i}`, ["calm"])), t("x", ["energetic"])];
    expect(stationPool(pool, station).map((x) => x.id)).not.toContain("x");
  });

  it("only leans on a thin pool instead of looping a handful of tracks", () => {
    const station = findStation("raat")!;
    const pool = [t("a", ["calm"]), t("b", ["energetic"]), t("c", ["pop"])];
    expect(stationPool(pool, station)).toHaveLength(3);
  });

  it("Diwali Radio forces the occasion slot outside the festival window", () => {
    const station = findStation("diwali")!;
    const ranked = [t("a", ["calm"]), t("b", ["calm"]), t("c", ["calm"]), t("d", ["calm"]), t("e", ["diwali"]), t("f", ["calm"])];
    // month 3 is well outside the calendar window, so only the forced themes can put the diwali track in the occasion slot
    const withThemes = programQueue(ranked, { hour: 12, month: 3, day: 1, familiar: new Set(), limit: 5, themes: station.themes });
    // the wheel's fifth slot is the occasion slot
    expect(withThemes[4]!.id).toBe("e");
  });

  it("Subah pins the dawn daypart", () => {
    const station = findStation("subah")!;
    expect(station.pinHour).toBe(6);
  });
});
