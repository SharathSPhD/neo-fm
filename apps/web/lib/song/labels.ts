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
    case "kannada-light-classical":
      return "Kannada light-classical";
    case "tamil-folk":
      return "Tamil folk";
    // v1.4 Sprint 2 / Sprint 3 additions.
    case "bollywood-ballad":
      return "Bollywood ballad";
    case "sanskrit-shloka":
      return "Sanskrit shloka";
    case "bengali-rabindrasangeet":
      return "Bengali Rabindra Sangeet";
    case "telugu-keerthana":
      return "Telugu keerthana";
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
    case "ta":
      return "Tamil";
    // v1.4 Sprint 2 / Sprint 3 additions.
    case "bn":
      return "Bengali";
    case "te":
      return "Telugu";
    case "sa":
      return "Sanskrit";
    default:
      return lang;
  }
}
