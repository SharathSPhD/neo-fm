/** agent_runs columns as of migration 0063 (select column_name from information_schema.columns). `line_timings` joins after its migration. */
export const AGENT_RUN_COLUMNS = [
  "job_id", "session_id", "agent_key", "status", "lyria_calls", "audio_path", "lyrics", "agent_song_document",
  "updated_at", "diction_qa", "polished_lyrics", "render_error",
] as const;

/** PostgREST query for finished songs that still need line timings. Only references real columns. */
export function candidateQuery(baseUrl: string, limit: number, hasLineTimings: boolean): string {
  const cols = ["job_id", "audio_path", "lyrics", ...(hasLineTimings ? ["line_timings"] : [])];
  const filters = ["audio_path=not.is.null", "lyrics=not.is.null", ...(hasLineTimings ? ["line_timings=is.null"] : [])];
  return `${baseUrl}/rest/v1/agent_runs?select=${cols.join(",")}&${filters.join("&")}&order=updated_at.desc&limit=${limit}`;
}
