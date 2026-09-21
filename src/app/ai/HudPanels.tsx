"use client";
import { kr } from "../../lib/agent-cost";
import { AGENT_ENGINE_LABEL } from "../../lib/agents";
import type { HudAgent, HudLink, HudModel } from "../../lib/ai-hud";

/**
 * Panelerne rundt om hologrammet.
 *
 * Alt her kommer fra HudModel, som er bygget på serveren. Komponenterne
 * regner ingenting ud — de vælger, hvad der skal stå hvor. Tekstreglen
 * gælder: ingen forklarende sætninger, labels på højst fire ord. Skal noget
 * uddybes, hører det til i dokumentvisningen.
 */

/** Et panel med hjørnebeslag. Ingen afrundede kasser i et kontrolrum. */
export function Panel({ label, right, children, className = "" }: {
  label: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`hud-panel ${className}`}>
      <header className="hp-head">
        <span className="hp-label">{label}</span>
        {right}
      </header>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------

/**
 * Bruddet: sidens vigtigste oplysning lige nu.
 *
 * Det står midt i scenen, ikke som en detalje i kæden nedenfor. Kæden viser
 * hvor, det her viser hvad der skal ske — ét navn, udledt af de noder der
 * blokerer leddet.
 */
export function BreakStage({ link }: { link: HudLink | null }) {
  if (!link) {
    return (
      <div className="hud-break is-whole">
        <p className="hb-where">Kæden er hel</p>
      </div>
    );
  }
  return (
    <div className="hud-break">
      <p className="hb-kicker">
        <span className="hb-dot" aria-hidden />
        Kæden stopper ved
      </p>
      <p className="hb-where">{link.label}</p>
      {link.next && (
        <p className="hb-next">
          <span className="hb-next-label">Afventer</span>
          <strong>{link.next}</strong>
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Det store udlæste tal. Rav er test; intet er i drift, så intet er grønt. */
export function Readout({ tally }: { tally: HudModel["tally"] }) {
  return (
    <div className="hud-readout">
      <span className="ro-group">
        <span className="ro-label">I drift</span>
        <span className="ro-value">{tally.drift}</span>
        <span className="ro-of">/ {tally.total}</span>
      </span>
      <span className="ro-group is-test">
        <span className="ro-label">Test</span>
        <span className="ro-value">{tally.test}</span>
      </span>
      <span className="ro-group">
        <span className="ro-label">Afventer</span>
        <span className="ro-value">{tally.afventer}</span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Omkostning pr. måned.
 *
 * Kun besluttede agenter tæller med i totalen — en idé koster ingenting,
 * før nogen siger ja til den. Kode-agenter koster nul og siger hvorfor.
 */
export function CostPanel({ model }: { model: HudModel }) {
  const koster = model.agents.filter((a) => !a.idea && a.kr > 0);
  const gratis = model.agents.filter((a) => !a.idea && a.kr === 0);

  return (
    <Panel label="Omkostning" className="hp-cost">
      <p className="hp-total">
        <span className="hp-total-value">{kr(model.totalKr)}</span>
        <span className="hp-total-unit">pr. måned</span>
      </p>
      {model.smaabeloeb && <p className="hp-note">Estimat · småbeløb</p>}

      <ul className="hp-rows">
        {koster.map((a) => (
          <li key={a.id}>
            <span className="hp-row-name">{a.name}</span>
            <span className="hp-row-value fm-num">{kr(a.kr)}</span>
          </li>
        ))}
        {gratis.map((a) => (
          <li key={a.id} className="is-free">
            <span className="hp-row-name">{a.name}</span>
            <span className="hp-row-value">{a.gratis ?? "0 kr."}</span>
          </li>
        ))}
      </ul>

      {model.ideas > 0 && (
        <p className="hp-note">{model.ideas} idéer tælles ikke med</p>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------

/**
 * Kørselsloggen.
 *
 * Den er tom, og det er sandheden: der er ikke kaldt et API fra dette repo.
 * Der står ingen eksempelrække — den ville kunne forveksles med en kørsel,
 * der havde fundet sted.
 */
export function RunLog({ model }: { model: HudModel }) {
  return (
    <Panel
      label="Kørsler"
      right={<span className="hp-count fm-num">{model.runs.length}</span>}
    >
      {model.runs.length === 0 ? (
        <p className="hp-empty">
          <span className="hp-empty-mark" aria-hidden>—</span>
          Ingen kørsler
        </p>
      ) : (
        <ul className="hp-rows hp-log">
          {model.runs.map((r) => (
            <li key={r.id} className={r.validering === "afvist" ? "is-rejected" : undefined}>
              <span className="hp-row-name fm-num">{r.tidspunkt.slice(0, 16).replace("T", " ")}</span>
              <span className="hp-row-value fm-num">{kr(r.prisDkk)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------

/**
 * Agentkernerne.
 *
 * Ringen er vejen til drift: `done` af `total` trin opfyldt. En idé er et
 * stiplet omrids uden lys — den er tænkt, ikke besluttet. En besluttet agent,
 * der ikke kører, ånder svagt.
 */
function Core({ a }: { a: HudAgent }) {
  const R = 15;
  const OMKREDS = 2 * Math.PI * R;
  const andel = a.total > 0 ? a.done / a.total : 0;

  return (
    <li className={`hud-core st-${a.state}${a.idea ? " is-idea" : ""}${a.sovende ? " is-sleeping" : ""}`}>
      <svg viewBox="0 0 36 36" className="hc-ring" aria-hidden>
        <circle cx="18" cy="18" r={R} className="hc-track" />
        <circle
          cx="18"
          cy="18"
          r={R}
          className="hc-arc"
          strokeDasharray={`${andel * OMKREDS} ${OMKREDS}`}
          transform="rotate(-90 18 18)"
        />
      </svg>
      <div className="hc-body">
        <span className="hc-name">{a.name}</span>
        <span className="hc-meta">
          <span className="hc-state">{a.statusLabel}</span>
          <span className="hc-sep" aria-hidden>·</span>
          <span className="hc-steps fm-num">{a.done}/{a.total}</span>
          <span className="hc-sep" aria-hidden>·</span>
          <span className="hc-engine">{AGENT_ENGINE_LABEL[a.engine]}</span>
        </span>
        <span className="hc-til">{a.til}</span>
      </div>
    </li>
  );
}

export function AgentCores({ model }: { model: HudModel }) {
  const besluttet = model.agents.filter((a) => !a.idea);
  const ideer = model.agents.filter((a) => a.idea);

  return (
    <Panel
      label="Agenter"
      className="hp-agents"
      right={<span className="hp-count fm-num">{model.decided}</span>}
    >
      <ul className="hud-cores">
        {besluttet.map((a) => <Core key={a.id} a={a} />)}
      </ul>
      {ideer.length > 0 && (
        <>
          <p className="hp-sub">Idéer</p>
          <ul className="hud-cores">
            {ideer.map((a) => <Core key={a.id} a={a} />)}
          </ul>
        </>
      )}
    </Panel>
  );
}
