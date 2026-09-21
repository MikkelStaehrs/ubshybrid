// Hvad en materialestrøm betyder.
//
// Strømsløjfen i live-source.ts giver procent af fuldt udslag og ikke andet.
// Her lægges de to ting ovenpå, som gør procenten brugbar:
//
//   1. En kalibrering — hvad 100 % er i tons. Den er en aftale med driften
//      og står i data/line-config.ts. Findes den ikke, vises procenten
//      alene, og takten står som "Ikke udfyldt".
//   2. En tilstand — kører linjen, eller gør den ikke. Den udledes af
//      procenten med hysterese, så et signal, der vipper omkring nul, ikke
//      får skærmen til at blinke.
//
// Sensorfejl er en tredje tilstand, ikke et stop. En måler, der er holdt op
// med at svare, siger ingenting om, hvorvidt der løber materiale — og et
// stop, der bygger på et dødt kabel, ville være opdigtet.
import { FULL_SCALE_PCT } from "./live-source";
import type { FlowLevel, LineOps } from "./types";

/**
 * Standardgrænser for, hvornår et flow er lavt, passende eller højt, i
 * procent af nominel kapacitet. De kan sættes pr. linje i line-config.ts.
 *
 * Tallene er valgte, ikke målte: hundrede procent er per definition nominel
 * kapacitet, og halvfjerds er det sted, hvor en underfødning er værd at
 * kigge på. Skal de flyttes, flyttes de i konfigurationen — ikke her.
 */
export const FLOW_LOW_PCT = 70;
export const FLOW_HIGH_PCT = 100;

export const FLOW_LEVEL_LABEL: Record<FlowLevel, string> = {
  lav: "Lavt",
  ok: "OK",
  hoej: "Højt",
};

export interface FlowLimits {
  lowPct: number;
  highPct: number;
}

/** Linjens grænser, med standardværdierne under. */
export function flowLimits(ops: LineOps | undefined): FlowLimits {
  return {
    lowPct: ops?.flow?.lowPct ?? FLOW_LOW_PCT,
    highPct: ops?.flow?.highPct ?? FLOW_HIGH_PCT,
  };
}

/**
 * Nominel kapacitet for ét signal, i linjens `rateUnit`. null når den ikke
 * er aftalt — og så findes takten ikke, den gættes ikke.
 */
