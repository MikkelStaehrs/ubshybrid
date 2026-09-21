"use client";
import { describeFault, QUALITY_LABEL, type Quality, type SignalValue } from "../lib/live-source";
import {
  isDone, pathState, registerMap, signalDelivery, OT_STATUS_LABEL,
  type CabinetReport, type OtLayout, type PlacedSensor,
} from "../lib/ot";
import type { LiveState } from "../lib/useLiveSignals";
import type { OtStatus } from "../lib/types";

/** "for 3 s siden". Null bliver til en streg, ikke til "aldrig". */
function ago(t: number | null | undefined): string {
  if (!t) return "—";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s} s siden`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min siden` : `${Math.floor(m / 60)} t siden`;
}

const num = (v: number, digits = 1) =>
  Number.isFinite(v) ? v.toFixed(digits).replace(".", ",") : "—";

/**
 * Kæden fra kobler til API, led for led.
 *
 * Statussen kommer fra infrastrukturen — den ved, hvad der findes — mens
 * "sidst set" kommer fra det, der faktisk er kommet ind. De to ting skal
 * holdes adskilt: i mock-tilstand tikker datakilden lystigt, selv om intet
 * af kæden står endnu, og det må panelet ikke skjule.
 */
function ChainStatus({ ot, live, sourceKind }: {
  ot: OtLayout;
  live: LiveState;
  sourceKind: "mock" | "api";
}) {
  const cabinet = ot.cabinets[0];
  const steps = cabinet ? pathState(ot.infrastructure, cabinet, ot.sensors[0]) : [];
  const byId = new Map(steps.map((s) => [s.id, s]));

  const links: { id: string; label: string; status: OtStatus; seen: number | null; note: string }[] = [
    {
      id: "kobler",
      label: "IO-kobler",
      status: byId.get("kobler")?.status ?? "missing",
      seen: null,
      note: byId.get("kobler")?.blockedBy.map((n) => n.name).join(", ") || "Holder registrene.",
    },
    {
      id: "edge",
      label: "Edge-collector",
      status: byId.get("edge")?.status ?? "missing",
      seen: null,
      note: byId.get("edge")?.blockedBy.map((n) => n.name).join(", ") || "Poller og skriver videre.",
    },
    {
      id: "mssql",
      label: "Database",
      status: byId.get("mssql")?.status ?? "missing",
      seen: null,
      note: byId.get("mssql")?.blockedBy.map((n) => n.name).join(", ") || "MSSQL.",
    },
    {
      id: "api",
      label: sourceKind === "mock" ? "Datakilde (simulator)" : "API /api/live",
      // Den her ved vi noget om: enten svarer den, eller også gør den ikke.
      status: live.lastReply ? (live.lastGood ? "active" : "planned") : "missing",
      seen: live.lastReply,
      note: sourceKind === "mock"
        ? "Simulerede værdier, ikke hentet gennem kæden."
        : live.lastGood ? "Svarer med data." : "Svarer, men uden værdier.",
    },
  ];

  return (
    <ul className="fm-chain">
      {links.map((l) => (
        <li key={l.id} className={`st-${l.status}`}>
          <span className="fm-chain-dot" />
          <span className="fm-chain-label">{l.label}</span>
          <span className="fm-chain-status">{OT_STATUS_LABEL[l.status]}</span>
          <span className="fm-chain-seen fm-mono">{l.seen ? ago(l.seen) : "ingen heartbeat"}</span>
          {l.note && <span className="fm-chain-note">{l.note}</span>}
        </li>
      ))}
    </ul>
  );
}

export function LivePanel({ ot, report, live, sourceKind, selectedId, onSelect }: {
  ot: OtLayout;
  report: CabinetReport | null;
  live: LiveState;
  sourceKind: "mock" | "api";
  selectedId: string | null;
  onSelect: (signalId: string) => void;
}) {
  const cabinet = ot.cabinets[0];
  const registers = report ? registerMap(report, ot.sensors) : [];
  const regById = new Map(registers.map((r) => [r.sensorId, r]));
  // Samme dom som agentstatussen: kæden skal stå, og måleren skal svare.
  const deliveryOf = (s: PlacedSensor) => {
    const v = live.values.get(s.id);
    return signalDelivery(s, ot, v && Number.isFinite(v.raw) ? { raw: v.raw } : null);
  };
  const withData = ot.sensors.filter((s) => deliveryOf(s).delivers).length;

  const source = (s: PlacedSensor) => {
    const r = regById.get(s.id);
    if (!r) return `${s.cabinetId} · ingen kanal`;
    return `${s.cabinetId} · ${r.channel} · ${r.address}`;
  };

  return (
    <aside className="fm-live-panel" aria-label="Forbindelser">
      <header className="fm-live-head">
        <h2>Forbindelser</h2>
        <span className="fm-live-sub">
          {withData} af {ot.sensors.length} signaler leverer data
        </span>
      </header>

      <section>
        <h3>Kæden</h3>
        <ChainStatus ot={ot} live={live} sourceKind={sourceKind} />
      </section>

      <section>
        <h3>Signaler</h3>
        {ot.sensors.length === 0 ? (
          <p className="fm-muted">Der er ingen signaler i OT-laget endnu.</p>
        ) : (
          <ul className="fm-siglist">
            <li className="fm-sighead">
              <span>Signal</span><span>Rå</span><span>Værdi</span><span>Sidst set</span>
            </li>
            {ot.sensors.map((s) => {
              const v: SignalValue | undefined = live.values.get(s.id);
              const q: Quality = v?.quality ?? "no-source";
              const fault = v && q === "fault" ? describeFault(v.raw) : null;
              const delivery = deliveryOf(s);
              return (
                <li key={s.id} className={`fm-sigrow q-${q}${selectedId === s.id ? " is-selected" : ""}`}>
                  <button type="button" onClick={() => onSelect(s.id)}>
                    <span className="fm-sig-id fm-mono">{s.id}</span>
                    <span className="fm-sig-raw fm-mono">{v ? `${num(v.raw, 2)} mA` : "—"}</span>
                    <span className="fm-sig-val fm-mono">
                      {v && v.value !== null ? `${num(v.value)} ${v.unit}` : "—"}
                    </span>
                    <span className="fm-sig-seen fm-mono">
                      {v && q !== "no-source" ? ago(new Date(v.timestamp).getTime()) : "—"}
                    </span>
                    <span className="fm-sig-src">{source(s)}</span>
                    <span className="fm-sig-q">{QUALITY_LABEL[q]}</span>
                    {/* Ved fejl: sig hvad der er galt, ikke bare at noget er. */}
                    {fault && <span className="fm-sig-fault">{fault}</span>}
                    {!fault && !delivery.delivers && (
                      <span className="fm-sig-why">Leverer ikke: {delivery.reason}.</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="fm-oee">
        <h3>OEE</h3>
        <p className="fm-muted">
          Ikke bygget endnu. Tilgængelighed kræver et driftssignal pr. maskine — kører eller
          stoppet — og der er ingen DI-signaler i anlægget i dag.
          {cabinet && " Sæt dem på fra kataloget under OT Layer, så kan regnestykket begynde."}
        </p>
        <p className="fm-muted">
          Ydelse og kvalitet kræver desuden en normtakt og et kasseret-tal. Begge dele mangler en
          kilde, så der står ikke et tomt felt her med et gæt i.
        </p>
      </section>
    </aside>
  );
}
