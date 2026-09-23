// Fælles datamodel for fabrikskortet.
// Én LineData pr. produktionslinje. Genereres fra Draw.io via `npm run parse`
// og kan senere læses fra MSSQL i stedet for JSON.

export type MachineKind = "intake" | "elevator" | "distributor" | "process" | "analysis" | "person";

/** Felter line managers kan udfylde via "Edit Data" (Ctrl+M) i Draw.io. */
export interface MachineDetails {
  producent?: string;
  model?: string;
  aar?: string;
  proces?: string;
  kapacitet?: string;
  dimSkab?: string;
  otNet?: string;
  noter?: string;
  /** Alle øvrige felter fra Draw.io bevares her. */
  [key: string]: string | undefined;
}

/**
 * Målfast placering fra plantegningen, i meter.
 *
 * Fabrikkens koordinatsystem: nulpunktet og akserne aftales én gang pr. fabrik
 * og står i README. x vokser mod øst, z vokser mod syd — samme retninger som
 * kortets x/z-akser, så tallene kan bruges direkte.
 */
export interface Placement {
  /** Maskinens midte, meter øst for nulpunktet. */
  x: number;
  /** Maskinens midte, meter syd for nulpunktet. */
  z: number;
  /** Rotation i grader med uret set oppefra. 0 = maskinens længdeakse peger mod øst. */
  rot: number;
}

/**
 * Opmålt fodaftryk i meter, i maskinens egne akser.
 * Uafhængigt af `placement`: man kan godt kende en maskines mål uden at vide,
 * hvor i fabrikken den står. Mangler det, bruges standardmålene for maskintypen.
 */
export interface Footprint {
  /** Bredde langs maskinens længdeakse. */
  x: number;
  /** Dybde på tværs. */
  z: number;
  /** Højde. Udelades den, bruges standardhøjden for maskintypen. */
  h?: number;
}

/** Plantegningen lagt ind under maskinerne, så koordinaterne kan kontrolleres visuelt. */
export interface FloorplanImage {
  /** Sti under `public/`, fx "/plantegninger/holeby.png". */
  src: string;
  /** Billedets nordvestlige hjørne i fabrikkens koordinatsystem (meter). */
  x: number;
  z: number;
  /** Billedets udstrækning i meter. */
  width: number;
  depth: number;
  /** Drejning i grader med uret om billedets midte, hvis tegningen ikke ligger akseparallelt. */
  rot?: number;
  /** 0–1. Standard 0.55. */
  opacity?: number;
}

export interface Machine {
  /** Stabilt id, afledt af W-ID (fx "W-611"). */
  id: string;
  drawioId: string;
  name: string;
  /** Rå label fra tegningen (renset for HTML). */
  label: string;
  wIds: string[];
  kind: MachineKind;
  /** Spor efter fordeling, fx "S" / "N". null = fælles stræk. */
  lane: string | null;
  /** Trin i flowet (0 = første maskine). */
  step: number;
  /** Placering i tegningen (Draw.io-pixels). Bruges til at udlede flow og spor. */
  drawio: { x: number; y: number; w: number; h: number };
  /** Målfast placering fra plantegningen. Mangler den, tegnes maskinen skematisk. */
  placement?: Placement;
  /** Opmålte mål. Bruges altid, også når placeringen er skematisk. */
  footprint?: Footprint;
  upstream: string[];
  downstream: string[];
  details: MachineDetails;
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  /** true = forbindelsen er gættet af parseren (mangler i tegningen). */
  inferred: boolean;
  note?: string;
}

export interface LineData {
  line: {
    id: string;
    name: string;
    order: number;
    sourceFile: string;
    parsedAt: string;
    /** "schematic" = placering fra flowdiagram, ikke målfast. */
    positionMode: "schematic" | "floorplan";
    /** Plantegning under kortet. Vises kun i floorplan-tilstand. */
    floorplan?: FloorplanImage;
  };
  lanes: string[];
  machines: Machine[];
  edges: FlowEdge[];
  issues: string[];
}

