export interface StoredClientError {
  created_at: string;
  fingerprint: string;
  name: string;
  message: string;
  route: string;
  boundary: string;
  lang: string | null;
  ua_family: string;
  request_id: string | null;
}

export interface ErrorGroup {
  fingerprint: string;
  name: string;
  message: string;
  route: string;
  count: number;
  first_seen: string;
  last_seen: string;
  boundaries: string[];
  sample_request_id: string | null;
}

/** Collapses rows (newest first or any order) into one entry per fingerprint, most frequent first. */
export function groupClientErrors(rows: StoredClientError[]): ErrorGroup[] {
  const map = new Map<string, ErrorGroup>();
  for (const r of rows) {
    const g = map.get(r.fingerprint);
    if (!g) {
      map.set(r.fingerprint, {
        fingerprint: r.fingerprint,
        name: r.name,
        message: r.message,
        route: r.route,
        count: 1,
        first_seen: r.created_at,
        last_seen: r.created_at,
        boundaries: [r.boundary],
        sample_request_id: r.request_id,
      });
      continue;
    }
    g.count += 1;
    if (r.created_at < g.first_seen) g.first_seen = r.created_at;
    if (r.created_at > g.last_seen) {
      g.last_seen = r.created_at;
      g.sample_request_id = r.request_id ?? g.sample_request_id;
    }
    if (!g.boundaries.includes(r.boundary)) g.boundaries.push(r.boundary);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || (a.last_seen < b.last_seen ? 1 : -1));
}
