"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { tallyMedTelemetri, type HudModel } from "../../lib/ai-hud";
import { SITE } from "../../lib/context";
import { rateFrom } from "../../lib/flow";
import { layoutLine } from "../../lib/layout";
import type { LiveSourceKind } from "../../lib/live-source";
import type { OtLayout } from "../../lib/ot";
import type { TelemetriBillede } from "../../lib/telemetri";
import type { LineData } from "../../lib/types";
import { ChainCircuit } from "./ChainCircuit";
import { Hologram } from "./Hologram";
import {
  AgentCores, DriftPanel, FlowPanel, FokusPanel, Haendelser, KastebordPanel, KlimaPanel,
  KvalitetPanel, OrdrePanel, Overskrift, Readout,
} from "./HudPanels";
import { Afkod } from "./Instrumenter";
import { useTelemetri } from "./useTelemetri";
import "./hud.css";

/**
 * Kontrolrummet.
 *
 * Hologrammet fylder hele skærmen og er scenen. Panelerne ligger i kanterne:
 * ordren, flow, drift og hallen til venstre; agenter, analyse og kasteborde til
 * højre; kæden og hændelserne i bunden. Midt i scenen står det vigtigste
 * lige nu, og nede i venstre hjørne den maskine, kameraet er på besøg hos.
 *
 * To slags bevægelse, og de holdes adskilt:
 *   - Data: pulser, strøm, visere, kurver, farver. Hver af dem svarer til en
 *     tilstand, og står tallet stille, står de stille.
 *   - Grænseflade: opstarten og kameraets tur. De viser ingen data og
 *     lader ikke som om. `prefers-reduced-motion` slukker begge.
 */
export function HudView({ model, line, ot, liveSource, measure, fokusWid, flaskehals, ophobning }: {
  model: HudModel;
  line: LineData;
  ot: OtLayout | null;
  liveSource: LiveSourceKind;
  measure?: boolean;
  /** Lås kameraet på maskinen med det her W-ID. Turen holder pause. */
  fokusWid?: string;
  /** Hold en flaskehals i kæden fremme. */
  flaskehals?: boolean;
  /** Lad KB-3N gå i stå kort efter start, så Driftsagenten kan ses gribe ind. */
  ophobning?: boolean;
}) {
  useFrameProbe(measure);
  const still = useReducedMotion();
  const layout = useMemo(() => layoutLine(line), [line]);
  const flowSignal = model.links.find((l) => l.instrument.signalId)?.instrument.signalId;
  const { billede, historik } = useTelemetri({
    layout, fremskrevet: model.fremskrevet, liveSource, flowSignal, flaskehals, ophobning,
  });
  const nu = useUr();
  const boot = useOpstart(still);
  const laast = fokusWid ? layout.machines.find((m) => m.wIds.includes(fokusWid))?.id ?? null : null;
  const [turFokus, pause] = useTur(billede, still || laast !== null);
  const fokus = laast ?? turFokus;
  // Skanningen løber, når Kædevagten kører: de første tolv sekunder af hvert
  // kvarter, samme kadence som agenten har i agents.ts. Kun i fremskrivningen
  // — i virkeligheden kører vagten ikke endnu.
  const vagt = model.fremskrevet && nu % 900_000 < 12_000;
  // Er tallene simulerede — enten af fremskrivningen eller af LiveSource —
  // skal hvert instrument, der viser dem, sige det.
  const sim = billede.simuleret || liveSource === "mock";
  const iFokus = fokus ? billede.maskiner.find((m) => m.id === fokus) ?? null : null;

  return (
    <main
      className={`ai-hud${model.fremskrevet || liveSource === "mock" ? " is-fremskrevet" : ""}${boot ? " is-boot" : ""}`}
      onPointerDown={(e) => { if ((e.target as HTMLElement).tagName === "CANVAS") pause(); }}
    >
      <Hologram data={line} ot={ot} still={still} billede={billede} fokus={fokus} skanning={vagt} />
      <div className="hud-skanlinjer" aria-hidden />

      {model.fremskrevet && (
        <div className="hud-opdigtet" role="status">
          <span className="ho-mark">Fremskrivning</span>
          <span className="ho-text">Ingen af tallene er målt</span>
          <Link href="/ai" className="ho-back">Anlægget som det står</Link>
        </div>
      )}

      {!model.fremskrevet && liveSource === "mock" && (
        <div className="hud-opdigtet is-sim" role="status">
          <span className="ho-mark">Simulator</span>
          <span className="ho-text">{flowSignal ?? "Måleren"} er ikke hentet gennem kæden</span>
        </div>
      )}

      <header className="hud-top">
        <span className="hud-eyebrow">{SITE}</span>
        <span className="hud-sep" aria-hidden />
        <span className="hud-line-name">{model.lineName}</span>
        <span className="hud-sep" aria-hidden />
        <Ur nu={nu} />
        <Puls billede={billede} sim={sim} />
        <h1><Afkod tekst={model.fremskrevet ? "AI-overblik · fremskrevet" : "AI-overblik"} forsinkelse={150} still={still} /></h1>
        {!model.fremskrevet && <Link href="/ai/demo" className="hud-switch">Med signaler inde</Link>}
        <Link href="/ai?visning=dokument" className="hud-switch">Dokumentvisning</Link>
      </header>

      <div className="hud-left">
        <OrdrePanel ordre={model.ordre} nr={1} still={still} />
        <FlowPanel model={model} billede={billede} historik={historik} sim={sim} nr={2} still={still} />
        <DriftPanel billede={billede} historik={historik} nr={3} still={still} />
        <KlimaPanel billede={billede} historik={historik} nr={4} still={still} />
      </div>

      <div className="hud-stage">
        <Overskrift model={model} billede={billede} still={still} />
        <div className="hud-stage-bund">
          <FokusPanel m={iFokus} historik={historik} sim={billede.simuleret} />
          <Readout tally={tallyMedTelemetri(model, billede)} sim={billede.simuleret} />
        </div>
      </div>

      <div className="hud-right">
        <AgentCores model={model} nr={5} still={still} ai={billede.ai} sim={billede.simuleret} />
        <KvalitetPanel billede={billede} nr={6} still={still} />
        <KastebordPanel billede={billede} nr={7} still={still} />
      </div>

      <footer className="hud-chain" style={{ ["--i" as string]: 8 }}>
        <div className="hc-head">
          <span className="hp-label">Signalkæden</span>
          <span className="hc-sub">Fra måler til AI</span>
          <span className="hc-reach fm-num">{model.reach.delivers} / {model.reach.total}</span>
        </div>
        <ChainCircuit
          model={model}
          reading={maalerTekst(billede, model)}
          kaede={billede.kaede}
          sim={sim}
        />
      </footer>

      <div className="hud-events">
        <Haendelser billede={billede} nr={9} still={still} />
      </div>

      {boot && <Opstart model={model} liveSource={liveSource} />}
    </main>
  );
}