// ---------------------------------------------------------------------------
// Vedligehold
//
// Bevidst adskilt fra LineData: linjedata genereres fra Draw.io og kan når som
// helst laves om af en ny `npm run parse`, mens historikken er driftsdata, der
// skal overleve. Ligger i data/maintenance.json og flytter senere til MSSQL.
// ---------------------------------------------------------------------------

export type MaintenanceType = "hovedeftersyn" | "retrofit" | "reparation" | "udskiftning";

export interface MaintenanceEvent {
  /** Stabilt id for hændelsen. */
  id: string;
  /**
   * W-ID på maskinen — nøglen der binder hændelsen til en maskine.
   * Har en maskine flere W-ID'er, tæller en hændelse på et hvilket som helst af dem.
   */
  wid: string;
  /** ISO-dato: "2024-06-15". */
  dato: string;
  type: MaintenanceType;
  beskrivelse: string;
  /** Hvem der udførte arbejdet — internt team eller ekstern leverandør. */
  udfoertAf?: string;
  /** Kroner. */
  omkostning?: number;
}

// ---------------------------------------------------------------------------
// OT-lag
//
// Sensorer, skabe og kabelbakker ligger som vedligehold uden for LineData:
// linjedata genereres fra Draw.io, mens OT-installationen er projektdata, der
// planlægges og rulles ud i faser. Ligger i data/ot-layer.ts og bindes til
// maskinerne på W-ID.
//
// Geometri står bevidst ikke i dataene. Bakker og skabe beskrives ved den
// maskine eller det spor, de følger, og koordinaterne udledes af layoutet — så
// overlever OT-laget en ny `npm run parse`, der flytter rundt på maskinerne.
// ---------------------------------------------------------------------------

/**
 * Hvor langt en OT-komponent er — fra noget der kører, til noget ingen har
 * taget stilling til. Rækkefølgen i OT_STATUS_ORDER følger den skala.
 *
 * To skel er vigtige, og kortet må ikke udviske dem:
 *  - "planned" er besluttet og skal købes; "idea" er en mulighed, ingen har
 *    sagt ja til.
 *  - "missing" er hverken af delene: det findes ikke i dag, men er en
 *    forudsætning for at resten virker. En manglende ting er ikke valgfri.
 */
export type OtStatus = "active" | "test" | "ordered" | "planned" | "missing" | "idea";

/** Udrulningen sker i faser. Filteret i kortet er kumulativt. */
export type OtPhase = 1 | 2 | 3;

/** Signaltype afgør hvilken slags kanal i skabet komponenten optager. */
export type OtSignal = "4-20 mA" | "0-10 V" | "digital";

export interface OtNetwork {
  /** Switch sensorskabet hænger på. */
  switch?: string;
  /** VLAN eller subnet for OT-segmentet. */
  vlan?: string;
  /** Hvor skabet er koblet op — fx fiber til krydsfelt. */
  uplink?: string;
}

/** Afsnit i skabets stykliste, i den rækkefølge de vises. */
export type OtHardwareCategory = "forsyning" | "io" | "netvaerk" | "klemmer" | "skab";

/**
 * Én komponent i skabet. Listen er både stykliste og kilden til kanaltallene:
 * hvor mange AI- og DI-kanaler skabet har, udledes af IO-kortene her, så tallene
 * ikke kan komme til at sige noget andet end styklisten.
 */
export interface OtHardware {
  id: string;
  category: OtHardwareCategory;
  name: string;
  /** Tavlebyggeren vælger det endelige fabrikat. Tom = ikke afklaret endnu. */
  model?: string;
  qty: number;
  status: OtStatus;
  note?: string;
  /**
   * Fasen komponenten kommer med i. Udeladt = med fra starten.
   * Det er sådan kortet ved, hvornår AI-kort nr. 2 kommer på.
   */
  phase?: OtPhase;
  /** Kanaler komponenten giver pr. stk. Kun IO-kort har det. */
  provides?: { ai?: number; di?: number };
  /**
   * Blokken på DIN-skinne-tegningen: `width` er bredden i forhold til de andre
   * blokke, `label` den korte tekst der kan stå i den. Komponenter uden `rail`
   * (skabet selv, uplinket) sidder ikke på skinnen og tegnes ikke.
   */
  rail?: { width: number; label: string };
}

