"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tallyMedTelemetri, type HudModel } from "../../lib/ai-hud";
import { SITE } from "../../lib/context";
import { rateFrom } from "../../lib/flow";
import { layoutLine } from "../../lib/layout";
import type { LiveSourceKind } from "../../lib/live-source";
import type { OtLayout } from "../../lib/ot";
import type { Motor, OrdreValg, TelemetriBillede } from "../../lib/telemetri";
import type { LineData } from "../../lib/types";
import { ChainCircuit } from "./ChainCircuit";
import { Hologram } from "./Hologram";
import {
  AgentCores, DriftPanel, FlowPanel, FokusPanel, Haendelser, KlimaPanel,
  LaboratoriePanel, OrdrePanel, Overskrift, Readout,
} from "./HudPanels";
import { AnbefalingerPanel, EnhedPanel } from "./Enhed";
import { Afkod } from "./Instrumenter";
import { AgentMaaler } from "./Logge";
import { LogVindue } from "./LogVindue";
import { useTelemetri, type KanalTilstand } from "./useTelemetri";
import "./hud.css";

/**
 * Kontrolrummet — og med en ordre linjeskærmen i operatørrummet.
 *
 * Linjeskærmen viser linjen, ikke simuleringen: der er ingen knap, der skruer
 * på tiden. Fart, forfra og Claude styres fra kontoret (`/ai/demo/kontor`),
 * som kan sidde på en anden maskine. Gangen står her stadig, så ingen tager
 * en time på skærmen for en time i hallen.
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
export function HudView({ model, line, ot, liveSource, measure, fokusWid, flaskehals, ophobning, seed, motor = "regler" }: {
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
  /** En anden dag: et andet seed giver andre hændelser. */
  seed?: number;
  /** Hvem der tænker for Claude-agenterne. */
  motor?: Motor;
}) {
  useFrameProbe(measure);
  const still = useReducedMotion();
  const layout = useMemo(() => layoutLine(line), [line]);
  const flowSignal = model.links.find((l) => l.instrument.signalId)?.instrument.signalId;
  // I fremskrivningen køres ordren fra start til slut — når der er en ordre
  // og et 100 %-punkt at regne kilo med. Ellers kører simulatoren bare.
  const ordre = useMemo<OrdreValg | null>(() => {
    const o = model.ordre;
    if (!model.fremskrevet || !o.ordreNr || !o.estimeretKg || !o.kasser || !model.flow.nominal) return null;
    return { ordreNr: o.ordreNr, estimeretKg: o.estimeretKg, kasser: o.kasser, nominalTPrT: model.flow.nominal };
  }, [model]);
  // Kontoret beder om Claude eller regler. Det er en anden adresse — resten
  // af den står, som den stod.
  const router = useRouter();
  const skiftMotor = useCallback((m: Motor) => {
    const u = new URL(window.location.href);
    if (m === "claude") u.searchParams.set("agenter", "claude");
    else u.searchParams.delete("agenter");
    router.replace(`${u.pathname}${u.search}`);
  }, [router]);
  const { billede, historik, log, samtale, styring, agenter, kanal } = useTelemetri({
    layout, fremskrevet: model.fremskrevet, liveSource, flowSignal, flaskehals, ophobning, ordre, seed, motor,
    onMotor: skiftMotor,
  });
  const nu = useUr();
  const boot = useOpstart(still);
  const laast = fokusWid ? layout.machines.find((m) => m.wIds.includes(fokusWid))?.id ?? null : null;
  // Turen hører til præsentationen. I en simulering står kameraet stille og
  // flytter sig kun, når man klikker på en enhed — eller selv slår turen til.
  const [turValg, setTurValg] = useState<boolean | null>(null);
  const tur = turValg ?? !styring;
  const [valgt, setValgt] = useState<string | null>(null);
  const [turFokus, pause] = useTur(billede, still || laast !== null || !tur || valgt !== null);
  const fokus = valgt ?? laast ?? (tur ? turFokus : null);
  const lukEnhed = useCallback(() => setValgt(null), []);
  const vaelg = useCallback((id: string) => setValgt(id), []);
  // Skanningen løber, når Kædevagten kører: de første tolv sekunder af hvert
  // kvarter, samme kadence som agenten har i agents.ts. Kun i fremskrivningen
  // — i virkeligheden kører vagten ikke endnu.
  const vagt = model.fremskrevet && (styring ? billede.t : nu) % 900_000 < 12_000;
  // Er tallene simulerede — enten af fremskrivningen eller af LiveSource —
  // skal hvert instrument, der viser dem, sige det.
  const sim = billede.simuleret || liveSource === "mock";
  const iFokus = fokus ? billede.maskiner.find((m) => m.id === fokus) ?? null : null;
  const iValgt = valgt ? billede.maskiner.find((m) => m.id === valgt) ?? null : null;
  const [logAaben, setLogAaben] = useState(false);
  const lukLog = useCallback(() => setLogAaben(false), []);

  return (
    <main
      className={`ai-hud${model.fremskrevet || liveSource === "mock" ? " is-fremskrevet" : ""}${boot ? " is-boot" : ""}`}
      onPointerDown={(e) => { if ((e.target as HTMLElement).tagName === "CANVAS") pause(); }}
    >
      <Hologram data={line} ot={ot} still={still} billede={billede} fokus={fokus} skanning={vagt} svaj={tur && valgt === null} onVaelg={vaelg} />
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
        {styring ? <Ur nu={billede.t} /> : <Ur nu={nu} />}
        <Puls billede={billede} sim={sim} />
        {styring && <span className="hud-gang fm-num">{styring.gang === 0 ? "Pause" : `×${styring.gang}`}</span>}
        <button type="button" className={`hud-fartknap${tur ? " is-valgt" : ""}`} aria-pressed={tur} onClick={() => setTurValg(!tur)}>Tur</button>
        {valgt && <button type="button" className="hud-fartknap" onClick={lukEnhed}>Oversigt</button>}
        {agenter && <AgentMaaler a={agenter} kort />}
        {kanal && <KanalMaerke k={kanal} />}
        <h1><Afkod tekst={model.fremskrevet ? "AI-overblik · fremskrevet" : "AI-overblik"} forsinkelse={150} still={still} /></h1>
        {!model.fremskrevet && <Link href="/ai/demo" className="hud-switch">Med signaler inde</Link>}
        <Link href="/ai?visning=dokument" className="hud-switch">Dokumentvisning</Link>
      </header>

      <div className="hud-left">
        <OrdrePanel ordre={model.ordre} nominal={model.flow.nominal} gennemloeb={billede.gennemloeb} status={billede.ordre} nr={1} still={still} />
        <FlowPanel model={model} billede={billede} historik={historik} sim={sim} nr={2} still={still} />
        <DriftPanel billede={billede} historik={historik} nr={3} still={still} />
        <KlimaPanel billede={billede} historik={historik} nr={4} still={still} />
      </div>

      <div className="hud-stage">
        <Overskrift model={model} billede={billede} still={still} />
        <div className="hud-stage-bund">
          {iValgt ? (
            <EnhedPanel
              m={iValgt}
              billede={billede}
              historik={historik}
              log={log}
              samtale={samtale}
              ot={ot}
              onLuk={lukEnhed}
              onUdfoer={styring?.udfoer}
              onAfvis={styring?.afvis}
            />
          ) : (
            <FokusPanel m={iFokus} historik={historik} sim={billede.simuleret} />
          )}
          <Readout tally={tallyMedTelemetri(model, billede)} sim={billede.simuleret} />
        </div>
      </div>

      <div className="hud-right">
        <AgentCores model={model} nr={5} still={still} ai={billede.ai} sim={billede.simuleret} samtale={samtale} />
        <LaboratoriePanel billede={billede} nr={6} still={still} />
        {styring && (
          <AnbefalingerPanel
            anbefalinger={billede.anbefalinger}
            sim={billede.simuleret}
            nr={7}
            still={still}
            onUdfoer={styring.udfoer}
            onAfvis={styring.afvis}
          />
        )}
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
        <Haendelser billede={billede} nr={9} still={still} onAaben={() => setLogAaben(true)} />
      </div>

      {logAaben && (
        <LogVindue
          log={log}
          samtale={styring ? samtale : null}
          sim={billede.simuleret}
          onLuk={lukLog}
        />
      )}

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
 * Kanalen til kontoret. Intet mærke, når alt er, som det skal være — kun når
 * kontoret ikke kan se, hvad der sker her.
 */
function KanalMaerke({ k }: { k: KanalTilstand }) {
  // Serveren svarer ikke: det er en fejl, rød som på kontoret. En anden
  // linjeskærm, der har taget over, er det ikke.
  if (k.fejl) return <span className="hud-kanal is-fejl">Kontoret afbrudt</span>;
  if (k.ejer === false) return <span className="hud-kanal">Anden linjeskærm sender</span>;
  return null;
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
