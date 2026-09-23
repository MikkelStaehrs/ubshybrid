"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SIMULERING } from "../../../data/fremskrivning";
import type { Layout } from "../../lib/layout";
import type { LiveSourceKind } from "../../lib/live-source";
import type { Besked } from "../../lib/samspil";
import {
  samlLog, samlSamtale, simulator, tomtBillede,
  type Haendelse, type Motor, type Opgave, type OrdreValg, type TelemetriBillede,
} from "../../lib/telemetri";
import { useLiveSignals } from "../../lib/useLiveSignals";
import { aabnKanal, type AgentStatus, type Hastighed, type SimBesked, type SimStatus } from "./simKanal";

/** Så mange fejl i træk, før reglerne tager over for resten af kørslen. */
const FEJL_I_TRAEK = 3;

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
  /** Hvem der tænker, og hvad det koster. Kun når der køres en ordre. */
  agenter: AgentStatus | null;
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
  /** Hvem der tænker for Claude-agenterne. "claude" koster penge pr. kald. */
  motor?: Motor;
}): Telemetri {
  const {
    layout, fremskrevet, liveSource, flowSignal, flaskehals = false, ophobning = false, ordre = null, seed,
    motor = "regler",
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
  const [agenter, setAgenter] = useState<AgentStatus | null>(null);
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
    // Med Claude er hver kørsel en ny dag: et tilfældigt seed, med mindre
    // adressen siger et bestemt. Seedet står på skærmen, så en kørsel kan
    // køres igen — med de samme hændelser, ikke de samme svar.
    const brugtSeed = seed ?? (motor === "claude" ? Math.floor(Math.random() * 100_000) : SIMULERING.seed);
    const s = simulator(layout, {
      seed: brugtSeed,
      ordre,
      motor,
      tvungenFlaskehals: flaskehals,
      // Ti minutter inde i ordren — efter opstarten, så man kan se det ske.
      planlagteStop: ophobning ? [{ wid: "636", fraS: 600, varighedS: 180 }] : [],
    });

    // --- Claude-agenterne ---------------------------------------------------
    // Hver opgave sendes til serveren, der kalder Claude. Svaret går tilbage
    // i simuleringen. Svarer Claude ikke, svarer reglerne — og er loftet nået
    // eller nøglen væk, tager reglerne over for resten af kørslen.
    let aktiv = true;
    const id = `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const sendt = new Set<number>();
    const venter = new Map<number, string>();
    const status: AgentStatus = {
      motor, kald: 0, brugtKr: 0, loftKr: 0, venter: [], stoppet: null, fejl: null, seed: brugtSeed,
    };
    let fejlITraek = 0;
    const vis = () => { if (aktiv) setAgenter({ ...status, venter: [...venter.values()] }); };
    vis();
    if (motor === "claude") {
      void fetch(`/api/agent?koersel=${id}`).then((r) => r.json()).then((d: { klar: boolean; budget: { loftKr: number } }) => {
        status.loftKr = d.budget.loftKr;
        if (!d.klar) status.stoppet = "Ingen API-nøgle på serveren";
        vis();
      }).catch(() => { /* ruten svarer ved første opgave */ });
    }
    const spoerg = async (o: Opgave) => {
      venter.set(o.id, o.agent);
      vis();
      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            koersel: id,
            opgave: {
              agent: o.agent, t: o.t, spoergsmaal: o.spoergsmaal, situation: o.situation,
              handlinger: o.handlinger, modtagere: o.modtagere, standard: o.standard,
            },
            samtale: samtale.current.slice(0, 8).reverse().map(({ fra, til, type, tekst }) => ({ fra, til, type, tekst })),
          }),
          signal: AbortSignal.timeout(35_000),
        });
        const d = await res.json() as { svar?: Parameters<typeof s.svar>[1]; fejl?: string; kr?: number; budget?: { brugtKr: number; loftKr: number } };
        if (!aktiv) return;
        if (d.budget) { status.brugtKr = d.budget.brugtKr; status.loftKr = d.budget.loftKr; }
        // Kald tæller de kald, der kostede noget — også dem, hvis svar ikke
        // kunne bruges. Ellers hørte antallet og prisen til hver sit.
        if ((d.kr ?? 0) > 0) status.kald++;
        if (res.ok && d.svar) {
          fejlITraek = 0;
          s.svar(o.id, d.svar);
          return;
        }
        s.svar(o.id, null);
        status.fejl = d.fejl ?? `Ruten svarede ${res.status}`;
        // Loft, manglende nøgle eller login: det går ikke over af sig selv.
        if (res.status === 402 || res.status === 503 || res.status === 401 || ++fejlITraek >= FEJL_I_TRAEK) status.stoppet = status.fejl;
      } catch {
        if (!aktiv) return;
        s.svar(o.id, null);
        status.fejl = "Kunne ikke nå serveren";
        if (++fejlITraek >= FEJL_I_TRAEK) status.stoppet = status.fejl;
      } finally {
        venter.delete(o.id);
        vis();
      }
    };
    const tagOpgaver = (b: TelemetriBillede) => {
      for (const o of b.opgaver) {
        if (sendt.has(o.id)) continue;
        sendt.add(o.id);
        if (status.stoppet) s.svar(o.id, null);
        else void spoerg(o);
      }
    };
    let simNu = startKlokke();
    historik.current = new Map();
    log.current = [];
    samtale.current = [];
    let b = s.skridt(TAKT_MS, simNu);
    arkiver(historik.current, b);
    setSim(b);

    const kanal = aabnKanal();
    const tilstand = (g: number): SimStatus => ({
      t: simNu, valgt: valgtRef.current, gang: g, ordre: b.ordre, uro: b.uro,
      agenter: { ...status, venter: [...venter.values()] },
    });
    // Loggen på skærm 2 får det hele, når den beder om det — og en tom log,
    // når simuleringen startes forfra.
    kanal?.postMessage({ type: "tilstand", status: tilstand(0), log: [], samtale: [] } satisfies SimBesked);
    if (kanal) {
      kanal.onmessage = (e: MessageEvent<SimBesked>) => {
        if (e.data.type === "hej") {
          kanal.postMessage({ type: "tilstand", status: tilstand(0), log: log.current, samtale: samtale.current } satisfies SimBesked);
        }
      };
    }

    let sidst = Date.now();
    let sidsteUro = simNu;
    const ur = setInterval(() => {
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
      // Tænker en agent, går tiden i virkelig tid: så er svartiden ægte, og
      // det, der sker imens, sker i det tempo, det ville.
      if (g > 1 && (venter.size > 0 || b.opgaver.length > 0)) g = 1;
      setGang(g);
      let rest = realDt * g;
      // På pause står ordren, men loggen på skærm 2 skal stadig vide, at
      // kontrolrummet er der.
      if (rest <= 0) {
        kanal?.postMessage({ type: "tilstand", status: tilstand(0) } satisfies SimBesked);
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
        // ellers var det overstået, før nogen nåede at se det. Og får en
        // agent noget at tænke over, går tiden i virkelig tid fra dét øjeblik.
        const taenker = motor === "claude" && s.antalOpgaver() > 0;
        if ((sker && v === "auto" && g === SIMULERING.hurtig) || (taenker && g > 1)) {
          sidsteUro = simNu;
          g = SIMULERING.langsom;
          b = s.skridt(0, simNu);
          break;
        }
      }
      if (b.uro.length > 0) sidsteUro = simNu;
      if (motor === "claude") tagOpgaver(b);
      arkiver(historik.current, b);
      log.current = samlLog(log.current, b.haendelser);
      samtale.current = samlSamtale(samtale.current, b.samtale);
      setSim(b);
      kanal?.postMessage({
        type: "tilstand",
        status: tilstand(g),
        ...(log.current !== foerLog ? { log: log.current } : {}),
        ...(samtale.current !== foerSamtale ? { samtale: samtale.current } : {}),
      } satisfies SimBesked);
    }, TAKT_MS);
    return () => {
      aktiv = false;
      clearInterval(ur);
      kanal?.close();
    };
  }, [fremskrevet, ordre, layout, flaskehals, ophobning, seed, koersel, motor]);

  const styring = useMemo<Styring | null>(
    () => (fremskrevet && ordre ? { valgt, gang, saet, genstart } : null),
    [fremskrevet, ordre, valgt, gang, saet, genstart],
  );

  if (fremskrevet && sim) {
    return {
      billede: sim, historik: historik.current, log: log.current, samtale: samtale.current, styring,
      agenter: ordre ? agenter : null,
    };
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
  return { billede, historik: h, log: billede.haendelser, samtale: [], styring: null, agenter: null };
}
