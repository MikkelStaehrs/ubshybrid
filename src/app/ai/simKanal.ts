// Kanalen mellem kontrolrummet og loggen på den anden skærm.
//
// Simuleringen kører ét sted: i kontrolrummets vindue. Loggen på skærm 2
// kører ingen simulering selv — den lytter. Browserens BroadcastChannel
// forbinder vinduer fra samme adresse på samme maskine, så der skal ingen
// server til, og intet forlader maskinen.
import type { Besked } from "../../lib/samspil";
import type { Haendelse, Motor, OrdreStatus, Uro } from "../../lib/telemetri";

export const KANAL = "ubs-simulering";

/** Hvor hurtigt tiden går. "auto" er hurtigt, når alt er roligt, og langsomt, når ikke. */
export type Hastighed = "auto" | "pause" | number;

export interface SimStatus {
  /** Simuleringens klokke. */
  t: number;
  valgt: Hastighed;
  /** Gangen lige nu. 0 er pause. */
  gang: number;
  ordre: OrdreStatus | null;
  uro: Uro[];
  agenter?: AgentStatus;
}

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

export type SimBesked =
  /** Loggen er åbnet og vil have det hele. */
  | { type: "hej" }
  /** Hvordan det står. Loggen og samtalen kun, når de har ændret sig. */
  | { type: "tilstand"; status: SimStatus; log?: Haendelse[]; samtale?: Besked[] };

export function aabnKanal(): BroadcastChannel | null {
  return typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(KANAL);
}
