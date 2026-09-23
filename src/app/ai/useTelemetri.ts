"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SIMULERING } from "../../../data/fremskrivning";
import type { Layout } from "../../lib/layout";
import type { LiveSourceKind } from "../../lib/live-source";
import type { Besked } from "../../lib/samspil";
import {
  samlLog, samlSamtale, simulator, tomtBillede,
  type Haendelse, type OrdreValg, type TelemetriBillede,
} from "../../lib/telemetri";
import { useLiveSignals } from "../../lib/useLiveSignals";
import { aabnKanal, type Hastighed, type SimBesked, type SimStatus } from "./simKanal";

/** Fire gange i sekundet: tal og kurver glider i stedet for at hoppe. */
export const TAKT_MS = 250;
/** Et minut historik ved fire prøver i sekundet. */
export const HISTORIK = 240;
/** Det længste skridt, simulatoren tager, når tiden går hurtigt. */
const SKRIDT_MS = 500;

/** Serier, kurverne tegnes af. Nøglen er "flow", "hal:temp", "m:<id>:<kanal>". */
export type Historik = Map<string, (number | null)[]>;

/** Hvem der driver tiden i ordresimuleringen. */
export interface Styring {
  valgt: Hastighed;
  /** Gangen lige nu. 0 er pause. */
  gang: number;
  saet: (h: Hastighed) => void;
  genstart: () => void;
}

