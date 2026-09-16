import events from "../../data/maintenance.json";
import { formatDate, parseDate, timeSince } from "./dates";
import type { MaintenanceEvent, MaintenanceType } from "./types";

export const MAINTENANCE_ORDER: MaintenanceType[] = [
  "hovedeftersyn", "retrofit", "reparation", "udskiftning",
];

export const MAINTENANCE_LABEL: Record<MaintenanceType, string> = {
  hovedeftersyn: "Hovedeftersyn",
  retrofit: "Retrofit",
  reparation: "Reparation",
  udskiftning: "Udskiftning",
};

// ISO-datoer sorterer korrekt som tekst, så nyeste først er en simpel sortering.
const ALL = (events as MaintenanceEvent[]).slice().sort((a, b) => b.dato.localeCompare(a.dato));

const BY_WID = new Map<string, MaintenanceEvent[]>();
for (const e of ALL) {
  const list = BY_WID.get(e.wid);
  if (list) list.push(e);
  else BY_WID.set(e.wid, [e]);
}

/**
 * Alle hændelser for en maskine, nyeste først.
 * En maskine kan dække flere W-ID'er (fx fire vippestole i én boks), så der
 * slås op på dem alle.
 */
export function historyFor(wIds: string[]): MaintenanceEvent[] {
  if (wIds.length === 1) return BY_WID.get(wIds[0]) ?? [];
  const seen = new Set<string>();
  const out: MaintenanceEvent[] = [];
  for (const w of wIds) {
    for (const e of BY_WID.get(w) ?? []) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      out.push(e);
    }
  }
  return out.sort((a, b) => b.dato.localeCompare(a.dato));
}

/** Seneste hændelse af en type. Listen skal være sorteret nyeste først. */
export function lastOfType(history: MaintenanceEvent[], type: MaintenanceType): MaintenanceEvent | undefined {
  return history.find((e) => e.type === type);
}

/** "15. juni 2024 · for 2 år siden". Kan datoen ikke læses, vises den råt. */
export function describeDate(iso: string): string {
  const p = parseDate(iso);
  if (!p) return iso;
  const since = timeSince(p);
  return since ? `${formatDate(p)} · ${since}` : formatDate(p);
}

/** 285000 → "285.000 kr." */
export function formatCost(v: number): string {
  return `${v.toLocaleString("da-DK")} kr.`;
}
