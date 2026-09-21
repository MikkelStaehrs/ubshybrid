"use client";
import { describeScope, AGENT_STATUS_LABEL, type SharedInlet } from "../lib/agents";
import { shortWIds } from "../lib/layout";

/**
 * Det fælles indløb. Zonen ejes ikke af nogen agent, så den har ingen status —
 * den er kontekst, flere agenter deler. Indholdet kommer fra sharedInlet(),
 * samme kilde som teksten på zonen.
 */
export function InletPanel({ inlet, onSelectAgent, onClose }: {
  inlet: SharedInlet;
  onSelectAgent: (agentId: string) => void;
  onClose: () => void;
}) {
  return (
    <aside className="fm-live-panel fm-agent-panel" aria-label="Fælles indløb">
      <header className="fm-live-head">
        <div className="fm-agent-head">
          <div>
            <div className="fm-modal-eyebrow">
              <span className="fm-dot ag-shared" /> Fælleszone
            </div>
            <h2>Fælles indløb</h2>
            <div className="fm-modal-sub">
              <span>{inlet.machines.length} maskiner</span>
              <span>upstream for {inlet.sharedBy}</span>
            </div>
          </div>
          <button type="button" className="fm-close" aria-label="Luk" onClick={onClose}>×</button>
        </div>
      </header>

      <section>
        <p className="fm-muted">
          Strækket fra vippestolene til fordeleren. Ingen agent ejer det — et stop her forklarer
          et stop i sporene, men det er ikke sporenes ansvar, og det tæller ikke i deres status.
        </p>
      </section>

      <section>
        <h3>Maskiner</h3>
        <ul className="fm-otlist">
          {inlet.machines.map((m) => (
            <li key={m.id}>
              <div className="fm-idearow is-real">
                <span className={`fm-dot k-${m.kind}`} />
                <span className="fm-idearow-name">{m.name}</span>
                <span className="fm-idearow-sig fm-mono">{shortWIds(m.wIds)}</span>
                <span className="fm-idearow-ch">Trin {m.step + 1}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Agenter der ser med</h3>
        <ul className="fm-otlist">
          {inlet.agents.map((st) => (
            <li key={st.agent.id}>
              <button type="button" className="fm-otrow" onClick={() => onSelectAgent(st.agent.id)}>
                <span className={`fm-dot ags-dot ags-${st.status}`} />
                <span className="fm-otrow-id">{st.agent.name}</span>
                <span className="fm-otrow-where">{describeScope(st.agent)}</span>
                <span className="fm-otrow-ch">{AGENT_STATUS_LABEL[st.status]}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
