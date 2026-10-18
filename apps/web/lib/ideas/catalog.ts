import { IDEAS_DATA } from "./data";
import type { Idea, IdeaLang } from "./types";

export const IDEAS: readonly Idea[] = IDEAS_DATA;

const BY_ID = new Map(IDEAS.map((i) => [i.id, i] as const));

export function ideaById(id: string | null | undefined): Idea | null {
  return (id && BY_ID.get(id)) || null;
}

export function ideasFor(lang: IdeaLang): Idea[] {
  return IDEAS.filter((i) => i.lang === lang);
}
