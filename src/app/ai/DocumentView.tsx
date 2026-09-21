// Dokumentvisningen af AI-overblikket: til at læse og printe.
//
// Indholdet er uændret fra før HUD'en kom til — den ligger nu på /ai, og
// den her på /ai?visning=dokument. Begge bygger på de samme funktioner.
//
// Oprindelig note:
// AI-overblik: hvad agenterne er, hvad de venter på, og hvad de ville koste.
//
// Ren serverside — alt udledes af agents.ts, pathState() og signalDelivery(),
// og ingen af delene rører browseren. Der er intet hardcodet og ingen
// simuleret aktivitet: står der ingen kørsler, er det fordi der ingen er.
//
// Bag samme login som resten; proxy.ts matcher /:path*.
import Link from "next/link";
import {
  agentStates, decidedAgents, describeScope,
  AGENT_BESLUTNING_LABEL, AGENT_ENGINE_LABEL, AGENT_STATUS_LABEL, AGENT_STATUS_ORDER,
  type AgentState,
} from "../../lib/agents";
import { costOf, kr, totalPerMaaned, COST_ASSUMPTIONS, SMÅBELØB_UNDER } from "../../lib/agent-cost";
import { firstRunBlocker, pathToProduction, runsFor } from "../../lib/agent-runs";
import { SITE } from "../../lib/context";
import { layoutLine } from "../../lib/layout";
import { LINES } from "../../lib/lines";
import { layoutOt, otLayerFor, type OtLayout } from "../../lib/ot";
import type { AgentEngine } from "../../lib/types";
import "./ai.css";

/** Kortet viser én linje ad gangen. Overblikket ser dem alle. */
function everyAgent() {
  const out: { lineId: string; lineName: string; states: AgentState[]; ot: OtLayout | null }[] = [];
  for (const [lineId, data] of Object.entries(LINES)) {
    const layout = layoutLine(data);
    const otData = otLayerFor(lineId);
    const ot = otData ? layoutOt(otData, layout, lineId) : null;
    const states = agentStates(lineId, layout, ot);
    if (states.length > 0) out.push({ lineId, lineName: data.line.name, states, ot });
  }
  return out;
}