/** Målerens aflæsning i kæden: procent, og W/HR når 100 %-punktet findes. */
function maalerTekst(b: TelemetriBillede, model: HudModel): { tekst: string; whr?: string } | undefined {
  if (b.flowPct === null) return b.flowMa !== null ? { tekst: "Fejl" } : undefined;
  const tekst = `${b.flowPct.toFixed(1).replace(".", ",")} %`;
  const whr = rateFrom(b.flowPct, model.flow.nominal);
  return whr === null ? { tekst } : { tekst, whr: `${whr.toFixed(2).replace(".", ",")} ${model.flow.rateUnit}` };
}

// ---------------------------------------------------------------------------

function Ur({ nu }: { nu: number }) {
  // Serveren og browseren kender ikke det samme sekund. Indtil browseren
  // har taget over, står der streger — ellers fejler hydreringen.
  if (nu === 0) return <span className="hud-ur fm-num">--<i>:</i>--<i>:</i>--</span>;
  const t = new Date(nu);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    <span className="hud-ur fm-num">
      {p(t.getHours())}<i>:</i>{p(t.getMinutes())}<i>:</i>{p(t.getSeconds())}
    </span>
  );
}

/**
 * Prikken slår, hver gang der kommer et nyt billede. Står kilden stille,
 * står prikken stille — den er en tilstand, ikke et hjerteslag for syns skyld.
 */
function Puls({ billede, sim }: { billede: TelemetriBillede; sim: boolean }) {
  const har = billede.flowPct !== null || billede.maskiner.some((m) => m.koerer !== null);
  return (
    <span className={`hud-puls${har ? " is-live" : ""}`} key={har ? Math.floor(billede.t / 1000) : 0}>
      <span className="hud-puls-dot" />
      {har ? (sim ? "Sim" : "Live") : "Ingen kilde"}
    </span>
  );
}

