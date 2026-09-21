// Agenterne: Claude-scripts, der læser data og skriver tekst.
//
// De kører ikke endnu — `enabled` er false på dem alle, og der bliver ikke
// kaldt noget API. Filen beskriver hvad de skal lave, hvad de skal bruge for
// at kunne det, og hvor de kigger hen.
//
// Status står der ikke. Den udledes i src/lib/agents.ts af, om de signaler
// agenten har brug for, rent faktisk findes i anlægget. Skrev vi status i
// hånden, ville den før eller siden komme til at lyve.
//
// Den tværgående agent oprettes først, når der er mere end én linje at gå på
// tværs af. Lige nu ville den kun have linje 2 at se på.
import type { Agent } from "../src/lib/types";

/** Fællesstrækket fra vippestolene til fordeleren. Begge spor får det som upstream. */
const INLET = ["793", "794", "795", "796", "611", "743", "614", "756", "615"];

const sliberi: Agent[] = [
  {
    id: "AG-SLIB-N",
    name: "Linjeagent Spor N",
    role: "linjeagent",
    job: "Daglig stoprapport for spor N: hvornår stod maskinerne stille, hvor længe, og hvad der gik forud.",
    scope: { kind: "lane", lane: "N", upstream: INLET },
    inputs: [
      {
        type: "motor-run",
        required: true,
        need: "Driftssignal (DI) pr. maskine i sporet",
      },
      {
        signalId: "FT-756",
        required: false,
        need: "Materialestrøm ind i sporene, målt før fordeleren",
      },
    ],
    // Skriver prosa ud fra tal, der skal vejes mod hinanden.
    engine: "claude",
    cadence: "Dagligt 06:00",
    enabled: false,
  },
  {
    id: "AG-SLIB-S",
    name: "Linjeagent Spor S",
    role: "linjeagent",
    job: "Daglig stoprapport for spor S: hvornår stod maskinerne stille, hvor længe, og hvad der gik forud.",
    scope: { kind: "lane", lane: "S", upstream: INLET },
    inputs: [
      {
        type: "motor-run",
        required: true,
        need: "Driftssignal (DI) pr. maskine i sporet",
      },
      {
        signalId: "FT-756",
        required: false,
        need: "Materialestrøm ind i sporene, målt før fordeleren",
      },
    ],
    engine: "claude",
    cadence: "Dagligt 06:00",
    enabled: false,
  },
  {
    id: "AG-SLIB-VAGT",
    name: "Vagtagent",
    role: "vagt",
    // Vagten ser ikke på maskinerne. Dens arbejde er at opdage, at tallene
    // holder op med at komme — og sige hvilket led der tav.
    job: "Melder når et led i signalkæden holder op med at svare, og hvilket et.",
    scope: { kind: "chain" },
    inputs: [
      { chainStep: "kobler", required: true, need: "IO-kobleren skal svare på Modbus" },
      { chainStep: "edge", required: true, need: "Edge-collectoren skal køre og poll'e" },
      { chainStep: "mssql", required: true, need: "Databasen skal tage imod rækker" },
    ],
    // Rent regel-tjek: svarede leddet, eller gjorde det ikke. Ingen API-kald —
    // og slet ikke fire gange i timen.
    engine: "kode",
    cadence: "Hver 15. minut",
    enabled: false,
  },
];

export const AGENTS: Record<string, Agent[]> = { sliberi };
