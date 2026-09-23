"use client";
import { ANALYSE, FLASKEHALS } from "../../../data/fremskrivning";
import { kr } from "../../lib/agent-cost";
import { AGENT_ENGINE_LABEL, lineOpsFor } from "../../lib/agents";
import type { HudAgent, HudLink, HudModel, LinkTone } from "../../lib/ai-hud";
import {
  flowLimits, rateFrom, runSegments, RUN_STATE_LABEL, type RunState,
} from "../../lib/flow";
import type { MaskinLaesning, TelemetriBillede } from "../../lib/telemetri";
import { Afkod, Bjaelke, Fordeling, Kurve, Maaler, Oscilloskop, Tal } from "./Instrumenter";
import { TAKT_MS, type Historik } from "./useTelemetri";

/**
 * Panelerne rundt om hologrammet.
 *
 * Alt her kommer fra HudModel og TelemetriBillede. Komponenterne regner
 * ingenting nyt ud — de vælger, hvad der skal stå hvor. Tekstreglen gælder:
 * labels på højst fire ord, ingen forklarende sætninger.
 *
 * Et tomt felt står som "Afventer signal", aldrig som et nul.
 */

const klok = (t: number) =>
  new Date(t).toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Et panel med hjørnebeslag. `nr` styrer rækkefølgen, de tændes i ved opstart. */
export function Panel({ label, right, children, className = "", nr = 0, still }: {
  label: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  nr?: number;
  still?: boolean;
}) {
  return (
    <section className={`hud-panel ${className}`} style={{ ["--i" as string]: nr }}>
      <header className="hp-head">
        <span className="hp-label"><Afkod tekst={label} forsinkelse={300 + nr * 110} still={still} /></span>
        {right}
      </header>
      {children}
    </section>
  );
}

/** Mærkatet på simulerede tal. Det følger tallet, ikke siden. */
export const Sim = () => <span className="hp-sim" title="Simuleret — ikke målt">SIM</span>;

const Afventer = ({ tekst = "Afventer signal" }: { tekst?: string }) => (
  <p className="hp-afventer"><span className="hp-afventer-mark" aria-hidden />{tekst}</p>
);

// ---------------------------------------------------------------------------
// Scenens overskrift

/**
 * Det vigtigste lige nu, midt i scenen.
 *
 * Er kæden brudt, er det bruddet. Halter den, er det flaskehalsen — er data
 * forsinkede, er alt andet på skærmen forældet, og det er vigtigere end én
 * maskine. Ellers det, der er galt i anlægget: en alarm før et stop, et
 * stop før ingenting. Kører alt, siger den det — med flowet som bevis.
 */
