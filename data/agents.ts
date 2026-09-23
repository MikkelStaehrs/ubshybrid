// Agenterne: Claude-scripts, der læser data og skriver tekst.
//
// De kører ikke endnu — ingen har `beslutning: "aktiveret"`, og der bliver
// ikke kaldt noget API. Filen beskriver hvad de skal lave, hvem det er til,
// hvad de skal bruge for at kunne det, og hvor de kigger hen.
//
// Status står der ikke. Den udledes i src/lib/agents.ts af beslutningen og
// af, om de signaler agenten har brug for, rent faktisk findes. Skrev vi
// status i hånden, ville den før eller siden komme til at lyve.
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
    til: "Linjeleder",
    svarerPaa: "Hvad skete i går, og hvad skal jeg kigge på?",
    job: "Daglig stoprapport for spor N: hvornår stod maskinerne stille, hvor længe, og hvad der gik forud.",
    scope: { kind: "lane", lane: "N", upstream: INLET },
    inputs: [
      {
        type: "motor-run",
        required: true,
        need: "Driftssignal (DI) pr. maskine i sporet",
      },
      {
        // Stedet, ikke taget. Måleren sad på elevator 756 og sidder nu ved
        // indgangen; flytter den sig igen, skal inputtet stadig passe.
        inlet: "materiale",
        required: false,
        need: "Materialestrøm ind i sporene, målt ved linjens indgang",
      },
    ],
    // Skriver prosa ud fra tal, der skal vejes mod hinanden.
    engine: "claude",
    cadence: "Dagligt 06:00",
    beslutning: "besluttet",
  },
  {
    id: "AG-SLIB-S",
    name: "Linjeagent Spor S",
    role: "linjeagent",
    til: "Linjeleder",
    svarerPaa: "Hvad skete i går, og hvad skal jeg kigge på?",
    job: "Daglig stoprapport for spor S: hvornår stod maskinerne stille, hvor længe, og hvad der gik forud.",
    scope: { kind: "lane", lane: "S", upstream: INLET },
    inputs: [
      {
        type: "motor-run",
        required: true,
        need: "Driftssignal (DI) pr. maskine i sporet",
      },
      {
        // Stedet, ikke taget. Måleren sad på elevator 756 og sidder nu ved
        // indgangen; flytter den sig igen, skal inputtet stadig passe.
        inlet: "materiale",
        required: false,
        need: "Materialestrøm ind i sporene, målt ved linjens indgang",
      },
    ],
    engine: "claude",
    cadence: "Dagligt 06:00",
    beslutning: "besluttet",
  },
  {
    id: "AG-SLIB-VAGT",
    name: "Kædevagt",
    role: "vagt",
    til: "Systemansvarlig",
    svarerPaa: "Kan jeg stole på data lige nu?",
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
    beslutning: "besluttet",
  },

  {
    id: "AG-SLIB-DRIFT",
    name: "Driftsagent",
    role: "styring",
    til: "Operatør",
    svarerPaa: "Skal et spor stoppes nu?",
    // Den eneste agent, der griber ind frem for at skrive. Den stopper et
    // spor, før en ophobning løber over eller frøet tager skade, og starter
    // det igen, når årsagen er væk.
    //
    // Den kan ikke stoppe noget i dag: der findes ingen vej fra en agent
    // tilbage til styringen. Den vej — en skrivning til PLC'en, interlocks,
    // hvem der kan tilsidesætte — er en sikkerhedsbeslutning og skal tages
    // for sig, før agenten slås til. Se "Åbne ender" i CLAUDE.md.
    job: "Stopper et spor, før en fejl eller en ophobning løber over, og starter det igen, når årsagen er væk.",
    scope: { kind: "line" },
    inputs: [
      {
        type: "motor-run",
        required: true,
        need: "Driftssignal (DI) pr. maskine på linjen",
      },
      {
        // En agent, der styrer, må ikke se forsinket. Uden databasen ser den
        // ingenting, og halter den, holder agenten sine beslutninger.
        chainStep: "mssql",
        required: true,
        need: "Databasen skal tage imod rækker, uden at halte",
      },
      {
        inlet: "materiale",
        required: false,
        need: "Materialestrøm ved linjens indgang",
      },
    ],
    // Reglerne afgør, hvornår noget er galt. Claude vejer, om det er et stop
    // værd, og skriver hvorfor — kun når der sker noget, ikke løbende.
    engine: "claude",
    cadence: "Ved hændelser",
    beslutning: "besluttet",
  },

  // --- Idéer -------------------------------------------------------------
  // Tænkt, men ikke besluttet. De tæller ikke med i optællinger og får ingen
  // zone på gulvet, før nogen siger ja til dem.
  {
    id: "AG-SLIB-SKIFT",
    name: "Skifteagent",
    role: "linjeagent",
    til: "Operatør",
    svarerPaa: "Hvad skal næste hold vide?",
    job: "Overlevering ved skiftehold: hvad der kørte skævt, hvad der blev rørt ved, og hvad der stadig står åbent.",
    scope: { kind: "line" },
    inputs: [
      {
        type: "motor-run",
        required: true,
        need: "Driftssignal (DI) pr. maskine på linjen",
      },
      {
        signalId: "FT-743",
        required: false,
        need: "Materialestrøm gennem linjen",
      },
    ],
    engine: "claude",
    cadence: "Ved hvert skiftehold",
    beslutning: "ide",
  },
  {
    id: "AG-SLIB-VEDL",
    name: "Vedligeholdsagent",
    role: "linjeagent",
    til: "Vedligehold",
    svarerPaa: "Hvilken maskine er på vej til at blive et problem?",
    job: "Ugentligt overblik over de maskiner, hvor driftsmønster og historik peger samme vej.",
    scope: { kind: "line" },
    inputs: [
      {
        type: "motor-run",
        required: true,
        need: "Driftssignal (DI) pr. maskine på linjen",
      },
      {
        dataset: "maintenance",
        required: true,
        need: "Vedligeholdshistorik på maskinerne",
      },
    ],
    engine: "claude",
    cadence: "Ugentligt, mandag 07:00",
    beslutning: "ide",
  },
];

export const AGENTS: Record<string, Agent[]> = { sliberi };
