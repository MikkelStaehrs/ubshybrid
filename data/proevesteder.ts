// Prøvestederne: hvor der tages prøver, hvad de skal bruges til, og hvor de
// analyseres.
//
// Håndholdt fil, og det ene sted, et prøvested er defineret. Fabrikskortet
// tegner dem, og simuleringens prøveplan (data/fremskrivning.ts) peger på dem.
//
// Et prøvested bindes til maskinens W-ID — og på et kastebord til strømmen —
// aldrig til tegningens celle-id eller et navn. Navnet her er til skærmen.
//
// To slags, sagt af driften:
//   - proces: prøverne, der gør, at vi handler på maskinerne løbende.
//   - ista:   de officielle prøver efter ISTA's regler.
//
// Operationsnummeret er det, laboratoriet kender prøven under. Står det tomt,
// står der "Ikke udfyldt" — det gættes ikke. Det samme gælder hyppigheden:
// simuleringens plan er et skøn og hører ikke til her.

export type ProevestedSlags = "proces" | "ista";
export type Instrument = "videometer" | "ct";
export type Stroem = "heavy" | "light" | "ready";

export interface Proevested {
  /** Stabil nøgle i koden. */
  id: string;
  /** Laboratoriets operationsnummer. null: ikke udfyldt. */
  operationsnr: string | null;
  slags: ProevestedSlags;
  /** Højst fire ord. */
  navn: string;
  /** Hvad prøven skal bruges til. */
  formaal: string;
  /** Hvor den tages: linjen eller rummet, maskinen og — på et kastebord — strømmen. */
  hvor: { del: string; wId: string; stroem?: Stroem };
  /** Hvor den analyseres: rummet og instrumentet. */
  analyse: { del: string; instrument: Instrument };
  /** Hvor tit, som laboratoriet har aftalt det. null: ikke udfyldt. */
  hyppighed: string | null;
}

export const INSTRUMENT_NAVN: Record<Instrument, string> = { videometer: "Videometer", ct: "CT-scanner" };

const STROEM_NAVN: Record<Stroem, string> = { heavy: "Heavy", light: "Light", ready: "Ready" };

const FORMAAL: Record<Stroem, string> = {
  heavy: "Hvor mange gode frø bordet smider ud i den tunge ende for hvert multigerm, det fanger. Heavy ryger ud.",
  light: "Hvor mange gode frø bordet smider ud i den lette ende for hvert tomt frø og fragment, det fanger. Light ryger ud.",
  ready: "Hvor rent frøet er, der går videre: multigerm, fragmenter og foreign seeds. Fra det sidste bord er det færdigvaren.",
};

/** Kastebordene og deres tre strømme. */
const kastebord = (wId: string, kort: string): Proevested[] =>
  (["heavy", "light", "ready"] as const).map((stroem) => ({
    id: `kb-${wId}-${stroem}`,
    operationsnr: null,
    slags: "proces",
    navn: `${kort} ${STROEM_NAVN[stroem]}`,
    formaal: FORMAAL[stroem],
    hvor: { del: "sliberi", wId, stroem },
    analyse: { del: "analytics", instrument: "ct" },
    hyppighed: null,
  }));

export const PROEVESTEDER: Proevested[] = [
  {
    id: "foer-fordeleren",
    operationsnr: null,
    slags: "proces",
    navn: "Før fordeleren",
    formaal: "Tidlig advarsel om foreign seeds — så der kan sorteres hårdere på Triørerne — og slibeskader. 500 g.",
    hvor: { del: "sliberi", wId: "615" },
    analyse: { del: "analytics", instrument: "videometer" },
    hyppighed: null,
  },
  {
    id: "efter-jetpealer-n",
    operationsnr: null,
    slags: "proces",
    navn: "Efter Jetpealer N",
    formaal: "Partiets kvalitet efter slibning: FV, multigerm (BIGF, BIGH, TWIN), NOTS og frøvægten i sporet.",
    hvor: { del: "sliberi", wId: "790" },
    analyse: { del: "analytics", instrument: "ct" },
    hyppighed: null,
  },
  {
    id: "efter-jetpealer-s",
    operationsnr: null,
    slags: "proces",
    navn: "Efter Jetpealer S",
    formaal: "Partiets kvalitet efter slibning: FV, multigerm (BIGF, BIGH, TWIN), NOTS og frøvægten i sporet.",
    hvor: { del: "sliberi", wId: "789" },
    analyse: { del: "analytics", instrument: "ct" },
    hyppighed: null,
  },
  ...kastebord("636", "KB-3N"),
  ...kastebord("746", "KB-3NN"),
  ...kastebord("635", "KB-2S"),
  ...kastebord("745", "KB-2SS"),
  // ISTA-prøverne: de officielle. Hvor og hvordan de tages, er ikke sagt endnu.
];