function Readiness({ st, ot }: { st: AgentState; ot: OtLayout | null }) {
  const steps = pathToProduction(st, ot);
  const done = steps.filter((s) => s.done).length;
  return (
    <div className="ai-ready">
      <div className="ai-ready-head">
        <h4>Vejen til drift</h4>
        <span className="fm-mono">{done} af {steps.length} opfyldt</span>
      </div>
      <div className="ai-ready-bar" aria-hidden>
        {steps.map((s, i) => <i key={i} className={s.done ? "on" : ""} />)}
      </div>
      <ol className="ai-steps">
        {steps.map((s, i) => (
          <li key={i} className={s.done ? "is-done" : ""}>
            <span className="ai-step-mark" aria-hidden>{s.done ? "✓" : "○"}</span>
            <span className="ai-step-label">{s.label}</span>
            <span className="ai-step-detail">{s.detail}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function AgentCard({ st, lineId, ot }: { st: AgentState; lineId: string; ot: OtLayout | null }) {
  const a = st.agent;
  const cost = costOf(a);
  return (
    <article className={`ai-card ags-${st.status}`}>
      <header>
        <div className="ai-card-top">
          <span className={`fm-agent-status ags-${st.status}`}>{AGENT_STATUS_LABEL[st.status]}</span>
          <span className={`fm-engine eng-${a.engine}`}>{AGENT_ENGINE_LABEL[a.engine]}</span>
        </div>
        <h3>{a.name}</h3>
        <p className="ai-card-q">{a.svarerPaa}</p>
      </header>

      <dl className="ai-facts">
        <div><dt>Til</dt><dd>{a.til}</dd></div>
        <div><dt>Scope</dt><dd>{describeScope(a)}</dd></div>
        <div><dt>Kadence</dt><dd>{a.cadence}</dd></div>
        <div><dt>Beslutning</dt><dd>{AGENT_BESLUTNING_LABEL[a.beslutning]}</dd></div>
        <div>
          <dt>Estimat</dt>
          <dd>{cost.gratis ? `0 kr. — ${cost.gratis}` : cost.ukendt ? "Ikke anslået" : `${kr(cost.perMaaned)} / md.`}</dd>
        </div>
      </dl>

      <Readiness st={st} ot={ot} />

      <footer>
        <Link href={`/?lag=agents&agent=${a.id}`} className="ai-link">
          Vis zonen i kortet →
        </Link>
        <span className="fm-mono ai-id">{a.id}</span>
      </footer>
    </article>
  );
}

export function DocumentView() {
  const lines = everyAgent();
  const alle = lines.flatMap((l) => l.states);
  const besluttede = decidedAgents(alle);
  const ideer = alle.length - besluttede.length;

  const perStatus = AGENT_STATUS_ORDER
    .map((s) => ({ s, n: alle.filter((st) => st.status === s).length }))
    .filter((x) => x.n > 0);
  const perEngine = (["claude", "kode"] as AgentEngine[])
    .map((e) => ({ e, n: besluttede.filter((st) => st.agent.engine === e).length }))
    .filter((x) => x.n > 0);

  const total = lines.reduce((sum, l) => sum + totalPerMaaned(l.states.map((st) => st.agent)), 0);
  const kørsler = runsFor();

  return (
    <main className="ai-root">
      <header className="ai-top">
        <div>
          <div className="fm-eyebrow">{SITE}</div>
          <h1>AI-overblik</h1>
          <p className="ai-sub">
            Alt på siden er udledt af agentdefinitionerne, signalkæden og infrastrukturen.
            Intet er skrevet i hånden, og der vises ingen aktivitet, der ikke har fundet sted.
          </p>
        </div>
        <Link href="/" className="fm-btn">Til kortet</Link>
      </header>

      <section className="ai-section">
        <h2>Overblik</h2>
        <div className="ai-stats">
          <div className="ai-stat">
            <span className="ai-stat-value fm-mono">{besluttede.length}</span>
            <span className="ai-stat-label">besluttede agenter</span>
            {ideer > 0 && <span className="ai-stat-hint">og {ideer} idéer, som ikke tæller med</span>}
          </div>
          {perStatus.map(({ s, n }) => (
            <div key={s} className={`ai-stat ags-${s}`}>
              <span className="ai-stat-value fm-mono">{n}</span>
              <span className="ai-stat-label">{AGENT_STATUS_LABEL[s]}</span>
            </div>
          ))}
          {perEngine.map(({ e, n }) => (
            <div key={e} className="ai-stat">
              <span className="ai-stat-value fm-mono">{n}</span>
              <span className="ai-stat-label">motor: {AGENT_ENGINE_LABEL[e]}</span>
              <span className="ai-stat-hint">
                {e === "claude" ? "koster pr. kørsel" : "ingen API-kald"}
              </span>
            </div>
          ))}
        </div>
      </section>

      {lines.map((l) => (
        <section key={l.lineId} className="ai-section">
          <h2>{l.lineName}</h2>
          <div className="ai-cards">
            {l.states.map((st) => (
              <AgentCard key={st.agent.id} st={st} lineId={l.lineId} ot={l.ot} />
            ))}
          </div>
        </section>
      ))}

      <section className="ai-section">
        <h2>Kørselslog</h2>
        {kørsler.length === 0 ? (
          <div className="ai-empty">
            <p><strong>Ingen kørsler endnu.</strong> Der er ikke kaldt et API fra dette repo.</p>
            <ul className="ai-blockers">
              {alle.map((st) => (
                <li key={st.agent.id}>
                  <span className="ai-blocker-name">{st.agent.name}</span>
                  <span className="ai-blocker-need">
                    Første kørsel kræver {firstRunBlocker(st)}.
                  </span>
                </li>
              ))}
            </ul>
            <p className="ai-note">
              Når fase 4 kører, logges tidspunkt, agent, hvilken udgave af konteksten den
              arbejdede på, tokenforbrug, pris, om rapporten blev godkendt eller afvist, og
              selve rapporten. En afvist kørsel koster også penge og kommer med i loggen.
            </p>
          </div>
        ) : null}
      </section>

      <section className="ai-section">
        <h2>Omkostning</h2>
        <p className="ai-estimate-mark">Estimat</p>
        <table className="ai-table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Motor</th>
              <th className="num">Kørsler / md.</th>
              <th className="num">Tokens ind / ud</th>
              <th className="num">Kr. / md.</th>
            </tr>
          </thead>
          <tbody>
            {alle.map((st) => {
              const c = costOf(st.agent);
              const idea = st.agent.beslutning === "ide";
              return (
                <tr key={st.agent.id} className={idea ? "is-idea" : ""}>
                  <td>
                    {st.agent.name}
                    {idea && <span className="ai-tag-idea">idé — ikke med i totalen</span>}
                  </td>
                  <td>{AGENT_ENGINE_LABEL[st.agent.engine]}</td>
                  <td className="num fm-mono">{c.gratis ? "—" : c.koerslerPrMaaned.toFixed(0)}</td>
                  <td className="num fm-mono">
                    {c.gratis ? "—" : `${c.input.toLocaleString("da-DK")} / ${c.output.toLocaleString("da-DK")}`}
                  </td>
                  <td className="num fm-mono">
                    {c.gratis ? <span className="ai-free">0 kr. — {c.gratis}</span> : kr(c.perMaaned)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={4}>Total for besluttede og aktiverede agenter</th>
              <td className="num fm-mono">{kr(total)}</td>
            </tr>
          </tfoot>
        </table>

        {total < SMÅBELØB_UNDER && (
          <p className="ai-point">
            {kr(total)} om måneden. Det lille tal er pointen: det, der koster noget her, er
            ikke API-kaldene — det er sensorerne, skabet og kablet ud til racket.
          </p>
        )}

        <h3 className="ai-assump-head">Antagelser</h3>
        <ul className="ai-assumptions">
          {COST_ASSUMPTIONS.map((a) => (
            <li key={a.label}>
              <span className="ai-assump-label">{a.label}</span>
              <span>
                {a.value}
                {a.ubekraeftet && <span className="ai-unconfirmed">ubekræftet</span>}
              </span>
            </li>
          ))}
        </ul>
        <p className="ai-note">
          Ingen af tallene er målt — der er ikke kørt en agent endnu. De er skøn, og de skal
          revideres efter første rigtige kørsel. Konstanterne står i{" "}
          <span className="fm-mono">src/lib/agent-cost.ts</span>.
        </p>
      </section>
    </main>
  );
}
