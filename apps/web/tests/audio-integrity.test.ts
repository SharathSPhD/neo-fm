import { describe, expect, it } from "vitest";
import { diffAudio, objectPath } from "../scripts/check-audio-integrity.mjs";

const t = (id: string, job: string, path: string, deleted_at: string | null = null) => ({ id, job_id: job, url: `tracks/${path}`, deleted_at });

describe("audio integrity diff", () => {
  it("strips the bucket prefix from track urls", () => {
    expect(objectPath("tracks/j1/1.mp3")).toBe("j1/1.mp3");
  });
  it("is clean when every row has its object and every object is referenced", () => {
    const r = diffAudio({ tracks: [t("a", "j1", "j1/1.mp3")], completedJobs: ["j1"], runs: [{ job_id: "j1", audio_path: "j1/1.mp3" }], objects: ["j1/1.mp3"] });
    expect(r).toEqual({ missing: [], orphans: [], no_track: [] });
  });
  it("flags a track row whose object is gone", () => {
    const r = diffAudio({ tracks: [t("a", "j1", "j1/1.mp3")], completedJobs: ["j1"], runs: [], objects: [] });
    expect(r.missing).toEqual([{ job_id: "j1", track_id: "a", path: "j1/1.mp3", source: "tracks.url" }]);
  });
  it("ignores soft-deleted tracks whose object was removed on purpose", () => {
    const r = diffAudio({ tracks: [t("a", "j1", "j1/1.mp3", "2026-10-01T00:00:00Z")], completedJobs: [], runs: [], objects: [] });
    expect(r.missing).toEqual([]);
  });
  it("flags objects nothing points at, but not those an agent run still references", () => {
    const r = diffAudio({ tracks: [], completedJobs: [], runs: [{ job_id: "j2", audio_path: "j2/1.mp3" }], objects: ["j2/1.mp3", "j9/1.mp3"] });
    expect(r.orphans).toEqual(["j9/1.mp3"]);
  });
  it("flags a completed job with audio on its run but no track row, and no double-report of a missing object", () => {
    const r = diffAudio({ tracks: [], completedJobs: ["j3"], runs: [{ job_id: "j3", audio_path: "j3/1.mp3" }], objects: [] });
    expect(r.no_track).toEqual(["j3"]);
    expect(r.missing).toEqual([{ job_id: "j3", track_id: null, path: "j3/1.mp3", source: "agent_runs.audio_path" }]);
  });
});
