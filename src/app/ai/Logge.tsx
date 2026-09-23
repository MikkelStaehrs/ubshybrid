"use client";
import { useState } from "react";
import { MENNESKER, type Besked, type BeskedType } from "../../lib/samspil";
import type { Haendelse } from "../../lib/telemetri";
import { klok } from "./HudPanels";

/**
 * De to logge, som man læser dem: hændelserne og agenterne imellem.
 *
 * Bruges både i vinduet på kontrolrummet og på loggens egen skærm. Begge er
 * til at læse, ikke til at kigge på: hele teksten, nyeste øverst, og til at
 * filtrere på det, man leder efter. Et klik på et navn viser kun det.
 */

type NiveauFilter = "alle" | "alarm" | "advarsel" | "info" | "ai";

const NIVEAUER: { id: NiveauFilter; label: string; passer: (h: Haendelse) => boolean }[] = [
  { id: "alle", label: "Alle", passer: () => true },
  { id: "alarm", label: "Alarm", passer: (h) => h.niveau === "alarm" },
  { id: "advarsel", label: "Advarsel", passer: (h) => h.niveau === "advarsel" },
  { id: "info", label: "Info", passer: (h) => h.niveau === "info" },
  { id: "ai", label: "AI", passer: (h) => !!h.ai },
];

const Tom = ({ tekst }: { tekst: string }) => (
  <p className="hp-afventer"><span className="hp-afventer-mark" aria-hidden />{tekst}</p>
);

export function HaendelsesLog({ log, sim }: { log: Haendelse[]; sim: boolean }) {
  const [filter, setFilter] = useState<NiveauFilter>("alle");
  const [hvor, setHvor] = useState<string | null>(null);
  const valgt = NIVEAUER.find((f) => f.id === filter)!;
  const vist = log.filter((h) => valgt.passer(h) && (hvor === null || h.hvor === hvor));
  const tom = log.length === 0
    ? (sim ? "Ingen hændelser endnu" : "Ingen signaler at melde fra")
    : "Ingen i det her filter";

  return (
    <div className="hl-log">
      <div className="hl-filtre" role="group" aria-label="Filter">
        {NIVEAUER.map((f) => (
          <button
            type="button"
            key={f.id}
            className={`hl-filter${filter === f.id ? " is-valgt" : ""}`}
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label}<span className="fm-num">{log.filter(f.passer).length}</span>
          </button>
        ))}
        {hvor !== null && (
          <button type="button" className="hl-filter is-valgt is-hvor" onClick={() => setHvor(null)} aria-label={`Fjern ${hvor}`}>
            {hvor}<span aria-hidden>×</span>
          </button>
        )}
      </div>
      {vist.length === 0 ? <Tom tekst={tom} /> : (
        <ol className="hp-haendelser hl-liste">
          {vist.map((h) => (
            <li key={`${h.t}-${h.hvor}-${h.tekst}`} className={`n-${h.niveau}`}>
              <time>{klok(h.t)}</time>
              <button type="button" className="hh-hvor hl-hvor" onClick={() => setHvor(h.hvor)} title={`Kun ${h.hvor}`}>
                {h.ai && <span className="hh-ai">AI</span>}{h.hvor}
              </button>
              <span className="hh-tekst">{h.tekst}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

const TYPE_LABEL: Record<BeskedType, string> = {
  iagttagelse: "Ser",
  forslag: "Foreslår",
  beslutning: "Beslutter",
  handling: "Gør",
  rapport: "Melder",
};

/**
 * Agenterne imellem. Hver besked: hvem, til hvem, hvad slags — og tallene
 * bag, for en beslutning uden sin begrundelse er ikke til at stole på.
 * Beskeder til mennesker er mærket, så man kan se, hvornår AI'en siger noget
 * til nogen, der skal gøre noget.
 */
export function AgentLog({ samtale }: { samtale: Besked[] }) {
  const [hvem, setHvem] = useState<string | null>(null);
  const [menneske, setMenneske] = useState(false);
  const agenter = [...new Set(samtale.map((b) => b.fra))].sort((a, b) => a.localeCompare(b, "da"));
  const vist = samtale.filter((b) =>
    (hvem === null || b.fra === hvem || b.til === hvem) && (!menneske || MENNESKER.has(b.til)));

  return (
    <div className="hl-log">
      <div className="hl-filtre" role="group" aria-label="Filter">
        <button
          type="button"
          className={`hl-filter${hvem === null && !menneske ? " is-valgt" : ""}`}
          aria-pressed={hvem === null && !menneske}
          onClick={() => { setHvem(null); setMenneske(false); }}
        >
          Alle<span className="fm-num">{samtale.length}</span>
        </button>
        <button
          type="button"
          className={`hl-filter${menneske ? " is-valgt" : ""}`}
          aria-pressed={menneske}
          onClick={() => setMenneske((m) => !m)}
        >
          Til mennesker<span className="fm-num">{samtale.filter((b) => MENNESKER.has(b.til)).length}</span>
        </button>
        {agenter.map((a) => (
          <button
            type="button"
            key={a}
            className={`hl-filter is-hvor${hvem === a ? " is-valgt" : ""}`}
            aria-pressed={hvem === a}
            onClick={() => setHvem(hvem === a ? null : a)}
          >
            {a}
          </button>
        ))}
      </div>
      {vist.length === 0 ? <Tom tekst={samtale.length === 0 ? "Ingen beskeder endnu" : "Ingen i det her filter"} /> : (
        <ol className="hl-samtale">
          {vist.map((b) => (
            <li key={b.nr} className={`hs-besked t-${b.type}${MENNESKER.has(b.til) ? " til-menneske" : ""}`}>
              <div className="hs-hoved">
                <time>{klok(b.t)}</time>
                <button type="button" className="hs-fra" onClick={() => setHvem(b.fra)}>{b.fra}</button>
                <span className="hs-pil" aria-hidden>→</span>
                <span className="hs-til">{b.til}</span>
                <span className="hs-type">{TYPE_LABEL[b.type]}</span>
              </div>
              <p className="hs-tekst">{b.tekst}</p>
              {b.grund && <p className="hs-grund">{b.grund}</p>}
              {b.linjer && (
                <ul className="hs-linjer">
                  {b.linjer.map((l) => <li key={l}>{l}</li>)}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
