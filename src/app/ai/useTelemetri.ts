"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Layout } from "../../lib/layout";
import type { LiveSourceKind } from "../../lib/live-source";
import { simulator, tomtBillede, type TelemetriBillede } from "../../lib/telemetri";
import { useLiveSignals } from "../../lib/useLiveSignals";

/** Fire gange i sekundet: tal og kurver glider i stedet for at hoppe. */
export const TAKT_MS = 250;
/** Et minut historik ved fire prøver i sekundet. */
export const HISTORIK = 240;

/** Serier, kurverne tegnes af. Nøglen er "flow", "hal:temp", "m:<id>:<kanal>". */
export type Historik = Map<string, (number | null)[]>;

export interface Telemetri {
  billede: TelemetriBillede;
  historik: Historik;
}

function gem(h: Historik, noegle: string, v: number | null) {
  const serie = h.get(noegle) ?? [];
  serie.push(v);
  if (serie.length > HISTORIK) serie.splice(0, serie.length - HISTORIK);
  h.set(noegle, serie);
}

/** Alt, der skal tegnes som en kurve, lagt i historikken. */
function arkiver(h: Historik, b: TelemetriBillede) {
  gem(h, "flow", b.flowPct);
  gem(h, "flowMa", b.flowMa);
  for (const k of b.hal) gem(h, `hal:${k.spec.id}`, k.value);
  for (const m of b.maskiner) {
    for (const k of m.kanaler) gem(h, `m:${m.id}:${k.spec.id}`, k.value);
  }
  gem(h, "oppetid", b.oppetidPct);
}

/**
 * Telemetrien til HUD'en.
 *
 * I fremskrivningen kører simulatoren her i browseren. Den forvarmes med et
 * minuts forløb, så kurverne ikke står tomme det første minut — alle tallene
 * er simulerede under alle omstændigheder, og det står i billedet.
 *
 * I den rigtige visning er der ingen simulator. Maskinerne har ingen tal, og
 * kun flowet kommer ind, fra den samme LiveSource som kortet.
 */
export function useTelemetri(opts: {
  layout: Layout;
  fremskrevet: boolean;
  liveSource: LiveSourceKind;
  flowSignal: string | undefined;
  /** Hold flaskehalsen i kæden fremme. Kun i fremskrivningen. */
  flaskehals?: boolean;
}): Telemetri {
  const { layout, fremskrevet, liveSource, flowSignal, flaskehals = false } = opts;

  // --- Anlægget som det står --------------------------------------------------
  const ids = useMemo(() => (flowSignal && !fremskrevet ? [flowSignal] : []), [flowSignal, fremskrevet]);
  const live = useLiveSignals(liveSource, ids, ids.length > 0);

  // --- Fremskrivningen --------------------------------------------------------
  const historik = useRef<Historik>(new Map());
  const [sim, setSim] = useState<TelemetriBillede | null>(null);

  useEffect(() => {
    if (!fremskrevet) return;
    const s = simulator(layout, undefined, undefined, flaskehals);
    const h: Historik = new Map();
    // Forvarm et minut, så kurverne har noget at vise fra første billede.
    const nu = Date.now();
    let b: TelemetriBillede | null = null;
    for (let i = HISTORIK; i > 0; i--) {
      b = s.skridt(TAKT_MS, nu - i * TAKT_MS);
      arkiver(h, b);
    }
    historik.current = h;
    setSim(b);

    let sidst = Date.now();
    const id = setInterval(() => {
      const t = Date.now();
      const nyt = s.skridt(t - sidst, t);
      sidst = t;
      arkiver(historik.current, nyt);
      setSim(nyt);
    }, TAKT_MS);
    return () => clearInterval(id);
  }, [fremskrevet, layout, flaskehals]);

  if (fremskrevet && sim) return { billede: sim, historik: historik.current };

  // Den rigtige visning: tomt billede med det flow, LiveSource har.
  const v = flowSignal ? live.values.get(flowSignal) : undefined;
  const pct = v && v.value !== null && Number.isFinite(v.value) ? v.value : null;
  // Billedets tid er målingens. Stemplede vi det med uret, ville alt, der
  // følger billedet — pulsen i toppen — slå, uden at noget var kommet ind.
  const billede = tomtBillede(layout, v ? new Date(v.timestamp).getTime() : 0, pct);
  if (v && Number.isFinite(v.raw)) billede.flowMa = v.raw;

  const h: Historik = new Map();
  const samples = flowSignal ? live.history.get(flowSignal) ?? [] : [];
  h.set("flow", samples.slice(-HISTORIK).map((s) => s.value));
  h.set("flowMa", samples.slice(-HISTORIK).map((s) => (Number.isFinite(s.raw) ? s.raw : null)));
  return { billede, historik: h };
}
