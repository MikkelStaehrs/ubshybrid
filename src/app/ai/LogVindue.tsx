"use client";
import { useEffect, useRef, useState } from "react";
import type { Haendelse } from "../../lib/telemetri";
import { klok, Sim } from "./HudPanels";

/**
 * Hændelsesloggen, til at læse igennem.
 *
 * Panelet i hjørnet viser de seneste; her står alt, der er sket, siden siden
 * åbnede — nyeste øverst, hele teksten, og til at filtrere på niveau, på
 * agentens beslutninger eller på ét sted. Et klik på et sted viser kun det.
 *
 * Vinduet er grænseflade, ikke data: det glider ind, når nogen beder om
 * det, og viser intet, anlægget ikke selv har meldt.
 */

type Filter = "alle" | "alarm" | "advarsel" | "info" | "ai";

const FILTRE: { id: Filter; label: string; passer: (h: Haendelse) => boolean }[] = [
  { id: "alle", label: "Alle", passer: () => true },
  { id: "alarm", label: "Alarm", passer: (h) => h.niveau === "alarm" },
  { id: "advarsel", label: "Advarsel", passer: (h) => h.niveau === "advarsel" },
  { id: "info", label: "Info", passer: (h) => h.niveau === "info" },
  { id: "ai", label: "AI", passer: (h) => !!h.ai },
];

export function LogVindue({ log, sim, onLuk }: { log: Haendelse[]; sim: boolean; onLuk: () => void }) {
  const [filter, setFilter] = useState<Filter>("alle");
  const [hvor, setHvor] = useState<string | null>(null);
  const luk = useRef<HTMLButtonElement>(null);

  // Fokus i vinduet, så tastaturet følger med; Escape lukker.
  useEffect(() => {
    const forrige = document.activeElement as HTMLElement | null;
    luk.current?.focus();
    const tast = (e: KeyboardEvent) => { if (e.key === "Escape") onLuk(); };
    window.addEventListener("keydown", tast);
    return () => {
      window.removeEventListener("keydown", tast);
      forrige?.focus();
    };
  }, [onLuk]);

  const valgt = FILTRE.find((f) => f.id === filter)!;
  const vist = log.filter((h) => valgt.passer(h) && (hvor === null || h.hvor === hvor));
  const aeldste = log.length > 0 ? log[log.length - 1].t : null;
  const tom = log.length === 0
    ? (sim ? "Ingen hændelser endnu" : "Ingen signaler at melde fra")
    : "Ingen i det her filter";

  return (
    <>
      <div className="hud-logslor" onClick={onLuk} aria-hidden />
      <aside className="hud-logvindue" role="dialog" aria-modal="true" aria-label="Hændelseslog">
        <header className="hl-head">
          <span className="hp-label">Hændelseslog</span>
          {sim && <Sim />}
          <span className="hl-antal fm-num">{vist.length} / {log.length}</span>
          <button type="button" ref={luk} className="hp-knap" onClick={onLuk}>Luk</button>
        </header>

        <div className="hl-filtre" role="group" aria-label="Filter">
          {FILTRE.map((f) => (
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

        {vist.length === 0 ? (
          <p className="hp-afventer"><span className="hp-afventer-mark" aria-hidden />{tom}</p>
        ) : (
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

        {aeldste !== null && <p className="hp-note">Siden {klok(aeldste)}</p>}
      </aside>
    </>
  );
}
