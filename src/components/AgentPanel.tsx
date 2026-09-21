"use client";
import {
  describeScope, AGENT_ENGINE_LABEL, AGENT_ENGINE_NOTE, AGENT_ROLE_LABEL, AGENT_STATUS_LABEL,
  type AgentState,
} from "../lib/agents";
import type { OtLayout } from "../lib/ot";
import { Field } from "./Modal";

/**
 * Eksempel på en rapport — en skabelon, ikke et resultat. Klammerne er de
 * felter, agenten udfylder, når signalerne findes. Der står ingen tal i, der
 * kunne forveksles med en måling.
 */
function exampleReport(st: AgentState): string {
  const a = st.agent;
  if (a.role === "vagt") {
    return [
      `Kædevagt, [tidspunkt]`,
      ``,
      `Alle led svarede: IO-kobler [sidst set], edge-collector [sidst set],`,
      `database [sidst set].`,
      ``,
      `— eller —`,
      ``,
      `[led] har ikke svaret siden [tidspunkt]. De øvrige led er upåvirkede,`,
      `men der er ikke skrevet nye rækker til databasen siden da.`,
    ].join("\n");
  }
  const scope = describeScope(a);
  return [
    `Stoprapport, ${scope}, [dato]`,
    ``,
    `Sporet kørte i [timer] af de [planlagte timer]. Der blev registreret`,
    `[antal] stop på tilsammen [varighed]; det længste var på [maskine] og`,
    `er kodet som [stopårsag].`,
    ``,
    `Indløbet: materialestrømmen før fordeleren var [stabil / faldende /`,
    `afbrudt] i perioden.`,
    ``,
    `Værd at kigge på: [maskine], som stoppede [antal] gange på under`,
    `[minutter] — det ligner en tilstopning, der ikke bliver fundet.`,
  ].join("\n");
}

export function AgentPanel({ st, colorIndex, ot, onClose }: {
  st: AgentState;
  colorIndex: number;
  ot: OtLayout | null;
  onClose: () => void;
}) {
  const a = st.agent;
  const dot = `ag-${(colorIndex % 3) + 1}`;
  const required = st.inputs.filter((i) => i.input.required);
  const supporting = st.inputs.filter((i) => !i.input.required);

  return (
    <aside className="fm-live-panel fm-agent-panel" aria-label={a.name}>
      <header className="fm-live-head">
        <div className="fm-agent-head">
          <div>
            <div className="fm-modal-eyebrow">
              <span className={`fm-dot ${dot}`} /> Agent · {AGENT_ROLE_LABEL[a.role]}
              <span className={`fm-engine eng-${a.engine}`}>{AGENT_ENGINE_LABEL[a.engine]}</span>
            </div>
            <h2>{a.name}</h2>
            <div className="fm-modal-sub">
              <span className={`fm-agent-status ags-${st.status}`}>{AGENT_STATUS_LABEL[st.status]}</span>
              <span>{describeScope(a)}</span>
              <span>{a.cadence}</span>
            </div>
          </div>
          <button type="button" className="fm-close" aria-label="Luk" onClick={onClose}>×</button>
        </div>
      </header>

      {st.status !== "running" && (
        <section>
          <p className="fm-warn"><span>{st.summary}</span></p>
        </section>
      )}

      <section>
        <h3>Job</h3>
        <p>{a.job}</p>
      </section>

      <section>
        <h3>Scope</h3>
        <dl>
          <Field
            label="Egne"
            value={st.machines.length
              ? `${describeScope(a)} · ${st.machines.length} maskiner`
              : describeScope(a)}
          />
          {st.upstream.length > 0 && (
            <Field
              label="Upstream"
              value={`${st.upstream.length} maskiner: ${st.upstream.map((m) => m.name).join(", ")}`}
            />
          )}
          <Field label="Kadence" value={a.cadence} />
          <Field label="Motor" value={`${AGENT_ENGINE_LABEL[a.engine]} — ${AGENT_ENGINE_NOTE[a.engine]}`} />
          <Field label="Aktiveret" value={a.enabled ? "Ja" : "Nej — ingen agent kører endnu"} />
        </dl>
        {st.upstream.length > 0 && (
          <p className="fm-ops-note">Indløbet må agenten se, men det tæller ikke i status — det er ikke sporets ansvar.</p>
        )}
      </section>

      <section>
        <h3>Inputs</h3>
        <ul className="fm-inputs">
          {[...required, ...supporting].map((i, n) => (
            <li key={n} className={`fm-input${i.have === i.total ? " is-ok" : i.have > 0 ? " is-partial" : " is-missing"}`}>
              <span className="fm-input-kind">{i.input.required ? "Påkrævet" : "Støttende"}</span>
              <span className="fm-input-label">{i.label}</span>
              <span className="fm-input-count fm-mono">{i.have} / {i.total}</span>
              <span className="fm-input-detail">{i.detail}</span>
            </li>
          ))}
        </ul>
        {!ot && <p className="fm-muted">Linjen har intet OT-lag, så ingen inputs kan findes.</p>}
      </section>

      <section>
        <h3>Seneste rapport</h3>
        <p className="fm-agent-sim">
          <strong>Simuleret</strong> — en skabelon, ikke et resultat. Klammerne udfyldes af agenten,
          når dens inputs leverer.
        </p>
        <pre className="fm-code fm-report">{exampleReport(st)}</pre>
      </section>
    </aside>
  );
}
