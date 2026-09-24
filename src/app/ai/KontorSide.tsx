"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SIMULERING } from "../../../data/fremskrivning";
import { SITE } from "../../lib/context";
import { TAVS_MS } from "../../lib/kanal";
import { klokke, type Besked } from "../../lib/samspil";
import { samlLog, samlSamtale, type Haendelse } from "../../lib/telemetri";
import { AnbefalingListe } from "./Enhed";
import { Sim } from "./HudPanels";
import { AgentLog, AgentMaaler, HaendelsesLog } from "./Logge";
import {
  KANAL_MS, laesKanal, sendKommando, type Ejer, type Hastighed, type KommandoIndhold, type SimStatus,
} from "./simKanal";
import "./hud.css";

const FASE: Record<NonNullable<SimStatus["ordre"]>["fase"], string> = {
  opstart: "Opstart",
  koerer: "Kører",
  udloeb: "Udløb",
  faerdig: "Færdig",
};

/** Farterne, simuleringen kan køre med. "Auto" går langsomt, når der sker noget. */
const FARTER: { h: Hastighed; label: string }[] = [
  { h: "pause", label: "Pause" },
  { h: 1, label: "1×" },
  { h: 10, label: "10×" },
  { h: SIMULERING.hurtig, label: `${SIMULERING.hurtig}×` },
  { h: "auto", label: "Auto" },
];

/** Kontorets eget id på en kommando. crypto.randomUUID findes ikke over http på netværket. */
const nytId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Formandens kontor.
 *
 * Linjeskærmen i operatørrummet kører ordren; kontoret kører ingen
 * simulering selv. Det læser, hvad linjeskærmen sender — agenterne imellem,
 * hændelserne og anbefalingerne — og styrer den: fart, forfra, Claude eller
 * regler, og et ja eller nej til en anbefaling. De to kan sidde på hver sin
 * maskine; beskederne går gennem serveren.
 *
 * Kontoret viser intet, linjeskærmen ikke selv har sendt.
 */
