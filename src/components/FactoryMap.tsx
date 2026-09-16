"use client";
import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { KIND_LABEL, layoutLine, shortWIds } from "../lib/layout";
import type { LineOption } from "../lib/lines";
import {
  describeDate, formatCost, historyFor, lastOfType,
  MAINTENANCE_LABEL, MAINTENANCE_ORDER,
} from "../lib/maintenance";
import type { LineData, Machine, MachineKind, MaintenanceEvent, MaintenanceType } from "../lib/types";
import { useSceneTheme } from "../lib/useSceneTheme";
import { Scene, type ViewMode } from "./Scene";

const DETAIL_ROWS: { key: string; label: string }[] = [
  { key: "producent", label: "Producent" },
  { key: "model", label: "Model" },
  { key: "aar", label: "År" },
  { key: "proces", label: "Proces" },
  { key: "kapacitet", label: "Kapacitet" },
];
const OT_ROWS: { key: string; label: string }[] = [
  { key: "dimSkab", label: "DIM-skab" },
  { key: "otNet", label: "OT-netværk" },
];
const KIND_ORDER: MachineKind[] = ["intake", "elevator", "distributor", "process", "analysis"];

/** Meter med dansk komma, uden overflødige decimaler. */
const meters = (v: number) => `${v.toFixed(1).replace(/\.0$/, "").replace(".", ",")} m`;

function HistoryModal({ m, onClose }: { m: Machine; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [filter, setFilter] = useState<MaintenanceType | null>(null);
  const history = useMemo(() => historyFor(m.wIds), [m.wIds]);
  const shown = filter ? history.filter((e) => e.type === filter) : history;

  // Vis kun filtre for de typer maskinen faktisk har hændelser af.
  const present = MAINTENANCE_ORDER
    .map((t) => ({ t, n: history.filter((e) => e.type === t).length }))
    .filter((x) => x.n > 0);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // capture, så modalen lukkes før Escape rammer resten af kortet
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="fm-modal-back" onClick={onClose}>
      <div
        className="fm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fm-history-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fm-modal-head">
          <div>
            <div className="fm-modal-eyebrow">Historik</div>
            <h2 id="fm-history-title">{m.name}</h2>
            <div className="fm-modal-sub">
              <span className="fm-mono">{shortWIds(m.wIds) || "uden W-ID"}</span>
              <span>{history.length === 1 ? "1 hændelse" : `${history.length} hændelser`}</span>
            </div>
          </div>
          <button ref={closeRef} type="button" className="fm-close" aria-label="Luk" onClick={onClose}>×</button>
        </div>

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

        <footer>
          Vedligehold ligger i <span className="fm-mono">data/maintenance.json</span>, adskilt fra
          tegningsdata og nøglet på W-ID.
        </footer>
      </div>
    </div>
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

function Field({ label, value, empty = "Ikke udfyldt" }: { label: string; value?: string; empty?: string }) {
  return (
    <div className="fm-field">
      <dt>{label}</dt>
      <dd className={value ? "" : "is-empty"}>{value || empty}</dd>
    </div>
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

export function FactoryMap({
  data,
  site = "UBS · Holeby",
  lines,
  rooms,
  onSelectLine,
}: {
  data: LineData;
  site?: string;
  /** Alle linjer i visningsrækkefølge. Er der under to, vises ingen linjevælger. */
  lines?: LineOption[];
  /** Fælles rum, altid valgbare uanset hvilken linje man står på. */
  rooms?: LineOption[];
  onSelectLine?: (id: string) => void;
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
  const isRoom = !!rooms?.some((r) => r.id === data.line.id);
  const showPicker = (lines?.length ?? 0) + (rooms?.length ?? 0) > 1 && !!onSelectLine;

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
  const kindCounts = KIND_ORDER.map((k) => ({ k, n: data.machines.filter((m) => m.kind === k).length })).filter((c) => c.n > 0);
  const hasFlow = data.edges.length > 0;

  const select = (id: string | null) => {
    setSelectedId(id);
    setSearchOpen(false);
    setHistoryOpen(false);
    if (id) {
      const m = layout.byId.get(id);
      if (m && lane && m.lane && m.lane !== lane) setLane(null);
    }
  };

  return (
    <div className={`fm-root${selected ? " has-panel" : ""}`}>
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
            <span>{data.machines.length} maskiner</span>
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

          {data.lanes.length > 0 && (
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
            {hasFlow && (
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

      {selected && (
        <aside className="fm-panel" aria-label={`${selected.name} ${selected.wIds.join("/")}`}>
          <div className="fm-plate">
            <div className="fm-plate-head">
              <span className="fm-kind"><span className={`fm-dot k-${selected.kind}`} />{KIND_LABEL[selected.kind]}</span>
              {selected.lane && <span className="fm-lane">Spor {selected.lane}</span>}
              <button type="button" className="fm-close" aria-label="Luk" onClick={() => select(null)}>×</button>
            </div>
            <h2>{selected.name}</h2>
            <div className="fm-wid">
              <span>W-ID</span>
              <strong>{selected.wIds.join(" / ") || "mangler"}</strong>
            </div>
            {maxStep > 0 && (
              <div className="fm-step">
                Trin {selected.step + 1} af {maxStep + 1}
                <span className="fm-steps" aria-hidden>
                  {Array.from({ length: maxStep + 1 }, (_, i) => <i key={i} className={i === selected.step ? "on" : i < selected.step ? "past" : ""} />)}
                </span>
              </div>
            )}
          </div>

          <section>
            <h3>Stamdata</h3>
            <dl>{DETAIL_ROWS.map((r) => <Field key={r.key} label={r.label} value={selected.details[r.key]} />)}</dl>
          </section>

          <section>
            <h3>OT & el</h3>
            <dl>{OT_ROWS.map((r) => <Field key={r.key} label={r.label} value={selected.details[r.key]} />)}</dl>
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

          {hasFlow && (
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
    </div>
  );
}
