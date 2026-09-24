// Agenternes samspil i ordresimuleringen: hvem siger hvad til hvem, og hvorfor.
//
// Beskederne er regler og skabeloner, ikke Claude. Der er ikke kaldt et API
// fra dette repo, og simuleringen lader ikke som om: hver besked er udledt af
// tallene i simuleringen i det øjeblik, den sendes, og loggen er mærket SIM.
// Det, der skal vises, er arbejdsdelingen — hvem ser hvad, hvem foreslår, hvem
// beslutter, og hvilke tal beslutningen hviler på.
import { PROEVERATE } from "../../data/fremskrivning";

export type BeskedType = "iagttagelse" | "forslag" | "beslutning" | "handling" | "rapport";

export interface Besked {
  /**
   * Løbenummer. Flere beskeder kan have samme tid — et svar kommer i samme
   * skridt som spørgsmålet — og så er det nummeret, der siger rækkefølgen.
   */
  nr: number;
  /** Simuleret tid, millisekunder siden epoch. */
  t: number;
  fra: string;
  /** En agent, "Alle", eller et menneske — se MENNESKER. */
  til: string;
  type: BeskedType;
  tekst: string;
  /** Tallene bag. En beslutning uden sin begrundelse er ikke til at stole på. */
  grund?: string;
  /** En rapport har flere linjer. */
  linjer?: string[];
  /**
   * Hvem der tænkte: Claude, eller reglerne og deres skabelon. Fladen
   * skal kunne se forskel — det er hele pointen med at køre dem rigtigt.
   */
  kilde?: "claude" | "regel" | "menneske";
  /** Hvor længe Claude var om svaret. */
  ms?: number;
  model?: string;
}

/**
 * Hvem der tænkte, som det står på skærmen: "Claude · 3,4 s" eller "Regel".
 * Ét sted, så mærket siger det samme i loggen, i panelet og på kontoret.
 */
export function kildeTekst(b: Pick<Besked, "kilde" | "ms">, medTid = true): string {
  if (b.kilde === "menneske") return "Menneske";
  if (b.kilde !== "claude") return "Regel";
  return medTid && b.ms !== undefined ? `Claude · ${(b.ms / 1000).toFixed(1).replace(".", ",")} s` : "Claude";
}

/**
 * Hvorfor reglerne har taget over, i højst to ord. Hele forklaringen — fx
 * Anthropics fejlbesked — hører ikke til på skærmen.
 */
export function stopGrund(tekst: string): string {
  if (/loft/i.test(tekst)) return "Loft nået";
  if (/nøgle/i.test(tekst)) return "Ingen nøgle";
  if (/serveren/i.test(tekst)) return "Ingen forbindelse";
  return "Claude svarer ikke";
}

/** Modtagere, der er mennesker. Fladen skal kunne se forskel på dem og agenterne. */
export const MENNESKER = new Set(["Operatør", "Formand", "Systemansvarlig", "Vedligehold"]);

/** Agenternes navne, som de står i data/agents.ts. */
export const AGENT = {
  operatoer: "Operatøragent",
  drift: "Driftsagent",
  data: "Dataagent",
  vagt: "Kædevagt",
  proever: "Prøvetagningsagent",
  linje: (lane: string) => `Linjeagent Spor ${lane}`,
} as const;

export type Gruppe = "hurtig" | "middel" | "langsom" | "di";

export const GRUPPER: Gruppe[] = ["hurtig", "middel", "langsom", "di"];

/** En prøveplan: raten i hver gruppe, og hvad den giver i rækker. */
export interface Proeveplan {
  /** Hvor mange af Dataagentens trin, der er taget. 0 er normal drift. */
  trin: number;
  rate: Record<Gruppe, number>;
  raekkerPrS: number;
}

/** Planen efter de første `trin` af Dataagentens trin. */
export function planMed(antal: Record<Gruppe, number>, trin: number): Proeveplan {
  const rate: Record<Gruppe, number> = { hurtig: PROEVERATE.normal, middel: PROEVERATE.normal, langsom: PROEVERATE.normal, di: PROEVERATE.normal };
  for (const t of PROEVERATE.trin.slice(0, trin)) rate[t.gruppe] = t.rate;
  const raekkerPrS = GRUPPER.reduce((n, g) => n + antal[g] * rate[g], 0);
  return { trin, rate, raekkerPrS };
}

/**
 * Dataagentens valg: så få trin som muligt, men nok til at ligge under
 * databasens kapacitet med luft. Hvert trin koster opløsning på nogle
 * signaler, så den tager ikke flere, end den skal.
 *
 * `nok` er false, hvis selv alle trin ikke giver luft. Så siger agenten det
 * — den lader ikke som om, planen løser noget, den ikke løser.
 */
export function vaelgPlan(antal: Record<Gruppe, number>, kapacitet: number): {
  plan: Proeveplan;
  alle: Proeveplan[];
  nok: boolean;
} {
  const alle = PROEVERATE.trin.map((_, i) => planMed(antal, i + 1));
  const graense = kapacitet * PROEVERATE.luft;
  const plan = alle.find((p) => p.raekkerPrS <= graense) ?? alle[alle.length - 1];
  return { plan, alle, nok: plan.raekkerPrS <= graense };
}

