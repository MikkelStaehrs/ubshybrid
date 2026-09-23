"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SITE } from "../../lib/context";
import { klokke, type Besked } from "../../lib/samspil";
import type { Haendelse } from "../../lib/telemetri";
import { Sim } from "./HudPanels";
import { AgentLog, HaendelsesLog } from "./Logge";
import { aabnKanal, type SimBesked, type SimStatus } from "./simKanal";
import "./hud.css";

/**
 * Hører loggen intet så længe, svarer kontrolrummet ikke — det er lukket,
 * på pause i en skjult fane, eller browseren har lagt det til side.
 */
const TAVS_MS = 15_000;

const FASE: Record<NonNullable<SimStatus["ordre"]>["fase"], string> = {
  opstart: "Opstart",
  koerer: "Kører",
  udloeb: "Udløb",
  faerdig: "Færdig",
};

/**
 * Loggen på skærm 2.
 *
 * To spalter: agenterne imellem til venstre — det, der skal ses — og
 * hændelserne til højre. Øverst står, hvor ordren er, og hvad der sker lige
 * nu. Siden lytter på kontrolrummet og viser intet, det ikke selv har sendt.
 */
export function SimLogSide() {
  const [status, setStatus] = useState<SimStatus | null>(null);
  const [log, setLog] = useState<Haendelse[]>([]);
  const [samtale, setSamtale] = useState<Besked[]>([]);
  const [hoert, setHoert] = useState(0);
  const [nu, setNu] = useState(0);

  useEffect(() => {
    const kanal = aabnKanal();
    const id = setInterval(() => setNu(Date.now()), 1000);
    if (kanal) {
      kanal.onmessage = (e: MessageEvent<SimBesked>) => {
        if (e.data.type !== "tilstand") return;
        setStatus(e.data.status);
        setHoert(Date.now());
        if (e.data.log) setLog(e.data.log);
        if (e.data.samtale) setSamtale(e.data.samtale);
      };
      kanal.postMessage({ type: "hej" } satisfies SimBesked);
    }
    setNu(Date.now());
    return () => {
      clearInterval(id);
      kanal?.close();
    };
  }, []);

  // Loggen bliver stående, også når kontrolrummet tier. Det er kun, før der
  // er hørt noget, at der intet er at vise.
  const hoertNoget = status !== null;
  const tavs = hoertNoget && nu - hoert > TAVS_MS;
  const o = status?.ordre ?? null;

  return (
    <main className="ai-hud is-fremskrevet sim-logside">
      <header className="sl-top">
        <span className="hud-eyebrow">{SITE}</span>
        <span className="hud-sep" aria-hidden />
        <span className="hud-line-name">Log · simulering</span>
        {status && (
          <>
            <span className="hud-sep" aria-hidden />
            <span className="hud-ur fm-num">{klokke(status.t)}</span>
            <span className="hud-gang fm-num">{status.gang === 0 ? "Pause" : `×${status.gang}`}</span>
            {o && (
              <span className="sl-ordre">
                <span>Ordre {o.ordreNr}</span>
                <span>{FASE[o.fase]}</span>
                <span className="fm-num">Box {o.kasserTippet} / {o.kasser}</span>
              </span>
            )}
            <span className="sl-uro">
              {tavs
                ? <span className="sl-uro-chip is-tavs">Kontrolrummet svarer ikke</span>
                : status.uro.map((u) => <span key={u.tekst} className={`sl-uro-chip${u.fejl ? " is-fejl" : ""}`}>{u.tekst}</span>)}
            </span>
          </>
        )}
        <Sim />
      </header>

      {!hoertNoget ? (
        <section className="hud-panel sl-venter">
          <p className="hp-afventer"><span className="hp-afventer-mark" aria-hidden />Venter på kontrolrummet</p>
          <Link href="/ai/demo" className="hud-switch" target="_blank">Åbn kontrolrummet</Link>
        </section>
      ) : (
        <div className="sl-kolonner">
          <section className="hud-panel sl-kolonne">
            <header className="hp-head">
              <span className="hp-label">Agenterne imellem</span>
              <Sim />
            </header>
            <AgentLog samtale={samtale} />
          </section>
          <section className="hud-panel sl-kolonne">
            <header className="hp-head">
              <span className="hp-label">Hændelser</span>
              <Sim />
            </header>
            <HaendelsesLog log={log} sim />
          </section>
        </div>
      )}
    </main>
  );
}
