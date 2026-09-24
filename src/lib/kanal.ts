// Kanalen mellem linjeskærmen og kontoret.
//
// Simuleringen kører ét sted: i linjeskærmens vindue i operatørrummet.
// Kontoret — formandens skærme — kører ingen simulering selv. Det læser,
// hvad linjeskærmen har sendt, og sender kommandoer tilbage: fart, forfra,
// Claude til og fra, og et ja eller nej til en anbefaling.
//
// De to kan sidde på hver sin maskine, så beskederne går gennem serveren
// (`/api/kanal`). Serveren regner intet; den gemmer og giver videre.
//
//   linjeskærm  ──POST status, nye hændelser og beskeder──▶  server
//               ◀──────────── kommandoer siden sidst ──────
//   kontor      ──GET siden sidst──▶  server
//               ──POST kommando───▶  server
//
// Lageret er serverens hukommelse, eller Upstash Redis, hvis der er en.
// Hukommelsen er nok, når appen kører som én proces. På Vercel kan to
// forespørgsler lande i to forskellige instanser, og så ser kontoret intet —
// dér skal Upstash til. Kontoret siger selv, hvilket lager kanalen bruger.
import type { Besked } from "./samspil";
import type { ProeveOverblik } from "./proeveoverblik";
import type { Anbefaling, Haendelse, Motor, OrdreStatus, Uro } from "./telemetri";

/** Hvor hurtigt tiden går. "auto" er hurtigt, når alt er roligt, og langsomt, når ikke. */
export type Hastighed = "auto" | "pause" | number;

/** Hvem der tænker, og hvad det har kostet. */
export interface AgentStatus {
  motor: Motor;
  /** Kald til Claude i denne kørsel, der kostede noget. */
  kald: number;
  brugtKr: number;
  loftKr: number;
  /** De agenter, der tænker lige nu. */
  venter: string[];
  /** Hvorfor reglerne har taget over, hvis de har. */
  stoppet: string | null;
  /** Den seneste fejl — et kald, reglerne måtte svare for. */
  fejl: string | null;
  /** Kørslens seed. Samme seed giver samme hændelser — ikke samme svar fra Claude. */
  seed: number;
}

/** Hvordan det står på linjeskærmen. Sendes hver gang. */
export interface SimStatus {
  /** Simuleringens klokke. */
  t: number;
  valgt: Hastighed;
  /** Gangen lige nu. 0 er pause. */
  gang: number;
  ordre: OrdreStatus | null;
  uro: Uro[];
  agenter: AgentStatus;
  /** De åbne anbefalinger og de seneste afgjorte. Kontoret kan også sige ja og nej. */
  anbefalinger: Anbefaling[];
  /** Prøvetagningen: CT-køen, kastebordenes svar og tab, videometeret. null uden ordre. */
  proever: ProeveOverblik | null;
}

/** Det, kontoret kan bede linjeskærmen om. */
export type KommandoIndhold =
  | { type: "fart"; h: Hastighed }
  | { type: "forfra" }
  | { type: "motor"; motor: Motor }
  | { type: "udfoer"; id: number }
  | { type: "afvis"; id: number };

export interface Kommando {
  /** Kontorets eget id. Linjeskærmen udfører hver kommando én gang. */
  id: string;
  /** Den kørsel, kommandoen var til. En anbefaling i en gammel kørsel er ikke den samme. */
  koersel: string;
  k: KommandoIndhold;
}

/** Hvem der ejer rummet: den linjeskærm, der sender. */
export interface Ejer {
  koersel: string;
  /** Skifter, hver gang rummet tømmes. Så ved kontoret, at det skal læse forfra. */
  udgave: string;
  /** Serverens tid, sidst linjeskærmen sendte. */
  sidst: number;
}

export interface LinjePost {
  type: "linje";
  koersel: string;
  /** Linjeskærmen er lige startet: den tager rummet, også fra en anden. */
  overtag?: boolean;
  status: SimStatus;
  log: Haendelse[];
  samtale: Besked[];
  /** Hvor langt i kommandoerne linjeskærmen er nået. */
  kommandoFra: number;
}

