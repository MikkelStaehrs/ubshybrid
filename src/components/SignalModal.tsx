"use client";
import { useMemo } from "react";
import { QUALITY_LABEL, type Quality, type SignalValue } from "../lib/live-source";
import type { PlacedSensor } from "../lib/ot";
import { summarise, type Sample } from "../lib/useLiveSignals";
import { Field, Modal } from "./Modal";

const num = (v: number, digits = 1) =>
  Number.isFinite(v) ? v.toFixed(digits).replace(".", ",") : "—";

const minutes = (ms: number) => {
  const m = ms / 60000;
  return m < 1 ? `${Math.round(ms / 1000)} s` : `${m.toFixed(m < 10 ? 1 : 0).replace(".", ",")} min`;
};

/**
 * Sparkline over historikken. Tegnes som SVG i stedet for et diagrambibliotek:
 * kurven har ingen akser og skal bare vise formen og hvor hullerne er.
 */
function Sparkline({ samples }: { samples: Sample[] }) {
  const W = 520;
  const H = 96;

  const path = useMemo(() => {
    const ok = samples.filter((s) => Number.isFinite(s.value));
    if (ok.length < 2) return null;
    const t0 = ok[0].t;
    const span = Math.max(1, ok[ok.length - 1].t - t0);
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of ok) {
      if (s.value < lo) lo = s.value;
      if (s.value > hi) hi = s.value;
    }
    // Fladt signal må ikke give division med nul — giv det lidt luft.
    if (hi - lo < 1e-6) { lo -= 1; hi += 1; }

    const x = (t: number) => ((t - t0) / span) * W;
    const y = (v: number) => H - ((v - lo) / (hi - lo)) * (H - 8) - 4;

    // Fejlprøver bryder linjen — et kabelbrud er et hul, ikke et dyk til nul.
    const runs: string[] = [];
    let current: string[] = [];
    for (const s of ok) {
      if (s.quality === "fault") {
        if (current.length > 1) runs.push(current.join(" "));
        current = [];
        continue;
      }
      current.push(`${current.length ? "L" : "M"}${x(s.t).toFixed(1)},${y(s.value).toFixed(1)}`);
    }
    if (current.length > 1) runs.push(current.join(" "));
    return { runs, lo, hi };
  }, [samples]);

  if (!path) {
    return <p className="fm-muted">Der er ikke prøver nok til en kurve endnu.</p>;
  }

  return (
    <div className="fm-spark">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Forløb">
        {path.runs.map((d, i) => <path key={i} d={d} fill="none" />)}
      </svg>
      <div className="fm-spark-scale fm-mono">
        <span>{num(path.hi)}</span>
        <span>{num(path.lo)}</span>
      </div>
    </div>
  );
}

export function SignalModal({ sensor, value, samples, channel, onClose }: {
  sensor: PlacedSensor;
  value: SignalValue | undefined;
  samples: Sample[];
  channel: string | null;
  onClose: () => void;
}) {
  const stats = summarise(samples);
  const quality: Quality = value?.quality ?? "no-source";
  const faults = samples.filter((s) => s.quality === "fault").length;

  return (
    <Modal
      eyebrow="Live"
      title={sensor.id}
      sub={
        <>
          <span>{sensor.type}</span>
          <span className={`fm-q q-${quality}`}>{QUALITY_LABEL[quality]}</span>
        </>
      }
      footer={
        <>
          Historikken starter, når Live-visningen åbnes, og holder de seneste 15 minutter i
          browseren. Den gemmes ikke.
        </>
      }
      onClose={onClose}
    >
      <section className="fm-modal-body">
        <div className="fm-live-now">
          <span className="fm-live-now-value fm-mono">
            {value && Number.isFinite(value.value) ? num(value.value) : "—"}
          </span>
          <span className="fm-live-now-unit">{value?.unit || ""}</span>
          <span className="fm-live-now-raw fm-mono">
            {value && Number.isFinite(value.raw) ? `${num(value.raw, 2)} mA` : "intet råsignal"}
          </span>
        </div>
      </section>

      <section className="fm-modal-body">
        <h3>Forløb</h3>
        <Sparkline samples={samples} />
        {stats && (
          <div className="fm-stats">
            <div className="fm-stat">
              <span className="fm-stat-value fm-mono">{num(stats.min)}</span>
              <span className="fm-stat-label">Minimum</span>
            </div>
            <div className="fm-stat">
              <span className="fm-stat-value fm-mono">{num(stats.avg)}</span>
              <span className="fm-stat-label">Gennemsnit</span>
            </div>
            <div className="fm-stat">
              <span className="fm-stat-value fm-mono">{num(stats.max)}</span>
              <span className="fm-stat-label">Maksimum</span>
            </div>
            <div className="fm-stat">
              <span className="fm-stat-value fm-mono">{minutes(stats.spanMs)}</span>
              <span className="fm-stat-label">Historik</span>
              <span className="fm-stat-hint">{stats.n} prøver</span>
            </div>
          </div>
        )}
        {faults > 0 && (
          <p className="fm-warn">
            <span>
              {faults === 1 ? "1 prøve" : `${faults} prøver`} uden for 3,6–21 mA i perioden. Kurven
              er brudt der — et kabelbrud er et hul, ikke en måling på nul.
            </span>
          </p>
        )}
      </section>

      <section className="fm-modal-body">
        <h3>Kilde</h3>
        <dl>
          <Field label="Skab" value={sensor.cabinetId} />
          <Field label="Kanal" value={channel ?? undefined} empty="Ingen kanal tildelt" />
          <Field label="Signal" value={sensor.signal} />
          <Field label="Måler" value={`${sensor.model} på W-ID ${sensor.machineId}`} />
        </dl>
      </section>
    </Modal>
  );
}
