// Driftsparametre pr. linje: normtakt, stopdefinition og stopårsager.
//
// Håndholdt fil. Den overlever `npm run parse`, modsat data/lines/*.json —
// det er aftaler om driften, ikke noget der står på tegningen.
//
// Alt defineres på linjen, og maskinerne arver. `machines` er kun til dem,
// der faktisk afviger, så ingen skal udfylde seksogtyve maskiner for at få
// en default. Normtakt står tom overalt indtil videre og vises derfor som
// "Ikke udfyldt" — der er ikke gættet et tal.
import type { LineOps } from "../src/lib/types";

const sliberi: LineOps = {
  rateUnit: "t/t",

  // Startværdi, ikke en måling. To minutter stilstand er et stop, der er
  // værd at skrive ned på et sliberi — men tallet skal aftales med driften,
  // før nogen regner tilgængelighed på det.
  stopAfterSeconds: 120,

  // Hvad flowsignalet betyder.
  //
  // `nominal` er nominel kapacitet pr. signal i `rateUnit` og definerer
  // 100 %. Den står tom: ingen har aftalt, hvad fuld fødning er på
  // sliberiet, og indtil da viser kortet procent og skriver "Ikke udfyldt",
  // hvor takten skulle stå. Skrev vi et tal her, ville alle tons på skærmen
  // være gættet.
  //
  //   flow: { nominal: { "FT-743": 32 } },
  //
  // Grænserne for lavt og højt flow er udeladt og arver 70 og 100 procent
  // fra src/lib/flow.ts.
  flow: {
    nominal: {},
  },

  stopReasons: [
    { code: "TILSTOP", label: "Tilstopning" },
    { code: "MATERIALE", label: "Manglende materiale" },
    { code: "OMSTILLING", label: "Sortskift eller omstilling" },
    { code: "VEDLIGEHOLD", label: "Planlagt vedligehold" },
    { code: "MASKINFEJL", label: "Maskinfejl" },
    { code: "BEMANDING", label: "Pause eller manglende bemanding" },
    { code: "UKENDT", label: "Ukendt" },
  ],

  // Ingen maskiner afviger endnu. Skal en elevator fx tælle som stoppet
  // efter 30 sekunder frem for 120, skrives kun den ene ind her:
  //
  //   machines: {
  //     "756": { stopAfterSeconds: 30, note: "Kort buffer — tilstopper hurtigt." },
  //   },
  machines: {},
};

export const LINE_OPS: Record<string, LineOps> = { sliberi };
