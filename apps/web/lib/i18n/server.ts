import "server-only";

import { cookies, headers } from "next/headers";

import {
  isUiLang,
  parseAcceptLanguage,
  translate,
  UI_LANG_COOKIE,
  type UiKey,
  type UiLang,
  type UiVars,
} from "./ui-strings";

/** UI language for this request: saved choice first, else the browser's. */
export function getUiLang(): UiLang {
  const saved = cookies().get(UI_LANG_COOKIE)?.value;
  if (isUiLang(saved)) return saved;
  return parseAcceptLanguage(headers().get("accept-language"));
}

/** Translator for server components: `const { t } = serverI18n();` */
export function serverI18n() {
  const lang = getUiLang();
  return { lang, t: (key: UiKey, vars?: UiVars) => translate(lang, key, vars) };
}