export function nominalFor(ops: LineOps | undefined, signalId: string): number | null {
  const n = ops?.flow?.nominal?.[signalId];
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

export function levelOf(pct: number, limits: FlowLimits): FlowLevel {
  if (pct > limits.highPct) return "hoej";
  return pct < limits.lowPct ? "lav" : "ok";
}

/**
 * Procent til takt. null når der ikke er en måling, eller når 100 %-punktet
 * ikke er aftalt — begge dele er "vi ved det ikke", ikke "nul".
 */
export function rateFrom(pct: number | null, nominal: number | null): number | null {
  if (pct === null || nominal === null || !Number.isFinite(pct)) return null;
  return (pct / 100) * nominal;
}

/** Fuldt udslag i linjens enhed. Kun til at skrive skalaen ud med. */
export function fullScaleRate(nominal: number | null): number | null {
  return rateFrom(FULL_SCALE_PCT, nominal);
}

// ---------------------------------------------------------------------------
// Kører eller kører ikke

/**
 * Hysterese. Over `KOERER_OVER_PCT` kører linjen, under `STAAR_UNDER_PCT`
 * står den, og imellem beholder den, hvad den var.
 *
 * Båndet er der, fordi et flowsignal aldrig lander præcis på nul: uden det
 * ville en måler, der vipper omkring grænsen, producere et stop i sekundet.
 * Tallene er valgte, ikke målte, og de skal forbi driften sammen med
 * stopgrænsen.
 */
export const KOERER_OVER_PCT = 5;
export const STAAR_UNDER_PCT = 2;

export type RunState = "koerer" | "staar" | "fejl";

export const RUN_STATE_LABEL: Record<RunState, string> = {
  koerer: "KØRER",
  staar: "KØRER IKKE",
  fejl: "SENSORFEJL",
};

/**
 * Tilstanden ud fra én måling og den forrige afgjorte tilstand.
 *
 * `prev` er den seneste tilstand, der *var* et svar — altså kører eller
 * kører ikke. En fejlperiode bærer ikke en tilstand videre, for den vidste
 * ingenting at bære.
 *
 * Uden en forrige tilstand afgøres båndet som "kører ikke": under fem
 * procent af nominel kapacitet løber der reelt ingenting. Båndet er til for
 * at holde tilstanden i ro, ikke for at skjule et flow.
 */
export function runStateFrom(pct: number | null, prev: RunState | null): RunState {
  if (pct === null || !Number.isFinite(pct)) return "fejl";
  if (pct > KOERER_OVER_PCT) return "koerer";
  if (pct < STAAR_UNDER_PCT) return "staar";
  return prev === "koerer" ? "koerer" : "staar";
}

/** Én prøve, som tidslinjen har brug for den. `value` er procent, null ved fejl. */
export interface FlowSample {
  t: number;
  value: number | null;
}

export interface RunSegment {
  state: RunState;
  /** Millisekunder siden epoch. */
  from: number;
  to: number;
}

export const segmentMs = (s: RunSegment) => Math.max(0, s.to - s.from);

/**
 * Prøverne lagt sammen til sammenhængende stræk. Det er tidslinjen bag
 * Live-visningen, og det er også grundlaget for stop og nøgletal.
 */
export function runSegments(samples: FlowSample[]): RunSegment[] {
  const out: RunSegment[] = [];
  // Kun kører/kører ikke bæres videre. En fejl ved ingenting at give videre.
  let decided: RunState | null = null;

  for (const s of samples) {
    const state = runStateFrom(s.value, decided);
    if (state !== "fejl") decided = state;
    const last = out[out.length - 1];
    if (last && last.state === state) {
      last.to = s.t;
    } else {
      // Strækket begynder, hvor det forrige slap, så tidslinjen ikke har huller.
      out.push({ state, from: last ? last.to : s.t, to: s.t });
    }
  }
  return out;
}

/**
 * De stræk, der er lange nok til at tælle som et stop.
 *
 * Kun "kører ikke" kan blive et stop. En sensorfejl kan det aldrig — vi ved
 * ikke, hvad der skete, mens måleren tav, og et stop hentet ud af et dødt
 * kabel ville være opfundet.
 */
export function stopsFrom(segments: RunSegment[], stopAfterSeconds: number): RunSegment[] {
  const min = stopAfterSeconds * 1000;
  return segments.filter((s) => s.state === "staar" && segmentMs(s) >= min);
}

// ---------------------------------------------------------------------------
// Nøgletal

/**
 * Hvor lang historik der skal til, før oppetid og total siger noget.
 *
 * Fem minutter er valgt, ikke aftalt. Kortere end det, og et enkelt stop
 * ville trække oppetiden til noget nær ingenting og se ud som en måling.
 * Indtil da står der "Afventer historik" — det er sandt, og det er nok.
 */
export const HISTORIK_MIN_MS = 300_000;

export interface KeyFigures {
  /**
   * Andel af den *kendte* tid, linjen kørte. Fejlperioder tæller hverken op
   * eller ned: de er ikke oppetid, og de er heller ikke nedetid.
   */
  uptimePct: number;
  /** Hvor længe måleren tav. Vises, så oppetiden kan vejes. */
  faultMs: number;
  /**
   * Samlet mængde ind i perioden, i linjens `rateUnit` gange timer. Det er
   * et integral af et estimat: hvert punkt er en øjebliksmåling, og
   * mellemrummene er interpoleret. Tallet skal mærkes "Estimat" i fladen.
   *
   * null når 100 %-punktet ikke er aftalt — så findes takten ikke.
   */
  total: number | null;
  spanMs: number;
}

/**
 * Oppetid og samlet indgang over prøverne. null indtil der er historik nok —
 * kaldepladsen skriver "Afventer historik" og ikke et tal.
 */
export function keyFigures(
  samples: FlowSample[],
  nominal: number | null,
): KeyFigures | null {
  if (samples.length < 2) return null;
  const spanMs = samples[samples.length - 1].t - samples[0].t;
  if (spanMs < HISTORIK_MIN_MS) return null;

  const segments = runSegments(samples);
  let koerer = 0;
  let staar = 0;
  let faultMs = 0;
  for (const s of segments) {
    const ms = segmentMs(s);
    if (s.state === "koerer") koerer += ms;
    else if (s.state === "staar") staar += ms;
    else faultMs += ms;
  }
  const kendt = koerer + staar;

  // Integralet: trapezer mellem nabopunkter. Et hul med en fejl i springes
  // over frem for at blive brolagt — vi ved ikke, hvad der løb imens.
  let total: number | null = null;
  if (nominal !== null) {
    let sum = 0;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1];
      const b = samples[i];
      if (a.value === null || b.value === null) continue;
      const rateA = rateFrom(a.value, nominal)!;
      const rateB = rateFrom(b.value, nominal)!;
      sum += ((rateA + rateB) / 2) * ((b.t - a.t) / 3_600_000);
    }
    total = sum;
  }

  return {
    uptimePct: kendt > 0 ? (koerer / kendt) * 100 : 0,
    faultMs,
    total,
    spanMs,
  };
}
