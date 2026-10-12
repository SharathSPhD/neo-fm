/**
 * Titles of widely known, still-protected songs (titles are not copyrightable; the lyrics are). Used only together with a
 * reproduction cue ("lyrics of ...", "cover of ...") so that "a mood like Tum Hi Ho" is not blocked. Starter list.
 */
import { normaliseText } from "./normalise";

const RAW = [
  // Hindi
  "tum hi ho", "kal ho naa ho", "chaiyya chaiyya", "tujh mein rab dikhta hai", "lag ja gale", "kun faya kun", "kabhi kabhi mere dil mein", "gerua", "channa mereya", "kesariya", "apna bana le", "tum se hi",
  "तुम ही हो", "कल हो ना हो", "छैयां छैयां", "लग जा गले", "केसरिया",
  // Tamil
  "why this kolaveri di", "kannazhaga", "munbe vaa", "chinna chinna aasai", "vaseegara", "ஏன் இந்த கொலவெறி", "சின்ன சின்ன ஆசை",
  // Telugu
  "butta bomma", "naatu naatu", "srivalli", "ramuloo ramulaa", "oo antava", "నాటు నాటు", "బుట్ట బొమ్మ", "శ్రీవల్లి",
  // Kannada
  "belageddu", "ಬೆಳಗೆದ್ದು",
  // Bengali
  "dhitang dhitang bole", "ধিতাং ধিতাং বোলে",
  // English
  "shape of you", "bohemian rhapsody", "hotel california", "imagine", "blinding lights", "rolling in the deep", "shake it off", "billie jean", "thriller",
];
export const KNOWN_TITLES: string[] = RAW.map(normaliseText);