// ---------------------------------------------------------------------------
// Tal og tider, som de skrives i en besked

export const tal = (v: number, d = 0) =>
  v.toLocaleString("da-DK", { minimumFractionDigits: d, maximumFractionDigits: d });

/** "06:42" — simuleringens klokke. */
export const klokke = (t: number) =>
  new Date(t).toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" });

/** "4 min 12 s", "1 t 20 min", "35 s". */
export function varighed(sekunder: number): string {
  const s = Math.max(0, Math.round(sekunder));
  if (s < 60) return `${s} s`;
  const t = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (t > 0) return `${t} t ${m} min`;
  return `${m} min ${s % 60} s`;
}

// ---------------------------------------------------------------------------
// Ordrens regnskab

export interface SporStop {
  lane: string;
  fra: number;
  til: number | null;
  aarsag: string;
}

export interface Ordreregnskab {
  ordreNr: string;
  kg: number;
  kasser: number;
  startT: number;
  slutT: number;
  oppetidPct: number | null;
  sporStop: SporStop[];
  maskinstop: number;
  mssqlEpisoder: number;
  maksForsinkelseS: number;
  tabt: number;
  sensorfejl: number;
  /** Laboratoriet: prøverne, det sidste bords Mainline pr. spor, foreign seeds og sorteringen. */
  lab: {
    ct: number;
    videometer: number;
    sprunget: number;
    /** Multigerm i det seneste svar fra det sidste bords Mainline. null uden svar. */
    produkt: { lane: string; multi: number | null }[];
    fremmedMaks: { stk: number; kasse: number } | null;
    /** Hvor længe der blev sorteret kraftigt. */
    kraftigS: number;
  };
  beslutninger: number;
  beskeder: number;
}

/**
 * Operatøragentens rapport, når ordren er færdig. Hver linje er et tal fra
 * simuleringen — intet er skrevet i hånden.
 */
export function ordreRapport(r: Ordreregnskab): string[] {
  const timer = (r.slutT - r.startT) / 3_600_000;
  const snit = timer > 0 ? r.kg / 1000 / timer : 0;
  const pr = (lane: string) => {
    const stop = r.sporStop.filter((s) => s.lane === lane);
    const tid = stop.reduce((n, s) => n + ((s.til ?? r.slutT) - s.fra) / 1000, 0);
    return stop.length === 0 ? `spor ${lane} stod ikke` : `spor ${lane} stod ${stop.length} gang${stop.length === 1 ? "" : "e"}, ${varighed(tid)}`;
  };
  const lanes = [...new Set(r.sporStop.map((s) => s.lane).concat(["N", "S"]))].sort();
  return [
    `${tal(r.kg)} kg · ${r.kasser} kasser · ${varighed((r.slutT - r.startT) / 1000)}`,
    `${tal(snit, 2)} t/hr i snit${r.oppetidPct !== null ? ` · oppetid ${tal(r.oppetidPct, 1)} %` : ""}`,
    `${r.maskinstop} maskinstop · ${lanes.map(pr).join(" · ")}`,
    r.mssqlEpisoder === 0
      ? "MSSQL fulgte med hele vejen"
      : `MSSQL bagud ${r.mssqlEpisoder} gang${r.mssqlEpisoder === 1 ? "" : "e"} · højst ${tal(r.maksForsinkelseS)} s · ${tal(r.tabt)} rækker tabt`,
    r.sensorfejl === 0 ? "Flowmåleren var inde hele vejen" : `Flowmåleren ude ${r.sensorfejl} gang${r.sensorfejl === 1 ? "" : "e"}`,
    `Laboratoriet · ${r.lab.ct} CT-prøver · ${r.lab.videometer} videometer${r.lab.sprunget > 0 ? ` · ${r.lab.sprunget} sprunget over` : ""}`,
    `Mainline ud · ${r.lab.produkt.map((x) => `spor ${x.lane} ${x.multi === null ? "intet svar" : `multigerm ${tal(x.multi, 1)} %`}`).join(" · ")}`,
    r.lab.fremmedMaks === null
      ? "Ingen videometerprøver"
      : `Foreign seeds højst ${r.lab.fremmedMaks.stk} pr. prøve (kasse ${r.lab.fremmedMaks.kasse})${r.lab.kraftigS > 0 ? ` · kraftig sortering ${varighed(r.lab.kraftigS)}` : ""}`,
    `${r.beslutninger} beslutninger · ${r.beskeder} beskeder mellem agenterne`,
  ];
}

/** Hvornår sidste kasse er tippet, ved det gennemløb, ordren har haft indtil nu. */
export function prognose(r: { kgInd: number; estimeretKg: number; koertFra: number; nu: number }): number | null {
  const timer = (r.nu - r.koertFra) / 3_600_000;
  if (timer <= 0 || r.kgInd <= 0) return null;
  const kgPrTime = r.kgInd / timer;
  return r.nu + ((r.estimeretKg - r.kgInd) / kgPrTime) * 3_600_000;
}