export interface Telemetri {
  billede: TelemetriBillede;
  historik: Historik;
  /** Alt, der er sket, siden siden åbnede. Nyeste først. */
  log: Haendelse[];
  /** Agenterne imellem. Nyeste først. Tom uden en ordre. */
  samtale: Besked[];
  /** Kun når der køres en ordre. */
  styring: Styring | null;
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

/** I dag, klokken ordren starter. Simuleringens ur begynder dér. */
function startKlokke(): number {
  const d = new Date();
  d.setHours(SIMULERING.startKl, 0, 0, 0);
  return d.getTime();
}

/**
 * Telemetrien til HUD'en.
 *
 * I fremskrivningen kører simulatoren her i browseren. Med en ordre kører
 * den ordren fra start til slut, og tiden går hurtigt, når alt er roligt, og
 * langsomt, når der sker noget. Uden en ordre forvarmes den et minut og
 * kører bare. Alle tallene er simulerede, og det står i billedet.
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
  /** Lad KB-3N gå i stå kort efter start. Kun i fremskrivningen. */
  ophobning?: boolean;
  /** Kør én ordre fra start til slut. Kun i fremskrivningen. */
  ordre?: OrdreValg | null;
  seed?: number;
}): Telemetri {
  const {
    layout, fremskrevet, liveSource, flowSignal, flaskehals = false, ophobning = false, ordre = null, seed,
  } = opts;

  // --- Anlægget som det står --------------------------------------------------
  const ids = useMemo(() => (flowSignal && !fremskrevet ? [flowSignal] : []), [flowSignal, fremskrevet]);
  const live = useLiveSignals(liveSource, ids, ids.length > 0);

  // --- Fremskrivningen --------------------------------------------------------
  const historik = useRef<Historik>(new Map());
  const log = useRef<Haendelse[]>([]);
  const samtale = useRef<Besked[]>([]);
  const [sim, setSim] = useState<TelemetriBillede | null>(null);

  // Farten. Intervallet læser den gennem en ref, så et skift ikke starter
  // simuleringen forfra.
  const [valgt, setValgt] = useState<Hastighed>("auto");
  const valgtRef = useRef<Hastighed>("auto");
  const [gang, setGang] = useState(0);
  const [koersel, setKoersel] = useState(0);
  const saet = useCallback((h: Hastighed) => { valgtRef.current = h; setValgt(h); }, []);
  const genstart = useCallback(() => setKoersel((n) => n + 1), []);

  // Uden ordre: forvarm et minut, og kør i virkelig tid.
  useEffect(() => {
    if (!fremskrevet || ordre) return;
    // Simulatoren forvarmes et minut. Et planlagt stop regnes fra dens start,
    // så fem sekunder efter forvarmningen er fem sekunder efter, siden åbnede.
    const forvarm = (HISTORIK * TAKT_MS) / 1000;
    const s = simulator(layout, {
      seed,
      tvungenFlaskehals: flaskehals,
      planlagteStop: ophobning ? [{ wid: "636", fraS: forvarm + 5, varighedS: 150 }] : [],
    });
    const h: Historik = new Map();
    const nu = Date.now();
    let b: TelemetriBillede | null = null;
    let l: Haendelse[] = [];
    for (let i = HISTORIK; i > 0; i--) {
      b = s.skridt(TAKT_MS, nu - i * TAKT_MS);
      arkiver(h, b);
      l = samlLog(l, b.haendelser);
    }
    historik.current = h;
    log.current = l;
    samtale.current = [];
    setSim(b);

    let sidst = Date.now();
    const id = setInterval(() => {
      const t = Date.now();
      const nyt = s.skridt(t - sidst, t);
      sidst = t;
      arkiver(historik.current, nyt);
      log.current = samlLog(log.current, nyt.haendelser);
      setSim(nyt);
    }, TAKT_MS);
    return () => clearInterval(id);
  }, [fremskrevet, ordre, layout, flaskehals, ophobning, seed]);

  // Med ordre: ordren fra start til slut, i den fart styringen siger.
  useEffect(() => {
    if (!fremskrevet || !ordre) return;
    const s = simulator(layout, {
      seed: seed ?? SIMULERING.seed,
      ordre,
      tvungenFlaskehals: flaskehals,
      // Ti minutter inde i ordren — efter opstarten, så man kan se det ske.
      planlagteStop: ophobning ? [{ wid: "636", fraS: 600, varighedS: 180 }] : [],
    });
    let simNu = startKlokke();
    historik.current = new Map();
    log.current = [];
    samtale.current = [];
    let b = s.skridt(TAKT_MS, simNu);
    arkiver(historik.current, b);
    setSim(b);

    const kanal = aabnKanal();
    const status = (g: number): SimStatus => ({ t: simNu, valgt: valgtRef.current, gang: g, ordre: b.ordre, uro: b.uro });
    // Loggen på skærm 2 får det hele, når den beder om det — og en tom log,
    // når simuleringen startes forfra.
    kanal?.postMessage({ type: "tilstand", status: status(0), log: [], samtale: [] } satisfies SimBesked);
    if (kanal) {
      kanal.onmessage = (e: MessageEvent<SimBesked>) => {
        if (e.data.type === "hej") {
          kanal.postMessage({ type: "tilstand", status: status(0), log: log.current, samtale: samtale.current } satisfies SimBesked);
        }
      };
    }

    let sidst = Date.now();
    let sidsteUro = simNu;
    const id = setInterval(() => {
      const t = Date.now();
      // Et hak i browseren må ikke blive til et spring i ordren.
      const realDt = Math.min(t - sidst, 1000);
      sidst = t;
      const v = valgtRef.current;
      const faerdig = b.ordre?.fase === "faerdig";
      const urolig = () => b.uro.length > 0 || simNu - sidsteUro < SIMULERING.efterS * 1000;
      let g = v === "pause" || (v === "auto" && faerdig) ? 0
        : v === "auto" ? (urolig() ? SIMULERING.langsom : SIMULERING.hurtig)
        : v;
      setGang(g);
      let rest = realDt * g;
      // På pause står ordren, men loggen på skærm 2 skal stadig vide, at
      // kontrolrummet er der.
      if (rest <= 0) {
        kanal?.postMessage({ type: "tilstand", status: status(0) } satisfies SimBesked);
        return;
      }

      const foerLog = log.current;
      const foerSamtale = samtale.current;
      while (rest > 0) {
        const d = Math.min(SKRIDT_MS, rest);
        rest -= d;
        simNu += d;
        // Kun det sidste skridt skal vises.
        if (rest <= 0) { b = s.skridt(d, simNu); break; }
        const sker = s.frem(d, simNu);
        // Sker der noget midt i et hurtigt spring, stopper springet dér —
        // ellers var det overstået, før nogen nåede at se det.
        if (sker && v === "auto" && g === SIMULERING.hurtig) {
          sidsteUro = simNu;
          g = SIMULERING.langsom;
          b = s.skridt(0, simNu);
          break;
        }
      }
      if (b.uro.length > 0) sidsteUro = simNu;
      arkiver(historik.current, b);
      log.current = samlLog(log.current, b.haendelser);
      samtale.current = samlSamtale(samtale.current, b.samtale);
      setSim(b);
      kanal?.postMessage({
        type: "tilstand",
        status: status(g),
        ...(log.current !== foerLog ? { log: log.current } : {}),
        ...(samtale.current !== foerSamtale ? { samtale: samtale.current } : {}),
      } satisfies SimBesked);
    }, TAKT_MS);
    return () => {
      clearInterval(id);
      kanal?.close();
    };
  }, [fremskrevet, ordre, layout, flaskehals, ophobning, seed, koersel]);

  const styring = useMemo<Styring | null>(
    () => (fremskrevet && ordre ? { valgt, gang, saet, genstart } : null),
    [fremskrevet, ordre, valgt, gang, saet, genstart],
  );

  if (fremskrevet && sim) {
    return { billede: sim, historik: historik.current, log: log.current, samtale: samtale.current, styring };
  }

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
  return { billede, historik: h, log: billede.haendelser, samtale: [], styring: null };
}