export function Overskrift({ model, billede, still }: {
  model: HudModel;
  billede: TelemetriBillede;
  still?: boolean;
}) {
  if (model.broken) return <Brud link={model.broken} tone={model.chainTone} still={still} />;

  // Data-forsinkelsen tager overskriften, når den betyder noget: når
  // Driftsagenten ikke længere kan stole på det, den ser. Under det viser
  // kæden den selv.
  const k = billede.kaede;
  if (k?.flaskehals && k.forsinkelseS > FLASKEHALS.forsinkelseAlarmS) {
    return (
      <div className="hud-break tone-brud">
        <p className="hb-kicker"><span className="hb-dot" aria-hidden />Flaskehals · {k.flaskehals.toUpperCase()}{billede.simuleret && <Sim />}</p>
        <p className="hb-where">Data <Tal v={k.forsinkelseS} d={0} /> s bagud</p>
        <p className="hb-next">
          <span className="hb-next-label">Kø</span>
          <strong><Tal v={k.koe} d={0} /> rækker</strong>
          {k.aarsag && (
            <>
              <span className="hb-next-label">Årsag</span>
              <strong>{k.aarsag}</strong>
            </>
          )}
        </p>
      </div>
    );
  }

  const whr = rateFrom(billede.flowPct, model.flow.nominal);

  // Driftsagenten har stoppet noget. Så længe det står på dens beslutning,
  // er det det vigtigste: hvad den gjorde, hvorfor, og hvad det koster.
  const ai = billede.ai;
  const aiStop = ai?.spor.filter((x) => x.stoppet) ?? [];
  if (ai && (aiStop.length > 0 || ai.indgangStoppet)) {
    const hvad = ai.indgangStoppet ? "Indgangen stoppet" : `Spor ${aiStop.map((x) => x.lane).join(" og ")} stoppet`;
    const hvorfor = aiStop[0]?.aarsag;
    return (
      <div className="hud-break tone-test is-ai">
        <p className="hb-kicker">
          <span className="hb-ai">AI</span>Driftsagent{billede.simuleret && <Sim />}
        </p>
        <p className="hb-where">{hvad}</p>
        <p className="hb-next">
          {hvorfor && (<><span className="hb-next-label">Årsag</span><strong>{hvorfor}</strong></>)}
          {whr !== null && (<><span className="hb-next-label">W/HR</span><strong><Tal v={whr} d={2} /> {model.flow.rateUnit}</strong></>)}
        </p>
      </div>
    );
  }

  const alarm = billede.haendelser.find((h) => h.niveau === "alarm" && billede.t - h.t < 20_000);
  // Maskiner, agenten har stoppet, er ikke fejl og hører ikke til her.
  const staar = billede.maskiner.filter((m) => m.koerer === false && !m.styret);

  if (alarm) {
    return (
      <div className="hud-break tone-brud">
        <p className="hb-kicker"><span className="hb-dot" aria-hidden />Alarm · {alarm.hvor}{billede.simuleret && <Sim />}</p>
        <p className="hb-where">{alarm.tekst}</p>
        <p className="hb-next"><span className="hb-next-label">{klok(alarm.t)}</span></p>
      </div>
    );
  }
  if (staar.length > 0) {
    return (
      <div className="hud-break tone-brud is-stop">
        <p className="hb-kicker"><span className="hb-dot" aria-hidden />{staar.length === 1 ? "Stoppet" : `${staar.length} stoppet`}{billede.simuleret && <Sim />}</p>
        <p className="hb-where">{staar.slice(0, 3).map((m) => m.kort).join(" · ")}</p>
        <p className="hb-next">
          <span className="hb-next-label">Kører</span>
          <strong>{billede.koerende} / {billede.maskiner.length}</strong>
        </p>
      </div>
    );
  }
  return (
    <div className={`hud-break is-whole tone-${billede.simuleret ? "drift" : model.chainTone}`}>
      <p className="hb-kicker">{billede.simuleret ? "Alle maskiner kører" : "Kæden er hel"}{billede.simuleret && <Sim />}</p>
      <p className="hb-where">
        {billede.flowPct === null
          ? "Linjen kører"
          : whr !== null
            ? <><Tal v={whr} d={2} /> {model.flow.rateUnit}</>
            : <><Tal v={billede.flowPct} d={1} /> %</>}
      </p>
      {billede.flowPct !== null && (
        <p className="hb-next">
          <span className="hb-next-label">{whr !== null ? "W/HR ved indgang" : "Flow ved indgang"}</span>
          {whr !== null && <strong><Tal v={billede.flowPct} d={0} /> %</strong>}
        </p>
      )}
    </div>
  );
}

function Brud({ link, tone, still }: { link: HudLink; tone: LinkTone; still?: boolean }) {
  return (
    <div className={`hud-break tone-${tone}`}>
      <p className="hb-kicker"><span className="hb-dot" aria-hidden />Kæden stopper ved</p>
      <p className="hb-where"><Afkod tekst={link.label} forsinkelse={900} still={still} /></p>
      {link.next && (
        <p className="hb-next">
          <span className="hb-next-label">Afventer</span>
          <strong>{link.next}</strong>
        </p>
      )}
    </div>
  );
}

/**
 * Det store udlæste tal: hvor mange maskiner har deres signaler på plads.
 *
 * Etiketten er HUD-ordet, ikke "i drift". Om en maskine *kører*, står i
 * driftspanelet — og står et spor på Driftsagentens beslutning, ville "i
 * drift 26" ved siden af "kører 16" være en modsigelse. Farven tændes kun,
 * når der er noget at farve.
 */
