// Telemetri: hvad skærmen aflæser pr. maskine.
//
// To kilder, samme form:
//
//   simulator()   Fremskrivningen. Alle kanaler fra data/fremskrivning.ts
//                 simuleres, og alt er mærket `simuleret: true`.
//   tomtBillede() Anlægget som det står. Ingen maskine har en kanal, så
//                 alt er null — bortset fra flowet, der kommer fra den
//                 samme LiveSource som kortet.
//
// Komponenterne kender kun `TelemetriBillede`. Om tallene er simuleret eller
// ej, står i billedet selv, så fladen ikke kan vise et opdigtet tal uden at
// vide det.
//
// Simulatoren er ren: ingen React, ingen Date.now() inde i regnestykket,
// seedet tilfældighed. Samme seed og samme skridt giver de samme tal, og
// det er det, der gør den testbar.
import {
  AFVIGELSER, DRIFTSAGENT, FLASKEHALS, FREMMEDE, HAL, KAEDE, KANALER, KASTEBORD, KASTEBORDET, PROCES, PROEVER,
  PROEVERATE, SIMULERING, TILLOEB, VARME, type KanalSpec,
} from "../../data/fremskrivning";
import { maFromPercent } from "./live-source";
import type { Layout, PlacedMachine } from "./layout";
import {
  bordeISpor, ctPlan, ctProeve, efterJetpealer, efterSortering, nytParti, skil, VIDEOMETER, videometerProeve, virkningAfTrin, vurder,
  type CtSvar, type Fraktion, type Parti, type ProeveSted, type Sortering, type Stroem, type VideometerSvar,
} from "./proever";
import {
  AGENT, klokke, ordreRapport, planMed, prognose, tal, vaelgPlan, varighed,
  type Besked, type BeskedType, type Gruppe, type Proeveplan, type SporStop,
} from "./samspil";

export type Niveau = "info" | "advarsel" | "alarm";

export interface Haendelse {
  /** Millisekunder siden epoch. */
  t: number;
  /** Maskinens korte navn. null for linjen som helhed. */
  hvor: string | null;
  tekst: string;
  niveau: Niveau;
  /** Driftsagenten traf beslutningen. Fladen mærker den som AI. */
  ai?: boolean;
}

export interface KanalLaesning {
  spec: KanalSpec;
  /** null: ingen måling. Aldrig et gæt. */
  value: number | null;
  alarm: boolean;
}

export interface MaskinLaesning {
  id: string;
  wIds: string[];
  navn: string;
  /** Kort nok til et mærkat i 3D: "E-743", "KB-3N". */
  kort: string;
  lane: string | null;
  /** null: vi ved ikke, om den kører. Det er sandheden for hele anlægget i dag. */
  koerer: boolean | null;
  /**
   * Står maskinen, fordi Driftsagenten har stoppet dens spor — og ikke
   * fordi den selv er gået i stå? Et styret stop er en beslutning, ikke en
   * fejl, og det skal kunne ses.
   */
  styret: boolean;
  /**
   * Slukket efter planen: før ordren har startet den, efter udløbet, eller
   * mens sporet startes bagfra. Ikke en fejl, og ikke agentens stop.
   */
  planlagt: boolean;
  /** Bufferen foran maskinen i procent. null uden for sporene og uden signal. */
  fyld: number | null;
  kanaler: KanalLaesning[];
  alarm: boolean;
}

/** Hvad Driftsagenten gør lige nu. */
export interface AiTilstand {
  /** Overvåger, handler (et spor står på dens beslutning), eller holder (kan ikke se). */
  tilstand: "overvaager" | "handler" | "holder";
  spor: { lane: string; stoppet: boolean; aarsag: string | null; siden: number | null }[];
  indgangStoppet: boolean;
  /** Den seneste beslutning, den traf. */
  seneste: Haendelse | null;
  beslutninger: number;
}

export type KaedeLedId = "kobler" | "edge" | "mssql";

/** Ét led i kæden, målt mod sin egen kapacitet. */
export interface KaedeLed {
  id: KaedeLedId;
  /** Efterspørgsel over kapacitet. Over 1 er leddet en flaskehals. */
  udnyttelse: number;
  /** Hvor mange signaler leddet kan bære ved sin nuværende kapacitet. */
  pladsTil: number;
}

/** Kædens egne tal. Kun når kæden står — altså kun i fremskrivningen i dag. */
export interface KaedeTal {
  signaler: number;
  pollMs: number;
  cyklusMs: number;
  raekkerPrS: number;
  /** Databasens kapacitet lige nu, og i normal drift. */
  dbKapacitet: number;
  dbNormal: number;
  /** Rækker, der venter i edge's buffer på at blive skrevet. */
  koe: number;
  buffer: number;
  /** Hvor langt databasen er bagud. */
  forsinkelseS: number;
  /** Rækker tabt, fordi bufferen var fuld. */
  tabt: number;
  /** Samlet siden start. Til regnskabet: modtaget = skrevet + kø + tabt. */
  modtaget: number;
  skrevetIalt: number;
  /** Tæller til visning. */
  skrevet: number;
  senesteMs: number;
  /** Leddet, der ikke kan følge med. null når alle kan. */
  flaskehals: KaedeLedId | null;
  /** Hvorfor, når der er en grund. */
  aarsag: string | null;
  led: KaedeLed[];
}

export interface TelemetriBillede {
  t: number;
  /** Alt her er opdigtet, når den er true. Fladen skal mærke det. */
  simuleret: boolean;
  maskiner: MaskinLaesning[];
  hal: KanalLaesning[];
  /** Materialestrømmen ved indgangen, i procent af nominel kapacitet. */
  flowPct: number | null;
  /** Det rå signal bag procenten. Oscilloskopet tegner det. */
  flowMa: number | null;
  /**
   * Strømmen ind lagt sammen over tid, i procent·sekunder. Med 100 %-punktet
   * bliver det til kilo. En sensorfejl springes over frem for at blive
   * brolagt. null uden simulator — i den rigtige visning er der intet at
   * lægge sammen her.
   */
  gennemloeb: number | null;
  /** Laboratoriet: prøverne, der er i gang, og det seneste svar fra hvert sted. */
  laboratorie: Laboratorie;
  /** Sorteringen på Carter og Alfa i hvert spor. */
  sortering: Record<string, Sortering>;
  /** Kædens egne tal. null når kæden ikke står. */
  kaede: KaedeTal | null;
  /** Nyeste først. */
  haendelser: Haendelse[];
  /** Andel af maskintiden, maskinerne har kørt. null uden driftssignaler. */
  oppetidPct: number | null;
  /** Stop, der har varet længere end stopgrænsen. */
  stop: number;
  koerende: number;
  /** Driftsagenten. null når der ingen er — altså i den rigtige visning i dag. */
  ai: AiTilstand | null;
  /** Agenterne imellem, nyeste først. Tom uden en ordre i simuleringen. */
  samtale: Besked[];
  /** Ordren, når simuleringen kører én. null ellers. */
  ordre: OrdreStatus | null;
  /**
   * Det, Claude-agenterne skal tage stilling til lige nu, ældste først. Tom
   * med reglerne — dér svarer de med det samme.
   */
  opgaver: Opgave[];
  /** Linjeagenternes anbefalinger til operatøren, nyeste først. */
  anbefalinger: Anbefaling[];
  /** Kastebordenes indstillinger lige nu, nøglet på maskinens id. */
  indstillinger: Record<string, Indstilling>;
  /**
   * Det, der sker lige nu: et spor, der står, en database, der halter. Tom,
   * når alt kører roligt — og så længe den ikke er tom, går tiden langsomt.
   */
  uro: Uro[];
}

/**
 * Én ting, der sker. `fejl` skiller det, der er gået galt — en maskine, der
 * er gået i stå, en måler, der er faldet ud — fra det, der er besluttet: et
 * spor, agenten har stoppet, en opstart. En fejl er rød; resten er det ikke.
 */
export interface Uro {
  tekst: string;
  fejl: boolean;
}

/**
 * Hvem der tænker for de agenter, der i virkeligheden er Claude.
 *
 * "regler": skabelonerne, med det samme. "claude": hver besked og hver
 * beslutning fra en Claude-agent bliver en opgave, der venter på et svar —
 * og det, der afhænger af beslutningen, venter med. Kædevagten er kode og
 * Driftsagenten stopper efter faste regler; de tænker aldrig med Claude.
 */
export type Motor = "regler" | "claude";

/** Én ting, en Claude-agent skal tage stilling til. */
export interface Opgave {
  id: number;
  /** Simuleret tid, da den opstod. */
  t: number;
  agent: string;
  /** Hvad agenten bliver spurgt om. */
  spoergsmaal: string;
  /** Tallene, den har at gå efter. Intet andet. */
  situation: Record<string, unknown>;
  /** Det, den kan vælge imellem. "ingen", når der kun skal siges noget. */
  handlinger: string[];
  /** Hvem den kan skrive til. */
  modtagere: string[];
  /** Det, reglerne ville have sagt. Bruges, hvis Claude ikke svarer. */
  skabelon: Omit<Besked, "t" | "nr">[];
  /** Det, reglerne ville have valgt. */
  standard: string;
  /** Tal, der hører med til svaret — en rapports linjer. */
  bilag?: string[];
}

/** Et svar på en opgave. */
export interface Svar {
  beskeder: { til: string; type: BeskedType; tekst: string; grund?: string }[];
  handling: string;
  /** Hvor længe Claude var om det. */
  ms?: number;
  model?: string;
}

/** Ordren i simuleringen, fra første kasse til sidste. */
export interface OrdreStatus {
  ordreNr: string;
  fase: "opstart" | "koerer" | "udloeb" | "faerdig";
  /** Det, der er løbet ind — det fysiske, ikke det målte. */
  kgInd: number;
  estimeretKg: number;
  kasserTippet: number;
  kasser: number;
  startT: number;
  slutT: number | null;
  /** Hvornår sidste kasse er tippet, ved gennemløbet indtil nu. */
  prognoseT: number | null;
  /** Hvor mange af Dataagentens trin, der er taget. 0 er fuld prøverate. */
  proeveTrin: number;
}

/** Et svar fra laboratoriet. Det viser strømmen, da prøven blev taget. */
export interface ProeveSvar {
  nr: number;
  sted: ProeveSted;
  taget: number;
  svarT: number;
  /** Kassen, frøet i prøven kom fra. */
  kasse: number | null;
  /** Stod bordet, hvor det var sat, da prøven blev taget? Ellers siger den intet om indstillingen. */
  somSat: boolean;
  ct: CtSvar | null;
  videometer: VideometerSvar | null;
}

/** Laboratoriet i Analytics-rummet: én CT-scanner og et videometer. */
export interface Laboratorie {
  ct: {
    igang: { sted: ProeveSted; taget: number; svarT: number } | null;
    /** De næste i planen. */
    naeste: ProeveSted[];
    taget: number;
  };
  videometer: { igang: { kasse: number; taget: number; svarT: number } | null; taget: number };
  /** Det seneste svar fra hvert sted. */
  seneste: ProeveSvar[];
  /** Prøver i planen, der blev sprunget over, fordi maskinen stod. */
  sprunget: number;
}

export const tomtLaboratorie = (): Laboratorie => ({
  ct: { igang: null, naeste: [], taget: 0 },
  videometer: { igang: null, taget: 0 },
  seneste: [],
  sprunget: 0,
});

/** Et kastebords indstillinger. Ændres under kørslen. */
export type Indstilling = Record<"tvaers" | "langs" | "slag" | "luft", number>;

/**
 * En anbefaling fra en agent til et menneske: flyt én indstilling ét trin på
 * et kastebord, eller sortér kraftigere eller normalt på Carter og Alfa.
 * AI'en anbefaler; et menneske udfører eller afviser.
 */
export interface Anbefaling {
  id: number;
  t: number;
  /** Maskinens id — eller "sortering" for Carter og Alfa i begge spor. */
  maskine: string;
  kort: string;
  /** Agenten, der anbefaler. */
  fra: string;
  parameter: "tvaers" | "luft" | "sortering";
  /** For sorteringen: 0 er normal, 1 er kraftig. */
  fraVaerdi: number;
  tilVaerdi: number;
  /**
   * Det, agenten venter, der sker, målt som det, den så. Den første er den,
   * anbefalingen bygger på — og den, virkningen gøres op på.
   */
  virkning: Virkning[];
  status: "aaben" | "udfoert" | "afvist" | "udloebet";
  /** Hvem der sagde ja eller nej — operatøren ved linjen eller formanden på kontoret. */
  af?: Menneske;
  udfoertT?: number;
  /** Virkningen er gjort op: der er kommet et svar fra efter ændringen. */
  gjortOp?: boolean;
}

export interface Virkning {
  navn: string;
  /** "%" for en andel, "%-rel" for en ændring i procent af det, der var. */
  enhed: "%" | "%-rel" | "pp";
  /** Det, agenten så. null, når den ikke har set det. */
  foer: number | null;
  /** Ændringen, den venter. */
  forventet: number;
  efter?: number;
  /** Hvilken strøm det måles i — så det kan gøres op, når et nyt svar kommer. */
  fraktion?: Fraktion;
  noegle?: "multi" | "let" | "godt";
}

/** De mennesker, der kan sige ja og nej til en anbefaling. */
export type Menneske = "Operatør" | "Formand";

// ---------------------------------------------------------------------------

/** Kanalerne til én maskine: den første gruppe, der passer, plus afvigelser. */
export function kanalerFor(m: Pick<PlacedMachine, "kind" | "name" | "wIds">): KanalSpec[] {
  const gruppe = KANALER.find((g) =>
    (!g.kind || g.kind === m.kind) && (!g.navn || g.navn.test(m.name)),
  );
  const base = gruppe?.kanaler ?? [];
  const egne = m.wIds.map((w) => AFVIGELSER[w]).find(Boolean);
  if (!egne) return base;
  return base.map((k) => ({ ...k, ...(egne[k.id] ?? {}) }));
}

/**
 * Hvor hurtigt materialet bevæger sig gennem en maskine, som andel af det
 * normale. Partiklerne i hologrammet flytter sig med den fart.
 *
 * Nul, når vi ikke ved, om maskinen kører — i den rigtige visning i dag står
 * alt stille, fordi ingen ved det. Har maskinen en hastighed eller et
 * omdrejningstal, følger farten den, så en elevator, der stopper, bremser ned
 * over et par sekunder i stedet for at fryse på et blink.
 */
export function maskinFart(m: Pick<MaskinLaesning, "koerer" | "kanaler">): number {
  if (m.koerer === null) return 0;
  const k = m.kanaler.find((x) => x.spec.id === "hastighed" || x.spec.id === "rpm");
  if (k && k.value !== null && k.spec.nominal > 0) return Math.min(1.5, Math.max(0, k.value / k.spec.nominal));
  return m.koerer ? 1 : 0;
}

/** Så mange hændelser husker loggen, man kan læse igennem. */
export const LOG_MAKS = 500;

/**
 * Læg et billedes beskeder oven i samtalen. Samme regel som loggen: hver
 * besked én gang, nyeste først — ordnet efter løbenummer, ikke tid. Ældre
 * beskeder kan komme efter nyere: kontoret får dem sendt forfra, når en
 * linjeskærm har taget kanalen, og de skal med.
 */
export function samlSamtale(samtale: Besked[], nye: Besked[], maks = LOG_MAKS): Besked[] {
  const kendt = new Set(samtale.map((b) => b.nr));
  // Også inden for det nye: en linjeskærm, der ikke fik svar, sender igen.
  const tilgang = nye.filter((b) => !kendt.has(b.nr) && !!kendt.add(b.nr));
  if (tilgang.length === 0) return samtale;
  return [...tilgang, ...samtale].sort((a, b) => b.nr - a.nr).slice(0, maks);
}

const logNoegle = (h: Haendelse) => `${h.t}|${h.hvor}|${h.tekst}`;

/**
 * Læg et billedes hændelser oven i loggen.
 *
 * Billedet husker kun de seneste; loggen husker, hvad der er sket, siden
 * siden åbnede. Hver hændelse står én gang, nyeste først. Den gamle liste
 * røres ikke — kommer der intet nyt, er det den samme liste, der kommer
 * tilbage, så fladen ikke tegner om for ingenting.
 */
export function samlLog(log: Haendelse[], nye: Haendelse[], maks = LOG_MAKS): Haendelse[] {
  const kendt = new Set(log.map(logNoegle));
  const tilgang = nye.filter((h) => {
    const k = logNoegle(h);
    return !kendt.has(k) && !!kendt.add(k);
  });
  if (tilgang.length === 0) return log;
  return [...tilgang, ...log].sort((a, b) => b.t - a.t).slice(0, maks);
}