export interface OtCabinet {
  /** Skabets mærkning, fx "RIO-SLIB-01". */
  id: string;
  name: string;
  /** W-ID på maskinen skabet står ved. Bestemmer placeringen på kortet. */
  nearMachine: string;
  /** Meter fra maskinens midte. Skabet skal stå ved siden af, ikke oveni. */
  offset: { x: number; z: number };
  /** Styklisten. Kanalkapaciteten regnes ud fra IO-kortene i den. */
  hardware: OtHardware[];
  status: OtStatus;
  /**
   * Netværksdelen er kun datamodel indtil videre — OT-nettet tegnes ovenpå
   * senere, og feltet er her for at holde oplysningen ét sted fra start.
   */
  network?: OtNetwork;
}

export interface OtSensor {
  /** Tag efter ISA-skik, fx "FT-743" — flowtransmitter ved elevator 743. */
  id: string;
  /** Hvad den måler, i klar tekst. */
  type: string;
  /**
   * Nøgle ind i sensorkataloget, fx "flow". Uden den kan en agent ikke vide,
   * om den slags signal, den har brug for, allerede sidder på maskinen.
   */
  catalogType?: string;
  model: string;
  signal: OtSignal;
  /** W-ID på maskinen, sensoren hører til. */
  machineId: string;
  /**
   * Hvor på maskinen den sidder, i meter i maskinens egne akser: `x` langs
   * længdeaksen (negativ = opstrøms), `y` over gulvet, `z` på tværs.
   *
   * Uden `mount` sidder den i afkastet øverst — det er, hvor en
   * flowmåler på en elevator normalt hænger. Skal den sidde et andet
   * sted, skrives målene her, ét sted, frem for i tegnekoden.
   */
  mount?: { x: number; y: number; z?: number };
  cabinetId: string;
  phase: OtPhase;
  status: OtStatus;
}

export interface OtCableTray {
  id: string;
  name: string;
  cabinetId: string;
  /** Sporet bakken følger. null = det fælles stræk før fordeleren. */
  lane: string | null;
  /**
   * Meter fra sporets midterlinje, med fortegn så siden vælges bevidst:
   * negativ = mod nord, positiv = mod syd.
   */
  offset: number;
  /** Højde over gulv i meter. */
  height: number;
  /**
   * W-ID på en maskine bakken skal nå ud over de maskiner, den betjener.
   * Bruges til stikket fra skabet frem til indtaget.
   */
  extendTo?: string;
}

export interface OtLayer {
  cabinets: OtCabinet[];
  sensors: OtSensor[];
  cableTrays: OtCableTray[];
}

// ---------------------------------------------------------------------------
// Sensorkatalog og idéer
//
// Kataloget er de sensortyper, der giver mening på et sliberi — uafhængigt af
// hvilke maskiner der findes. Det er hverken projektdata eller anlægsdata, men
// en liste over hvad man kan sætte på. Idéerne er det, brugeren selv stikker
// ind på kortet for at se, hvad en udvidelse ville koste i kanaler.
// ---------------------------------------------------------------------------

/**
 * Hvordan signalet når frem til skabet. AI og DI optager hver sin slags kanal;
 * IO-Link og Modbus går på feltbussen og bruger ingen.
 */
export type OtSignalKind = "AI" | "DI" | "IO-Link" | "Modbus";

export interface OtSensorType {
  /** Stabil nøgle, fx "flow". */
  type: string;
  label: string;
  signal: OtSignalKind;
  /**
   * Nogle typer fås i to udgaver — en vibrationssensor kan være analog eller
   * sidde på IO-Link. `signal` er den, kanalregnskabet regner med.
   */
  altSignal?: OtSignalKind;
  /** Hvor den typisk sidder. Fri tekst — kortet gætter ikke på maskiner. */
  typicalPlacement: string;
  /** Hvad man får ud af den. */
  purpose: string;
}

/**
 * En sensoridé sat på en maskine i kortet. Lever kun i browseren — det er en
 * skitse, ikke et projekt, og den skal ikke kunne forveksles med data/.
 */
