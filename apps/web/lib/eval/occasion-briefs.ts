/**
 * Occasion-song cases for the eval gate: songs people make FOR someone or something (wedding, birthday, festival, farewell),
 * where a prompt change must not lose the named occasion, relationship or ritual. Ids are frozen: `occ-<lang code>-<n>`, never reorder.
 * Kept out of allEvalBriefs() so the 150-brief research set (EVAL-PCE.md) stays comparable.
 */
import type { EvalBrief } from "./briefs";

export const OCCASION_BRIEFS: EvalBrief[] = [
  { id: "occ-kn-1", language: "Kannada", style: "kannada-folk", text: "A wedding song for the bride's sendoff from her parents' home, with the mother's blessing and the sound of the nadaswaram" },
  { id: "occ-kn-2", language: "Kannada", style: "kannada-light-classical", text: "A birthday song for a grandmother turning seventy, thanking her for the stories and the kitchen full of festival sweets" },
  { id: "occ-kn-3", language: "Kannada", style: "kannada-folk", text: "A Ugadi song welcoming the new year with neem and jaggery, bitter and sweet together" },
  { id: "occ-ta-1", language: "Tamil", style: "tamil-folk", text: "A wedding song for the groom's procession arriving under a banana-leaf arch, with the thali and the elders' blessing" },
  { id: "occ-ta-2", language: "Tamil", style: "tamil-light-classical", text: "A birthday song for a little daughter's first birthday, with lamps, payasam and her father's lullaby" },
  { id: "occ-ta-3", language: "Tamil", style: "tamil-folk", text: "A Deepavali morning song about oil baths, new clothes and crackers in the street" },
  { id: "occ-te-1", language: "Telugu", style: "telugu-folk", text: "A wedding song of the pelli-kuthuru ceremony, turmeric on the bride's hands and the women singing around her" },
  { id: "occ-te-2", language: "Telugu", style: "telugu-keerthana", text: "A housewarming song for a family entering a new home, milk boiling over and a prayer at the threshold" },
  { id: "occ-te-3", language: "Telugu", style: "telugu-folk", text: "A Sankranti song with kites, bhogi fire and the harvest brought home" },
  { id: "occ-hi-1", language: "Hindi", style: "bollywood-ballad", text: "A wedding anniversary song for a couple of twenty-five years, tea on the balcony and the same old song on the radio" },
  { id: "occ-hi-2", language: "Hindi", style: "hindi-folk", text: "A Raksha Bandhan song from a sister to her brother far away, the rakhi posted in an envelope" },
  { id: "occ-hi-3", language: "Hindi", style: "bollywood-ballad", text: "A farewell song for a friend leaving for a job in another city, the last chai at the station" },
  { id: "occ-bn-1", language: "Bengali", style: "bengali-folk", text: "A wedding song for the bride's arrival with conch shells, alta on her feet and the ululation of the women" },
  { id: "occ-bn-2", language: "Bengali", style: "bengali-rabindrasangeet", text: "A Poila Boishakh song welcoming the new year with sweets, new accounts books and neighbours visiting" },
  { id: "occ-bn-3", language: "Bengali", style: "bengali-rabindrasangeet", text: "A birthday song for a father, thanking him for the evenings he read poems aloud to the children" },
];

export const OCCASION_BATCH_SOURCE = "occA";