export function Readout({ tally, sim = false }: { tally: HudModel["tally"]; sim?: boolean }) {
  return (
    <div className="hud-readout">
      {sim && <Sim />}
      <span className={`ro-group${tally.drift > 0 ? " is-drift" : ""}`}>
        <span className="ro-label">På plads</span>
        <Tal v={tally.drift} d={0} className="ro-value" />
        <span className="ro-of">/ {tally.total}</span>
      </span>
      <span className={`ro-group${tally.test > 0 ? " is-test" : ""}`}>
        <span className="ro-label">Test</span>
        <Tal v={tally.test} d={0} className="ro-value" />
      </span>
      <span className="ro-group">
        <span className="ro-label">Afventer</span>
        <Tal v={tally.afventer} d={0} className="ro-value" />
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flowet ved indgangen

/** Kører / kører ikke / sensorfejl — udledt af forløbet, ikke af én prøve. */
function tilstandAf(serie: (number | null)[]): RunState | null {
  if (serie.length === 0) return null;
  const segs = runSegments(serie.map((value, i) => ({ t: i * TAKT_MS, value })));
  return segs.length ? segs[segs.length - 1].state : null;
}

const RUN_TONE: Record<RunState, string> = { koerer: "drift", staar: "moerk", fejl: "brud" };

export function FlowPanel({ model, billede, historik, sim, nr, still }: {
  model: HudModel;
  billede: TelemetriBillede;
  historik: Historik;
  sim: boolean;
  nr: number;
  still?: boolean;
}) {
  const ops = lineOpsFor(model.lineId);
  const graenser = flowLimits(ops);
  const signal = model.flow.signal ?? "FT-743";
  const rate = rateFrom(billede.flowPct, model.flow.nominal);
  const tilstand = tilstandAf(historik.get("flow") ?? []);
  const tone = tilstand ? RUN_TONE[tilstand] : "moerk";

  return (
    <Panel label={`Flow · ${signal}`} nr={nr} still={still} className="hp-flow" right={sim ? <Sim /> : undefined}>
      <div className="hp-flow-top">
        <Maaler
          v={billede.flowPct}
          min={0}
          max={150}
          enhed="%"
          tone={tone}
          zoner={[[0, graenser.lowPct, "lav"], [graenser.lowPct, graenser.highPct, "ok"], [graenser.highPct, 150, "hoej"]]}
        />
        <div className="hp-flow-side">
          <span className={`hp-run run-${tilstand ?? "ukendt"}`}>
            {tilstand ? RUN_STATE_LABEL[tilstand] : "Afventer"}
          </span>
          {/* W/HR: vægt pr. time. Det tal, driften spørger efter først. */}
          <div className="hp-whr">
            <span className="hp-whr-label">
              W/HR
              {model.flow.kilde === "skoen" && <span className="hp-skoen" title="100 %-punktet er et skøn, ikke aftalt">Skøn</span>}
            </span>
            {rate === null
              ? <span className="hp-ikke">Ikke udfyldt</span>
              : <span className="hp-whr-tal"><Tal v={rate} d={2} /><i>{model.flow.rateUnit}</i></span>}
          </div>
          <dl className="hp-kv">
            <div><dt>Råsignal</dt><dd><Tal v={billede.flowMa} d={2} /> <i>mA</i></dd></div>
          </dl>
        </div>
      </div>
      <Oscilloskop serie={historik.get("flowMa") ?? []} />
    </Panel>
  );
}

// ---------------------------------------------------------------------------

export function DriftPanel({ billede, historik, nr, still }: {
  billede: TelemetriBillede;
  historik: Historik;
  nr: number;
  still?: boolean;
}) {
  const kendt = billede.oppetidPct !== null;
  // Rødt er en fejl. Står maskinerne kun på Driftsagentens beslutning, er
  // tallet rav — et styret stop må ikke se ud som noget, der er gået galt.
  const fejl = billede.maskiner.some((m) => m.koerer === false && !m.styret);
  const styrede = billede.maskiner.some((m) => m.styret);
  const koererTone = fejl ? " is-brud" : styrede ? " is-styret" : "";
  return (
    <Panel label="Drift" nr={nr} still={still} right={billede.simuleret ? <Sim /> : undefined}>
      {!kendt ? (
        <Afventer tekst="Afventer driftssignaler" />
      ) : (
        <>
          <div className="hp-tre">
            <div className="hp-stort">
              <span className="hp-stort-label">Oppetid</span>
              <span className="hp-stort-tal"><Tal v={billede.oppetidPct} d={1} /><i>%</i></span>
            </div>
            <div className="hp-stort">
              <span className="hp-stort-label">Kører</span>
              <span className={`hp-stort-tal${koererTone}`}>
                <Tal v={billede.koerende} d={0} /><i>/ {billede.maskiner.length}</i>
              </span>
            </div>
            <div className="hp-stort">
              <span className="hp-stort-label">Stop</span>
              <span className="hp-stort-tal"><Tal v={billede.stop} d={0} /></span>
            </div>
          </div>
          <Kurve serie={historik.get("oppetid") ?? []} tone="drift" hoejde={28} />
        </>
      )}
    </Panel>
  );
}

export function KlimaPanel({ billede, historik, nr, still }: {
  billede: TelemetriBillede;
  historik: Historik;
  nr: number;
  still?: boolean;
}) {
  const har = billede.hal.some((k) => k.value !== null);
  return (
    <Panel label="Hallen" nr={nr} still={still} right={billede.simuleret ? <Sim /> : undefined}>
      {!har ? <Afventer /> : (
        <div className="hp-klima">
          {billede.hal.map((k) => (
            <div key={k.spec.id} className={`hp-klima-rk${k.alarm ? " is-alarm" : ""}`}>
              <span className="hp-klima-lbl">{k.spec.label}</span>
              <span className="hp-klima-tal"><Tal v={k.value} d={k.spec.decimaler} /><i>{k.spec.unit}</i></span>
              <Kurve serie={historik.get(`hal:${k.spec.id}`) ?? []} tone={k.alarm ? "brud" : "drift"} hoejde={22} graense={k.spec.alarmHoej !== undefined ? [k.spec.alarmHoej] : undefined} />
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Kvaliteten

export function KvalitetPanel({ billede, nr, still }: { billede: TelemetriBillede; nr: number; still?: boolean }) {
  const sidst = billede.analyse.find((a) => a.proeveT !== null)?.proeveT ?? null;
  return (
    <Panel
      label="Analyse · FV"
      nr={nr}
      still={still}
      right={billede.simuleret ? <Sim /> : undefined}
    >
      {billede.analyse.every((a) => a.andele === null) ? <Afventer /> : (
        <>
          {billede.analyse.map((a) => (
            <div key={a.lane} className="hp-analyse">
              <span className="hp-spor">Spor {a.lane}</span>
              <Fordeling andele={a.andele} navne={ANALYSE.klasser} alarm={a.alarm} />
            </div>
          ))}
          {sidst && <p className="hp-note">Prøve {klok(sidst)}</p>}
        </>
      )}
    </Panel>
  );
}

/** De fire kasteborde og det, der ender på deres tunge side. */
export function KastebordPanel({ billede, nr, still }: { billede: TelemetriBillede; nr: number; still?: boolean }) {
  const kb = billede.maskiner.filter((m) => /^kb[-\s]/i.test(m.navn));
  const har = kb.some((m) => m.kanaler.some((k) => k.value !== null));
  return (
    <Panel label="Kasteborde · tung side" nr={nr} still={still} right={billede.simuleret ? <Sim /> : undefined}>
      {!har ? <Afventer /> : (
        <div className="hp-kb">
          <div className="hp-kb-hoved">
            <span />
            {["BIGF", "BIGH", "NOTS"].map((k) => <span key={k}>{k}</span>)}
          </div>
          {kb.map((m) => (
            <div key={m.id} className={`hp-kb-rk${m.styret ? " is-styret" : m.koerer === false ? " is-stop" : ""}`}>
              <span className="hp-kb-navn">{m.kort}</span>
              {["bigf", "bigh", "nots"].map((id) => {
                const k = m.kanaler.find((x) => x.spec.id === id);
                if (!k) return <span key={id} />;
                return (
                  <span key={id} className={`hp-kb-celle${k.alarm ? " is-alarm" : ""}`}>
                    <Tal v={k.value} d={1} className="hp-kb-tal" />
                    <Bjaelke v={k.value} max={id === "nots" ? 12 : 100} graense={k.spec.alarmHoej} alarm={k.alarm} />
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Maskinen i fokus

export function FokusPanel({ m, historik, sim }: { m: MaskinLaesning | null; historik: Historik; sim: boolean }) {
  if (!m) return null;
  const tilstand = m.alarm ? "alarm" : m.styret ? "styret" : m.koerer === false ? "staar" : m.koerer ? "koerer" : "ukendt";
  return (
    <section className={`hud-fokus t-${tilstand}`} key={m.id}>
      <header className="hf-head">
        <span className="hf-navn">{m.kort}</span>
        <span className="hf-id">W-{m.wIds.join(" · W-")}{m.lane ? ` · Spor ${m.lane}` : ""}</span>
        {sim && <Sim />}
        <span className="hf-tilstand">
          {tilstand === "alarm" ? "Alarm" : tilstand === "styret" ? "Stoppet af AI" : tilstand === "staar" ? "Stoppet" : tilstand === "koerer" ? "Kører" : "Afventer"}
        </span>
      </header>
      {m.kanaler.every((k) => k.value === null) ? <Afventer /> : (
        <div className="hf-kanaler">
          {m.kanaler.map((k) => (
            <div key={k.spec.id} className={`hf-kanal${k.alarm ? " is-alarm" : ""}`}>
              <span className="hf-lbl">{k.spec.label}</span>
              <span className="hf-tal"><Tal v={k.value} d={k.spec.decimaler} /><i>{k.spec.unit}</i></span>
              <Kurve
                serie={historik.get(`m:${m.id}:${k.spec.id}`) ?? []}
                tone={k.alarm ? "brud" : "drift"}
                hoejde={26}
                graense={[k.spec.alarmHoej, k.spec.alarmLav].filter((g): g is number => g !== undefined)}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Hændelserne

export function Haendelser({ billede, nr, still }: { billede: TelemetriBillede; nr: number; still?: boolean }) {
  return (
    <Panel
      label="Hændelser"
      nr={nr}
      still={still}
      className="hp-log"
      right={billede.simuleret ? <Sim /> : <span className="hp-count fm-num">{billede.haendelser.length}</span>}
    >
      {billede.haendelser.length === 0 ? <Afventer tekst="Ingen signaler at melde fra" /> : (
        <ol className="hp-haendelser">
          {billede.haendelser.slice(0, 14).map((h) => (
            <li key={`${h.t}-${h.hvor}-${h.tekst}`} className={`n-${h.niveau}`}>
              <time>{klok(h.t)}</time>
              <span className="hh-hvor">{h.ai && <span className="hh-ai">AI</span>}{h.hvor}</span>
              <span className="hh-tekst">{h.tekst}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Agenterne

const AI_TILSTAND: Record<NonNullable<TelemetriBillede["ai"]>["tilstand"], string> = {
  overvaager: "Overvåger",
  handler: "Handler",
  holder: "Holder",
};

function Core({ a, ai, sim }: { a: HudAgent; ai: TelemetriBillede["ai"]; sim: boolean }) {
  const R = 13;
  const OMKREDS = 2 * Math.PI * R;
  const andel = a.total > 0 ? a.done / a.total : 0;
  return (
    <li className={`hud-core st-${a.state}${a.idea ? " is-idea" : ""}${a.sovende ? " is-sleeping" : ""}`}>
      <svg viewBox="0 0 32 32" className="hc-ring" aria-hidden>
        <circle cx="16" cy="16" r={R} className="hc-track" />
        <circle cx="16" cy="16" r={R} className="hc-arc" strokeDasharray={`${andel * OMKREDS} ${OMKREDS}`} transform="rotate(-90 16 16)" />
        {a.state === "paa-plads" && (
          <>
            <circle cx="16" cy="16" r="7" className="hc-kerne-glod" />
            <circle cx="16" cy="16" r="4" className="hc-kerne" />
          </>
        )}
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
        {/* Den agent, der styrer, siger hvad den gør lige nu. */}
        {a.styring && ai && (
          <span className={`hc-ai t-${ai.tilstand}`}>
            <span className="hh-ai">AI</span>
            {AI_TILSTAND[ai.tilstand]}
            {ai.tilstand === "handler" && ai.seneste && ` · ${ai.seneste.tekst.split(" · ")[0]}`}
            {sim && <Sim />}
          </span>
        )}
      </div>
    </li>
  );
}

export function AgentCores({ model, nr, still, ai = null, sim = false }: {
  model: HudModel;
  nr: number;
  still?: boolean;
  ai?: TelemetriBillede["ai"];
  sim?: boolean;
}) {
  const besluttet = model.agents.filter((a) => !a.idea);
  const ideer = model.agents.filter((a) => a.idea);
  return (
    <Panel
      label="Agenter"
      nr={nr}
      still={still}
      className="hp-agents"
      right={<span className="hp-count fm-num">{kr(model.totalKr)} / md.</span>}
    >
      <ul className="hud-cores">{besluttet.map((a) => <Core key={a.id} a={a} ai={ai} sim={sim} />)}</ul>
      {ideer.length > 0 && (
        <>
          <p className="hp-sub">Idéer · ikke medregnet</p>
          <ul className="hud-cores is-ideer">{ideer.map((a) => <Core key={a.id} a={a} ai={null} sim={false} />)}</ul>
        </>
      )}
    </Panel>
  );
}
