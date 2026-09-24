// Linjeskærmens og kontorets ende af kanalen. Reglerne og typerne står i
// src/lib/kanal.ts; her er det kun, hvordan browseren taler med serveren.
import type { Kommando, KontorSvar, LinjePost, LinjeSvar } from "../../lib/kanal";

export type {
  AgentStatus, Ejer, Hastighed, Kommando, KommandoIndhold, KontorSvar, LinjeSvar, SimStatus,
} from "../../lib/kanal";

/** To gange i sekundet. Hurtigt nok til, at et klik på kontoret føles som et klik. */
export const KANAL_MS = 500;

const ADRESSE = "/api/kanal";

async function post<T>(body: unknown, ventMs: number): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(ADRESSE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ventMs),
  });
  return { ok: res.ok, status: res.status, data: await res.json() as T };
}

/** Linjeskærmen sender, hvordan det står, og får kontorets kommandoer tilbage. */
export async function sendLinje(p: LinjePost): Promise<LinjeSvar> {
  // Rundeligt: et svar, der ikke når frem, sendes igen — og serveren har
  // det måske allerede. Kontoret tåler det, men færre er bedre.
  const r = await post<LinjeSvar & { fejl?: string }>(p, 10_000);
  if (!r.ok) throw new Error(r.data.fejl ?? `Kanalen svarede ${r.status}`);
  return r.data;
}

/** Kontoret læser det, der er kommet, siden det sidst spurgte. */
export async function laesKanal(logFra: number, samtaleFra: number): Promise<KontorSvar> {
  const res = await fetch(`${ADRESSE}?log=${logFra}&samtale=${samtaleFra}`, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
  const data = await res.json() as KontorSvar & { fejl?: string };
  if (!res.ok) throw new Error(data.fejl ?? `Kanalen svarede ${res.status}`);
  return data;
}

/**
 * Kontoret beder linjeskærmen om noget. Svaret er et af to korte ord til
 * skærmen — aldrig lagerets egen fejltekst.
 */
export async function sendKommando(kommando: Kommando): Promise<{ ok: true } | { ok: false; fejl: "Linjeskærmen er skiftet" | "Nåede ikke frem" }> {
  try {
    const r = await post<{ ok: boolean }>({ type: "kommando", kommando }, 5_000);
    if (r.ok) return { ok: true };
    return { ok: false, fejl: r.status === 409 ? "Linjeskærmen er skiftet" : "Nåede ikke frem" };
  } catch {
    return { ok: false, fejl: "Nåede ikke frem" };
  }
}

/** Nøglen, en hændelse kendes på — samme som loggen bruger. */
export const haendelsesNoegle = (h: { t: number; hvor: string | null; tekst: string }) => `${h.t}|${h.hvor}|${h.tekst}`;