/** Opstarten: fakta fra modellen, afkodet linje for linje. */
function Opstart({ model, liveSource }: { model: HudModel; liveSource: LiveSourceKind }) {
  const linjer = [
    `${SITE} · ${model.lineName}`,
    `Hologram · ${model.tally.total} maskiner`,
    `Signalkæde · ${model.reach.delivers}/${model.reach.total} led`,
    `Agenter · ${model.decided} besluttet`,
    model.fremskrevet ? "Fremskrivning · simulator" : `Kilde · ${liveSource === "mock" ? "simulator" : "api"}`,
  ];
  return (
    <div className="hud-opstart" aria-hidden>
      {linjer.map((l, i) => (
        <p key={l} style={{ ["--i" as string]: i }}>
          <span className="op-nr">{String(i + 1).padStart(2, "0")}</span>
          <Afkod tekst={l} forsinkelse={i * 260} />
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

function useUr(): number {
  const [nu, setNu] = useState(0);
  useEffect(() => {
    setNu(Date.now());
    const id = setInterval(() => setNu(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return nu;
}

/** Opstartssekvensen står i knap tre sekunder. Ved ro springes den over. */
function useOpstart(still: boolean): boolean {
  const [boot, setBoot] = useState(true);
  useEffect(() => {
    if (still) { setBoot(false); return; }
    const id = setTimeout(() => setBoot(false), 3000);
    return () => clearTimeout(id);
  }, [still]);
  return boot && !still;
}

/**
 * Kameraets tur. Alarmer og stop først, så resten i linjens rækkefølge, med
 * et overblik ind imellem. Rører nogen ved scenen, holder turen pause.
 */
function useTur(billede: TelemetriBillede, still: boolean): [string | null, () => void] {
  const [fokus, setFokus] = useState<string | null>(null);
  const seneste = useRef(billede);
  seneste.current = billede;
  const pauseTil = useRef(0);
  const besoegt = useRef(new Map<string, number>());

  useEffect(() => {
    if (still) { setFokus(null); return; }
    let trin = 0;
    let cursor = 0;
    const id = setInterval(() => {
      if (Date.now() < pauseTil.current) return;
      const b = seneste.current;
      const kandidater = b.maskiner.filter((m) => m.kanaler.some((k) => k.value !== null));
      if (kandidater.length === 0) { setFokus(null); return; }
      trin++;
      const nu = Date.now();
      // Noget galt, vi ikke har set på det sidste halve minut, går forrest.
      const galt = kandidater.find((m) => (m.alarm || (m.koerer === false && !m.styret)) && nu - (besoegt.current.get(m.id) ?? 0) > 30_000);
      if (galt) {
        besoegt.current.set(galt.id, nu);
        setFokus(galt.id);
        return;
      }
      if (trin % 4 === 0) { setFokus(null); return; }
      const m = kandidater[cursor++ % kandidater.length];
      besoegt.current.set(m.id, nu);
      setFokus(m.id);
    }, 6500);
    return () => clearInterval(id);
  }, [still]);

  return [fokus, () => { pauseTil.current = Date.now() + 30_000; }];
}

/** Beder brugeren om ro, står alt stille — uden at tabe indhold. */
function useReducedMotion(): boolean {
  const [still, setStill] = useState(false);
  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const set = () => setStill(mq.matches);
    set();
    mq.addEventListener("change", set);
    return () => mq.removeEventListener("change", set);
  }, []);
  return still;
}

/**
 * Frametids-måling til udvikling. Aktiveres med ?maal=1 og kun uden for
 * produktion.
 */
function useFrameProbe(on?: boolean) {
  useEffect(() => {
    if (!on || process.env.NODE_ENV === "production") return;
    let frames = 0;
    let worst = 0;
    let last = performance.now();
    let raf = 0;
    const start = last;
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      frames++;
      if (dt > worst) worst = dt;
      if (now - start < 5000) raf = requestAnimationFrame(tick);
      else {
        const secs = (now - start) / 1000;
        console.log(`[maal] ${(frames / secs).toFixed(1)} fps over ${secs.toFixed(1)} s, værste frame ${worst.toFixed(1)} ms`);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on]);
}
