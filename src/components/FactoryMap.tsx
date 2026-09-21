"use client";
import { Canvas } from "@react-three/fiber";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  agentStates, lineOpsFor, opsForMachine, AGENT_ENGINE_LABEL, AGENT_STATUS_LABEL,
} from "../lib/agents";
import { OT_FIELDS, STAMDATA_FIELDS } from "../lib/fields";
import { KIND_LABEL, layoutLine, shortWIds } from "../lib/layout";
import type { LineOption } from "../lib/lines";
import {
  describeDate, formatCost, historyFor, lastOfType,
  MAINTENANCE_LABEL, MAINTENANCE_ORDER,
} from "../lib/maintenance";
import {
  channelReports, isDone, layoutIdeas, layoutOt, otLayerFor, withinPhase,
  OT_PHASES, OT_SENSOR_TYPES, OT_STATUS_LABEL, OT_STATUS_ORDER,
  type OtSelection, type PlacedIdea, type PlacedSensor,
} from "../lib/ot";
import type {
  LineData, Machine, MachineKind, MaintenanceEvent, MaintenanceType, OtPhase, SensorIdea,
} from "../lib/types";
import { useLiveSignals } from "../lib/useLiveSignals";
import type { LiveSourceKind } from "../lib/live-source";
import { useSceneTheme } from "../lib/useSceneTheme";
import { AgentPanel } from "./AgentPanel";
import { LivePanel } from "./LivePanel";
import { SignalModal } from "./SignalModal";
import { Field, Modal } from "./Modal";
import { CabinetModal, OtDot, SensorModal } from "./OtModals";
import { Scene, type MapLayer, type ViewMode } from "./Scene";

const KIND_ORDER: MachineKind[] = ["intake", "elevator", "distributor", "process", "analysis"];

/** Meter med dansk komma, uden overflødige decimaler. */
const meters = (v: number) => `${v.toFixed(1).replace(/\.0$/, "").replace(".", ",")} m`;

function HistoryModal({ m, onClose }: { m: Machine; onClose: () => void }) {
  const [filter, setFilter] = useState<MaintenanceType | null>(null);
  const history = useMemo(() => historyFor(m.wIds), [m.wIds]);
  const shown = filter ? history.filter((e) => e.type === filter) : history;

  // Vis kun filtre for de typer maskinen faktisk har hændelser af.
  const present = MAINTENANCE_ORDER
    .map((t) => ({ t, n: history.filter((e) => e.type === t).length }))
    .filter((x) => x.n > 0);

  return (
    <Modal
      eyebrow="Historik"
      title={m.name}
      sub={
        <>
          <span className="fm-mono">{shortWIds(m.wIds) || "uden W-ID"}</span>
          <span>{history.length === 1 ? "1 hændelse" : `${history.length} hændelser`}</span>
        </>
      }
      footer={
        <>
          Vedligehold ligger i <span className="fm-mono">data/maintenance.json</span>, adskilt fra
          tegningsdata og nøglet på W-ID.
        </>
      }
      onClose={onClose}
    >
      {history.length === 0 ? (
        <p className="fm-empty">
          Ingen registreringer.
          {m.wIds.length
            ? " Der er ikke registreret vedligehold på denne maskine endnu."
            : " Maskinen mangler W-ID, og historikken slås op på W-ID."}
        </p>
      ) : (
        <>
          {present.length > 1 && (
            <div className="fm-seg fm-history-filter" role="group" aria-label="Filtrér på type">
              <button type="button" aria-pressed={filter === null} onClick={() => setFilter(null)}>
                Alle <span className="fm-count">{history.length}</span>
              </button>
              {present.map(({ t, n }) => (
                <button key={t} type="button" aria-pressed={filter === t} onClick={() => setFilter(t)}>
                  {MAINTENANCE_LABEL[t]} <span className="fm-count">{n}</span>
                </button>
              ))}
            </div>
          )}

          {shown.length === 0 ? (
            <p className="fm-empty">Ingen registreringer af denne type.</p>
          ) : (
            <ol className="fm-timeline">
              {shown.map((e) => <TimelineEvent key={e.id} e={e} />)}
            </ol>
          )}
        </>
      )}
    </Modal>
  );
}