export interface SensorIdea {
  id: string;
  /** W-ID på maskinen idéen er sat på. */
  machineId: string;
  /** Nøgle ind i sensorkataloget. */
  type: string;
}

// ---------------------------------------------------------------------------
// OT-infrastruktur
//
// Alt det mellem IO-skabet og en database, der ikke står i hallen: uplink,
// rack, VLAN, edge-collector og vejen til skyen. Det meste findes ikke endnu,
// og det er hele pointen — uden det leverer piloten ingen data nogen steder.
// ---------------------------------------------------------------------------

/** Leddene i datavejen, fra måling til skærm. */
export type OtPathStep = "sensor" | "io" | "kobler" | "edge" | "mssql" | "dashboard";

export type OtInfraType = "uplink" | "rack" | "vlan" | "edge" | "link" | "cloud";

export interface OtInfraNode {
  id: string;
  type: OtInfraType;
  name: string;
  /** Hvor den er — eller skal være. Fri tekst. */
  location: string;
  status: OtStatus;
  /** De led i datavejen, der ikke virker uden den. */
  requiredFor: OtPathStep[];
  note?: string;
}

// ---------------------------------------------------------------------------
// Driftsparametre
//
// Normtakt, stopdefinition og stopårsager er aftaler om driften, ikke noget
// der står på tegningen. De ligger derfor i data/line-config.ts og overlever
// en `npm run parse`, som vedligehold og OT-laget gør.
//
// Alt defineres på linjen. En maskine arver linjens værdier og kan afvige —
// så slipper man for at udfylde seksogtyve maskiner for at få en default.
// ---------------------------------------------------------------------------

export interface StopReason {
  /** Kort kode, fx "TILSTOP". Den er nøglen, labelen kan skrives om. */
  code: string;
  label: string;
}

export interface MachineOps {
  /**
   * Forventet takt i drift, i linjens `rateUnit`. Maskinens maksimum står
   * som `kapacitet` i stamdata og kommer fra tegningen — de to er ikke
   * det samme tal, og må ikke lægges oven i hinanden.
   */
  normtakt?: number;
  /** Afviger maskinen fra linjens stopdefinition. */
  stopAfterSeconds?: number;
  /** Afviger maskinen fra linjens kodeliste. */
  stopReasons?: StopReason[];
  /** Driftsnote. Adskilt fra `noter` i stamdata, der kommer fra tegningen. */
  note?: string;
}

/** Lavt, passende eller højt flow. Grænserne er konfiguration, ikke kode. */
export type FlowLevel = "lav" | "ok" | "hoej";

/**
 * Hvad et flowsignal betyder i tons og timer.
 *
 * Strømsløjfen giver kun procent af fuldt udslag — det er en form, ikke en
 * mængde. Skal procenten blive til en takt, skal nogen sige, hvad 100 %
 * er på netop denne linje. Det tal er en aftale med driften og hører
 * derfor her, ikke i koden.
 */
export interface FlowOps {
  /**
   * Nominel kapacitet pr. signal-id, i linjens `rateUnit`. Tallet definerer
   * 100 % og er samtidig den eneste kalibrering, der findes.
   *
   * Tom betyder "ikke udfyldt": procenten vises, takten gør ikke. Der
   * gættes ikke en kapacitet, for så ville kortet vise et tal, ingen har
   * sagt god for.
   */
  nominal: Record<string, number>;
  /** Under denne procent er flowet lavt. Udeladt: se `FLOW_LOW_PCT`. */
  lowPct?: number;
  /** Over denne procent er flowet højt. Udeladt: se `FLOW_HIGH_PCT`. */
  highPct?: number;
}

export interface LineOps {
  /** Enheden takt måles i på denne linje, fx "t/hr" — vægt pr. time. */
  rateUnit: string;
  /** Hvor længe en maskine skal stå stille, før det tæller som et stop. */
  stopAfterSeconds: number;
  /** Linjens fælles kodeliste. */
  stopReasons: StopReason[];
  /** Hvad flowsignalerne på linjen betyder. */
  flow?: FlowOps;
  /** Kun de maskiner, der faktisk afviger. Resten arver. */
  machines?: Record<string, MachineOps>;
}