export type LinjeSvar =
  | { ejer: true; nulstillet: boolean; kommandoer: Kommando[]; kommandoTil: number }
  /** En anden linjeskærm sender. Denne kører videre, men tier. */
  | { ejer: false };

export interface KommandoPost {
  type: "kommando";
  kommando: Kommando;
}

export interface KontorSvar {
  ejer: Ejer | null;
  status: SimStatus | null;
  /** Hvor længe siden linjeskærmen sidst sendte. */
  alderMs: number | null;
  log: Haendelse[];
  logTil: number;
  samtale: Besked[];
  samtaleTil: number;
  lager: LagerNavn;
  /** Kører serveren på Vercel? Så er hukommelsen ikke et fælles lager. */
  vercel: boolean;
}

/** Så længe uden et ord fra ejeren, og en anden linjeskærm kan tage rummet. */
export const TAVS_MS = 15_000;
/** Aldrig mere end det i en liste. En ordre giver langt færre. */
const MAKS = 5_000;
/** Et rum, ingen har brugt i et døgn, ryddes. */
const LEVETID_S = 24 * 3600;

// ---------------------------------------------------------------------------
// Lageret

export type LagerNavn = "hukommelse" | "upstash";

export interface KanalLager {
  navn: LagerNavn;
  ejer(rum: string): Promise<Ejer | null>;
  /** Tøm rummet og giv det til en ny ejer. */
  nulstil(rum: string, ejer: Ejer): Promise<void>;
  skriv(rum: string, d: { ejer: Ejer; status: SimStatus; log: Haendelse[]; samtale: Besked[] }): Promise<void>;
  kommandoer(rum: string, fra: number): Promise<Kommando[]>;
  kommando(rum: string, k: Kommando): Promise<void>;
  laes(rum: string, logFra: number, samtaleFra: number): Promise<{
    ejer: Ejer | null; status: SimStatus | null; log: Haendelse[]; samtale: Besked[];
  }>;
}

interface Rum {
  ejer: Ejer | null;
  status: SimStatus | null;
  log: Haendelse[];
  samtale: Besked[];
  kommandoer: Kommando[];
}

/**
 * Serverens hukommelse. Ligger på globalThis, så en genindlæsning i
 * udvikling ikke taber rummet midt i en kørsel.
 */
export function hukommelse(rum: Map<string, Rum> = hukommelsesRum()): KanalLager {
  const hent = (r: string) => {
    let x = rum.get(r);
    if (!x) rum.set(r, (x = { ejer: null, status: null, log: [], samtale: [], kommandoer: [] }));
    return x;
  };
  const tilfoej = <T,>(liste: T[], nye: T[]) => { liste.push(...nye.slice(0, Math.max(0, MAKS - liste.length))); };
  return {
    navn: "hukommelse",
    ejer: async (r) => hent(r).ejer,
    nulstil: async (r, ejer) => { rum.set(r, { ejer, status: null, log: [], samtale: [], kommandoer: [] }); },
    skriv: async (r, d) => {
      const x = hent(r);
      x.ejer = d.ejer;
      x.status = d.status;
      tilfoej(x.log, d.log);
      tilfoej(x.samtale, d.samtale);
    },
    kommandoer: async (r, fra) => hent(r).kommandoer.slice(fra),
    kommando: async (r, k) => tilfoej(hent(r).kommandoer, [k]),
    laes: async (r, logFra, samtaleFra) => {
      const x = hent(r);
      return { ejer: x.ejer, status: x.status, log: x.log.slice(logFra), samtale: x.samtale.slice(samtaleFra) };
    },
  };
}

function hukommelsesRum(): Map<string, Rum> {
  const g = globalThis as { __ubsKanal?: Map<string, Rum> };
  return (g.__ubsKanal ??= new Map());
}

