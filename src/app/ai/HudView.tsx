"use client";
import Link from "next/link";
import { useEffect } from "react";
import type { HudModel } from "../../lib/ai-hud";
import { SITE } from "../../lib/context";
import { ChainCircuit } from "./ChainCircuit";
import "./hud.css";

/**
 * Kontrolrummet.
 *
 * Alt på skærmen kommer fra `model`, som er bygget på serveren af
 * pathState(), signalDelivery() og agentstatus. Der er ingen tilstand her
 * inde og intet, der bevæger sig uden at svare til noget virkeligt.
 */
export function HudView({ model, measure }: { model: HudModel; measure?: boolean }) {
  useFrameProbe(measure);

  return (
    <main className="ai-hud">
      <header className="hud-top">
        <div>
          <div className="hud-eyebrow">{SITE} · {model.lineName}</div>
          <h1>AI-overblik</h1>
        </div>
        <Link href="/ai?visning=dokument" className="hud-switch">Dokumentvisning</Link>
      </header>

      <section className="hud-section">
        <h2>Signalkæden</h2>
        <p className="hud-reach">
          <strong>{model.reach.delivers} af {model.reach.total}</strong> led på plads
        </p>
        <ChainCircuit model={model} />
      </section>
    </main>
  );
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
          `animerede noder ${document.querySelectorAll(".ai-hud .cc-pulse, .ai-hud .cc-glow.is-pulse, .ai-hud .cc-break-dot").length}`,
        );
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on]);
}
