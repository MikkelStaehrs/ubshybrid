"use client";
import { useEffect, useRef, useState } from "react";
import {
  createLiveSource, STALE_AFTER_MS,
  type LiveSourceKind, type Quality, type SignalValue,
} from "./live-source";

/** Ét øjebliksbillede i historikken. Holdes lille — der kommer ét i sekundet. */
export interface Sample {
  t: number;
  raw: number;
  /** null ved sensorfejl — en prøve uden måling. */
  value: number | null;
  quality: Quality;
}

/** 15 minutter ved ét kald i sekundet. */
const MAX_SAMPLES = 900;
const POLL_MS = 1000;

export interface LiveState {
  values: Map<string, SignalValue>;
  history: Map<string, Sample[]>;
  /** Hvornår kilden sidst svarede — uanset om der var data i svaret. */
  lastReply: number | null;
  /** Hvornår vi sidst fik en brugbar måling. */
  lastGood: number | null;
  /** Første kald er ikke kommet retur endnu. */
  loading: boolean;
}

const EMPTY: LiveState = {
  values: new Map(),
  history: new Map(),
  lastReply: null,
  lastGood: null,
  loading: true,
};

/**
 * Poller datakilden én gang i sekundet, så længe Live-visningen er fremme.
 * Historikken ligger i en ref og kopieres ud ved hvert svar — den kan blive
 * lang, og den skal ikke udløse gentegning af mere end nødvendigt.
 */
export function useLiveSignals(
  kind: LiveSourceKind,
  signalIds: string[],
  active: boolean,
): LiveState {
  const [state, setState] = useState<LiveState>(EMPTY);
  const history = useRef(new Map<string, Sample[]>());
  // Stabil nøgle, så hooket ikke genstarter hver gang listen laves om.
  const key = signalIds.join(",");

  useEffect(() => {
    if (!active) return;
    const ids = key ? key.split(",") : [];
    if (ids.length === 0) return;

    const source = createLiveSource(kind, ids);
    let alive = true;
    let lastGood: number | null = null;

    const tick = async () => {
      const snapshot = await source.getSnapshot();
      if (!alive) return;
      const now = Date.now();

      for (const v of snapshot) {
        if (v.quality === "no-source") continue;
        const list = history.current.get(v.signalId) ?? [];
        list.push({ t: new Date(v.timestamp).getTime(), raw: v.raw, value: v.value, quality: v.quality });
        // Fast loft frem for at rydde op på tid — billigere, og 15 min er nok.
        if (list.length > MAX_SAMPLES) list.splice(0, list.length - MAX_SAMPLES);
        history.current.set(v.signalId, list);
      }
      if (snapshot.some((v) => v.quality === "good")) lastGood = now;

      setState({
        values: new Map(snapshot.map((v) => [v.signalId, v])),
        history: new Map(history.current),
        lastReply: now,
        lastGood,
        loading: false,
      });
    };

    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [kind, key, active]);

  // Historikken hører til datakilden — skifter den, starter vi forfra.
  useEffect(() => { history.current = new Map(); }, [kind]);

  return active ? state : EMPTY;
}

/** Min, maks og gennemsnit over de prøver, der faktisk bar en værdi. */
export function summarise(samples: Sample[]) {
  const ok = samples.filter(
    (s): s is Sample & { value: number } => s.value !== null && Number.isFinite(s.value) && s.quality !== "fault",
  );
  if (ok.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const s of ok) {
    if (s.value < min) min = s.value;
    if (s.value > max) max = s.value;
    sum += s.value;
  }
  return { min, max, avg: sum / ok.length, n: ok.length, spanMs: ok[ok.length - 1].t - ok[0].t };
}

export { STALE_AFTER_MS };
