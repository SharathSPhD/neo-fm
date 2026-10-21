/**
 * English cases for the ENGLISH_MAIN lyrics gate (two per genre). Ids are frozen: `en-<genre>-<n>`, never reorder.
 * Kept out of allEvalBriefs() so the 150-brief research set (EVAL-PCE.md) stays comparable.
 */
import type { EvalBrief } from "./briefs";

export const ENGLISH_BRIEFS: EvalBrief[] = [
  { id: "en-pop-1", language: "English", style: "english-pop", text: "A bright summer pop song about the first morning of a holiday with someone new, windows down and no plans" },
  { id: "en-pop-2", language: "English", style: "english-pop", text: "A pop song for a friend who just moved cities, about group chats, voice notes and the flat that feels too quiet" },
  { id: "en-rock-1", language: "English", style: "english-rock", text: "A driving rock anthem about leaving a small town at midnight with everything you own in the back seat" },
  { id: "en-rock-2", language: "English", style: "english-rock", text: "A rock song about finally standing up to a boss who took credit for years of work" },
  { id: "en-hiphop-1", language: "English", style: "english-hip-hop", text: "A hip-hop verse and hook about the first person in the family to graduate, with the night shifts that paid for it" },
  { id: "en-hiphop-2", language: "English", style: "english-hip-hop", text: "A laid-back hip-hop track about Sunday cooking with the whole block, steam on the windows and old records" },
  { id: "en-country-1", language: "English", style: "english-country", text: "A country ballad about a father's truck still parked in the barn, and the daughter who now drives it" },
  { id: "en-country-2", language: "English", style: "english-country", text: "A country song about a diner that is closing after forty years and the regulars' last breakfast" },
  { id: "en-rnb-1", language: "English", style: "english-rnb", text: "A slow r&b song about texting an ex at 2am, wanting to call and choosing not to" },
  { id: "en-rnb-2", language: "English", style: "english-rnb", text: "A smooth r&b love song for an anniversary, small rituals like shared umbrellas and Sunday records" },
  { id: "en-indiefolk-1", language: "English", style: "english-indie-folk", text: "An indie folk song about walking a river path in autumn and learning to forgive a brother" },
  { id: "en-indiefolk-2", language: "English", style: "english-indie-folk", text: "A quiet indie folk lullaby for a newborn, about the lamp left on in the hallway and the long first winter" },
];