/** "E-743" for elevatorer, navnet for resten. Vippestolene er én gruppe. */
export function kortNavn(m: Pick<PlacedMachine, "kind" | "name" | "wIds">): string {
  if (m.kind === "elevator") return `E-${m.wIds[0]}`;
  if (m.wIds.length > 1) return `${m.name}e`;
  return m.name;
}

/**
 * Indkøringstid: så længe efter en start meldes en lav værdi ikke.
 *
 * En maskine på vej op i omdrejninger er ikke for langsom — den er ved at
 * starte. Uden den her ville hver genstart udløse en alarm, og et
 * alarmsystem, der altid melder, lærer folk at se bort fra det.
 */
export const INDKOERING_S = 20;

/** Decimaler i et tal, som det er skrevet — 2,8 har én, 70 har ingen. */
const decimalerI = (v: number) => (String(v).split(".")[1] ?? "").length;

/**
 * Kanalens grænser, som man læser dem: "2,0–2,8", "max 70", "min 10".
 * Samme antal decimaler i begge ender, så båndet ikke ser skævt ud. Står
 * her ved alarmreglen, så det, skærmen viser, er det, der melder.
 */
export function graense(k: Pick<KanalSpec, "alarmLav" | "alarmHoej" | "decimaler">): string | null {
  const { alarmLav: lav, alarmHoej: hoej } = k;
  const d = Math.min(k.decimaler, Math.max(lav !== undefined ? decimalerI(lav) : 0, hoej !== undefined ? decimalerI(hoej) : 0));
  const f = (v: number) => v.toLocaleString("da-DK", { minimumFractionDigits: d, maximumFractionDigits: d });
  if (lav !== undefined && hoej !== undefined) return `${f(lav)}–${f(hoej)}`;
  if (hoej !== undefined) return `max ${f(hoej)}`;
  if (lav !== undefined) return `min ${f(lav)}`;
  return null;
}

const erAlarm = (
  k: KanalSpec,
  v: number | null,
  koerer: boolean | null,
  indkoerer = false,
): boolean => {
  if (v === null) return false;
  if (k.alarmHoej !== undefined && v > k.alarmHoej) return true;
  // En elevator, der står, er ikke for langsom. Den er stoppet — det er
  // noget andet. Og en, der lige er startet, er ved at komme op i fart.
  if (koerer && !indkoerer && k.alarmLav !== undefined && v < k.alarmLav) return true;
  return false;
};

/**
 * Anlægget som det står: ingen kanaler, ingen driftssignaler.
 *
 * Maskinerne er med, så 3D-scenen kan vise dem — men de har ingen tal, og
 * `koerer` er null, fordi ingen ved det. Flowet sættes udefra, når
 * LiveSource har noget.
 */
export function tomtBillede(layout: Layout, t: number, flowPct: number | null): TelemetriBillede {
  const maskiner = layout.machines
    .filter((m) => m.kind !== "person")
    .map((m) => ({
      id: m.id,
      wIds: m.wIds,
      navn: m.name,
      kort: kortNavn(m),
      lane: m.lane,
      koerer: null,
      styret: false,
      planlagt: false,
      fyld: null,
      kanaler: kanalerFor(m).map((spec) => ({ spec, value: null, alarm: false })),
      alarm: false,
    }));
  return {
    t,
    simuleret: false,
    maskiner,
    hal: HAL.map((spec) => ({ spec, value: null, alarm: false })),
    flowPct,
    flowMa: flowPct === null ? null : maFromPercent(flowPct),
    gennemloeb: null,
    laboratorie: tomtLaboratorie(),
    sortering: {},
    kaede: null,
    haendelser: [],
    oppetidPct: null,
    stop: 0,
    koerende: 0,
    ai: null,
    samtale: [],
    ordre: null,
    opgaver: [],
    anbefalinger: [],
    indstillinger: {},
    uro: [],
  };
}

// ---------------------------------------------------------------------------
// Simulatoren