export function KontorSide() {
  const [status, setStatus] = useState<SimStatus | null>(null);
  const [ejer, setEjer] = useState<Ejer | null>(null);
  const [alder, setAlder] = useState<number | null>(null);
  const [log, setLog] = useState<Haendelse[]>([]);
  const [samtale, setSamtale] = useState<Besked[]>([]);
  const [lager, setLager] = useState<{ navn: string; vercel: boolean } | null>(null);
  const [serverFejl, setServerFejl] = useState(false);
  const [kommandoFejl, setKommandoFejl] = useState<string | null>(null);

  useEffect(() => {
    let aktiv = true;
    let logFra = 0;
    let samtaleFra = 0;
    let udgave: string | null = null;
    let fejl = 0;
    let ur: ReturnType<typeof setTimeout> | null = null;
    const hent = async () => {
      try {
        let d = await laesKanal(logFra, samtaleFra);
        // En ny linjeskærm, eller et rum, der er tømt: læs forfra.
        const ny = d.ejer?.udgave ?? null;
        if (ny !== udgave) {
          const fraStart = logFra === 0 && samtaleFra === 0;
          udgave = ny;
          logFra = 0;
          samtaleFra = 0;
          if (aktiv) { setLog([]); setSamtale([]); }
          if (!fraStart) d = await laesKanal(0, 0);
        }
        if (!aktiv) return;
        logFra = d.logTil;
        samtaleFra = d.samtaleTil;
        const nyeLog = d.log;
        const nyeSamtale = d.samtale;
        if (nyeLog.length > 0) setLog((l) => samlLog(l, nyeLog));
        if (nyeSamtale.length > 0) setSamtale((s) => samlSamtale(s, nyeSamtale));
        setStatus(d.status);
        setEjer(d.ejer);
        setAlder(d.alderMs);
        setLager({ navn: d.lager, vercel: d.vercel });
        fejl = 0;
        setServerFejl(false);
      } catch {
        if (aktiv && ++fejl >= 3) setServerFejl(true);
      } finally {
        if (aktiv) ur = setTimeout(hent, KANAL_MS);
      }
    };
    void hent();
    return () => {
      aktiv = false;
      if (ur) clearTimeout(ur);
    };
  }, []);

  // En kommando går til den kørsel, kontoret ser. Er linjeskærmen skiftet
  // imellem, afviser serveren den — et ja til en anbefaling i en gammel
  // kørsel er ikke et ja til noget i den nye.
  const send = useCallback(async (k: KommandoIndhold) => {
    if (!ejer) return;
    const r = await sendKommando({ id: nytId(), koersel: ejer.koersel, k });
    setKommandoFejl(r.ok ? null : r.fejl);
  }, [ejer]);

  const hoertNoget = status !== null && ejer !== null;
  const tavs = alder !== null && alder > TAVS_MS;
  const o = status?.ordre ?? null;
  const claude = status?.agenter.motor === "claude";

  return (
    <main className="ai-hud is-fremskrevet sim-logside">
      <header className="sl-top">
        <span className="hud-eyebrow">{SITE}</span>
        <span className="hud-sep" aria-hidden />
        <span className="hud-line-name">Kontoret</span>
        {hoertNoget && (
          <>
            <span className="hud-sep" aria-hidden />
            <span className="hud-ur fm-num">{klokke(status.t)}</span>
            <span className="hud-fart" role="group" aria-label="Simuleringens fart">
              <span className="hud-gang fm-num">{status.gang === 0 ? "Pause" : `×${status.gang}`}</span>
              {FARTER.map((f) => (
                <button
                  key={String(f.h)}
                  type="button"
                  className={`hud-fartknap${status.valgt === f.h ? " is-valgt" : ""}`}
                  aria-pressed={status.valgt === f.h}
                  onClick={() => void send({ type: "fart", h: f.h })}
                >
                  {f.label}
                </button>
              ))}
              <button type="button" className="hud-fartknap" onClick={() => void send({ type: "forfra" })}>Forfra</button>
            </span>
            <button type="button" className="hud-switch" onClick={() => void send({ type: "motor", motor: claude ? "regler" : "claude" })}>
              {claude ? "Med regler" : "Med Claude"}
            </button>
            <AgentMaaler a={status.agenter} />
            {o && (
              <span className="sl-ordre">
                <span>Ordre {o.ordreNr}</span>
                <span>{FASE[o.fase]}</span>
                <span className="fm-num">Box {o.kasserTippet} / {o.kasser}</span>
                <Sim />
              </span>
            )}
          </>
        )}
        <span className="sl-uro">
          {serverFejl && <span className="sl-uro-chip is-fejl">Serveren svarer ikke</span>}
          {kommandoFejl && <span className="sl-uro-chip is-fejl">{kommandoFejl}</span>}
          {lager?.navn === "hukommelse" && lager.vercel && (
            <span className="sl-uro-chip is-tavs">Uden fælles lager</span>
          )}
          {hoertNoget && (tavs
            ? <span className="sl-uro-chip is-tavs">Linjeskærmen svarer ikke</span>
            : status.uro.map((u) => <span key={u.tekst} className={`sl-uro-chip${u.fejl ? " is-fejl" : ""}`}>{u.tekst}</span>))}
        </span>
        <Sim />
      </header>

      {!hoertNoget ? (
        <section className="hud-panel sl-venter">
          <p className="hp-afventer"><span className="hp-afventer-mark" aria-hidden />Venter på linjeskærmen</p>
          <Link href="/ai/demo" className="hud-switch" target="_blank">Åbn linjeskærmen</Link>
        </section>
      ) : (
        <div className="sl-kolonner is-tre">
          <section className="hud-panel sl-kolonne">
            <header className="hp-head">
              <span className="hp-label">Anbefalinger</span>
              <Sim />
            </header>
            <div className="sl-rul">
              <AnbefalingListe
                anbefalinger={status.anbefalinger}
                afgjorte={6}
                onUdfoer={(id) => void send({ type: "udfoer", id })}
                onAfvis={(id) => void send({ type: "afvis", id })}
              />
            </div>
          </section>
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
