"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { HudModel } from "../../lib/ai-hud";
import { SITE } from "../../lib/context";
import type { OtLayout } from "../../lib/ot";
import type { LineData } from "../../lib/types";
import { ChainCircuit } from "./ChainCircuit";
import { Hologram } from "./Hologram";
import { AgentCores, BreakStage, CostPanel, Readout, RunLog } from "./HudPanels";
import "./hud.css";

/**
 * Kontrolrummet.
 *
 * Faste zoner på én skærm: hologrammet er scenen, bruddet står midt i den,
 * kæden ligger som et bånd i bunden, agenterne i højre søjle, omkostning og
 * log i venstre. Der er ingen scroll og ingen kolonne med maksimumsbredde —
 * det her skal kunne stå på en skærm i et mødelokale og læses på afstand.
 *
 * Alt på skærmen kommer fra `model`, som er bygget på serveren af
 * pathState(), signalDelivery() og agentstatus. Der er ingen tilstand her
 * inde og intet, der bevæger sig uden at svare til noget virkeligt.
 */
export function HudView({ model, line, ot, measure }: {
  model: HudModel;
  line: LineData;
  ot: OtLayout | null;
  measure?: boolean;
}) {
  useFrameProbe(measure);
  const still = useReducedMotion();

  return (
    <main className="ai-hud">
      {/* Scenen. Ligger bag alt andet og fylder hele skærmen. */}
      <Hologram data={line} ot={ot} still={still} />

      <header className="hud-top">
        <span className="hud-eyebrow">{SITE}</span>
        <span className="hud-sep" aria-hidden />
        <span className="hud-line-name">{model.lineName}</span>
        <h1>AI-overblik</h1>
        <Link href="/ai?visning=dokument" className="hud-switch">Dokumentvisning</Link>
      </header>

      <div className="hud-left">
        <CostPanel model={model} />
        <RunLog model={model} />
      </div>

      {/* Scenens midte holdes fri: hologrammet skal kunne ses. Kun det
          udlæste tal og bruddet står her, og bruddet er blikfanget. */}
      <div className="hud-stage">
        <BreakStage link={model.broken} />
        <Readout tally={model.tally} />
      </div>

      <div className="hud-right">
        <AgentCores model={model} />
      </div>

      <footer className="hud-chain">
        <div className="hc-head">
          <span className="hp-label">Signalkæden</span>
          <span className="hc-reach fm-num">
            {model.reach.delivers} / {model.reach.total}
          </span>
        </div>
        <ChainCircuit model={model} />
      </footer>
    </main>
  );
}

/** Beder brugeren om ro, står hologrammet stille — bane og strøm slukkes. */
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
 * produktion — tallene skal komme fra en rigtig maskine frem for et skøn,
 * men de hører ikke hjemme i et deploy.
 *
 * Bliver stående til og med element 3 (hologrammet), hvor der er noget
 * tungt at måle på. Fjernes derefter.
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
        console.log(
          `[maal] ${(frames / secs).toFixed(1)} fps over ${secs.toFixed(1)} s, ` +
          `værste frame ${worst.toFixed(1)} ms, ` +
          `animerede noder ${document.querySelectorAll(".ai-hud .cc-pulse, .ai-hud .cc-glow.is-pulse, .ai-hud .hb-dot").length}`,
        );
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on]);
}