function TimelineEvent({ e }: { e: MaintenanceEvent }) {
  return (
    <li className={`fm-event t-${e.type}`}>
      <div className="fm-event-head">
        <span className="fm-event-type">{MAINTENANCE_LABEL[e.type]}</span>
        <span className="fm-event-date">{describeDate(e.dato)}</span>
      </div>
      <p>{e.beskrivelse}</p>
      {(e.udfoertAf || e.omkostning !== undefined) && (
        <div className="fm-event-meta">
          {e.udfoertAf && <span>{e.udfoertAf}</span>}
          {e.omkostning !== undefined && <span className="fm-mono">{formatCost(e.omkostning)}</span>}
        </div>
      )}
    </li>
  );
}

function MachineChip({ m, onSelect }: { m: Machine; onSelect: (id: string) => void }) {
  return (
    <button type="button" className="fm-chip" onClick={() => onSelect(m.id)}>
      <span className={`fm-dot k-${m.kind}`} />
      {m.name}
      <span className="fm-mono">{shortWIds(m.wIds)}</span>
    </button>
  );
}

/**
 * Sensoridéer på én maskine: hvad der sidder der, hvad man har skitseret, og
 * kataloget man kan vælge fra. Idéerne lever kun i browseren.
 */
function SensorIdeaPanel({ sensors, ideas, onAdd, onRemove }: {
  sensors: PlacedSensor[];
  ideas: PlacedIdea[];
  onAdd: (type: string) => void;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <section>
        <h3>Signaler på maskinen</h3>
        {sensors.length === 0 && ideas.length === 0 ? (
          <p className="fm-muted">Ingen — hverken monteret eller skitseret.</p>
        ) : (
          <ul className="fm-otlist">
            {sensors.map((s) => (
              <li key={s.id}>
                <div className="fm-idearow is-real">
                  <OtDot s={s.status} />
                  <span className="fm-idearow-name">{s.type}</span>
                  <span className="fm-idearow-sig fm-mono">{s.id}</span>
                  <span className="fm-idearow-ch">{OT_STATUS_LABEL[s.status]}</span>
                </div>
              </li>
            ))}
            {ideas.map((i) => (
              <li key={i.id}>
                <div className="fm-idearow">
                  <span className="fm-dot ot-idea" />
                  <span className="fm-idearow-name">{i.kind.label}</span>
                  <span className="fm-idearow-sig fm-mono">{i.kind.signal}</span>
                  <span className="fm-idearow-ch">idé</span>
                  <button
                    type="button"
                    className="fm-idearow-del"
                    aria-label={`Fjern ${i.kind.label}`}
                    onClick={() => onRemove(i.id)}
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>Tilføj sensoridé</h3>
        <button type="button" className="fm-history-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <span>{open ? "Skjul katalog" : "Vælg fra katalog"}</span>
          <span className="fm-history-count">{OT_SENSOR_TYPES.length} typer</span>
        </button>
        {open && (
          <ul className="fm-catalog">
            {OT_SENSOR_TYPES.map((t) => (
              <li key={t.type}>
                <button type="button" onClick={() => onAdd(t.type)}>
                  <span className="fm-catalog-head">
                    <span className="fm-catalog-name">{t.label}</span>
                    <span className="fm-catalog-sig fm-mono">
                      {t.signal}{t.altSignal ? ` / ${t.altSignal}` : ""}
                    </span>
                  </span>
                  <span className="fm-catalog-where">{t.typicalPlacement}</span>
                  <span className="fm-catalog-why">{t.purpose}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="fm-muted fm-catalog-foot">
          Idéer er en skitse i browseren. De rører ikke <span className="fm-mono">data/</span> og
          forsvinder ved genindlæsning.
        </p>
      </section>
    </>
  );
}

export function FactoryMap({
  data,
  site = "UBS · Holeby",
  lines,
  rooms,
  onSelectLine,
  liveSource = "mock",
}: {
  data: LineData;
  site?: string;
  /** Alle linjer i visningsrækkefølge. Er der under to, vises ingen linjevælger. */
  lines?: LineOption[];
  /** Fælles rum, altid valgbare uanset hvilken linje man står på. */
  rooms?: LineOption[];
  onSelectLine?: (id: string) => void;
  /** Hvor Live-visningen henter tal fra. Sættes af serveren ud fra LIVE_SOURCE. */
  liveSource?: LiveSourceKind;
}) {
  const theme = useSceneTheme();
  const layout = useMemo(() => layoutLine(data), [data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [lane, setLane] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [view, setView] = useState<ViewMode>("perspective");
  const [animateFlow, setAnimateFlow] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [resetToken, setResetToken] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [layer, setLayer] = useState<MapLayer>("maintenance");
  // Kun fase 1 er besluttet, så kortet åbner der. Fase 2 og 3 ses kun, når
  // man selv vælger dem.
  const [otPhase, setOtPhase] = useState<OtPhase>(1);
  const [otSel, setOtSel] = useState<OtSelection | null>(null);
  const [otHover, setOtHover] = useState<OtSelection | null>(null);
  // Sensoridéer er en skitse i browseren — de rører ikke data/.
  const [ideas, setIdeas] = useState<SensorIdea[]>([]);
  const [liveSel, setLiveSel] = useState<string | null>(null);
  const [agentSel, setAgentSel] = useState<string | null>(null);
  const isRoom = !!rooms?.some((r) => r.id === data.line.id);
  const showPicker = (lines?.length ?? 0) + (rooms?.length ?? 0) > 1 && !!onSelectLine;

  // OT-installationen findes kun for de linjer, der har fået den projekteret.
  const otData = useMemo(() => otLayerFor(data.line.id), [data.line.id]);
  const lineOps = useMemo(() => lineOpsFor(data.line.id), [data.line.id]);
  const ot = useMemo(
    () => (otData ? layoutOt(otData, layout, data.line.id) : null),
    [otData, layout, data.line.id],
  );
  // Lander man på en linje uden OT-udstyr, findes visningen ikke at skifte til.
  const activeLayer: MapLayer = ot ? layer : "maintenance";

  // Skift af linje: ryd valg og filtre, så intet peger på den forrige linje.
  const firstLine = useRef(true);
  useEffect(() => {
    if (firstLine.current) { firstLine.current = false; return; }
    setSelectedId(null);
    setHoveredId(null);
    setLane(null);
    setHistoryOpen(false);
    setQuery("");
    setIssuesOpen(false);
    setLayer("maintenance");
    setOtPhase(1);
    setOtSel(null);
    setOtHover(null);
    setIdeas([]);
    setLiveSel(null);
    setAgentSel(null);
    setResetToken((t) => t + 1);
  }, [data.line.id]);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) setAnimateFlow(false);
    if (matchMedia("(max-width: 860px)").matches) setShowLabels(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setSelectedId(null); setIssuesOpen(false); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const selected = selectedId ? layout.byId.get(selectedId) : undefined;
  const maxStep = Math.max(...data.machines.map((m) => m.step));
  const results = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^w-?(id)?:?\s*/, "");
    if (!q) return [];
    return data.machines.filter((m) => m.name.toLowerCase().includes(q) || m.wIds.some((w) => w.includes(q))).slice(0, 7);
  }, [query, data.machines]);
  const history = useMemo(() => (selected ? historyFor(selected.wIds) : []), [selected]);
  const lastService = lastOfType(history, "hovedeftersyn");
  const lastRetrofit = lastOfType(history, "retrofit");
  const inferredEdges = selected ? data.edges.filter((e) => e.inferred && (e.from === selected.id || e.to === selected.id)) : [];
  const people = data.machines.filter((m) => m.kind === "person").length;
  const kindCounts = KIND_ORDER.map((k) => ({ k, n: data.machines.filter((m) => m.kind === k).length })).filter((c) => c.n > 0);
  const hasFlow = data.edges.length > 0;

  const isOt = activeLayer === "ot";
  const isLive = activeLayer === "live";
  const isAgents = activeLayer === "agents";
  // Status udledes hver gang — den står ingen steder i dataene.
  const agents = useMemo(() => agentStates(data.line.id, layout, ot), [data.line.id, layout, ot]);
  const agentSelected = agentSel ? agents.find((a) => a.agent.id === agentSel) : undefined;
  const signalIds = useMemo(() => ot?.sensors.map((s) => s.id) ?? [], [ot]);
  const live = useLiveSignals(liveSource, signalIds, isLive);
  /** Tallet på hver faseknap er kumulativt, ligesom filteret selv. */
  const sensorCounts = useMemo(() => {
    const out = {} as Record<OtPhase, number>;
    for (const ph of OT_PHASES) out[ph] = ot ? ot.sensors.filter(withinPhase(ph)).length : 0;
    return out;
  }, [ot]);
  const shownSensors = useMemo(
    () => (ot ? ot.sensors.filter(withinPhase(otPhase)) : []),
    [ot, otPhase],
  );
  const statusCounts = OT_STATUS_ORDER
    .map((s) => ({ s, n: shownSensors.filter((x) => x.status === s).length }))
    .filter((c) => c.n > 0);
  // Kanalerne afhænger af fasen: et IO-kort mere flytter grænsen.
  const reports = useMemo(() => (ot ? channelReports(ot, otPhase) : null), [ot, otPhase]);
  const channelOf = (s: PlacedSensor) => reports?.get(s.cabinetId)?.channel.get(s.id) ?? null;
  /** Sensorer der ikke kan få en kanal — kortets vigtigste advarsel i OT-laget. */
  const unchanneled = shownSensors.filter((s) => !channelOf(s)).length;
  /** Forudsætninger der ikke findes i dag — det er dem, kortet skal råbe op om. */
  const missingInfra = ot?.infrastructure.filter((n) => !isDone(n.status)).length ?? 0;
  const liveSensor = liveSel ? ot?.sensors.find((x) => x.id === liveSel) : undefined;
  // Linjens driftsparametre med maskinens egne afvigelser lagt ovenpå.
  const ops = selected ? opsForMachine(lineOps, selected.wIds) : null;
  const otSensor = otSel?.kind === "sensor" ? ot?.sensors.find((s) => s.id === otSel.id) : undefined;
  // Porten i kortet åbner samme modal, men på forudsætningerne — det er dem,
  // den stiplede streg handler om.
  const otCabinet = otSel?.kind === "cabinet"
    ? ot?.cabinets.find((c) => c.id === otSel.id)
    : otSel?.kind === "gateway" ? ot?.cabinets[0] : undefined;
  const cabinetTab = otSel?.kind === "gateway" ? "forudsaetninger" as const : undefined;
  const placedIdeas = useMemo(() => layoutIdeas(ideas, layout), [ideas, layout]);
  // Fasefilteret har kun noget at sige, når der er sensorer i mere end én fase.
  const phasesWithSensors = new Set(ot?.sensors.map((s) => s.phase) ?? []);
  const showPhases = isOt && phasesWithSensors.size > 1;

  const addIdea = (machineId: string, type: string) =>
    setIdeas((list) => [...list, { id: `idea-${Date.now()}-${list.length}`, machineId, type }]);
  const removeIdea = (id: string) => setIdeas((list) => list.filter((i) => i.id !== id));

  const select = (id: string | null) => {
    if (isAgents) {
      // En maskine hører til en agent — det er agenten, man vil se.
      const owner = id ? agents.find((a) => a.machines.some((m) => m.id === id)) : undefined;
      setAgentSel(owner?.agent.id ?? null);
      return;
    }
    setSelectedId(id);
    setSearchOpen(false);
    setHistoryOpen(false);
    if (id) {
      const m = layout.byId.get(id);
      if (m && lane && m.lane && m.lane !== lane) setLane(null);
    }
  };

  return (
    <div className={`fm-root${(isAgents ? !!agentSelected : !!selected && !isLive) ? " has-panel" : ""}${isLive ? " is-live" : ""}`}>
      <div className="fm-canvas" data-hovering={hoveredId ? "" : undefined}>
        {theme && (
          <Canvas
            shadows
            dpr={[1, 2]}
            camera={{ fov: 30, near: 0.5, far: 2000, position: [0, 80, 80] }}
            onPointerMissed={() => select(null)}
          >
            <Scene
              data={data}
              layout={layout}
              theme={theme}
              selectedId={selectedId}
              hoveredId={hoveredId}
              lane={lane}
              query={query.trim()}
              animateFlow={animateFlow}
              showLabels={showLabels}
              view={view}
              resetToken={resetToken}
              onSelect={select}
              onHover={setHoveredId}
              layer={activeLayer}
              ot={ot}
              otPhase={otPhase}
              otSelected={otSel}
              otHovered={otHover}
              otIdeas={placedIdeas}
              liveValues={live.values}
              liveSelected={liveSel}
              onLiveSelect={setLiveSel}
              agents={isAgents ? agents : []}
              agentSelected={agentSel}
              onAgentSelect={setAgentSel}
              onOtSelect={setOtSel}
              onOtHover={setOtHover}
            />
          </Canvas>
        )}
      </div>

      <header className="fm-top">
        <div className="fm-title">
          <div className="fm-eyebrow">
            {site} ·{" "}
            {showPicker ? (
              <select
                className="fm-linepick"
                aria-label="Vælg linje eller rum"
                value={data.line.id}
                onChange={(e) => onSelectLine!(e.target.value)}
              >
                {!!lines?.length && (
                  <optgroup label="Linjer">
                    {lines.map((l) => (
                      <option key={l.id} value={l.id}>Linje {l.order} – {l.name}</option>
                    ))}
                  </optgroup>
                )}
                {!!rooms?.length && (
                  <optgroup label="Rum">
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            ) : isRoom ? (
              <>{data.line.name}</>
            ) : (
              <>Linje {data.line.order}</>
            )}
          </div>
          <h1>{data.line.name}</h1>
          <div className="fm-meta">
            <span>{data.machines.length - people} maskiner</span>
            {people > 0 && <span>{people === 1 ? "1 person" : `${people} personer`}</span>}
            {data.lanes.length > 0 && <span>{data.lanes.length} spor</span>}
            {maxStep > 0 && <span>{maxStep + 1} trin</span>}
          </div>
        </div>

        <div className="fm-tools" role="toolbar" aria-label="Visning">
          <div className="fm-search">
            <input
              id="fm-search"
              type="search"
              placeholder="Søg W-ID eller maskine"
              value={query}
              autoComplete="off"
              onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              onKeyDown={(e) => { if (e.key === "Enter" && results[0]) select(results[0].id); }}
            />
            {searchOpen && results.length > 0 && (
              <ul className="fm-results" role="listbox">
                {results.map((m) => (
                  <li key={m.id}>
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => select(m.id)}>
                      <span className={`fm-dot k-${m.kind}`} />
                      <span className="fm-results-name">{m.name}{m.lane ? ` · ${m.lane}` : ""}</span>
                      <span className="fm-mono">{shortWIds(m.wIds)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {searchOpen && query.trim() && results.length === 0 && (
              <div className="fm-results fm-results-empty">Ingen maskine matcher “{query.trim()}”</div>
            )}
          </div>

          {ot && (
            <div className="fm-seg" role="group" aria-label="Visning">
              <button type="button" aria-pressed={activeLayer === "maintenance"} onClick={() => setLayer("maintenance")}>
                Maintenance
              </button>
              <button type="button" aria-pressed={activeLayer === "ot"} onClick={() => setLayer("ot")}>
                OT Layer
              </button>
              <button type="button" aria-pressed={activeLayer === "live"} onClick={() => setLayer("live")}>
                Live
              </button>
              <button type="button" aria-pressed={activeLayer === "agents"} onClick={() => setLayer("agents")}>
                Agents
              </button>
            </div>
          )}

          {/* Fasefilteret er kumulativt: fase 2 viser også fase 1. */}
          {showPhases && (
            <div className="fm-seg" role="group" aria-label="Udrulningsfase">
              {OT_PHASES.map((ph) => (
                <button key={ph} type="button" aria-pressed={otPhase === ph} onClick={() => setOtPhase(ph)}>
                  Fase {ph} <span className="fm-count">{sensorCounts[ph]}</span>
                </button>
              ))}
            </div>
          )}

          {/* Sporfilteret tonede maskiner — i OT-visningen er de tonet i forvejen. */}
          {!isOt && !isAgents && data.lanes.length > 0 && (
          <div className="fm-seg" role="group" aria-label="Spor">
            {[null, ...data.lanes.slice().sort().reverse()].map((l) => (
              <button key={l ?? "all"} type="button" aria-pressed={lane === l} onClick={() => setLane(l)}>
                {l ? `Spor ${l}` : "Alle"}
              </button>
            ))}
          </div>
          )}

          <div className="fm-seg" role="group" aria-label="Kamera">
            <button type="button" aria-pressed={view === "perspective"} onClick={() => { setView("perspective"); setResetToken((t) => t + 1); }}>3D</button>
            <button type="button" aria-pressed={view === "top"} onClick={() => { setView("top"); setResetToken((t) => t + 1); }}>Oppefra</button>
          </div>

          <div className="fm-seg" role="group" aria-label="Lag">
            {hasFlow && !isOt && !isAgents && (
              <button type="button" aria-pressed={animateFlow} onClick={() => setAnimateFlow((v) => !v)}>Flow</button>
            )}
            <button type="button" aria-pressed={showLabels} onClick={() => setShowLabels((v) => !v)}>Navne</button>
          </div>

          <button type="button" className="fm-btn" onClick={() => { select(null); setResetToken((t) => t + 1); }}>
            Hele linjen
          </button>
        </div>
      </header>

      <aside className="fm-legend" aria-label="Signaturforklaring">
        {isAgents ? (
          <>
            <ul>
              {agents.map((st, i) => (
                <li key={st.agent.id}>
                  <button
                    type="button"
                    className={`fm-legend-agent${agentSel === st.agent.id ? " is-selected" : ""}`}
                    onClick={() => setAgentSel(st.agent.id)}
                  >
                    <span className={`fm-dot ag-${(i % 3) + 1}`} />
                    {st.agent.name}
                    <span className={`fm-engine eng-${st.agent.engine}`}>
                      {AGENT_ENGINE_LABEL[st.agent.engine]}
                    </span>
                    <span className={`fm-legend-status ags-${st.status}`}>{AGENT_STATUS_LABEL[st.status]}</span>
                  </button>
                </li>
              ))}
              {agents.some((a) => a.upstream.length > 0) && (
                <li><span className="fm-dot ag-shared" />Fælles indløb<span className="fm-mono">upstream</span></li>
              )}
            </ul>
            <p>
              Zonerne er agenternes ansvarsområder. Stiplet kant betyder, at agenten mangler sine
              inputs — samme sprog som OT Layer. Mærket <span className="fm-engine eng-claude">Claude</span>{" "}
              koster API-kald pr. kørsel; <span className="fm-engine eng-kode">Kode</span> gør ikke.
            </p>
          </>
        ) : isOt && ot ? (
          <>
            <ul>
              {statusCounts.map(({ s, n }) => (
                <li key={s}><span className={`fm-dot ot-${s}`} />{OT_STATUS_LABEL[s]}<span className="fm-mono">{n}</span></li>
              ))}
              <li><span className="fm-dot ot-cab" />IO-skab<span className="fm-mono">{ot.cabinets.length}</span></li>
              <li><span className="fm-tray" />Kabelbakke<span className="fm-mono">{ot.trays.length}</span></li>
              {missingInfra > 0 && (
                <li><span className="fm-dot ot-missing" />Mangler – nødvendig<span className="fm-mono">{missingInfra}</span></li>
              )}
            </ul>
            <p>Maskinerne er tonet ned. Den stiplede røde streg mod nord er vejen til OT-racket — den findes ikke endnu.</p>
            {unchanneled > 0 && (
              <p className="fm-warn">
                <span>
                  {unchanneled === 1
                    ? "1 sensor kan ikke få en kanal i skabet."
                    : `${unchanneled} sensorer kan ikke få en kanal i skabet.`}
                  {" "}Åbn skabet for regnskabet.
                </span>
              </p>
            )}
          </>
        ) : (
          <>
            <ul>
              {kindCounts.map(({ k, n }) => (
                <li key={k}><span className={`fm-dot k-${k}`} />{KIND_LABEL[k]}<span className="fm-mono">{n}</span></li>
              ))}
              {hasFlow && <li><span className="fm-flow" />Materialeflow</li>}
              {hasFlow && data.edges.some((e) => e.inferred) && (
                <li><span className="fm-flow is-inferred" />Antaget forbindelse</li>
              )}
            </ul>
            {data.line.positionMode === "schematic" ? (
              <p>Placering er skematisk (fra flowdiagram) — ikke målfast.</p>
            ) : layout.unplaced.length > 0 ? (
              <p>Målfast fra plantegningen — {layout.unplaced.length} af {data.machines.length} maskiner mangler x/z og står skematisk.</p>
            ) : (
              <p>Målfast placering fra plantegningen.</p>
            )}
          </>
        )}
        {data.issues.length > 0 && (
          <button type="button" className="fm-issues-btn" aria-expanded={issuesOpen} onClick={() => setIssuesOpen((v) => !v)}>
            <span className="fm-badge">{data.issues.length}</span>
            ting at rette i tegningen
          </button>
        )}
        {issuesOpen && (
          <ol className="fm-issues">
            {data.issues.map((i) => <li key={i}>{i}</li>)}
          </ol>
        )}
      </aside>

      {selected && !isLive && !isAgents && (
        <aside className="fm-panel" aria-label={`${selected.name} ${selected.wIds.join("/")}`}>
          <div className="fm-plate">
            <div className="fm-plate-head">
              <span className="fm-kind"><span className={`fm-dot k-${selected.kind}`} />{KIND_LABEL[selected.kind]}</span>
              {selected.lane && <span className="fm-lane">Spor {selected.lane}</span>}
              <button type="button" className="fm-close" aria-label="Luk" onClick={() => select(null)}>×</button>
            </div>
            <h2>{selected.name}</h2>
            {selected.kind !== "person" && (
              <div className="fm-wid">
                <span>W-ID</span>
                <strong>{selected.wIds.join(" / ") || "mangler"}</strong>
              </div>
            )}
            {maxStep > 0 && (
              <div className="fm-step">
                Trin {selected.step + 1} af {maxStep + 1}
                <span className="fm-steps" aria-hidden>
                  {Array.from({ length: maxStep + 1 }, (_, i) => <i key={i} className={i === selected.step ? "on" : i < selected.step ? "past" : ""} />)}
                </span>
              </div>
            )}
          </div>

          {/* I OT-visningen handler panelet om signaler, ikke om vedligehold. */}
          {isOt && selected.kind !== "person" && selected.wIds.length > 0 && (
            <SensorIdeaPanel
              sensors={ot?.sensors.filter((x) => selected.wIds.includes(x.machineId)) ?? []}
              ideas={placedIdeas.filter((i) => selected.wIds.includes(i.machineId))}
              onAdd={(type) => addIdea(selected.wIds[0], type)}
              onRemove={removeIdea}
            />
          )}

          {!isOt && selected.kind !== "person" && (
          <>
          <section>
            <h3>Stamdata</h3>
            <dl>{STAMDATA_FIELDS.map((r) => <Field key={r.key} label={r.label} value={selected.details[r.key]} />)}</dl>
          </section>

          {ops && (
            <section>
              <h3>Drift</h3>
              <dl>
                <Field
                  label="Normtakt"
                  value={ops.normtakt !== undefined ? `${ops.normtakt} ${ops.rateUnit}` : undefined}
                />
                <Field
                  label="Stop efter"
                  value={`${ops.stopAfterSeconds} s${ops.overrides.has("stopAfterSeconds") ? " · afviger fra linjen" : ""}`}
                />
                <Field
                  label="Stopårsager"
                  value={`${ops.stopReasons.length} koder${ops.overrides.has("stopReasons") ? " · egen liste" : " · linjens liste"}`}
                />
                <Field label="Driftsnote" value={ops.note} />
              </dl>
              <p className="fm-ops-note">
                Kapacitet ovenfor er maskinens maksimum fra tegningen. Normtakt er den takt, den
                forventes at køre med i drift — to forskellige tal.
              </p>
            </section>
          )}

          <section>
            <h3>OT & el</h3>
            <dl>{OT_FIELDS.map((r) => <Field key={r.key} label={r.label} value={selected.details[r.key]} />)}</dl>
          </section>

          <section>
            <h3>Vedligehold</h3>
            <dl>
              <Field
                label="Sidste hovedeftersyn"
                value={lastService && describeDate(lastService.dato)}
                empty="Ingen registreringer"
              />
              <Field
                label="Sidste retrofit"
                value={lastRetrofit && describeDate(lastRetrofit.dato)}
                empty="Ingen registreringer"
              />
            </dl>
            <button type="button" className="fm-history-btn" onClick={() => setHistoryOpen(true)}>
              <span>Se historik</span>
              <span className="fm-history-count">
                {history.length === 0 ? "Ingen registreringer" : history.length === 1 ? "1 hændelse" : `${history.length} hændelser`}
              </span>
            </button>
          </section>
          </>
          )}

          {!isOt && hasFlow && selected.kind !== "person" && (
          <section>
            <h3>Flow</h3>
            <div className="fm-flowlist">
              <span className="fm-flowlabel">Fra</span>
              <div>
                {selected.upstream.length
                  ? selected.upstream.map((id) => <MachineChip key={id} m={layout.byId.get(id)!} onSelect={select} />)
                  : <span className="fm-muted">Start på linjen</span>}
              </div>
              <span className="fm-flowlabel">Til</span>
              <div>
                {selected.downstream.length
                  ? selected.downstream.map((id) => <MachineChip key={id} m={layout.byId.get(id)!} onSelect={select} />)
                  : <span className="fm-muted">Slut på tegningen</span>}
              </div>
            </div>
            {inferredEdges.length > 0 && (
              <p className="fm-warn">
                {inferredEdges.map((e) => {
                  const other = layout.byId.get(e.from === selected.id ? e.to : e.from)!;
                  return <span key={e.id}>Forbindelsen til {other.name} ({other.wIds.join("/")}) er antaget: {e.note?.toLowerCase()}.</span>;
                })}
              </p>
            )}
          </section>
          )}

          {selected.details.noter && (
            <section>
              <h3>Noter</h3>
              <p>{selected.details.noter}</p>
            </section>
          )}

          {data.line.positionMode === "floorplan" && selected.placedBy === "schematic" && (
            <p className="fm-warn">
              <span>Mangler x/z fra plantegningen — maskinen står skematisk og passer ikke med resten.</span>
            </p>
          )}

          <footer>
            Kilde: {data.line.sourceFile} · celle <span className="fm-mono">{selected.drawioId}</span>
            {selected.placedBy === "floorplan" && selected.placement && (
              <> · plan <span className="fm-mono">x {meters(selected.placement.x)} z {meters(selected.placement.z)}
                {selected.placement.rot ? ` ${selected.placement.rot}°` : ""}</span></>
            )}
          </footer>
        </aside>
      )}

      {historyOpen && selected && (
        <HistoryModal m={selected} onClose={() => setHistoryOpen(false)} />
      )}

      {isLive && liveSource === "mock" && (
        <div className="fm-mock-banner" role="status">
          <strong>Simulerede data</strong>
          <span>
            Tallene er genereret i browseren, ikke målt. Sæt <span className="fm-mono">LIVE_SOURCE=api</span>,
            når kæden står.
          </span>
        </div>
      )}

      {isAgents && (
        <div className="fm-mock-banner" role="status">
          <strong>Eksempelrapporter</strong>
          <span>Ingen agent kører endnu. Rapporterne i panelet er skabeloner, ikke resultater.</span>
        </div>
      )}

      {isAgents && agentSelected && (
        <AgentPanel
          st={agentSelected}
          colorIndex={agents.indexOf(agentSelected)}
          ot={ot}
          onClose={() => setAgentSel(null)}
        />
      )}

      {isLive && ot && (
        <LivePanel
          ot={ot}
          report={reports?.get(ot.cabinets[0]?.id ?? "") ?? null}
          live={live}
          sourceKind={liveSource}
          selectedId={liveSel}
          onSelect={setLiveSel}
        />
      )}

      {isLive && liveSensor && (
        <SignalModal
          sensor={liveSensor}
          value={live.values.get(liveSensor.id)}
          samples={live.history.get(liveSensor.id) ?? []}
          channel={channelOf(liveSensor)}
          onClose={() => setLiveSel(null)}
        />
      )}

      {ot && otSensor && (
        <SensorModal
          s={otSensor}
          cabinet={ot.cabinets.find((c) => c.id === otSensor.cabinetId)}
          channel={channelOf(otSensor)}
          phase={otPhase}
          onClose={() => setOtSel(null)}
          onOpenCabinet={() => setOtSel({ kind: "cabinet", id: otSensor.cabinetId })}
        />
      )}

      {ot && otCabinet && reports?.get(otCabinet.id) && (
        <CabinetModal
          c={otCabinet}
          ot={ot}
          report={reports.get(otCabinet.id)!}
          phase={otPhase}
          ideas={placedIdeas}
          initialTab={cabinetTab}
          onClose={() => setOtSel(null)}
          onOpenSensor={(id) => setOtSel({ kind: "sensor", id })}
          onRemoveIdea={removeIdea}
        />
      )}
    </div>
  );
}