type Hent = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Upstash Redis gennem dets REST-API — ren fetch, ingen pakke. Listerne
 * vokser kun; hvor langt kontoret og linjeskærmen er nået, er et indeks i
 * dem. Rummet tømmes, når en ny linjeskærm tager det.
 */
export function upstash(url: string, token: string, hent: Hent = fetch): KanalLager {
  const noegle = (r: string, del: string) => `ubs:kanal:${r}:${del}`;
  const kald = async (kommandoer: (string | number)[][]): Promise<unknown[]> => {
    const res = await hent(`${url.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      // Alt som tekst, som Redis selv ser det.
      body: JSON.stringify(kommandoer.map((k) => k.map(String))),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Upstash svarede ${res.status}`);
    const svar = await res.json() as { result?: unknown; error?: string }[];
    const fejl = svar.find((s) => s.error);
    if (fejl) throw new Error(`Upstash: ${fejl.error}`);
    return svar.map((s) => s.result);
  };
  const json = <T,>(v: unknown): T | null => (typeof v === "string" ? JSON.parse(v) as T : null);
  const liste = <T,>(v: unknown): T[] => (Array.isArray(v) ? v.map((x) => JSON.parse(String(x)) as T) : []);
  return {
    navn: "upstash",
    ejer: async (r) => json<Ejer>((await kald([["GET", noegle(r, "ejer")]]))[0]),
    nulstil: async (r, ejer) => {
      await kald([
        ["DEL", noegle(r, "status"), noegle(r, "log"), noegle(r, "samtale"), noegle(r, "kommandoer")],
        ["SET", noegle(r, "ejer"), JSON.stringify(ejer), "EX", LEVETID_S],
      ]);
    },
    skriv: async (r, d) => {
      const k: (string | number)[][] = [
        ["SET", noegle(r, "ejer"), JSON.stringify(d.ejer), "EX", LEVETID_S],
        ["SET", noegle(r, "status"), JSON.stringify(d.status), "EX", LEVETID_S],
      ];
      for (const [del, nye] of [["log", d.log], ["samtale", d.samtale]] as const) {
        if (nye.length === 0) continue;
        k.push(["RPUSH", noegle(r, del), ...nye.map((x) => JSON.stringify(x))], ["EXPIRE", noegle(r, del), LEVETID_S]);
      }
      await kald(k);
    },
    kommandoer: async (r, fra) => liste<Kommando>((await kald([["LRANGE", noegle(r, "kommandoer"), fra, -1]]))[0]),
    kommando: async (r, k) => {
      await kald([["RPUSH", noegle(r, "kommandoer"), JSON.stringify(k)], ["EXPIRE", noegle(r, "kommandoer"), LEVETID_S]]);
    },
    laes: async (r, logFra, samtaleFra) => {
      const [ejer, status, log, samtale] = await kald([
        ["GET", noegle(r, "ejer")],
        ["GET", noegle(r, "status")],
        ["LRANGE", noegle(r, "log"), logFra, -1],
        ["LRANGE", noegle(r, "samtale"), samtaleFra, -1],
      ]);
      return { ejer: json<Ejer>(ejer), status: json<SimStatus>(status), log: liste<Haendelse>(log), samtale: liste<Besked>(samtale) };
    },
  };
}

/**
 * Upstash, hvis det er sat op — under Upstash' egne navne eller dem, Vercel
 * giver en database fra sin markedsplads. Ellers serverens hukommelse.
 */
export function lagerFraMiljoe(env: Record<string, string | undefined>): KanalLager {
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN;
  return url && token ? upstash(url, token) : hukommelse();
}

// ---------------------------------------------------------------------------
// Reglerne for rummet

/**
 * Linjeskærmen sender. Rummet er dens, hvis det er tomt, hvis det allerede
 * er dens, hvis ejeren har tiet i `TAVS_MS` — eller hvis den lige er startet:
 * den nyeste linjeskærm vinder. Tager den et rum, der havde noget i sig,
 * tømmes det, og den skal sende alt, den har (`nulstillet`).
 */
