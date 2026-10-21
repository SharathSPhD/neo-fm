/**
 * English (Western pop, rock, hip-hop and the rest) as a main language of the offering rather than an afterthought at
 * the end of the list. With ENGLISH_MAIN=1 the creation form puts English first and starts English-UI visitors on it.
 * English lyrics need an eval-gate pass before this goes on in production (see docs/english-offering.md).
 */
export function englishMainEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ENGLISH_MAIN === "1";
}
