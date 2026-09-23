"use client";
import { useEffect, useRef, useState } from "react";
import type { Besked } from "../../lib/samspil";
import type { Haendelse } from "../../lib/telemetri";
import { Sim } from "./HudPanels";
import { AgentLog, HaendelsesLog } from "./Logge";

/**
 * Loggen, til at læse igennem.
 *
 * Panelet i hjørnet viser de seneste; her står alt, der er sket, siden siden
 * åbnede. Kører der en ordre, er der også agenterne imellem — hvem sagde hvad
 * til hvem, og hvorfor. Begge kan flyttes over på en anden skærm.
 *
 * Vinduet er grænseflade, ikke data: det glider ind, når nogen beder om
 * det, og viser intet, anlægget ikke selv har meldt.
 */
export function LogVindue({ log, samtale, sim, onLuk, onSkaerm2 }: {
  log: Haendelse[];
  /** Agenterne imellem. null, når der ingen ordre kører. */
  samtale: Besked[] | null;
  sim: boolean;
  onLuk: () => void;
  /** Åbn loggen i sit eget vindue, til en anden skærm. */
  onSkaerm2?: () => void;
}) {
  const [fane, setFane] = useState<"haendelser" | "agenter">(samtale ? "agenter" : "haendelser");
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

  const aeldste = log.length > 0 ? log[log.length - 1].t : null;
  const vis = samtale && fane === "agenter" ? "agenter" : "haendelser";

  return (
    <>
      <div className="hud-logslor" onClick={onLuk} aria-hidden />
      <aside className="hud-logvindue" role="dialog" aria-modal="true" aria-label="Log">
        <header className="hl-head">
          {samtale ? (
            <div className="hl-faner" role="tablist">
              <button type="button" role="tab" aria-selected={vis === "agenter"} className={`hl-fane${vis === "agenter" ? " is-valgt" : ""}`} onClick={() => setFane("agenter")}>
                Agenterne imellem <span className="fm-num">{samtale.length}</span>
              </button>
              <button type="button" role="tab" aria-selected={vis === "haendelser"} className={`hl-fane${vis === "haendelser" ? " is-valgt" : ""}`} onClick={() => setFane("haendelser")}>
                Hændelser <span className="fm-num">{log.length}</span>
              </button>
            </div>
          ) : (
            <span className="hp-label">Hændelseslog</span>
          )}
          {sim && <Sim />}
          <span className="hl-hoejre">
            {onSkaerm2 && <button type="button" className="hp-knap" onClick={onSkaerm2}>Skærm 2</button>}
            <button type="button" ref={luk} className="hp-knap" onClick={onLuk}>Luk</button>
          </span>
        </header>

        {vis === "agenter" && samtale ? <AgentLog samtale={samtale} /> : <HaendelsesLog log={log} sim={sim} />}

        {aeldste !== null && vis === "haendelser" && <p className="hp-note">Siden {new Date(aeldste).toLocaleTimeString("da-DK")}</p>}
      </aside>
    </>
  );
}