export async function haandterLinje(lager: KanalLager, rum: string, p: LinjePost, nu: number): Promise<LinjeSvar> {
  const e = await lager.ejer(rum);
  const egen = e?.koersel === p.koersel;
  const tavs = !e || nu - e.sidst > TAVS_MS;
  if (!egen && !tavs && !p.overtag) return { ejer: false };
  const ejer: Ejer = egen ? { ...e!, sidst: nu } : { koersel: p.koersel, udgave: udgave(), sidst: nu };
  let nulstillet = false;
  if (!egen) {
    await lager.nulstil(rum, ejer);
    nulstillet = true;
  }
  await lager.skriv(rum, { ejer, status: p.status, log: p.log, samtale: p.samtale });
  const fra = nulstillet ? 0 : p.kommandoFra;
  const kommandoer = await lager.kommandoer(rum, fra);
  return { ejer: true, nulstillet, kommandoer: kommandoer.filter((k) => k.koersel === p.koersel), kommandoTil: fra + kommandoer.length };
}

/** Kontoret sender en kommando. Den når kun den kørsel, den var til. */
export async function haandterKommando(lager: KanalLager, rum: string, p: KommandoPost): Promise<{ ok: boolean; fejl?: string }> {
  const e = await lager.ejer(rum);
  if (!e || e.koersel !== p.kommando.koersel) return { ok: false, fejl: "Linjeskærmen er skiftet" };
  await lager.kommando(rum, p.kommando);
  return { ok: true };
}

/** Kontoret læser, hvad der er kommet, siden det sidst spurgte. */
export async function laesKontor(
  lager: KanalLager, rum: string, logFra: number, samtaleFra: number, nu: number, vercel: boolean,
): Promise<KontorSvar> {
  const d = await lager.laes(rum, logFra, samtaleFra);
  return {
    ejer: d.ejer,
    status: d.status,
    alderMs: d.ejer ? nu - d.ejer.sidst : null,
    log: d.log,
    logTil: logFra + d.log.length,
    samtale: d.samtale,
    samtaleTil: samtaleFra + d.samtale.length,
    lager: lager.navn,
    vercel,
  };
}

const udgave = () => Math.random().toString(36).slice(2, 10);

// ---------------------------------------------------------------------------
// Hvad serveren tager imod

export const RUM = /^[a-z0-9-]{1,40}$/;
const KOERSEL = /^[a-z0-9-]{1,60}$/i;

const erObjekt = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const erHaendelse = (h: unknown) => erObjekt(h) && typeof h.t === "number" && typeof h.tekst === "string";
const erBesked = (b: unknown) => erObjekt(b) && typeof b.nr === "number" && typeof b.tekst === "string";
const erHastighed = (h: unknown) => h === "auto" || h === "pause" || (typeof h === "number" && h >= 0 && h <= 1000);

export function gyldigLinje(v: unknown): v is LinjePost {
  return erObjekt(v) && v.type === "linje" && typeof v.koersel === "string" && KOERSEL.test(v.koersel)
    && erObjekt(v.status) && typeof v.kommandoFra === "number" && v.kommandoFra >= 0
    && Array.isArray(v.log) && v.log.length <= MAKS && v.log.every(erHaendelse)
    && Array.isArray(v.samtale) && v.samtale.length <= MAKS && v.samtale.every(erBesked);
}

export function gyldigKommando(v: unknown): v is KommandoPost {
  if (!erObjekt(v) || v.type !== "kommando" || !erObjekt(v.kommando)) return false;
  const { id, koersel, k } = v.kommando;
  if (typeof id !== "string" || id.length > 60 || typeof koersel !== "string" || !KOERSEL.test(koersel) || !erObjekt(k)) return false;
  switch (k.type) {
    case "fart": return erHastighed(k.h);
    case "forfra": return true;
    case "motor": return k.motor === "regler" || k.motor === "claude";
    case "udfoer": case "afvis": return typeof k.id === "number";
    default: return false;
  }
}