// ---------------------------------------------------------------------------
// Agenter
//
// Claude-scripts, der læser data og skriver tekst. De kører ikke endnu —
// ingen har `beslutning: "aktiveret"`. Status hardcodes ikke: den udledes af, om
// de signaler agenten har brug for, rent faktisk findes.
// ---------------------------------------------------------------------------

/**
 * Hvad agenten er til. De fleste læser og skriver en rapport; styring griber
 * ind i driften. Det skel skal kunne ses, for det er ikke det samme at sende
 * en rapport som at stoppe en linje.
 */
export type AgentRole = "linjeagent" | "tvaergaaende" | "vagt" | "styring";

/**
 * Hvor langt nogen har taget stilling til agenten.
 *
 * Det er en beslutning, ikke en status. Status udledes af den her sammen med
 * inputs: en idé er ikke besluttet og vises som idé uanset hvad; en aktiveret
 * agent uden data falder tilbage til Mangler eller Delvis, så "I drift" aldrig
 * kan stå om noget, der ikke har noget at arbejde med.
 */
export type AgentBeslutning = "ide" | "besluttet" | "aktiveret";

/**
 * Hvad der driver agenten.
 *
 * "kode" er ren regel-logik og koster ingenting at køre — et kædetjek er
 * en sammenligning, ikke en vurdering. "claude" kalder API'et og koster
 * penge pr. kørsel. Forskellen skal kunne ses i fladen, før nogen sætter
 * noget i gang hver 15. minut.
 */
export type AgentEngine = "kode" | "claude";

/**
 * Hvad agenten kigger på. Vagtagenten ser på signalkæden frem for maskiner —
 * dens arbejde er at opdage, at data holder op med at komme.
 */
export type AgentScope = (
  | { kind: "line" }
  | { kind: "lane"; lane: string }
  | { kind: "machines"; wIds: string[] }
  | { kind: "chain" }
) & {
  /**
   * W-ID'er opstrøms, som agenten må se men ikke ejer. Et stop i indløbet
   * forklarer et stop i sporet — men indløbet tæller ikke med, når der
   * regnes "X af 10 maskiner har driftssignal".
   */
  upstream?: string[];
};

/**
 * Ét input agenten har brug for. Enten et konkret signal, der findes i dag,
 * en type fra sensorkataloget der skal sættes op, eller et led i kæden.
 * `need` er den sætning, kortet skriver, når det mangler.
 */
export interface AgentInput {
  signalId?: string;
  /** Nøgle i sensorkataloget, fx "motor-run". */
  type?: string;
  /** Led i datavejen — kun for kædevagten. */
  chainStep?: OtPathStep;
  /**
   * En datakilde frem for et signal. Måles som dækning over agentens scope,
   * ligesom driftssignalerne: hvor mange af maskinerne har noget at vise.
   */
  dataset?: "maintenance";
  /**
   * Materialestrømmen ind i agentens scope, målt før den første maskine den
   * ejer. Agenten peger ikke på et bestemt tag: flytter måleren sig, eller
   * kommer der en anden, skal inputtet stadig passe. Derfor er det stedet,
   * der står her, og ikke sensorens navn.
   */
  inlet?: "materiale";
  /**
   * Påkrævet: agenten kan ikke gøre sit arbejde uden. Støttende: rart at
   * have, men status regnes kun på de påkrævede. En stoprapport kræver
   * driftssignal; flowet gør den bare bedre.
   */
  required: boolean;
  need: string;
}

export interface Agent {
  id: string;
  name: string;
  role: AgentRole;
  /** Én sætning om hvad den leverer. */
  job: string;
  /** Hvem rapporten er skrevet til. En agent uden modtager har intet formål. */
  til: string;
  /** Det ene spørgsmål, agenten skal besvare. Ét — ikke en liste. */
  svarerPaa: string;
  scope: AgentScope;
  inputs: AgentInput[];
  engine: AgentEngine;
  /** Fx "Dagligt 06:00". */
  cadence: string;
  beslutning: AgentBeslutning;
}
