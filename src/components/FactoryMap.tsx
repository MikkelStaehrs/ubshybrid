"use client";
import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { KIND_LABEL, layoutLine, shortWIds } from "../lib/layout";
import type { LineOption } from "../lib/lines";
import { formatRetrofit, parseRetrofit, timeSince } from "../lib/retrofit";
import type { LineData, Machine, MachineKind } from "../lib/types";
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

function RetrofitModal({ m, onClose }: { m: Machine; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const raw = m.details.retrofit?.trim();
  const parsed = raw ? parseRetrofit(raw) : null;
  const since = parsed ? timeSince(parsed) : "";

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    // capture, så modalen lukkes før Escape rammer resten af kortet
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="fm-modal-back" onClick={onClose}>
      <div
        className="fm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fm-retro-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fm-modal-head">
          <div>
            <div className="fm-modal-eyebrow">Retrofit</div>
            <h2 id="fm-retro-title">{m.name}</h2>
          </div>
          <button ref={closeRef} type="button" className="fm-close" aria-label="Luk" onClick={onClose}>×</button>
        </div>

        <div className={`fm-retro-state${raw ? " is-done" : ""}`}>
          {raw ? (
            <>
              <strong>Totalrenoveret {parsed ? formatRetrofit(parsed) : raw}</strong>
              {since && <span>{since}</span>}
            </>
          ) : (
            <>
              <strong>Ingen totalrenovering registreret</strong>
              <span>Vi ved ikke, om maskinen har været gennemrenoveret.</span>
            </>
          )}
        </div>

        <dl>
          <Field label="W-ID" value={m.wIds.join(" / ") || undefined} />
          <Field label="Producent" value={m.details.producent} />
          <Field label="Model" value={m.details.model} />
          <Field label="Oprindeligt år" value={m.details.aar} />
          <Field label="Sidste totalrenovering" value={raw} />
        </dl>

        {m.details.retrofitNoter && (
          <section>
            <h3>Hvad blev der lavet</h3>
            <p>{m.details.retrofitNoter}</p>
          </section>
        )}

        <footer>
          Udfyldes i Draw.io med Ctrl+M: <span className="fm-mono">retrofit</span> (fx
          {" "}<span className="fm-mono">2024-06</span>) og <span className="fm-mono">retrofitnoter</span>.
        </footer>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div className="fm-field">
      <dt>{label}</dt>
      <dd className={value ? "" : "is-empty"}>{value || "Ikke udfyldt"}</dd>
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
  const [retrofitOpen, setRetrofitOpen] = useState(false);
  const isRoom = !!rooms?.some((r) => r.id === data.line.id);
  const showPicker = (lines?.length ?? 0) + (rooms?.length ?? 0) > 1 && !!onSelectLine;

  // Skift af linje: ryd valg og filtre, så intet peger på den forrige linje.
  const firstLine = useRef(true);
  useEffect(() => {
    if (firstLine.current) { firstLine.current = false; return; }
    setSelectedId(null);
    setHoveredId(null);
    setLane(null);
    setRetrofitOpen(false);
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
  const inferredEdges = selected ? data.edges.filter((e) => e.inferred && (e.from === selected.id || e.to === selected.id)) : [];
  const kindCounts = KIND_ORDER.map((k) => ({ k, n: data.machines.filter((m) => m.kind === k).length })).filter((c) => c.n > 0);
  const hasFlow = data.edges.length > 0;

  const select = (id: string | null) => {
    setSelectedId(id);
    setSearchOpen(false);
    setRetrofitOpen(false);
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
            <h3>Retrofit</h3>
            <button
              type="button"
              className={`fm-retro-btn${selected.details.retrofit ? " is-done" : ""}`}
              onClick={() => setRetrofitOpen(true)}
            >
              <span>{selected.details.retrofit ? `Totalrenoveret ${selected.details.retrofit}` : "Ikke registreret"}</span>
              <span className="fm-retro-more">Detaljer</span>
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

      {retrofitOpen && selected && (
        <RetrofitModal m={selected} onClose={() => setRetrofitOpen(false)} />
      )}
    </div>
  );
}
