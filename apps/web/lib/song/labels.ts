/**
 * Display-label helpers for style families and languages. Used
 * across /discover, /s/[publicId], /songs/[id], and OG image
 * generation so we render the same human-readable strings every-
 * where without copy-pasting the switch statements.
 */

export function prettyStyle(style: string): string {
  switch (style) {
    case "carnatic":
      return "Carnatic";
    case "hindustani":
      return "Hindustani";
    case "kannada-folk":
      return "Kannada folk";
    case "western":
      return "Western";
    default:
      return style;
  }
}

export function prettyLanguage(lang: string): string {
  switch (lang) {
    case "en":
      return "English";
    case "hi":
      return "Hindi";
    case "kn":
      return "Kannada";
    default:
      return lang;
  }
}