/** mulberry32 — samme lille generator som hologrammet bruger. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Normalfordelt støj af to jævne tal (Box–Muller). */
function gauss(r: () => number): number {
  const u = Math.max(r(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

const klem = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const fmtTal = (v: number, d: number) => v.toFixed(d).replace(".", ",");

/**
 * Hvor ofte der sker noget. Skruet op, så der sker noget på en skærm, man
 * kigger på i fem minutter — tallene siger ingenting om anlægget.
 */
export const SIM = {
  /**
   * Middeltid mellem to stop et sted på linjen. Hvert stop i et spor bliver
   * til en beslutning for Driftsagenten, så tallet afgør, hvor tit den
   * griber ind. Fem minutter giver en linje, der mest kører ved sit normale
   * gennemløb, med en indgriben med jævne mellemrum.
   */
  stopHverS: 300,
  stopVarighedS: [25, 170] as const,
  /** Middeltid mellem to udfald på flowmåleren. */
  sensorfejlHverS: 420,
  sensorfejlVarighedS: 9,
  flowNominal: 92,
  flowSpredning: 5,
  /** Stopgrænsen. Samme 120 s som line-config — ikke et nyt tal. */
  stopEfterS: 120,
  /** Hvor mange hændelser loggen husker. */
  logLaengde: 40,
};

interface KanalTilstand { spec: KanalSpec; x: number; alarm: boolean }
interface MaskinTilstand {
  m: PlacedMachine;
  kort: string;
  kanaler: KanalTilstand[];
  stopTil: number | null;
  stoppetFra: number | null;
  /** Hvornår den sidst startede. Bruges til indkøringstiden. */
  startet: number | null;
  koertMs: number;
  totalMs: number;
  /** Bufferen foran maskinen, 0–100. null uden for sporene. */
  fyld: number | null;
  overloebet: boolean;
  /** Friktion i en jetpealer: frøet varmes op, til dette tidspunkt. */
  varmeTil: number | null;
  /**
   * Slukket efter planen — før ordren er startet, efter den er slut, eller
   * mens sporet startes bagfra. Ikke en fejl, og ikke et stop.
   */
  slukket: boolean;
  /** Hvornår den startes eller stoppes efter planen. */
  startVed: number | null;
  stopVed: number | null;
  /** Et stop på vej: en kanal løber ud af sit bånd, og så stopper maskinen. */
  varsel: { kanal: string; maal: number; stopVed: number; varighedS: number } | null;
  /** Det, varslet nåede at vise, da maskinen stoppede. Til linjeagentens diagnose. */
  varslet: { label: string; tekst: string; normalt: string } | null;
  /** Siden hvornår en kanal har været langt ude, og om det er meldt. */
  afvigFra: number | null;
  afvigMeldt: boolean;
  /** Et kastebords indstillinger. null for alt andet. */
  indstilling: Indstilling | null;
}

/**
 * Står kastebordet, hvor det er sat? Luften er på vej op efter en start,
 * hældningen på vej efter en ændring — så skiller bordet dårligt af den
 * grund. Prøven er rigtig nok, men den siger intet om indstillingen: den
 * melder ikke alarm, og ingen anbefaling bygges på den. Samme tanke som
 * indkøringen, der ikke melder "for langsom".
 */
function staarSomSat(s: MaskinTilstand): boolean {
  if (!s.indstilling) return true;
  return (["tvaers", "luft"] as const).every((id) => {
    const k = s.kanaler.find((x) => x.spec.id === id);
    return !k || Math.abs(k.x - s.indstilling![id]) <= KASTEBORDET.trin[id] / 2;
  });
}

/** Valg til simulatoren. Alle har en standard. */
export interface SimValg {
  seed?: number;
  stopEfterS?: number;
  /** Hold flaskehalsen i kæden fremme hele tiden — til at vise den i et møde. */
  tvungenFlaskehals?: boolean;
  /**
   * Driftsagenten styrer. Kan slås fra, så en test kan vise, hvad der sker
   * uden den: bufferne løber over.
   */
  ai?: boolean;
  /**
   * Stop, der sker på et bestemt tidspunkt. En test skal kunne bestemme,
   * hvad der sker — ikke håbe på, at det tilfældigvis gør.
   */
  planlagteStop?: { wid: string; fraS: number; varighedS: number }[];
  /** Middeltid mellem tilfældige stop. Udeladt: SIM.stopHverS. */
  stopHverS?: number;
  /**
   * Kør én ordre fra start til slut. Linjen startes bagfra, kører, til
   * sidste kasse er tippet, og løber tom. Agenterne arbejder sammen og
   * skriver til hinanden. Udeladt: simulatoren kører bare, som den altid har.
   */
  ordre?: OrdreValg;
  /** Hvem der tænker for Claude-agenterne. Udeladt: reglerne. */
  motor?: Motor;
  /**
   * Et bestemt parti. En test skal kunne bestemme, hvad der ligger i
   * kasserne. Udeladt: et parti trækkes af seedet.
   */
  parti?: Parti;
}

export interface OrdreValg {
  ordreNr: string;
  estimeretKg: number;
  kasser: number;
  /** 100 %-punktet i t/hr. Uden det kan strømmen ikke blive til kilo. */
  nominalTPrT: number;
}

/** Det, der skete i ét skridt, og som agenterne skal reagere på. */
type Sket =
  | { type: "maskinstop"; s: MaskinTilstand }
  | { type: "sporStop"; lane: string; aarsag: Aarsag }
  | { type: "sporKlar"; lane: string; hvad: string; fyld: number | null; driftTekst: string }
  | { type: "sensorfejl" }
  | { type: "sensorTilbage"; varighedS: number }
  | { type: "svar"; p: ProeveSvar };

/** Sorteringen, som den står på skærmen: 0 er normal, 1 er kraftig. */
const SORTERING_NAVN = ["Normal", "Kraftig"];

/** Et tal med fortegn: "+0,4", "-1,2". */
const fortegn = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${tal(v, d)}`;

/** Afrund til én decimal — til det, en agent får at se. */
const rund = (v: number) => Math.round(v * 10) / 10;

/** Hvor meget en andel i en prøve af den størrelse svinger: én standardafvigelse, i procentpoint. */
const usikkerhed = (pct: number, froe: number) => Math.sqrt(Math.max(0, (pct / 100) * (1 - pct / 100)) / Math.max(1, froe)) * 100;

/** Det, en virkning måles på, i et CT-svar. */
function maalt(c: CtSvar, noegle: "multi" | "let" | "godt"): number {
  return noegle === "multi" ? c.bigf + c.bigh : c[noegle];
}

/** Kanalerne, en linjeagent holder øje med for at se et stop komme. */
const OVERVAAGET = new Set(["vibration", "dæk", "motortemp", "stroem", "rpm", "hastighed", "luft"]);

/**
 * Så mange gange det normale udsving, før en linjeagent melder et stop på
 * vej. Ved fire vandrede en motortemperatur derud af sig selv i løbet af en
 * ordre; ved fem sker det næsten aldrig.
 */
const VARSEL_Z = 5;

/**
 * Den kanal, der varsler et stop på en maskine, og hvor den løber hen:
 * vibration, der stiger, et dæk, der ryster for lidt, en motor, der bliver
 * varm, eller en strøm, der stiger. Otte gange det normale udsving: langt
 * ud over det, en kanal vandrer af sig selv.
 */
function varselFor(s: MaskinTilstand): { kanal: string; maal: number } | null {
  const k = ["vibration", "dæk", "motortemp", "stroem"]
    .map((id) => s.kanaler.find((x) => x.spec.id === id))
    .find(Boolean);
  if (!k) return null;
  const ned = k.spec.id === "dæk";
  return { kanal: k.spec.id, maal: k.spec.nominal + (ned ? -VARSEL_Z * 1.6 : VARSEL_Z * 1.6) * k.spec.spredning };
}

interface Aarsag {
  type: "ophobning" | "varme";
  /** Maskinen, der er årsagen. */
  maskine: string;
  tekst: string;
}

export interface Simulator {
  /** Ét skridt frem. `dtMs` er tiden siden sidst, `nu` er uret. */
  skridt(dtMs: number, nu: number): TelemetriBillede;
  /**
   * Ét skridt frem uden at bygge et billede. Til mellemskridtene, når tiden
   * går hurtigt: kun det sidste skridt skal vises. Forløbet er det samme.
   * Svarer true, når der sker noget — så kan den, der driver tiden, sætte
   * farten ned, før det er overstået.
   */
  frem(dtMs: number, nu: number): boolean;
  /**
   * Svar på en opgave. null: Claude svarede ikke, og reglerne tager over
   * med deres skabelon. En handling, opgaven ikke tilbød, bliver reglernes.
   */
  svar(id: number, svar: Svar | null): void;
  /** Hvor mange opgaver, der venter på et svar. */
  antalOpgaver(): number;
  /**
   * Et menneske udfører en anbefaling: indstillingen flyttes. Den, der
   * trykker først, bestemmer; en anbefaling, der er afgjort, rører sig ikke.
   */
  udfoer(id: number, hvem?: Menneske): void;
  /** Et menneske afviser en anbefaling. */
  afvis(id: number, hvem?: Menneske): void;
}

/**
 * Anlægget, som det ville se ud med kanalerne inde.
 *
 * Hver kanal er en Ornstein–Uhlenbeck-proces: den søger mod sit driftspunkt
 * og har et udsving omkring det, så den vandrer som en rigtig måling i
 * stedet for at flimre. Når maskinen står, søger den mod sin hvileværdi —
 * hastigheden mod nul, motortemperaturen langsomt mod hallens.
 */
/** Et kastebords standardindstillinger: kanalernes driftspunkt. */
function udgangspunkt(kanaler: KanalSpec[]): Indstilling {
  const v = (id: string, standard: number) => kanaler.find((k) => k.id === id)?.nominal ?? standard;
  return { tvaers: v("tvaers", 4), langs: v("langs", 1.5), slag: v("slag", 420), luft: v("luft", 65) };
}

export function simulator(layout: Layout, valg: SimValg = {}): Simulator {
  const {
    seed = 743, stopEfterS = SIM.stopEfterS, tvungenFlaskehals = false, ai = true,
    planlagteStop = [], stopHverS = SIM.stopHverS,
  } = valg;
  let startT: number | null = null;
  const udfoert = new Set<number>();
  const r = rng(seed);
  // Kastebordenes klassificering og partierne har deres egen strøm, så resten
  // af forløbet ikke flytter sig, fordi de kom til.
  const rk = rng(seed ^ 0x5eed);
  const maskiner: MaskinTilstand[] = layout.machines
    .filter((m) => m.kind !== "person")
    .map((m) => ({
      m,
      kort: kortNavn(m),
      kanaler: kanalerFor(m).map((spec) => ({
        spec,
        // Start et tilfældigt sted i det normale udsving, ikke på stregen.
        x: klem(spec.nominal + gauss(r) * spec.spredning, spec.min, spec.max),
        alarm: false,
      })),
      stopTil: null,
      stoppetFra: null,
      startet: null,
      koertMs: 0,
      totalMs: 0,
      fyld: m.lane ? TILLOEB.normalPct : null,
      overloebet: false,
      varmeTil: null,
      // Med en ordre står linjen, til ordren starter den.
      slukket: !!valg.ordre,
      startVed: null,
      stopVed: null,
      varsel: null,
      varslet: null,
      afvigFra: null,
      afvigMeldt: false,
      indstilling: KASTEBORD.test(m.name) ? udgangspunkt(kanalerFor(m)) : null,
    }));
  const hal: KanalTilstand[] = HAL.map((spec) => ({ spec, x: spec.nominal, alarm: false }));

  // Sporene, og hvem der fodrer hvem i dem.
  const lanes = [...new Set(maskiner.map((s) => s.m.lane).filter((l): l is string => !!l))].sort();
  const iSpor = new Map(lanes.map((l) => [
    l, maskiner.filter((s) => s.m.lane === l).sort((a, b) => a.m.step - b.m.step),
  ]));
  const fordeler = maskiner.find((s) => s.m.kind === "distributor");

  // Driftsagentens tilstand.
  const spor = new Map(lanes.map((l) => [l, { stoppet: false, aarsag: null as Aarsag | null, siden: null as number | null }]));
  let indgangStoppet = false;
  let holder = false;
  let beslutninger = 0;
  /** Hvor længe et fund har holdt. Agenten handler ikke på én prøve. */
  const overvejer = new Map<string, number>();
  let naesteVarme: number | null = null;

  /** Står maskinen, fordi agenten har stoppet dens spor eller indgangen? */
  const styret = (s: MaskinTilstand) => (s.m.lane ? spor.get(s.m.lane)!.stoppet : indgangStoppet);
  const koererNu = (s: MaskinTilstand) => s.stopTil === null && !styret(s) && !s.slukket;

  // --- Ordresimuleringen -----------------------------------------------------
  // Kun når der er en ordre. Uden den er simulatoren den samme som altid.
  const O = valg.ordre ?? null;
  // Går tiden hurtigt, kan der ske meget mellem to billeder. Så husker det flere.
  const logMaks = O ? 200 : SIM.logLaengde;
  let uroNu = false;
  let fase: OrdreStatus["fase"] = "opstart";
  let ordreStart: number | null = null;
  let koertFra: number | null = null;
  let kgInd = 0;
  let kasserTippet = 0;
  let slutT: number | null = null;
  const milepael = new Set<number>();
  const samtale: Besked[] = [];
  let beskeder = 0;
  const sig = (b: Omit<Besked, "t" | "nr">, nu: number) => {
    beskeder++;
    samtale.unshift({ kilde: "regel", ...b, t: nu, nr: beskeder });
    if (samtale.length > logMaks) samtale.length = logMaks;
  };
  // Signalerne i hver prøvegruppe — samme signaler, som kæden tæller.
  // Flowet er hurtigt; hver maskine har et driftssignal.
  const antal: Record<Gruppe, number> = { hurtig: 1, middel: 0, langsom: 0, di: 0 };
  for (const s of maskiner) {
    for (const k of s.kanaler) antal[PROEVERATE.gruppe[k.spec.maaler] ?? "langsom"]++;
    antal.di += s.m.wIds.length;
  }
  for (const k of HAL) antal[PROEVERATE.gruppe[k.maaler] ?? "langsom"]++;
  let proeveTrin = 0;
  /**
   * Fødningen ind på linjen, som andel af normalt. Kun Operatøragenten kan
   * skrue den ned — og kun hvis den vælger det frem for Dataagentens forslag.
   */
  let foedning = 1;
  let dataVenter = false;
  let godkendVenter = false;
  /** Spor, der venter på Operatøragentens beslutning om at starte igen. */
  const genstartVenter = new Set<string>();
  /** Spor, Operatøragenten har valgt at vente med. */
  const venterTil = new Map<string, number>();
  let roligFra: number | null = null;
  let overbelastFra: number | null = null;
  let vagtMeldt: number | null = null;
  let forslag: { t: number; plan: Proeveplan; alle: Proeveplan[]; nok: boolean } | null = null;
  let koeMeldt = false;
  let episodeTil: number | null = null;
  let mssqlEpisoder = 0;
  let maksForsinkelse = 0;
  let sensorfejl = 0;
  let maskinstop = 0;
  const sporStop: SporStop[] = [];
  /** Spor, der startes bagfra, og hvornår det begyndte. */
  const genstarter = new Map<string, number>();
  const froe = new Map<string, { punkter: { t: number; x: number }[]; meldt: boolean; udeFra: number | null }>();
  const anbefalinger: Anbefaling[] = [];
  let anbefalingNr = 0;
  /** Hvornår et bord eller sorteringen tidligst må få en anbefaling igen. */
  const anbefalIgenFra = new Map<string, number>();

  // --- Partiet og laboratoriet --------------------------------------------------
  // Partiet ligger fast for ordren. Laboratoriet har sin egen tilfældighed,
  // så resten af forløbet ikke flytter sig, fordi en prøve kom til.
  const rl = rng(seed ^ 0x1ab5);
  const parti: Parti = valg.parti ?? nytParti(rl, valg.ordre?.kasser ?? 1);
  /** Hvornår hver kasse begyndte at løbe ind. Frøet når prøvestederne senere. */
  const kasseFra: number[] = [];
  const sortering: Record<string, Sortering> = Object.fromEntries(lanes.map((l) => [l, "normal" as Sortering]));
  const planSteder = ctPlan(layout, kortNavn);
  const bordeI = bordeISpor(layout);
  let planPos = 0;
  let foersteCt: number | null = null;
  let ctIgang: (ProeveSvar & { ct: CtSvar }) | null = null;
  let vmIgang: (ProeveSvar & { videometer: VideometerSvar }) | null = null;
  let vmNaesteKasse = 0;
  let vmUnderLav = 0;
  const seneste = new Map<string, ProeveSvar>();
  let proeveNr = 0;
  let ctTaget = 0;
  let vmTaget = 0;
  let sprunget = 0;
  /** Hvornår et bords indstilling sidst blev flyttet. Svar fra før tæller ikke for det nye. */
  const aendret = new Map<string, number>();
  let fremmedMaks: { stk: number; kasse: number } | null = null;
  let kraftigMs = 0;
  let kraftigFra: number | null = null;

  let flow = valg.ordre ? 0 : SIM.flowNominal;

  // --- Hvem tænker --------------------------------------------------------------
  // Med reglerne svarer agenterne med det samme, med skabelonerne. Med Claude
  // bliver hver besked og beslutning fra en Claude-agent til en opgave, der
  // venter på et svar — og det, der afhænger af beslutningen, venter med.
  const motor: Motor = valg.motor ?? "regler";
  let opgaveNr = 0;
  let sidsteNu = 0;
  const aabneOpgaver = new Map<number, Opgave & { anvend: (handling: string) => void }>();
  const taenk = (o: Omit<Opgave, "id" | "t">, nu: number, anvend: (handling: string) => void = () => {}) => {
    if (motor === "regler") {
      for (const b of o.skabelon) sig(b, nu);
      anvend(o.standard);
      return;
    }
    const id = ++opgaveNr;
    aabneOpgaver.set(id, { ...o, id, t: nu, anvend });
  };
  const besvar = (id: number, sv: Svar | null) => {
    const o = aabneOpgaver.get(id);
    if (!o) return;
    aabneOpgaver.delete(id);
    const nu = sidsteNu;
    if (!sv || sv.beskeder.length === 0) {
      for (const b of o.skabelon) sig(b, nu);
      o.anvend(o.standard);
      return;
    }
    sv.beskeder.forEach((b, i) => sig({
      fra: o.agent, til: b.til, type: b.type, tekst: b.tekst, grund: b.grund,
      linjer: i === 0 ? o.bilag : undefined,
      kilde: "claude", ms: sv.ms, model: sv.model,
    }, nu));
    o.anvend(o.handlinger.includes(sv.handling) ? sv.handling : o.standard);
  };
  let gennemloeb = 0;
  let sensorfejlTil: number | null = null;
  // --- Strømmen, som den er ved et prøvested --------------------------------------
  const kasseVed = (t: number) => {
    let k = 0;
    for (let i = 0; i < kasseFra.length; i++) if (kasseFra[i] <= t) k = i;
    return Math.min(k, parti.kasser.length - 1);
  };
  const delta = (m: MaskinTilstand) => {
    const k = (id: string) => m.kanaler.find((x) => x.spec.id === id);
    const tv = k("tvaers");
    const lu = k("luft");
    // Målt, ikke sat: en hældning, der lige er ændret, er ikke nået derhen.
    return { dT: tv ? tv.x - tv.spec.nominal : 0, dL: lu ? lu.x - lu.spec.nominal : 0 };
  };
  /** Strømmen ved et prøvested lige nu: frøet fra den kasse, der var tippet for transittiden siden. */
  const stroemVed = (sted: ProeveSted, nu: number): { s: Stroem; kasse: number } => {
    const transit = sted.bord === null ? PROCES.transitMin.jetpealer : PROCES.transitMin.kastebord[Math.min(sted.bord, 1)];
    const kasse = kasseVed(nu - transit * 60_000);
    let st = efterJetpealer(parti.kasser[kasse]);
    if (sted.bord === null || !sted.fraktion || !sted.lane) return { s: st, kasse };
    st = efterSortering(st, sortering[sted.lane] ?? "normal");
    const liste = bordeI.get(sted.lane) ?? [];
    for (let i = 0; i <= sted.bord && i < liste.length; i++) {
      const t = maskiner.find((x) => x.m.id === liste[i].id);
      const d = t ? delta(t) : { dT: 0, dL: 0 };
      const sk = skil(st, d.dT, d.dL);
      if (i === sted.bord) return { s: sk[sted.fraktion], kasse };
      st = sk.mainline;
    }
    return { s: st, kasse };
  };
  /** Hvornår der ca. kommer et svar fra samme maskine igen, ved planen, som den står. */
  const naesteFra = (maskine: string, nu: number): number | null => {
    const rest = ctIgang ? Math.max(0, ctIgang.svarT - nu) : 0;
    for (let i = 0; i < planSteder.length; i++) {
      if (planSteder[(planPos + i) % planSteder.length].maskine === maskine) {
        return nu + rest + (i + 1) * PROEVER.ct.minutter * 60_000;
      }
    }
    return null;
  };

  // --- Svar fra laboratoriet ------------------------------------------------------
  // Prøvetagningsagenten melder svaret videre. Er det fra et kastebord,
  // vurderer linjeagenten bordet; er det fra videometeret, vejer
  // Operatøragenten, om der skal sorteres kraftigere på Carter og Alfa.

  const meldCt = (p: ProeveSvar, nu: number) => {
    const c = p.ct!;
    const sted = p.sted;
    const m = sted.maskine ? maskiner.find((x) => x.m.id === sted.maskine) : undefined;
    const multi = c.bigf + c.bigh;
    const [tekst, kortTekst] = sted.fraktion === null
      ? [`${sted.navn}: multigerm ${tal(multi, 1)} % (BIGF ${tal(c.bigf, 1)}, BIGH ${tal(c.bigh, 1)}), NOTS ${c.notsStk} i ${c.froe} frø.`, `multigerm ${tal(multi, 1)} % · NOTS ${c.notsStk}`]
      : sted.fraktion === "mainline"
        ? [`${sted.navn}: multigerm ${tal(multi, 1)} %, let ${tal(c.let, 1)} %, godt frø ${tal(c.godt, 1)} %.`, `Mainline · multigerm ${tal(multi, 1)} %`]
        : sted.fraktion === "heavy"
          ? [`${sted.navn}: godt frø ${tal(c.godt, 0)} %, multigerm ${tal(multi, 0)} %, sten ${tal(c.sten, 1)} %.`, `Heavy · godt frø ${tal(c.godt, 0)} %`]
          : [`${sted.navn}: godt frø ${tal(c.godt, 0)} %, let ${tal(c.let, 0)} %, ler ${tal(c.ler, 1)} %.`, `Light · godt frø ${tal(c.godt, 0)} %`];
    // Uden for grænsen i sig selv — det, strømmen her kan sige alene.
    const over = sted.fraktion !== null && sted.bord !== null && vurder(sted.bord, { [sted.fraktion]: c }).grunde.length > 0;
    // Det sidste bord i sporet leverer produktet. Er dets Mainline uden for, er det en fejl.
    const produkt = sted.fraktion === "mainline" && sted.lane !== null && sted.bord === (bordeI.get(sted.lane)?.length ?? 0) - 1;
    skriv({ t: nu, hvor: m ? m.kort : "Laboratoriet", tekst: `CT · ${kortTekst}`, niveau: over ? (produkt ? "alarm" : "advarsel") : "info" });
    const naeste = sted.maskine ? naesteFra(sted.maskine, nu) : null;
    sig({
      fra: AGENT.proever, til: sted.lane ? AGENT.linje(sted.lane) : AGENT.operatoer, type: "iagttagelse", tekst,
      grund: `Taget ${klokke(p.taget)}, svar ${klokke(p.svarT)}.${naeste !== null && m ? ` Næste fra ${m.kort} ca. ${klokke(naeste)}.` : ""}`,
    }, nu);
    if (sted.fraktion && m?.indstilling && sted.bord !== null) vurderBord(m, sted.bord, p, nu);
  };

  const vurderBord = (m: MaskinTilstand, bord: number, p: ProeveSvar, nu: number) => {
    const hvem = AGENT.linje(m.m.lane ?? "N");
    const ind = m.indstilling!;
    const w = m.m.wIds[0];
    // Kun svar fra efter den seneste ændring, og fra et bord, der stod, hvor
    // det var sat. Et svar fra før siger intet om det, der står nu.
    const fra = aendret.get(m.m.id) ?? -Infinity;
    const svar: Partial<Record<Fraktion, CtSvar>> = {};
    for (const f of ["heavy", "light", "mainline"] as const) {
      const sv = seneste.get(`${w}:${f}`);
      if (sv?.ct && sv.somSat && sv.taget >= fra) svar[f] = sv.ct;
    }

    // Virkningen af en udført ændring gøres op, når der er et svar fra efter den.
    for (const an of anbefalinger) {
      if (an.maskine !== m.m.id || an.status !== "udfoert" || an.gjortOp) continue;
      if (!p.somSat || p.taget < (an.udfoertT ?? Infinity)) continue;
      for (const v of an.virkning) {
        if (v.fraktion === p.sted.fraktion && v.noegle && v.efter === undefined) v.efter = maalt(p.ct!, v.noegle);
      }
      const h = an.virkning[0];
      if (h.efter === undefined) continue;
      an.gjortOp = true;
      const foerTekst = h.foer !== null ? `${tal(h.foer, 1)} → ` : "";
      taenk({
        agent: hvem,
        spoergsmaal: `Virkningen af ændringen på ${m.kort} er målt. Fortæl operatøren, om den virkede.`,
        situation: {
          kastebord: m.kort,
          aendring: `${an.parameter === "tvaers" ? "tværhældning" : "luft"} ${tal(an.fraVaerdi, 1)} → ${tal(an.tilVaerdi, 1)}`,
          virkning: an.virkning.map((v) => ({ navn: v.navn, foer: v.foer, ventet: Math.round(v.forventet * 10) / 10, efter: v.efter ?? null })),
          maaltIProeve: `én CT-prøve af ${p.ct!.froe} frø, taget ${klokke(p.taget)}`,
        },
        handlinger: ["ingen"], modtagere: ["Operatør"],
        skabelon: [{
          fra: hvem, til: "Operatør", type: "rapport",
          tekst: `Efter ændringen på ${m.kort}: ${h.navn.toLowerCase()} ${foerTekst}${tal(h.efter, 1)} %.`,
          grund: `Ventet ${fortegn(h.forventet)} procentpoint. Én prøve, taget ${klokke(p.taget)} — den svinger ca. ±${tal(usikkerhed(h.efter, p.ct!.froe), 1)}.`,
        }],
        standard: "ingen",
      }, nu);
    }

    // En ny anbefaling: én ad gangen pr. bord, og ikke mens bordet har ro.
    if (anbefalinger.some((x) => x.maskine === m.m.id && (x.status === "aaben" || (x.status === "udfoert" && !x.gjortOp)))) return;
    if ((anbefalIgenFra.get(m.m.id) ?? 0) > nu) return;
    const v = vurder(bord, svar);
    if (!v.tvaers && !v.luft) return;
    const g = KASTEBORDET.graenser[Math.min(bord, KASTEBORDET.graenser.length - 1)];
    const spec = (id: "tvaers" | "luft") => m.kanaler.find((k) => k.spec.id === id)!.spec;
    const kan = (id: "tvaers" | "luft", ret: 1 | -1) => ret > 0
      ? ind[id] + KASTEBORDET.trin[id] <= (spec(id).alarmHoej ?? Infinity) - KASTEBORDET.trin[id]
      : ind[id] - KASTEBORDET.trin[id] >= (spec(id).alarmLav ?? -Infinity) + KASTEBORDET.trin[id];
    // Tværhældningen først: multigerm er det, bordet mest skal have ud.
    const valgt = (["tvaers", "luft"] as const).map((par) => ({ par, r: v[par] })).find((x) => x.r === "op" || x.r === "ned");
    const konflikt = (["tvaers", "luft"] as const).find((par) => v[par] === "begge");
    const grunde = v.grunde.join("; ");
    const grundTekst = grunde.charAt(0).toUpperCase() + grunde.slice(1);
    if (!valgt || !kan(valgt.par, valgt.r === "op" ? 1 : -1)) {
      // En afvejning — eller en indstilling ved sin grænse — er ikke noget,
      // et trin løser. Så siges det til et menneske i stedet for at skrue
      // frem og tilbage.
      anbefalIgenFra.set(m.m.id, nu + KASTEBORDET.roEfterNejS * 1000);
      const par = konflikt ?? valgt?.par ?? "tvaers";
      const navn = par === "tvaers" ? "tværhældningen" : "luften";
      taenk({
        agent: hvem,
        spoergsmaal: konflikt
          ? `${m.kort} kan ikke rense Mainline uden at smide for meget godt frø ud. Forklar formanden afvejningen.`
          : `${m.kort} skulle justeres, men ${navn} er ved sin grænse. Sig det til formanden.`,
        situation: { kastebord: m.kort, fund: v.grunde, graenser: g, indstillingNu: { tvaersGrader: ind.tvaers, luftPct: ind.luft } },
        handlinger: ["ingen"], modtagere: ["Formand", AGENT.operatoer],
        skabelon: [{
          fra: hvem, til: "Formand", type: "iagttagelse",
          tekst: konflikt
            ? `${m.kort} kan ikke både holde Mainline ren og tabet nede ved det her parti.`
            : `${m.kort} skulle justeres, men ${navn} er ved sin grænse.`,
          grund: konflikt
            ? `${grundTekst}. Hæves ${navn}, går mere godt frø ud; sænkes den, bliver Mainline mere uren. Hvad vejer tungest?`
            : `${grundTekst}.`,
        }],
        standard: "ingen",
      }, nu);
      return;
    }
    const retning = valgt.r === "op" ? 1 : -1;
    const regel = `${retning > 0 ? "haev" : "saenk"}_${valgt.par}`;
    const effekt = Object.fromEntries((["haev_tvaers", "saenk_tvaers", "haev_luft", "saenk_luft"] as const).map((h) => {
      const [ret, par] = h.split("_") as ["haev" | "saenk", "tvaers" | "luft"];
      return [h, virkningAfTrin(bord, par, ret === "haev" ? 1 : -1)];
    }));
    const skabelon = (h: string) => {
      const [ret, par] = h.split("_") as ["haev" | "saenk", "tvaers" | "luft"];
      const til = ind[par] + (ret === "haev" ? 1 : -1) * KASTEBORDET.trin[par];
      const e = effekt[h];
      return {
        fra: hvem, til: "Operatør", type: "forslag" as const,
        tekst: `${ret === "haev" ? "Hæv" : "Sænk"} ${par === "tvaers" ? "tværhældningen" : "luften"} på ${m.kort} fra ${tal(ind[par], par === "tvaers" ? 1 : 0)} til ${tal(til, par === "tvaers" ? 1 : 0)}${par === "tvaers" ? "°" : " %"}.`,
        grund: `${grundTekst}. Venter ${e.map((x) => `${x.navn.toLowerCase()} ${fortegn(x.delta)}`).join(" og ")} procentpoint.`,
      };
    };
    taenk({
      agent: hvem,
      spoergsmaal: `${m.kort} er uden for sine grænser: ${grunde}. Hvilken ændring anbefaler du operatøren?`,
      situation: {
        kastebord: m.kort, spor: m.m.lane, bordISporet: bord + 1,
        indstillingNu: { tvaersGrader: ind.tvaers, langsGrader: ind.langs, slagPrMin: ind.slag, luftPct: ind.luft },
        senesteSvar: Object.fromEntries(Object.entries(svar).map(([f, c]) => [f, { godtPct: rund(c.godt), multigermPct: rund(c.bigf + c.bigh), letPct: rund(c.let), stenPct: rund(c.sten) }])),
        graenser: g,
        virkningPrTrin: Object.fromEntries(Object.entries(effekt).map(([h, e]) => [h, e.map((x) => ({ [x.navn]: rund(x.delta) }))])),
        hvemUdfoerer: "operatøren — du anbefaler, et menneske beslutter",
        naesteSvar: "et svar fra bordet kommer først, når CT-scanneren når til det i planen",
      },
      handlinger: ["haev_tvaers", "saenk_tvaers", "haev_luft", "saenk_luft", "ingen"],
      modtagere: ["Operatør"],
      skabelon: [skabelon(regel)],
      standard: regel,
    }, nu, (h) => {
      if (h === "ingen") return;
      const [ret, par] = h.split("_") as ["haev" | "saenk", "tvaers" | "luft"];
      const fraV = m.indstilling![par];
      const til = Math.round((fraV + (ret === "haev" ? 1 : -1) * KASTEBORDET.trin[par]) * 10) / 10;
      const e = effekt[h];
      const virkning: Virkning[] = par === "tvaers"
        ? [
            { navn: e[0].navn, enhed: "%", foer: svar.mainline ? maalt(svar.mainline, "multi") : null, forventet: e[0].delta, fraktion: "mainline", noegle: "multi" },
            { navn: e[1].navn, enhed: "%", foer: svar.heavy?.godt ?? null, forventet: e[1].delta, fraktion: "heavy", noegle: "godt" },
          ]
        : [
            { navn: e[0].navn, enhed: "%", foer: svar.mainline?.let ?? null, forventet: e[0].delta, fraktion: "mainline", noegle: "let" },
            { navn: e[1].navn, enhed: "%", foer: svar.light?.godt ?? null, forventet: e[1].delta, fraktion: "light", noegle: "godt" },
          ];
      // Den, anbefalingen bygger på, står først: at sænke er for tabets skyld.
      if (ret === "saenk") virkning.reverse();
      anbefalinger.unshift({
        id: ++anbefalingNr, t: sidsteNu, maskine: m.m.id, kort: m.kort, fra: hvem,
        parameter: par, fraVaerdi: fraV, tilVaerdi: til, virkning, status: "aaben",
      });
      if (anbefalinger.length > 20) anbefalinger.length = 20;
    });
  };

  const meldVideometer = (p: ProeveSvar, nu: number) => {
    const v = p.videometer!;
    const kasse = (p.kasse ?? 0) + 1;
    const arter = FREMMEDE.filter((a) => v.fremmed[a] > 0).sort((a, b) => v.fremmed[b] - v.fremmed[a]);
    const top = arter.slice(0, 3).map((a) => `${a} ${v.fremmed[a]}`).join(", ");
    const { fremmedHoej: hoej, fremmedLav: lav } = PROEVER.videometer;
    const over = v.fremmedIalt > hoej;
    if (!fremmedMaks || v.fremmedIalt > fremmedMaks.stk) fremmedMaks = { stk: v.fremmedIalt, kasse };
    skriv({ t: nu, hvor: "Videometer", tekst: `Kasse ${kasse} · ${v.fremmedIalt} foreign seeds${arter[0] ? ` · flest ${arter[0]}` : ""}`, niveau: over ? "advarsel" : "info" });
    if (v.slibeskader > PROEVER.videometer.slibeskaderHoej) {
      skriv({ t: nu, hvor: "Videometer", tekst: `Kasse ${kasse} · slibeskader ${tal(v.slibeskader, 1)} %`, niveau: "advarsel" });
    }
    sig({
      fra: AGENT.proever, til: AGENT.operatoer, type: "iagttagelse",
      tekst: `Videometer, kasse ${kasse}: ${v.fremmedIalt} foreign seeds i ${v.gram} g${top ? ` — ${top}` : ""}. Slibeskader ${tal(v.slibeskader, 1)} %.`,
      grund: `Taget ${klokke(p.taget)}, svar ${klokke(p.svarT)}. ${over ? `Over grænsen på ${hoej}.` : `Grænsen er ${hoej}.`}`,
    }, nu);

    // Sortér kraftigere, når der er for mange — og normalt igen, når to
    // prøver i træk er under den lave grænse. Kraftig sortering koster godt frø.
    vmUnderLav = v.fremmedIalt < lav ? vmUnderLav + 1 : 0;
    const kraftig = Object.values(sortering).some((x) => x === "kraftig");
    if (anbefalinger.some((x) => x.maskine === "sortering" && x.status === "aaben")) return;
    if ((anbefalIgenFra.get("sortering") ?? 0) > nu) return;
    const tilKraftig = over && !kraftig;
    const tilNormal = kraftig && vmUnderLav >= 2;
    if (!tilKraftig && !tilNormal) return;
    const P = PROCES.sortering;
    const videre = (x: Sortering) => 1 - P[x].fremmed;
    const [fra, til]: Sortering[] = tilKraftig ? ["normal", "kraftig"] : ["kraftig", "normal"];
    const eff: Virkning[] = [
      { navn: "Foreign seeds videre", enhed: "%-rel", foer: null, forventet: (videre(til) / videre(fra) - 1) * 100 },
      { navn: "Godt frø tabt", enhed: "pp", foer: null, forventet: P[til].godtTab - P[fra].godtTab },
    ];
    const transit = PROCES.transitMin.jetpealer;
    taenk({
      agent: AGENT.operatoer,
      spoergsmaal: tilKraftig
        ? `Videometeret har fundet ${v.fremmedIalt} foreign seeds i kasse ${kasse}. Hvad anbefaler du operatøren?`
        : `Videometeret har været under ${lav} foreign seeds i to prøver i træk, og der sorteres kraftigt. Hvad anbefaler du operatøren?`,
      situation: {
        kasse, foreignSeeds: v.fremmedIalt, arter: top, graenseHoej: hoej, graenseLav: lav, sorteringNu: fra,
        virkning: eff.map((x) => ({ [x.navn]: rund(x.forventet) })),
        tid: `svaret kommer ${PROEVER.videometer.minutter} min efter prøven; frøet er ved jetpealerne ${transit} min efter, kassen tippes`,
      },
      handlinger: [til, "ingen"], modtagere: ["Operatør"],
      skabelon: [{
        fra: AGENT.operatoer, til: "Operatør", type: "forslag",
        tekst: tilKraftig ? "Sortér kraftigere på Carter og Alfa i begge spor." : "Sortér normalt igen på Carter og Alfa.",
        grund: tilKraftig
          ? `Kasse ${kasse} har ${v.fremmedIalt} foreign seeds pr. ${v.gram} g — grænsen er ${hoej}. Frøet fra den kasse er allerede forbi, men kommer der mere, slipper ca. ${tal(-eff[0].forventet, 0)} % færre igennem — for ${tal(eff[1].forventet, 1)} procentpoint godt frø.`
          : `To prøver i træk under ${lav}. Normal sortering sparer ca. ${tal(-eff[1].forventet, 1)} procentpoint godt frø.`,
      }],
      standard: til,
    }, nu, (h) => {
      if (h === "ingen") return;
      anbefalinger.unshift({
        id: ++anbefalingNr, t: sidsteNu, maskine: "sortering", kort: "Carter og Alfa", fra: AGENT.operatoer,
        parameter: "sortering", fraVaerdi: fra === "kraftig" ? 1 : 0, tilVaerdi: til === "kraftig" ? 1 : 0, virkning: eff, status: "aaben",
      });
      if (anbefalinger.length > 20) anbefalinger.length = 20;
    });
  };

  // Kæden. Tælleren til visning starter et sted, regnskabet starter i nul.
  const skrevetStart = 1_184_000;
  let modtaget = 0;
  let skrevetIalt = 0;
  let koe = 0;
  let tabt = 0;
  let foersteT: number | null = null;
  let iEpisode = false;
  let alarmeret = false;
  let indhentFra: number | null = null;
  let stop = 0;
  let sidsteVagt = -1;
  const log: Haendelse[] = [];

  const skriv = (h: Haendelse) => {
    log.unshift(h);
    if (log.length > logMaks) log.length = logMaks;
  };
  const fmt = (v: number, k: KanalSpec) => v.toFixed(k.decimaler).replace(".", ",");

  function opdater(k: KanalTilstand, maal: number, dt: number, stoej: boolean, traeghed?: number) {
    const theta = traeghed ?? k.spec.traeghed ?? 0.1;
    // Den eksakte løsning over et skridt, ikke en tilnærmelse: processen i
    // ro har spredningen fra specifikationen, uanset hvor langt der er mellem
    // to skridt. Med en tilnærmelse slog kanalerne større ud på en bærbar,
    // der hakker — og ramte grænser, de aldrig ramte på en, der ikke gør.
    const a = Math.exp(-theta * dt);
    k.x = maal + (k.x - maal) * a + (stoej ? k.spec.spredning * Math.sqrt(1 - a * a) * gauss(r) : 0);
    k.x = klem(k.x, k.spec.min, k.spec.max);
  }

  /**
   * Findes der en grund til at stoppe sporet? Den første, agenten ser, i
   * sporets rækkefølge: en ophobning foran en stoppet maskine, eller frø, der
   * er blevet for varmt i en jetpealer.
   */
  function aarsagI(liste: MaskinTilstand[]): Aarsag | null {
    for (const s of liste) {
      if (s.stopTil !== null && s.fyld !== null && s.fyld >= DRIFTSAGENT.bufferStopPct) {
        return { type: "ophobning", maskine: s.m.id, tekst: `${s.kort} står · buffer ${Math.round(s.fyld)} %` };
      }
      const temp = s.kanaler.find((k) => k.spec.id === "froetemp");
      if (temp && koererNu(s) && temp.x >= DRIFTSAGENT.froeStopC) {
        return { type: "varme", maskine: s.m.id, tekst: `Frø ${fmtTal(temp.x, 1)} °C på ${s.kort}` };
      }
    }
    return null;
  }

  function gaa(dtMs: number, nu: number, medBillede: boolean): TelemetriBillede | null {
    const dt = Math.min(dtMs, 2000) / 1000;
    const sket: Sket[] = [];
    sidsteNu = nu;

    // --- Ordren: start bagfra, kørsel, stop forfra -----------------------------
    if (O) {
      if (ordreStart === null) {
        ordreStart = nu;
        // Bagfra: det sidste trin først, påslaget sidst. Så er der plads i
        // hver buffer, før der fødes.
        const trin = [...new Set(maskiner.map((s) => s.m.step))].sort((a, b) => b - a);
        for (const s of maskiner) s.startVed = nu + trin.indexOf(s.m.step) * SIMULERING.trinS * 1000;
        skriv({ t: nu, hvor: "Ordre", tekst: `${O.ordreNr} startet · ${O.kasser} kasser · ${tal(O.estimeretKg)} kg`, niveau: "info" });
        taenk({
          agent: AGENT.operatoer,
          spoergsmaal: `Ordre ${O.ordreNr} starter nu. Giv Driftsagent besked om at starte linjen, og sig hvorfor rækkefølgen er, som den er.`,
          situation: {
            ordre: O.ordreNr, kasser: O.kasser, estimeretKg: O.estimeretKg,
            startplan: "bagfra: sidste trin først (kastebordene), påslaget sidst",
            sekunderMellemTrin: SIMULERING.trinS, antalTrin: trin.length,
          },
          handlinger: ["ingen"], modtagere: [AGENT.drift],
          skabelon: [{
            fra: AGENT.operatoer, til: AGENT.drift, type: "beslutning",
            tekst: `Start ordre ${O.ordreNr}: ${O.kasser} kasser, ${tal(O.estimeretKg)} kg. Start linjen bagfra.`,
            grund: "Kastebordene først, påslaget sidst — så er der plads i hver buffer, før der fødes.",
          }],
          standard: "ingen",
        }, nu);
      }
      const startet: string[] = [];
      const stoppet: string[] = [];
      for (const s of maskiner) {
        if (s.startVed !== null && nu >= s.startVed) {
          s.startVed = null;
          s.slukket = false;
          s.startet = nu;
          startet.push(s.kort);
        }
        if (s.stopVed !== null && nu >= s.stopVed) {
          s.stopVed = null;
          s.slukket = true;
          stoppet.push(s.kort);
        }
      }
      if (startet.length) skriv({ t: nu, hvor: AGENT.drift, tekst: `Starter ${startet.join(", ")}`, niveau: "info", ai: true });
      if (stoppet.length) skriv({ t: nu, hvor: AGENT.drift, tekst: `Stopper ${stoppet.join(", ")}`, niveau: "info", ai: true });
      if (fase === "opstart" && maskiner.every((s) => !s.slukket)) {
        fase = "koerer";
        koertFra = nu;
        // Første kasse løber ind. Laboratoriet kan begynde, når frøet er nået frem.
        kasseFra.push(nu);
        foersteCt = nu + PROEVER.foersteCtMin * 60_000;
        sig({
          fra: AGENT.drift, til: AGENT.operatoer, type: "rapport",
          tekst: `Linjen kører · ${maskiner.length} maskiner startet på ${varighed((nu - ordreStart) / 1000)}.`,
        }, nu);
      }
    }

    // --- Stop og start ------------------------------------------------------
    if (startT === null) startT = nu;
    planlagteStop.forEach((p, i) => {
      if (udfoert.has(i) || nu - startT! < p.fraS * 1000) return;
      const s = maskiner.find((x) => x.m.wIds.includes(p.wid));
      if (!s) return;
      udfoert.add(i);
      s.stopTil = nu + p.varighedS * 1000;
      s.stoppetFra = nu;
      skriv({ t: nu, hvor: s.kort, tekst: "Stoppet", niveau: "advarsel" });
    });
    // Med en ordre sker stop kun, mens den kører, og mange varsles først.
    if ((!O || fase === "koerer") && r() < dt / (O ? SIMULERING.maskinstopHverS : stopHverS)) {
      const kandidater = maskiner.filter((s) =>
        s.stopTil === null && !styret(s) && !s.slukket && s.varsel === null && s.m.kind !== "intake");
      const s = kandidater[Math.floor(r() * kandidater.length)];
      if (s) {
        const [lo, hi] = O ? SIMULERING.maskinstopVarighedS : SIM.stopVarighedS;
        const varighedS = lo + r() * (hi - lo);
        const kanal = O ? varselFor(s) : null;
        if (kanal && r() < SIMULERING.varselAndel) {
          s.varsel = { ...kanal, stopVed: nu + SIMULERING.varselS * 1000, varighedS };
        } else {
          s.stopTil = nu + varighedS * 1000;
          s.stoppetFra = nu;
          skriv({ t: nu, hvor: s.kort, tekst: "Stoppet", niveau: "advarsel" });
          if (O) sket.push({ type: "maskinstop", s });
        }
      }
    }
    // Et varslet stop kommer, når varslet er løbet ud.
    for (const s of maskiner) {
      if (!s.varsel || nu < s.varsel.stopVed) continue;
      const k = s.kanaler.find((x) => x.spec.id === s.varsel!.kanal)!;
      s.varslet = { label: k.spec.label, tekst: `${fmt(k.x, k.spec)} ${k.spec.unit}`, normalt: `${fmt(k.spec.nominal, k.spec)} ${k.spec.unit}` };
      s.stopTil = nu + s.varsel.varighedS * 1000;
      s.stoppetFra = nu;
      s.varsel = null;
      skriv({ t: nu, hvor: s.kort, tekst: "Stoppet", niveau: "advarsel" });
      sket.push({ type: "maskinstop", s });
    }
    for (const s of maskiner) {
      if (s.stopTil !== null && nu >= s.stopTil) {
        const varighed = (nu - (s.stoppetFra ?? nu)) / 1000;
        // Samme regel som flow.ts: først over stopgrænsen er det et stop.
        if (varighed >= stopEfterS) stop++;
        skriv({
          t: nu, hvor: s.kort,
          tekst: `Kører igen · ${Math.round(varighed)} s${varighed >= stopEfterS ? " · stop registreret" : ""}`,
          niveau: "info",
        });
        s.stopTil = null;
        s.stoppetFra = null;
        s.startet = nu;
      }
    }

    // --- Friktion i jetpealerne --------------------------------------------
    if (O) {
      if (fase === "koerer" && r() < dt / SIMULERING.varmeHverS) {
        const jet = maskiner.filter((s) => /jet\s?pe[ae]ler/i.test(s.m.name) && s.varmeTil === null && koererNu(s));
        const s = jet[Math.floor(r() * jet.length)];
        if (s) {
          s.varmeTil = nu + SIMULERING.varmeVarighedS * 1000;
          skriv({ t: nu, hvor: s.kort, tekst: "Friktion stiger", niveau: "advarsel" });
        }
      }
    } else if (naesteVarme === null) naesteVarme = nu + VARME.foersteS * 1000;
    if (!O && nu >= naesteVarme!) {
      const jet = maskiner.filter((s) => /jet\s?pe[ae]ler/i.test(s.m.name) && s.varmeTil === null && koererNu(s));
      const s = jet[Math.floor(r() * jet.length)];
      if (s) {
        s.varmeTil = nu + VARME.varighedS * 1000;
        skriv({ t: nu, hvor: s.kort, tekst: "Friktion stiger", niveau: "advarsel" });
      }
      naesteVarme = nu + VARME.hverS * (0.6 + r() * 0.8) * 1000;
    }
    for (const s of maskiner) if (s.varmeTil !== null && nu >= s.varmeTil) s.varmeTil = null;

    // --- Kanalerne ----------------------------------------------------------
    const hallensTemp = hal[0].x;
    for (const s of maskiner) {
      const koerer = koererNu(s);
      const indkoerer = s.startet !== null && nu - s.startet < INDKOERING_S * 1000;
      // Med en ordre er opstart og udløb ikke oppetid eller nedetid.
      if (!O || fase === "koerer") {
        s.totalMs += dtMs;
        if (koerer) s.koertMs += dtMs;
      }
      // (koerer er koererNu: et spor, agenten har stoppet, kører ikke.)
      for (const k of s.kanaler) {
        // Står maskinen, søger kanalen mod sin hvileværdi. Motortemperaturen
        // falder mod hallens, ikke mod et fast tal.
        const hvile = k.spec.id === "motortemp" || k.spec.id === "froetemp" ? hallensTemp + 3 : k.spec.hvile;
        let maal = k.spec.nominal;
        // Friktion: frøet varmes op, så længe jetpealeren kører med den.
        if (k.spec.id === "froetemp" && s.varmeTil !== null) maal = VARME.maalC;
        // Et stop på vej: kanalen løber ud af sit bånd.
        if (s.varsel && k.spec.id === s.varsel.kanal) maal = s.varsel.maal;
        // Et kastebords hældning, slag og luft står, hvor de er sat.
        if (s.indstilling && k.spec.id in s.indstilling) maal = s.indstilling[k.spec.id as keyof Indstilling];
        // Fordeleren sender alt til det spor, der kører — og intet til et spor,
        // der er ved at blive startet bagfra.
        if (k.spec.id === "andelN") {
          const lukket = (l: string) => spor.get(l)?.stoppet || iSpor.get(l)?.[0]?.slukket;
          maal = lukket("N") ? 0 : lukket("S") ? 100 : k.spec.nominal;
        }
        // Med en ordre varmes frøet op over minutter, ikke sekunder.
        const langsomVarme = O && k.spec.id === "froetemp" && s.varmeTil !== null ? SIMULERING.varmeTraeghed : undefined;
        if (koerer) opdater(k, maal, dt, true, langsomVarme);
        else if (hvile !== undefined) opdater(k, hvile, dt, false);
        const alarm = erAlarm(k.spec, k.x, koerer, indkoerer);
        if (alarm && !k.alarm) {
          skriv({ t: nu, hvor: s.kort, tekst: `${k.spec.label} ${fmt(k.x, k.spec)} ${k.spec.unit}`, niveau: "alarm" });
        }
        k.alarm = alarm;
      }
    }
    for (const k of hal) {
      opdater(k, k.spec.nominal, dt, true);
      const alarm = erAlarm(k.spec, k.x, true);
      if (alarm && !k.alarm) skriv({ t: nu, hvor: "Hal", tekst: `${k.spec.label} ${fmt(k.x, k.spec)} ${k.spec.unit}`, niveau: "alarm" });
      k.alarm = alarm;
    }

    // --- Flowet ved indgangen -----------------------------------------------
    // Står påslaget eller elevator 743, løber der ingenting ind.
    // Med en ordre er hele fællesstrækket med: står en maskine før fordeleren,
    // kommer der intet igennem.
    const indgang = O
      ? maskiner.filter((s) => !s.m.lane)
      : maskiner.filter((s) => /påslag/i.test(s.m.name) || s.m.wIds.includes("743"));
    const indgangStaar = indgang.some((s) => !koererNu(s));
    // Står et spor, kan fordeleren kun sende til det andet — og et spor kan
    // tage halvdelen. Et stop koster gennemløb, og det skal kunne ses.
    //
    // Måleren sidder ved indgangen. Den måler, hvad der kommer ind — også det,
    // der ender på gulvet ved et overløb. W/HR er kun lig med gennemløbet,
    // når intet går tabt undervejs, og det er netop det, agenten sørger for.
    const aabne = lanes.filter((l) => !spor.get(l)!.stoppet && !iSpor.get(l)![0].slukket).length;
    const maal = indgangStaar ? 0 : SIM.flowNominal * foedning * (aabne / Math.max(1, lanes.length));
    const theta = indgangStaar ? 0.6 : 0.15;
    // Samme eksakte skridt som kanalerne, så flowet heller ikke slår større
    // ud, når der går længe mellem to skridt.
    const af = Math.exp(-theta * dt);
    flow = maal + (flow - maal) * af + (indgangStaar ? 0 : SIM.flowSpredning * Math.sqrt(1 - af * af) * gauss(r));
    flow = klem(flow, 0, 150);

    // --- Bufferne foran maskinerne i sporene --------------------------------
    // Står en maskine, mens maskinen før den stadig fodrer, fylder bufferen.
    // Når den er fuld, løber den over. Det er det, Driftsagenten skal nå
    // at forhindre.
    for (const lane of lanes) {
      const liste = iSpor.get(lane)!;
      liste.forEach((s, i) => {
        if (s.fyld === null) return;
        const foer = i === 0 ? fordeler : liste[i - 1];
        // En maskine, der er slukket efter planen, fødes ikke: planen starter
        // den, før der sendes noget til den.
        const fodres = !spor.get(lane)!.stoppet && !!foer && koererNu(foer) && flow > 1 && !s.slukket;
        // Med en ordre tager en maskine i sin første halve indkøringstid ikke
        // fra sin buffer endnu — den er ved at komme op i fart. Derfor betyder
        // det noget, i hvilken rækkefølge et spor startes.
        const optager = O && s.startet !== null && nu - s.startet < INDKOERING_S * 500;
        if (koererNu(s) && !optager) s.fyld = Math.max(TILLOEB.normalPct, s.fyld - TILLOEB.toemPrS * dt);
        else if (koererNu(s)) { if (fodres) s.fyld = Math.min(100, s.fyld + TILLOEB.fyldPrS * (flow / SIM.flowNominal) * dt); }
        else if (fodres) s.fyld = Math.min(100, s.fyld + TILLOEB.fyldPrS * (flow / SIM.flowNominal) * dt);
        if (s.fyld >= 100 && !s.overloebet) {
          s.overloebet = true;
          skriv({ t: nu, hvor: s.kort, tekst: "Overløb · bufferen er fuld", niveau: "alarm" });
          // Sporet står, mens der bliver fejet op. Det er prisen for et
          // overløb, og den er større end prisen for at stoppe i tide.
          const til = nu + TILLOEB.rengoeringS * 1000;
          for (const x of liste) {
            if (x.stopTil === null || x.stopTil < til) {
              if (x.stopTil === null) x.stoppetFra = nu;
              x.stopTil = til;
            }
          }
          skriv({ t: nu, hvor: `Spor ${lane}`, tekst: `Rengøring · ${Math.round(TILLOEB.rengoeringS / 60)} min`, niveau: "alarm" });
          s.fyld = TILLOEB.normalPct;
        }
        if (s.fyld < 90) s.overloebet = false;
      });
    }

    if (sensorfejlTil === null && (!O || fase !== "faerdig") && r() < dt / (O ? SIMULERING.sensorfejlHverS : SIM.sensorfejlHverS)) {
      sensorfejlTil = nu + (O ? SIMULERING.sensorfejlVarighedS : SIM.sensorfejlVarighedS) * 1000;
      skriv({ t: nu, hvor: "FT-743", tekst: "Sensorfejl · uden for 4–20 mA", niveau: "alarm" });
      if (O) sket.push({ type: "sensorfejl" });
    }
    if (sensorfejlTil !== null && nu >= sensorfejlTil) {
      sensorfejlTil = null;
      skriv({ t: nu, hvor: "FT-743", tekst: "Signal tilbage", niveau: "info" });
      if (O) sket.push({ type: "sensorTilbage", varighedS: (O ? SIMULERING.sensorfejlVarighedS : 0) });
    }
    const fejl = sensorfejlTil !== null;
    // Kun det, måleren så. Et hul i målingen er et hul i summen.
    if (!fejl) gennemloeb += flow * dt;

    // --- Ordren: kasserne tippes, til der ikke er flere --------------------------
    // Kiloene er det, der fysisk løber ind — ikke det, måleren så. En kasse
    // tippes, også mens måleren er ude.
    if (O && (fase === "koerer" || fase === "udloeb")) {
      kgInd = Math.min(O.estimeretKg, kgInd + (flow / 100) * O.nominalTPrT * (1000 / 3600) * dt);
    }
    if (O && fase === "koerer") {
      const kgPrKasse = O.estimeretKg / O.kasser;
      while (kasserTippet < O.kasser && kgInd >= (kasserTippet + 1) * kgPrKasse - 1e-6) {
        kasserTippet++;
        if (kasserTippet < O.kasser) kasseFra.push(nu);
        skriv({ t: nu, hvor: "Vippestole", tekst: `Kasse ${kasserTippet}/${O.kasser} tippet`, niveau: "info" });
        const kvart = Math.floor((kasserTippet / O.kasser) * 4);
        if (kvart >= 1 && kvart <= 3 && !milepael.has(kvart)) {
          milepael.add(kvart);
          const p = koertFra !== null ? prognose({ kgInd, estimeretKg: O.estimeretKg, koertFra, nu }) : null;
          taenk({
            agent: AGENT.operatoer,
            spoergsmaal: `Ordren er ${kvart * 25} % igennem. Giv operatøren en kort status.`,
            situation: {
              kasserTippet, kasserIalt: O.kasser, kgKoert: Math.round(kgInd), kgIalt: O.estimeretKg,
              timerSidenStart: Math.round(((nu - (koertFra ?? nu)) / 3_600_000) * 10) / 10,
              prognoseSidsteKasseKl: p !== null ? klokke(p) : "ukendt",
              sporStopIndtilNu: sporStop.length, maskinstopIndtilNu: maskinstop,
            },
            handlinger: ["ingen"], modtagere: ["Operatør"],
            skabelon: [{
              fra: AGENT.operatoer, til: "Operatør", type: "rapport",
              tekst: `${kasserTippet} af ${O.kasser} kasser · ${tal(kgInd)} kg.`,
              grund: p !== null ? `Ved gennemløbet indtil nu er sidste kasse tippet ca. kl. ${klokke(p)}.` : undefined,
            }],
            standard: "ingen",
          }, nu);
        }
      }
      if (kasserTippet >= O.kasser) {
        fase = "udloeb";
        // Forfra: indgangen nu, sporene, når de er tomme. Det, der er tomt,
        // stoppes først — intet står fuldt til næste ordre.
        const indTrin = [...new Set(maskiner.filter((s) => !s.m.lane).map((s) => s.m.step))].sort((a, b) => a - b);
        const sporTrin = [...new Set(maskiner.filter((s) => s.m.lane).map((s) => s.m.step))].sort((a, b) => a - b);
        // En genstart, der er i gang, gør sig færdig — ellers stod sporet
        // slukket, mens indgangen stadig fodrede det andet.
        for (const s of maskiner) {
          s.stopVed = s.m.lane
            ? nu + (SIMULERING.udloebS + sporTrin.indexOf(s.m.step) * SIMULERING.trinS) * 1000
            : nu + indTrin.indexOf(s.m.step) * SIMULERING.trinS * 1000;
        }
        skriv({ t: nu, hvor: "Vippestole", tekst: "Sidste kasse tippet", niveau: "info" });
        sig({
          fra: AGENT.operatoer, til: AGENT.drift, type: "beslutning",
          tekst: "Sidste kasse er tippet. Stop linjen forfra: indgangen nu, sporene når de er tomme.",
          grund: `Sporene løber ${varighed(SIMULERING.udloebS)} endnu. Det, der er tomt, stoppes først.`,
        }, nu);
      }
    }

    // --- Laboratoriet ----------------------------------------------------------
    // Prøverne tages i hånden og analyseres i Analytics-rummet. Videometeret
    // får en prøve af hver anden kasse, før den fordeles. CT-scanneren er én:
    // den tager den næste prøve i planen, så snart den er ledig, og springer
    // en maskine over, der står. Svaret kommer tyve minutter efter — og det
    // viser strømmen, da prøven blev taget.
    if (!O && kasseFra.length === 0) {
      kasseFra.push(nu);
      foersteCt = nu + PROEVER.foersteCtMin * 60_000;
    }
    if (fase !== "faerdig") {
      if (ctIgang && nu >= ctIgang.svarT) {
        const p: ProeveSvar = { ...ctIgang, videometer: null };
        seneste.set(p.sted.id, p);
        ctIgang = null;
        sket.push({ type: "svar", p });
      }
      if (vmIgang && nu >= vmIgang.svarT) {
        const p: ProeveSvar = { ...vmIgang, ct: null };
        seneste.set(p.sted.id, p);
        vmIgang = null;
        sket.push({ type: "svar", p });
      }
    }
    const flyder = kasseFra.length > 0 && (!O || fase === "koerer");
    if (flyder && !ctIgang && foersteCt !== null && nu >= foersteCt && planSteder.length > 0) {
      const n = planSteder.length;
      const i = [...Array(n).keys()].find((j) => {
        const sted = planSteder[(planPos + j) % n];
        const m = maskiner.find((x) => x.m.id === sted.maskine);
        return !!m && koererNu(m);
      });
      if (i !== undefined) {
        for (let j = 0; j < i; j++) {
          const sted = planSteder[(planPos + j) % n];
          sprunget++;
          skriv({ t: nu, hvor: "Laboratoriet", tekst: `${sted.navn} sprunget over · maskinen står`, niveau: "info" });
        }
        const sted = planSteder[(planPos + i) % n];
        planPos = (planPos + i + 1) % n;
        const m = maskiner.find((x) => x.m.id === sted.maskine)!;
        const { s: st, kasse } = stroemVed(sted, nu);
        ctIgang = {
          nr: ++proeveNr, sted, taget: nu, svarT: nu + PROEVER.ct.minutter * 60_000, kasse,
          somSat: m.indstilling ? staarSomSat(m) : true, ct: ctProeve(st, parti, rl), videometer: null,
        };
        ctTaget++;
        skriv({ t: nu, hvor: "Laboratoriet", tekst: `CT · ${sted.navn} taget`, niveau: "info" });
      }
    }
    if (O && flyder && !vmIgang) {
      const kasse = kasseFra.length - 1;
      if (kasse >= vmNaesteKasse) {
        vmNaesteKasse = kasse + PROEVER.videometer.hverKasse;
        vmIgang = {
          nr: ++proeveNr, sted: VIDEOMETER, taget: nu, svarT: nu + PROEVER.videometer.minutter * 60_000, kasse,
          somSat: true, ct: null, videometer: videometerProeve(parti.kasser[Math.min(kasse, parti.kasser.length - 1)], parti, rl),
        };
        vmTaget++;
        skriv({ t: nu, hvor: "Laboratoriet", tekst: `Videometer · kasse ${kasse + 1} taget`, niveau: "info" });
      }
    }

    // --- Kæden --------------------------------------------------------------
    // Hvert signal gemmes fire gange i sekundet. Rækkerne går gennem
    // kobleren og edge og skal skrives i databasen. Kan databasen ikke
    // følge med, hober de sig op i edge's buffer; er bufferen fuld, tabes de.
    // Signalerne er kanalerne, hallen, flowet og ét driftssignal pr. maskine —
    // det, agenterne beder om. Samme målere, som fremskrivningen sætter i
    // OT-laget; her tælles tallene, de sender, ikke kasserne.
    const signaler = maskiner.reduce((n, s) => n + s.kanaler.length + s.m.wIds.length, 0) + hal.length + 1;
    // Med en ordre kan Dataagenten have sænket prøveraten på nogle signaler.
    const raekkerPrS = O ? planMed(antal, proeveTrin).raekkerPrS : signaler * KAEDE.proeverPrS;
    const forespoergsler = Math.ceil((signaler * KAEDE.registreProSignal) / KAEDE.registreProForespoergsel);
    const pollMs = forespoergsler * KAEDE.msProForespoergsel + Math.round(Math.abs(gauss(r)) * 2);

    // Episoden: databasen skriver langsommere en periode.
    if (foersteT === null) foersteT = nu;
    const siden = (nu - foersteT) / 1000 - FLASKEHALS.foersteS;
    // Med en ordre kommer episoderne tilfældigt, i simuleret tid.
    if (O) {
      if (episodeTil === null && fase !== "faerdig" && r() < dt / SIMULERING.flaskehalsHverS) {
        episodeTil = nu + SIMULERING.flaskehalsVarighedS * 1000;
        mssqlEpisoder++;
      }
      if (episodeTil !== null && nu >= episodeTil) episodeTil = null;
    }
    const episode = tvungenFlaskehals
      || (O ? episodeTil !== null : siden >= 0 && siden % FLASKEHALS.hverS < FLASKEHALS.varighedS);
    const dbKapacitet = KAEDE.dbKapacitet * (episode ? FLASKEHALS.kapacitetAndel : 1);

    if (episode && !iEpisode) {
      skriv({ t: nu, hvor: "MSSQL", tekst: `Skriver langsommere · ${FLASKEHALS.aarsag}`, niveau: "advarsel" });
    }
    if (!episode && iEpisode) {
      skriv({ t: nu, hvor: "MSSQL", tekst: "Kapacitet tilbage", niveau: "info" });
      indhentFra = nu;
    }
    iEpisode = episode;

    const ind = raekkerPrS * dt;
    modtaget += ind;
    // Databasen skriver det, der kommer, plus det, der venter — op til loftet.
    const skrives = Math.min(koe + ind, dbKapacitet * dt);
    skrevetIalt += skrives;
    koe += ind - skrives;
    if (koe > KAEDE.buffer) {
      // Loggen nævner leddet ved skærmens navn. Edge hedder Server på HUD'en.
      if (tabt === 0) skriv({ t: nu, hvor: "Server", tekst: "Buffer fuld · data tabes", niveau: "alarm" });
      tabt += koe - KAEDE.buffer;
      koe = KAEDE.buffer;
    }
    // Hvor langt bagud: den ældste række i køen, ved den fart databasen skriver.
    const forsinkelseS = koe > 0.5 ? koe / dbKapacitet : 0;
    maksForsinkelse = Math.max(maksForsinkelse, forsinkelseS);

    // Kædevagten: kan jeg stole på data lige nu? Ikke hvis de er forsinkede.
    if (forsinkelseS > FLASKEHALS.forsinkelseAlarmS && !alarmeret) {
      alarmeret = true;
      skriv({ t: nu, hvor: "Kædevagt", tekst: `Data ${Math.round(forsinkelseS)} s forsinket`, niveau: "alarm" });
    }
    if (koe <= 0.5 && indhentFra !== null) {
      skriv({ t: nu, hvor: "MSSQL", tekst: `Indhentet · ${Math.round((nu - indhentFra) / 1000)} s`, niveau: "info" });
      indhentFra = null;
      alarmeret = false;
    }

    // Kædevagten kører hvert kvarter på uret — samme kadence som i agents.ts.
    // Den melder det, den ser: svarer leddene, men halter data, er det ikke
    // "kæden svarer" — så kan man ikke stole på tallene lige nu.
    const kvarter = Math.floor(nu / 900_000);
    if (kvarter !== sidsteVagt) {
      if (sidsteVagt !== -1) {
        skriv(forsinkelseS >= 1
          ? { t: nu, hvor: "Kædevagt", tekst: `Kæden svarer · ${Math.round(forsinkelseS)} s bagud`, niveau: "advarsel" }
          : { t: nu, hvor: "Kædevagt", tekst: "Kæden svarer", niveau: "info" });
      }
      sidsteVagt = kvarter;
    }

    const led: KaedeLed[] = [
      {
        id: "kobler",
        udnyttelse: pollMs / KAEDE.cyklusMs,
        pladsTil: Math.floor(
          (KAEDE.cyklusMs / KAEDE.msProForespoergsel) * KAEDE.registreProForespoergsel / KAEDE.registreProSignal,
        ),
      },
      {
        id: "edge",
        udnyttelse: raekkerPrS / KAEDE.edgeKapacitet,
        pladsTil: Math.floor(KAEDE.edgeKapacitet / KAEDE.proeverPrS),
      },
      {
        id: "mssql",
        // Efterspørgslen er det, der kommer ind — ikke det, der når at blive
        // skrevet. Ellers ville en flaskehals aldrig kunne ses som en.
        udnyttelse: raekkerPrS / dbKapacitet,
        pladsTil: Math.floor(dbKapacitet / KAEDE.proeverPrS),
      },
    ];
    // Flaskehalsen er det led, der ikke kan følge med — og står der en kø,
    // er det den, selv om kapaciteten lige er kommet tilbage.
    const overbelastet = led.filter((l) => l.udnyttelse >= 1).sort((a, b) => b.udnyttelse - a.udnyttelse)[0];
    const flaskehals = overbelastet?.id ?? (koe > 0.5 ? "mssql" : null);


    // --- Driftsagenten -----------------------------------------------------
    // Den ser på det samme som skærmen og beslutter, om et spor skal stoppes.
    // Den handler ikke på én prøve, og den handler ikke på data, den ikke
    // kan stole på: halter kæden, holder den sine beslutninger, til den kan
    // se igen. Den stopper ikke linjen for en langsom database — anlægget
    // kører fint; det er dens eget syn, der er forsinket.
    if (ai) {
      const blind = forsinkelseS > FLASKEHALS.forsinkelseAlarmS;
      if (blind && !holder) {
        holder = true;
        skriv({ t: nu, hvor: "Driftsagent", tekst: `Holder · data ${Math.round(forsinkelseS)} s bagud`, niveau: "advarsel", ai: true });
      }
      if (!blind && holder) {
        holder = false;
        skriv({ t: nu, hvor: "Driftsagent", tekst: "Ser igen", niveau: "info", ai: true });
      }

      if (!holder) {
        for (const lane of lanes) {
          const st = spor.get(lane)!;
          const liste = iSpor.get(lane)!;
          if (!st.stoppet) {
            const aarsag = aarsagI(liste);
            const noegle = `stop:${lane}`;
            if (!aarsag) { overvejer.delete(noegle); continue; }
            const fra = overvejer.get(noegle) ?? nu;
            overvejer.set(noegle, fra);
            if (nu - fra < DRIFTSAGENT.overvejS * 1000) continue;
            overvejer.delete(noegle);
            st.stoppet = true;
            st.aarsag = aarsag;
            st.siden = nu;
            beslutninger++;
            skriv({ t: nu, hvor: "Driftsagent", tekst: `Stopper spor ${lane} · ${aarsag.tekst}`, niveau: "advarsel", ai: true });
            if (O) {
              sporStop.push({ lane, fra: nu, til: null, aarsag: aarsag.tekst });
              sket.push({ type: "sporStop", lane, aarsag });
            }
          } else {
            const a = st.aarsag!;
            const s = maskiner.find((x) => x.m.id === a.maskine)!;
            const temp = s.kanaler.find((k) => k.spec.id === "froetemp")?.x;
            const klar = a.type === "ophobning"
              ? s.stopTil === null
              : s.varmeTil === null && temp !== undefined && temp <= DRIFTSAGENT.froeStartC;
            const laenge = nu - (st.siden ?? nu) >= DRIFTSAGENT.mindsteStopS * 1000;
            if (!klar || !laenge) continue;
            const driftTekst = `Starter spor ${lane} · ${a.type === "ophobning" ? `${s.kort} kører igen` : `frø ${fmtTal(temp!, 1)} °C`}`;
            if (O) {
              // Med en ordre er det Operatøragentens beslutning, hvordan — og
              // om — sporet startes. Det står, til den har besluttet.
              if (genstartVenter.has(lane) || (venterTil.get(lane) ?? 0) > nu) continue;
              genstartVenter.add(lane);
              sket.push({
                type: "sporKlar", lane, driftTekst,
                hvad: a.type === "ophobning" ? `${s.kort} kører igen` : `Frøet er kølet til ${fmtTal(temp!, 1)} °C`,
                fyld: s.fyld,
              });
              continue;
            }
            st.stoppet = false;
            st.aarsag = null;
            st.siden = null;
            beslutninger++;
            // Sporet starter forfra og skal have sin indkøringstid.
            for (const x of liste) x.startet = nu;
            skriv({ t: nu, hvor: "Driftsagent", tekst: driftTekst, niveau: "info", ai: true });
          }
        }

        // Står begge spor, er der ingen steder at sende materialet hen.
        const alleStaar = lanes.length > 0 && lanes.every((l) => spor.get(l)!.stoppet);
        if (alleStaar && !indgangStoppet) {
          indgangStoppet = true;
          beslutninger++;
          skriv({ t: nu, hvor: "Driftsagent", tekst: "Stopper indgangen · begge spor står", niveau: "advarsel", ai: true });
        }
        if (!alleStaar && indgangStoppet) {
          indgangStoppet = false;
          beslutninger++;
          for (const x of maskiner) if (!x.m.lane) x.startet = nu;
          const aabne = lanes.filter((l) => !spor.get(l)!.stoppet).map((l) => `spor ${l}`).join(" og ");
          skriv({ t: nu, hvor: "Driftsagent", tekst: `Starter indgangen · ${aabne} kører`, niveau: "info", ai: true });
        }
      }
    }

    const koerende = maskiner.filter(koererNu).length;
    const tid = maskiner.reduce((n, s) => n + s.totalMs, 0);
    const koert = maskiner.reduce((n, s) => n + s.koertMs, 0);

    // --- Agenterne imellem ------------------------------------------------------
    // Reglerne afgør, hvornår en agent har noget at sige. Hvad den siger — og
    // hvad den beslutter, når der er noget at beslutte — er Claude's, når der
    // tænkes med Claude, og skabelonens ellers.
    if (O && ai) {
      const andet = (l: string) => lanes.find((x) => x !== l) ?? l;
      const halvt = O.nominalTPrT * (SIM.flowNominal / 100) / 2;

      /** Start et spor igen, bagfra eller alle på én gang. Driftsagent udfører. */
      const genstart = (lane: string, maade: "bagfra" | "alle", t: number, driftTekst: string) => {
        const st = spor.get(lane)!;
        const liste = iSpor.get(lane)!;
        st.stoppet = false;
        st.aarsag = null;
        st.siden = null;
        beslutninger++;
        // Er ordren ved at løbe tom, startes intet bagfra: planen stopper
        // sporet om lidt. Det, der ikke er slukket endnu, kører igen — og er
        // på vej op i fart, ikke for langsomt.
        if (fase === "udloeb" || fase === "faerdig") {
          for (const x of liste) if (!x.slukket) x.startet = t;
          const aaben = sporStop.find((p) => p.lane === lane && p.til === null);
          if (aaben) aaben.til = t;
          return;
        }
        // Bagfra: det sidste trin først. Sporets første maskine — den, fordeleren
        // fodrer — starter sidst, så ingen buffer fyldes, før maskinen efter
        // den kører. Alle på én gang: nu.
        const trin = [...new Set(liste.map((x) => x.m.step))].sort((a, b) => b - a);
        for (const x of liste) {
          x.slukket = true;
          x.startVed = maade === "alle" ? t : t + trin.indexOf(x.m.step) * (SIMULERING.trinS / 3) * 1000;
        }
        genstarter.set(lane, t);
        const aaben = sporStop.find((p) => p.lane === lane && p.til === null);
        if (aaben) aaben.til = t;
        skriv({ t, hvor: "Driftsagent", tekst: `${driftTekst}${maade === "alle" ? " · alle på én gang" : " · bagfra"}`, niveau: "info", ai: true });
      };

      for (const e of sket) {
        if (e.type === "maskinstop") {
          const s = e.s;
          maskinstop++;
          const v = s.varslet;
          s.varslet = null;
          const diagnose = v
            ? `Varslet: ${v.label.toLowerCase()} ${v.tekst} før stoppet, normalt ${v.normalt}.`
            : "Intet varsel i signalerne før stoppet — sandsynligvis elektrisk.";
          const varsel = v ? { kanal: v.label, vaerdiFoerStop: v.tekst, normalt: v.normalt } : "intet varsel i signalerne";
          if (s.m.lane && s.fyld !== null) {
            const hvem = AGENT.linje(s.m.lane);
            taenk({
              agent: hvem,
              spoergsmaal: `${s.kort} i dit spor er lige stoppet. Hvad ser du i tallene, og hvad betyder det?`,
              situation: {
                maskine: s.kort, spor: s.m.lane, bufferForanPct: Math.round(s.fyld),
                bufferFyldesPctPrS: TILLOEB.fyldPrS, fuldOmCaS: Math.round((100 - s.fyld) / TILLOEB.fyldPrS),
                driftsagentStopperSporetVedPct: DRIFTSAGENT.bufferStopPct, foerStoppet: varsel,
              },
              handlinger: ["ingen"], modtagere: [AGENT.operatoer],
              skabelon: [{
                fra: hvem, til: AGENT.operatoer, type: "iagttagelse",
                tekst: `${s.kort} står. Bufferen foran er ${tal(s.fyld)} % og fyldes.`,
                grund: `${diagnose} Fuld om ca. ${tal((100 - s.fyld) / TILLOEB.fyldPrS)} s, hvis sporet kører videre.`,
              }],
              standard: "ingen",
            }, nu);
          } else {
            sig({ fra: AGENT.drift, til: AGENT.operatoer, type: "iagttagelse", tekst: `${s.kort} står — der kommer intet materiale ind.`, grund: diagnose }, nu);
            taenk({
              agent: AGENT.operatoer,
              spoergsmaal: `${s.kort} på fællesstrækket før fordeleren er stoppet. Fortæl operatøren, hvad det betyder.`,
              situation: { maskine: s.kort, foerStoppet: varsel, sporeneKoererTomme: true, materialeInd: "intet, til maskinen kører igen" },
              handlinger: ["ingen"], modtagere: ["Operatør"],
              skabelon: [{
                fra: AGENT.operatoer, til: "Operatør", type: "rapport",
                tekst: `Indgangen står: ${s.kort}. Sporene kører videre tomme.`,
                grund: "Der er intet at stoppe for — et spor uden materiale fylder ingen buffer.",
              }],
              standard: "ingen",
            }, nu);
          }
        } else if (e.type === "sporStop") {
          const graense = e.aarsag.type === "ophobning" ? `${DRIFTSAGENT.bufferStopPct} %` : `${DRIFTSAGENT.froeStopC} °C`;
          sig({ fra: AGENT.drift, til: AGENT.operatoer, type: "handling", tekst: `Stopper spor ${e.lane}.`, grund: `${e.aarsag.tekst} — grænsen er ${graense}.` }, nu);
          taenk({
            agent: AGENT.operatoer,
            spoergsmaal: `Driftsagent har stoppet spor ${e.lane}. Fortæl operatøren, hvad der sker, og hvad det koster.`,
            situation: {
              spor: e.lane, aarsag: e.aarsag.tekst, graense, andetSpor: andet(e.lane),
              gennemloebNuCaTPrT: Math.round(halvt * 100) / 100, gennemloebNormaltTPrT: Math.round(halvt * 200) / 100,
            },
            handlinger: ["ingen"], modtagere: ["Operatør"],
            skabelon: [{
              fra: AGENT.operatoer, til: "Operatør", type: "rapport",
              tekst: `Spor ${e.lane} er stoppet: ${e.aarsag.tekst}. Spor ${andet(e.lane)} tager alt.`,
              grund: `Gennemløbet falder til ca. ${tal(halvt, 2)} t/hr — ikke til nul. Sporet startes igen, når årsagen er væk.`,
            }],
            standard: "ingen",
          }, nu);
        } else if (e.type === "sporKlar") {
          const lane = e.lane;
          const buffere = iSpor.get(lane)!.filter((x) => x.fyld !== null).map((x) => ({ maskine: x.kort, pct: Math.round(x.fyld!) }));
          const trinS = SIMULERING.trinS / 3;
          taenk({
            agent: AGENT.operatoer,
            spoergsmaal: `Årsagen til stoppet i spor ${lane} er væk: ${e.hvad}. Hvordan skal sporet startes igen?`,
            situation: {
              spor: lane, hvad: e.hvad, buffere,
              indkoering: `en maskine tager ikke fra sin buffer de første ${INDKOERING_S / 2} s efter start`,
              muligheder: {
                bagfra: `sidste maskine først, ${trinS} s mellem hver; fordeleren fodrer sporet til sidst`,
                alle_paa_en_gang: "alle starter nu; buffere fødes, mens maskinerne efter dem er i indkøring",
                vent: "vent 60 s og spørg igen",
              },
            },
            handlinger: ["bagfra", "alle_paa_en_gang", "vent"],
            modtagere: [AGENT.drift, "Operatør"],
            skabelon: [{
              fra: AGENT.operatoer, til: AGENT.drift, type: "beslutning",
              tekst: `Genstart spor ${lane} bagfra.`,
              grund: `${e.hvad}. ${e.fyld !== null && e.fyld > TILLOEB.normalPct + 5
                ? `Bufferen foran er ${tal(e.fyld)} % — bagfra er den tømt, før der fødes igen.`
                : "Bagfra fyldes ingen buffer, før maskinen efter den kører."}`,
            }],
            standard: "bagfra",
          }, nu, (h) => {
            genstartVenter.delete(lane);
            if (h === "vent") { venterTil.set(lane, sidsteNu + 60_000); return; }
            genstart(lane, h === "alle_paa_en_gang" ? "alle" : "bagfra", sidsteNu, e.driftTekst);
          });
        } else if (e.type === "sensorfejl") {
          sensorfejl++;
          taenk({
            agent: AGENT.data,
            spoergsmaal: "Flowmåleren FT-743 sender et signal uden for 4–20 mA. Hvad gør du med dataene, og hvad siger du til de andre?",
            situation: { maaler: "FT-743", signalMa: "under 3,6 — sensorfejl", summenAfFlow: "tæller ikke, mens måleren er ude", maskinerKoerer: `${koerende} af ${maskiner.length}` },
            handlinger: ["ingen"], modtagere: ["Alle", AGENT.operatoer],
            skabelon: [{ fra: AGENT.data, til: "Alle", type: "iagttagelse", tekst: "FT-743 er uden for 4–20 mA. Markeret som fejl.", grund: "Summen springer hullet over frem for at gætte på det." }],
            standard: "ingen",
          }, nu, () => taenk({
            agent: AGENT.operatoer,
            spoergsmaal: "Flowmåleren er ude. Fortæl operatøren, hvad det betyder for linjen og for prognosen.",
            situation: { maskinerKoerer: `${koerende} af ${maskiner.length}`, prognose: "står stille, til måleren er tilbage" },
            handlinger: ["ingen"], modtagere: ["Operatør"],
            skabelon: [{
              fra: AGENT.operatoer, til: "Operatør", type: "rapport", tekst: "Flowmåleren er ude. Linjen kører.",
              grund: `${koerende} af ${maskiner.length} maskiner melder, at de kører. Prognosen venter på måleren.`,
            }],
            standard: "ingen",
          }, sidsteNu));
        } else if (e.type === "sensorTilbage") {
          taenk({
            agent: AGENT.data,
            spoergsmaal: "Flowmåleren FT-743 er tilbage. Sig det til de andre, og hvad der mangler i dataene.",
            situation: { maaler: "FT-743", udeS: Math.round(e.varighedS), hulISummen: `${Math.round(e.varighedS)} s, ikke fyldt ud` },
            handlinger: ["ingen"], modtagere: ["Alle"],
            skabelon: [{ fra: AGENT.data, til: "Alle", type: "iagttagelse", tekst: `FT-743 er tilbage efter ${varighed(e.varighedS)}.`, grund: `${varighed(e.varighedS)} mangler i summen — de er ikke fyldt ud.` }],
            standard: "ingen",
          }, nu);
        } else if (e.type === "svar") {
          if (e.p.videometer) meldVideometer(e.p, nu);
          else meldCt(e.p, nu);
        }
      }

      // En anbefaling, ingen har taget stilling til, bortfalder.
      for (const an of anbefalinger) {
        if (an.status === "aaben" && nu - an.t > KASTEBORDET.anbefalingGyldigS * 1000) {
          an.status = "udloebet";
          anbefalIgenFra.set(an.maskine, nu + KASTEBORDET.roEfterNejS * 1000);
        }
      }

      // Et spor, der er startet igen, kører, når dets sidste maskine gør.
      for (const [lane, fra] of genstarter) {
        const liste = iSpor.get(lane)!;
        if (liste.some((x) => x.slukket)) continue;
        genstarter.delete(lane);
        const stop = [...sporStop].reverse().find((p) => p.lane === lane);
        const hoejeste = Math.max(...liste.map((x) => x.fyld ?? 0));
        sig({ fra: AGENT.drift, til: AGENT.operatoer, type: "rapport", tekst: `Spor ${lane} kører · ${liste.length} maskiner på ${varighed((nu - fra) / 1000)}.` }, nu);
        taenk({
          agent: AGENT.operatoer,
          spoergsmaal: `Spor ${lane} kører igen. Fortæl operatøren det kort.`,
          situation: {
            spor: lane, stodS: stop ? Math.round(((stop.til ?? nu) - stop.fra) / 1000) : null,
            aarsag: stop?.aarsag ?? null, hoejesteBufferNuPct: Math.round(hoejeste),
          },
          handlinger: ["ingen"], modtagere: ["Operatør"],
          skabelon: [{
            fra: AGENT.operatoer, til: "Operatør", type: "rapport", tekst: `Spor ${lane} kører igen.`,
            grund: stop ? `Stod ${varighed(((stop.til ?? nu) - stop.fra) / 1000)}: ${stop.aarsag}.` : undefined,
          }],
          standard: "ingen",
        }, nu);
      }

      // En linjeagent ser et stop komme: en kanal, der løber langt ud af sit bånd.
      for (const s of maskiner) {
        const indkoerer = s.startet !== null && nu - s.startet < INDKOERING_S * 1000;
        if (!koererNu(s) || indkoerer) { s.afvigFra = null; continue; }
        // Kun i den retning, der er farlig: en motor, der er kold efter et
        // stop, varsler ingenting. Retningen er kanalens grænser.
        const ude = s.kanaler
          .filter((k) => OVERVAAGET.has(k.spec.id) && k.spec.spredning > 0)
          .map((k) => {
            const z = (k.x - k.spec.nominal) / k.spec.spredning;
            const op = k.spec.alarmHoej !== undefined;
            const ned = k.spec.alarmLav !== undefined;
            return { k, z: (op && z > 0) || (ned && z < 0) ? z : 0 };
          })
          .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))[0];
        if (!ude || Math.abs(ude.z) < VARSEL_Z) {
          if (!ude || Math.abs(ude.z) < 2) s.afvigMeldt = false;
          s.afvigFra = null;
          continue;
        }
        s.afvigFra ??= nu;
        if (s.afvigMeldt || nu - s.afvigFra < 5000) continue;
        s.afvigMeldt = true;
        const { k, z } = ude;
        const tekst = `${s.kort}: ${k.spec.label.toLowerCase()} ${fmt(k.x, k.spec)} ${k.spec.unit}, normalt ${fmt(k.spec.nominal, k.spec)}.`;
        const grund = `${tal(Math.abs(z), 1)} gange det normale udsving og på vej væk. Det plejer at komme før et stop.`;
        const operatoeren = () => taenk({
          agent: AGENT.operatoer,
          spoergsmaal: `${s.kort} ser ud til at være på vej mod et stop. Hvad skal operatøren gøre?`,
          situation: {
            maskine: s.kort, spor: s.m.lane ?? "fællesstrækket", kanal: k.spec.label,
            vaerdi: `${fmt(k.x, k.spec)} ${k.spec.unit}`, normalt: `${fmt(k.spec.nominal, k.spec)} ${k.spec.unit}`,
            hvisDenStopper: s.m.lane
              ? `Driftsagent stopper spor ${s.m.lane}, og spor ${andet(s.m.lane)} tager over`
              : "der kommer intet materiale ind på linjen",
          },
          handlinger: ["ingen"], modtagere: ["Operatør"],
          skabelon: [{
            fra: AGENT.operatoer, til: "Operatør", type: "forslag", tekst: `Se på ${s.kort} nu, før den stopper.`,
            grund: s.m.lane
              ? `Står den, stopper Driftsagent spor ${s.m.lane}, og spor ${andet(s.m.lane)} tager over.`
              : "Står den, kommer der intet materiale ind på linjen.",
          }],
          standard: "ingen",
        }, sidsteNu);
        if (s.m.lane) {
          const hvem = AGENT.linje(s.m.lane);
          taenk({
            agent: hvem,
            spoergsmaal: `En kanal på ${s.kort} er langt ude af sit normale bånd. Hvad ser du, og hvad betyder det?`,
            situation: {
              maskine: s.kort, kanal: k.spec.label, vaerdi: `${fmt(k.x, k.spec)} ${k.spec.unit}`,
              normalt: `${fmt(k.spec.nominal, k.spec)} ${k.spec.unit}`, gangeDetNormaleUdsving: Math.round(Math.abs(z) * 10) / 10,
              alarmgraense: k.spec.alarmHoej ?? k.spec.alarmLav ?? null,
            },
            handlinger: ["ingen"], modtagere: [AGENT.operatoer],
            skabelon: [{ fra: hvem, til: AGENT.operatoer, type: "iagttagelse", tekst, grund }],
            standard: "ingen",
          }, nu, operatoeren);
        } else {
          // Fællesstrækket ejer Driftsagent. Den melder efter reglerne.
          sig({ fra: AGENT.drift, til: AGENT.operatoer, type: "iagttagelse", tekst, grund }, nu);
          operatoeren();
        }
      }

      // Friktion: en linjeagent ser frøet blive varmt og regner på, hvornår.
      // Den melder først, når temperaturen har været tydeligt ude i et stykke
      // tid — frøets temperatur vandrer af sig selv, og et alarmsystem, der
      // melder hver gang, lærer folk at se bort fra det.
      const froeGraense = (k: KanalTilstand) => k.spec.nominal + 4 * k.spec.spredning;
      for (const s of maskiner) {
        const k = s.kanaler.find((x) => x.spec.id === "froetemp");
        if (!k) continue;
        const f = froe.get(s.m.id) ?? { punkter: [], meldt: false, udeFra: null as number | null };
        f.punkter.push({ t: nu, x: k.x });
        while (f.punkter.length > 1 && nu - f.punkter[0].t > 60_000) f.punkter.shift();
        const foerst = f.punkter[0];
        const rate = nu > foerst.t ? (k.x - foerst.x) / ((nu - foerst.t) / 60_000) : 0;
        f.udeFra = koererNu(s) && k.x >= froeGraense(k) ? f.udeFra ?? nu : null;
        if (!f.meldt && f.udeFra !== null && nu - f.udeFra >= 20_000 && rate > 0.1) {
          f.meldt = true;
          const min = (DRIFTSAGENT.froeStopC - k.x) / rate;
          const hvem = AGENT.linje(s.m.lane ?? "N");
          taenk({
            agent: hvem,
            spoergsmaal: `Frøet i ${s.kort} bliver varmere. Hvad ser du, og hvornår når det grænsen?`,
            situation: {
              maskine: s.kort, froeC: Math.round(k.x * 10) / 10, stigerCPrMin: Math.round(rate * 10) / 10,
              normaltC: k.spec.nominal, driftsagentStopperSporetVedC: DRIFTSAGENT.froeStopC,
              naarGraensenOmCaS: Math.round(Math.max(0, min * 60)), spireevnenTagerSkadeOverC: DRIFTSAGENT.froeStopC,
            },
            handlinger: ["ingen"], modtagere: [AGENT.operatoer],
            skabelon: [{
              fra: hvem, til: AGENT.operatoer, type: "iagttagelse",
              tekst: `Frøet i ${s.kort} er ${fmtTal(k.x, 1)} °C og stiger ${tal(rate, 1)} °C/min.`,
              grund: `Rammer ${DRIFTSAGENT.froeStopC} °C om ca. ${varighed(Math.max(0, min * 60))}. Så stopper Driftsagent sporet.`,
            }],
            standard: "ingen",
          }, nu, () => taenk({
            agent: AGENT.operatoer,
            spoergsmaal: `Friktion i ${s.kort}: frøet bliver varmt. Hvad skal operatøren gøre?`,
            situation: {
              maskine: s.kort, froeC: Math.round(k.x * 10) / 10, grænseC: DRIFTSAGENT.froeStopC,
              hvemStopper: "Driftsagent stopper sporet ved grænsen — det skal operatøren ikke",
              mulighedForÅrsag: "slibestenen",
            },
            handlinger: ["ingen"], modtagere: ["Operatør"],
            skabelon: [{
              fra: AGENT.operatoer, til: "Operatør", type: "forslag", tekst: `Friktion i ${s.kort}: tjek slibestenen, når sporet står.`,
              grund: `Spireevnen tager skade over ${DRIFTSAGENT.froeStopC} °C. Stoppet klarer Driftsagent; årsagen skal et menneske se på.`,
            }],
            standard: "ingen",
          }, sidsteNu));
        }
        if (f.meldt && k.x < DRIFTSAGENT.froeStartC - 1) f.meldt = false;
        froe.set(s.m.id, f);
      }

      // Kæden: Kædevagten ser det, Dataagenten foreslår, Operatøragenten
      // afvejer og beslutter.
      const over = raekkerPrS > dbKapacitet;
      overbelastFra = over ? overbelastFra ?? nu : null;
      if (vagtMeldt === null && overbelastFra !== null && nu - overbelastFra >= 2000) {
        vagtMeldt = nu;
        const vokser = raekkerPrS - dbKapacitet;
        sig({
          fra: AGENT.vagt, til: AGENT.data, type: "iagttagelse",
          tekst: `MSSQL skriver ${tal(dbKapacitet)} rækker/s. Vi sender ${tal(raekkerPrS)}.`,
          grund: `Køen vokser ${tal(vokser)} rækker/s. Om et minut er data ${tal((vokser * 60) / dbKapacitet)} s bagud, og så holder Driftsagent.`,
        }, nu);
      }
      if (vagtMeldt !== null && forslag === null && !dataVenter && proeveTrin === 0 && nu - vagtMeldt >= 3000) {
        const valgt = vaelgPlan(antal, dbKapacitet);
        const trin = valgt.alle.map((p, i) => `${i + 1} trin ${tal(p.raekkerPrS)}`).join(", ");
        dataVenter = true;
        taenk({
          agent: AGENT.data,
          spoergsmaal: "MSSQL kan ikke følge med. Hvad foreslår du Operatøragenten?",
          situation: {
            mssqlKanRaekkerPrS: dbKapacitet, mssqlKanNormaltRaekkerPrS: KAEDE.dbKapacitet,
            viSenderRaekkerPrS: raekkerPrS, koeRaekker: Math.round(koe),
            dataBagudS: Math.round(forsinkelseS * 10) / 10, driftsagentHolderVedS: FLASKEHALS.forsinkelseAlarmS,
            signalerPrGruppe: antal, proeverPrSekundNu: PROEVERATE.normal,
            trin: PROEVERATE.trin.map((t, i) => ({ handling: `trin_${i + 1}`, hvad: `${t.navn} (sammen med trinene før)`, raekkerPrS: valgt.alle[i].raekkerPrS })),
            planenSkalLiggeUnderPct: Math.round(PROEVERATE.luft * 100),
            roeresAldrig: "flow og hastigheder — dem styrer Driftsagent efter",
            foedningPct: Math.round(foedning * 100),
          },
          handlinger: ["trin_1", "trin_2", "trin_3", "ingen"], modtagere: [AGENT.operatoer],
          skabelon: [{
            fra: AGENT.data, til: AGENT.operatoer, type: "forslag",
            tekst: `Sænk prøveraten: ${PROEVERATE.trin.slice(0, valgt.plan.trin).map((t) => t.navn.toLowerCase()).join(", ")}.`,
            grund: `Rækker/s ved ${trin} — MSSQL kan ${tal(dbKapacitet)}. ${valgt.nok
              ? `${valgt.plan.trin} trin giver luft.`
              : "Selv alle trin er ikke nok; køen vil stadig vokse."} Flow og hastigheder røres ikke.`,
          }],
          standard: `trin_${valgt.plan.trin}`,
        }, nu, (h) => {
          dataVenter = false;
          // Intet forslag: spørg igen om et minut, hvis det ikke er gået over.
          if (!h.startsWith("trin_")) { vagtMeldt = sidsteNu + 57_000; return; }
          const n = Math.min(PROEVERATE.trin.length, Math.max(1, Number(h.slice(5)) || valgt.plan.trin));
          forslag = { t: sidsteNu, plan: planMed(antal, n), alle: valgt.alle, nok: planMed(antal, n).raekkerPrS <= dbKapacitet * PROEVERATE.luft };
        });
      }
      if (forslag !== null && proeveTrin === 0 && !godkendVenter && nu - forslag.t >= 2000) {
        const f = forslag;
        const foer = raekkerPrS;
        // Prisen regnes af linjens normale gennemløb, ikke af øjeblikkets —
        // under en opstart løber der endnu intet, og så ville den se gratis ud.
        const tab = O.nominalTPrT * (SIM.flowNominal / 100) * 0.4;
        godkendVenter = true;
        taenk({
          agent: AGENT.operatoer,
          spoergsmaal: `Dataagent foreslår at sænke prøveraten ${f.plan.trin} trin. Hvad beslutter du?`,
          situation: {
            forslag: { trin: f.plan.trin, raekkerPrSBagefter: f.plan.raekkerPrS },
            mssqlKanRaekkerPrS: dbKapacitet, viSenderNuRaekkerPrS: foer, signaler,
            dataBagudS: Math.round(forsinkelseS * 10) / 10, driftsagentHolderVedS: FLASKEHALS.forsinkelseAlarmS,
            alternativ_skru_ned: {
              foedningPct: 60, kosterCaTPrT: Math.round(tab * 100) / 100, faerreRaekker: 0,
              hvorfor: "rækkerne kommer fra antallet af signaler og prøveraten, ikke fra tons",
            },
          },
          handlinger: ["godkend", "skru_ned", "afvis"], modtagere: [AGENT.data, "Alle"],
          skabelon: [{
            fra: AGENT.operatoer, til: AGENT.data, type: "beslutning", tekst: "Godkendt.",
            grund: `Overvejet og afvist: at skrue linjen ned. Rækkerne kommer fra ${signaler} signaler, ikke fra tons — 40 % mindre fødning ville koste ${tal(tab, 2)} t/hr og give 0 færre rækker.`,
          }],
          standard: "godkend",
        }, nu, (h) => {
          godkendVenter = false;
          forslag = null;
          if (h === "godkend") {
            proeveTrin = f.plan.trin;
            beslutninger++;
            sig({
              fra: AGENT.data, til: "Alle", type: "handling",
              tekst: `Prøverate sænket · ${tal(foer)} → ${tal(f.plan.raekkerPrS)} rækker/s.`,
              grund: "Flow og hastigheder gemmes stadig fire gange i sekundet — dem styrer Driftsagent efter.",
            }, sidsteNu);
            skriv({ t: sidsteNu, hvor: AGENT.data, tekst: `Prøverate sænket · ${tal(f.plan.raekkerPrS)} rækker/s`, niveau: "advarsel", ai: true });
          } else if (h === "skru_ned") {
            // Operatøragenten valgte tons frem for prøverate. Det koster
            // gennemløb og giver ingen færre rækker — og Dataagenten bliver
            // spurgt igen, for køen vokser stadig.
            foedning = 0.6;
            beslutninger++;
            skriv({ t: sidsteNu, hvor: AGENT.operatoer, tekst: "Fødning skruet ned · 60 %", niveau: "advarsel", ai: true });
            vagtMeldt = sidsteNu;
          } else {
            vagtMeldt = sidsteNu + 57_000;
          }
        });
      }
      if (proeveTrin > 0 && koe <= 0.5 && !koeMeldt) {
        koeMeldt = true;
        sig({ fra: AGENT.vagt, til: AGENT.data, type: "iagttagelse", tekst: "Køen er skrevet. Data er i tide igen." }, nu);
      }
      // Tilbage til fuld rate og fuld fødning, når databasen kan igen og har
      // kunnet et stykke tid.
      if (proeveTrin > 0 || foedning < 1) {
        roligFra = !episode && koe <= 0.5 ? roligFra ?? nu : null;
        if (roligFra !== null && nu - roligFra >= 30_000) {
          const fuld = planMed(antal, 0).raekkerPrS;
          if (proeveTrin > 0) {
            proeveTrin = 0;
            beslutninger++;
            sig({
              fra: AGENT.data, til: AGENT.operatoer, type: "handling",
              tekst: `MSSQL skriver ${tal(KAEDE.dbKapacitet)} rækker/s igen. Prøverate tilbage på ${PROEVERATE.normal} pr. s.`,
              grund: `Med fuld rate sendes ${tal(fuld)} rækker/s — ${tal((fuld / KAEDE.dbKapacitet) * 100)} % af det, den kan.`,
            }, nu);
            skriv({ t: nu, hvor: AGENT.data, tekst: "Prøverate tilbage på normal", niveau: "info", ai: true });
          }
          if (foedning < 1) {
            foedning = 1;
            skriv({ t: nu, hvor: AGENT.operatoer, tekst: "Fødning tilbage · 100 %", niveau: "info", ai: true });
          }
          vagtMeldt = null;
          forslag = null;
          koeMeldt = false;
          roligFra = null;
        }
      } else if (vagtMeldt !== null && forslag === null && !dataVenter && !over && koe <= 0.5 && vagtMeldt <= nu) {
        // Gik det over, før Dataagenten nåede at foreslå noget, er der intet at gøre.
        vagtMeldt = null;
      }
    }

    // --- Ordren slutter, når alt er stoppet efter planen --------------------------
    if (O && fase === "udloeb" && maskiner.every((s) => s.slukket)) {
      fase = "faerdig";
      slutT = nu;
      skriv({ t: nu, hvor: "Ordre", tekst: `${O.ordreNr} færdig · ${varighed((nu - ordreStart!) / 1000)}`, niveau: "info" });
      const linjer = ordreRapport({
        ordreNr: O.ordreNr, kg: kgInd, kasser: kasserTippet, startT: ordreStart!, slutT: nu,
        oppetidPct: tid > 0 ? (koert / tid) * 100 : null,
        sporStop, maskinstop, mssqlEpisoder, maksForsinkelseS: maksForsinkelse, tabt: Math.round(tabt), sensorfejl,
        lab: {
          ct: ctTaget, videometer: vmTaget, sprunget, fremmedMaks,
          kraftigS: (kraftigMs + (kraftigFra !== null ? nu - kraftigFra : 0)) / 1000,
          produkt: lanes.map((l) => {
            const b = (bordeI.get(l) ?? []).at(-1);
            const sv = b ? seneste.get(`${b.wIds[0]}:mainline`)?.ct ?? null : null;
            return { lane: l, multi: sv ? sv.bigf + sv.bigh : null };
          }),
        },
        beslutninger, beskeder: beskeder + 1,
      });
      // Tallene er regnskabets; ordene omkring dem er agentens.
      taenk({
        agent: AGENT.operatoer,
        spoergsmaal: `Ordre ${O.ordreNr} er færdig. Skriv rapporten til operatøren: hvad gik godt, hvad kostede, og hvad bør man se på til næste ordre?`,
        situation: { regnskab: linjer },
        handlinger: ["ingen"], modtagere: ["Operatør"],
        skabelon: [{ fra: AGENT.operatoer, til: "Operatør", type: "rapport", tekst: `Ordre ${O.ordreNr} er færdig.`, linjer }],
        standard: "ingen",
        bilag: linjer,
      }, nu);
    }

    // Det, der sker lige nu. Så længe listen ikke er tom, går tiden langsomt.
    const uro: Uro[] = [];
    if (O) {
      const u = (tekst: string, fejl = false) => uro.push({ tekst, fejl });
      if (fase === "opstart") u("Opstart");
      if (fase === "udloeb") u("Udløb");
      for (const l of lanes) if (spor.get(l)!.stoppet) u(`Spor ${l} står`);
      for (const [l] of genstarter) u(`Spor ${l} starter`);
      for (const s of maskiner) if (s.stopTil !== null) u(`${s.kort} står`, true);
      for (const s of maskiner) if (s.afvigMeldt) u(`Varsel ${s.kort}`);
      for (const [id, f] of froe) if (f.meldt) u(`Friktion ${maskiner.find((x) => x.m.id === id)!.kort}`);
      if (episode || koe > 0.5) u("MSSQL bagud");
      if (proeveTrin > 0) u("Prøverate sænket");
      if (sensorfejlTil !== null) u("FT-743 ude", true);
      for (const o of aabneOpgaver.values()) u(`${o.agent} tænker`);
      // En ny anbefaling bremser tiden et minut, så man når at se den. Står
      // den stadig åben, går tiden videre — den venter i panelet.
      for (const an of anbefalinger) if (an.status === "aaben" && nu - an.t < 60_000) u(`Anbefaling ${an.kort}`);
    }

    // Støjen i billedet trækkes her, i samme rækkefølge som altid, så et
    // skridt uden billede giver præcis det samme forløb som et med.
    const maStoej = fejl ? r() : 0;
    const msStoej = r();
    uroNu = uro.length > 0;
    if (!medBillede) return null;

    return {
      t: nu,
      simuleret: true,
      maskiner: maskiner.map((s) => {
        const koerer = koererNu(s);
        const kanaler = s.kanaler.map((k) => ({ spec: k.spec, value: k.x, alarm: k.alarm }));
        return {
          id: s.m.id,
          wIds: s.m.wIds,
          navn: s.m.name,
          kort: s.kort,
          lane: s.m.lane,
          koerer,
          // En maskine, der selv er gået i stå, er en fejl — også når dens
          // spor står. Kun de andre står på agentens beslutning eller plan.
          styret: s.stopTil === null && (styret(s) || s.slukket),
          planlagt: s.stopTil === null && s.slukket,
          fyld: s.fyld === null ? null : Math.round(s.fyld),
          kanaler,
          alarm: kanaler.some((k) => k.alarm),
        };
      }),
      hal: hal.map((k) => ({ spec: k.spec, value: k.x, alarm: k.alarm })),
      flowPct: fejl ? null : flow,
      gennemloeb,
      // Ved sensorfejl er det rå signal uden for sløjfen — det er fejlen.
      flowMa: fejl ? 3.2 + maStoej * 0.2 : maFromPercent(flow),
      laboratorie: {
        ct: {
          igang: ctIgang ? { sted: ctIgang.sted, taget: ctIgang.taget, svarT: ctIgang.svarT } : null,
          naeste: planSteder.length > 0 ? [0, 1, 2].map((i) => planSteder[(planPos + i) % planSteder.length]) : [],
          taget: ctTaget,
        },
        videometer: { igang: vmIgang ? { kasse: vmIgang.kasse ?? 0, taget: vmIgang.taget, svarT: vmIgang.svarT } : null, taget: vmTaget },
        seneste: [...seneste.values()],
        sprunget,
      },
      sortering: { ...sortering },
      kaede: {
        signaler,
        pollMs,
        cyklusMs: KAEDE.cyklusMs,
        raekkerPrS,
        dbKapacitet,
        dbNormal: KAEDE.dbKapacitet,
        koe: Math.round(koe),
        buffer: KAEDE.buffer,
        forsinkelseS,
        tabt: Math.round(tabt),
        modtaget,
        skrevetIalt,
        skrevet: Math.floor(skrevetStart + skrevetIalt),
        senesteMs: Math.round(forsinkelseS * 1000 + msStoej * 250),
        flaskehals,
        aarsag: episode ? FLASKEHALS.aarsag : null,
        led,
      },
      haendelser: [...log],
      oppetidPct: tid > 0 ? (koert / tid) * 100 : null,
      stop,
      koerende,
      ai: ai
        ? {
            tilstand: holder
              ? "holder"
              : indgangStoppet || lanes.some((l) => spor.get(l)!.stoppet) ? "handler" : "overvaager",
            spor: lanes.map((l) => {
              const st = spor.get(l)!;
              return { lane: l, stoppet: st.stoppet, aarsag: st.aarsag?.tekst ?? null, siden: st.siden };
            }),
            indgangStoppet,
            seneste: log.find((h) => h.ai) ?? null,
            beslutninger,
          }
        : null,
      samtale: [...samtale],
      opgaver: [...aabneOpgaver.values()].map(({ anvend: _, ...o }) => o),
      anbefalinger: anbefalinger.map((a) => ({ ...a })),
      indstillinger: Object.fromEntries(maskiner.filter((x) => x.indstilling).map((x) => [x.m.id, { ...x.indstilling! }])),
      ordre: O
        ? {
            ordreNr: O.ordreNr,
            fase,
            kgInd,
            estimeretKg: O.estimeretKg,
            kasserTippet,
            kasser: O.kasser,
            startT: ordreStart ?? nu,
            slutT,
            prognoseT: fase === "koerer" && koertFra !== null && !fejl
              ? prognose({ kgInd, estimeretKg: O.estimeretKg, koertFra, nu })
              : null,
            proeveTrin,
          }
        : null,
      uro,
    };
  }

  return {
    skridt: (dtMs, nu) => gaa(dtMs, nu, true)!,
    frem: (dtMs, nu) => { gaa(dtMs, nu, false); return uroNu; },
    svar: besvar,
    antalOpgaver: () => aabneOpgaver.size,
    udfoer: (id, hvem = "Operatør") => {
      const an = anbefalinger.find((x) => x.id === id);
      if (!an || an.status !== "aaben") return;
      if (an.parameter === "sortering") {
        const ny: Sortering = an.tilVaerdi === 1 ? "kraftig" : "normal";
        for (const l of Object.keys(sortering)) sortering[l] = ny;
        if (ny === "kraftig" && kraftigFra === null) kraftigFra = sidsteNu;
        if (ny === "normal" && kraftigFra !== null) { kraftigMs += sidsteNu - kraftigFra; kraftigFra = null; }
        an.status = "udfoert";
        an.af = hvem;
        an.udfoertT = sidsteNu;
        // Virkningen kan ikke gøres op: en CT-prøve er for lille til at se
        // de få foreign seeds, der slipper igennem. Den står som ventet.
        an.gjortOp = true;
        beslutninger++;
        const tekst = `${SORTERING_NAVN[an.fraVaerdi]} → ${SORTERING_NAVN[an.tilVaerdi]}`;
        sig({ fra: hvem, til: an.fra, type: "handling", kilde: "menneske", tekst: `Sortering på Carter og Alfa: ${tekst.toLowerCase()}.` }, sidsteNu);
        skriv({ t: sidsteNu, hvor: "Carter og Alfa", tekst: `Sortering ${tekst.toLowerCase()} · ${hvem}`, niveau: "info" });
        return;
      }
      const bord = maskiner.find((x) => x.m.id === an.maskine);
      if (!bord?.indstilling) return;
      an.status = "udfoert";
      an.af = hvem;
      an.udfoertT = sidsteNu;
      bord.indstilling[an.parameter] = an.tilVaerdi;
      aendret.set(an.maskine, sidsteNu);
      beslutninger++;
      const enhed = an.parameter === "tvaers" ? "°" : " %";
      const navn = an.parameter === "tvaers" ? "Tværhældning" : "Luft";
      sig({
        fra: hvem, til: an.fra, type: "handling", kilde: "menneske",
        tekst: `${navn} på ${an.kort}: ${tal(an.fraVaerdi, 1)} → ${tal(an.tilVaerdi, 1)}${enhed}.`,
      }, sidsteNu);
      skriv({ t: sidsteNu, hvor: an.kort, tekst: `${navn} ${tal(an.fraVaerdi, 1)} → ${tal(an.tilVaerdi, 1)}${enhed} · ${hvem}`, niveau: "info" });
    },
    afvis: (id, hvem = "Operatør") => {
      const an = anbefalinger.find((x) => x.id === id);
      if (!an || an.status !== "aaben") return;
      an.status = "afvist";
      an.af = hvem;
      anbefalIgenFra.set(an.maskine, sidsteNu + KASTEBORDET.roEfterNejS * 1000);
      const hvad = an.parameter === "sortering" ? "sorteringen på Carter og Alfa" : `${an.parameter === "tvaers" ? "tværhældningen" : "luften"} på ${an.kort}`;
      sig({ fra: hvem, til: an.fra, type: "beslutning", kilde: "menneske", tekst: `Afvist: ${hvad} bliver, som den er.` }, sidsteNu);
    },
  };
}
