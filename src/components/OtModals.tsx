"use client";
import { useState } from "react";
import { shortWIds } from "../lib/layout";
import {
  freeChannels, hardwareByCategory, hardwarePhase, ideaDemand, isDone, isIdea, pathState,
  prerequisites, railItems, registerMap, splitSensors,
  CHANNEL_FOR, OT_HARDWARE_LABEL, OT_PROCUREMENT_LABEL, OT_STATUS_LABEL,
  type CabinetReport, type OtLayout, type PlacedCabinet, type PlacedIdea, type PlacedSensor,
} from "../lib/ot";
import type { OtHardware, OtInfraNode, OtPathStep, OtPhase, OtStatus } from "../lib/types";
import { Field, Modal } from "./Modal";

export const OtDot = ({ s }: { s: OtStatus }) => <span className={`fm-dot ot-${s}`} />;

/** Én sensor i en liste — samme rolle som MachineChip i maskinpanelet. */
export function SensorRow({ s, channel, phase, onSelect }: {
  s: PlacedSensor;
  channel: string | null;
  /** Den viste fase — sensorer længere ude i udrulningen tones ned. */
  phase: OtPhase;
  onSelect: (id: string) => void;
}) {
  const later = s.phase > phase;
  return (
    <li>
      <button type="button" className={`fm-otrow${later ? " is-later" : ""}`} onClick={() => onSelect(s.id)}>
        <OtDot s={s.status} />
        <span className="fm-otrow-id fm-mono">{s.id}</span>
        <span className="fm-otrow-where">{s.machine ? s.machine.name : "ukendt maskine"}</span>
        <span className="fm-otrow-phase">Fase {s.phase}</span>
        <span className={`fm-otrow-ch fm-mono${later || channel ? "" : " is-missing"}`}>
          {later ? "senere fase" : channel ?? "ingen kanal"}
        </span>
      </button>
    </li>
  );
}

export function SensorModal({ s, cabinet, channel, phase, onClose, onOpenCabinet }: {
  s: PlacedSensor;
  cabinet?: PlacedCabinet;
  channel: string | null;
  /** Den viste fase. Kanaler findes kun for det, der er med indtil da. */
  phase: OtPhase;
  onClose: () => void;
  onOpenCabinet: () => void;
}) {
  // Uden kanal er der to vidt forskellige årsager, og de må ikke forveksles.
  const later = s.phase > phase;
  return (
    <Modal
      eyebrow={`Sensor · fase ${s.phase}`}
      title={s.id}
      sub={
        <>
          <span>{s.type}</span>
          <span><OtDot s={s.status} />{OT_STATUS_LABEL[s.status]}</span>
        </>
      }
      footer={
        <>
          OT-udstyret ligger i <span className="fm-mono">data/ot-layer.ts</span>, adskilt fra
          tegningsdata og bundet til maskinen på W-ID.
        </>
      }
      onClose={onClose}
    >
      <section className="fm-modal-body">
        <dl>
          <Field label="Model" value={s.model} />
          <Field label="Signal" value={s.signal} />
          <Field label="Status" value={OT_STATUS_LABEL[s.status]} />
          <Field label="Fase" value={`Fase ${s.phase}`} />
          <Field
            label="Sidder på"
            value={s.machine && `${s.machine.name} · W-ID ${shortWIds(s.machine.wIds)}`}
            empty={`W-ID ${s.machineId} findes ikke i linjen`}
          />
          <Field label="Skab" value={cabinet ? `${cabinet.name} · ${cabinet.id}` : s.cabinetId} />
          <Field
            label="Kanal"
            value={channel ?? undefined}
            empty={later ? `Tildeles først i fase ${s.phase}` : "Ingen ledig kanal i skabet"}
          />
        </dl>
        {!channel && (
          <p className="fm-warn">
            <span>
              {later
                ? `Sensoren hører til fase ${s.phase}, og kortet står på fase ${phase}. Vælg fase ${s.phase} for at se, hvilken kanal den ville få.`
                : "Skabet har ikke flere ledige indgange af den type, signalet kræver, ved den viste fase. Sensoren kan først kobles på, når der kommer et IO-kort mere i skabet."}
            </span>
          </p>
        )}
        {cabinet && (
          <button type="button" className="fm-history-btn" onClick={onOpenCabinet}>
            <span>Se skabet</span>
            <span className="fm-history-count fm-mono">{cabinet.id}</span>
          </button>
        )}
      </section>
    </Modal>
  );
}


// --- Skabsmodalen ----------------------------------------------------------

type CabTab = "oversigt" | "hardware" | "signaler" | "data" | "forudsaetninger" | "udvidelse";

const TABS: { id: CabTab; label: string }[] = [
  { id: "oversigt", label: "Oversigt" },
  { id: "hardware", label: "Hardware" },
  { id: "signaler", label: "Signaler" },
  { id: "data", label: "Data" },
  { id: "forudsaetninger", label: "Forudsætninger" },
  { id: "udvidelse", label: "Udvidelse" },
];

/**
 * Komponenterne som blokke på en DIN-skinne, i styklistens rækkefølge.
 * Blokke, der først kommer ved en udvidelse, står tomme — så kan man se den
 * plads, de skal fylde.
 */
function DinRail({ items, phase }: { items: OtHardware[]; phase: OtPhase }) {
  if (items.length === 0) return null;
  return (
    <div
      className="fm-rail"
      role="img"
      aria-label={`DIN-skinne fra venstre: ${items.map((h) => h.name).join(", ")}`}
    >
      <div className="fm-rail-row">
        {items.map((h) => {
          const later = isIdea(h.status) || hardwarePhase(h) > phase;
          return (
            <div
              key={h.id}
              className={`fm-rail-block${later ? " is-later" : ""}${h.provides ? " is-io" : ""}`}
              style={{ flexGrow: h.rail!.width }}
              title={`${h.name}${h.qty > 1 ? ` × ${h.qty}` : ""}${later ? " — først ved udvidelse" : ""}`}
            >
              <span>{h.rail!.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Én komponent i styklisten: navn · model · antal · om den købes nu. */
function HardwareRow({ h, phase }: { h: OtHardware; phase: OtPhase }) {
  const idea = isIdea(h.status);
  const later = hardwarePhase(h) > phase;
  return (
    <li className={`fm-hwrow${idea ? " is-idea" : ""}${later && !idea ? " is-later" : ""}`}>
      <OtDot s={h.status} />
      <span className="fm-hwrow-name">
        {h.name}
        {!idea && later && <span className="fm-hwrow-later"> · fra fase {hardwarePhase(h)}</span>}
      </span>
      <span className={`fm-hwrow-model${h.model ? "" : " is-empty"}`}>{h.model || "afklares"}</span>
      <span className="fm-hwrow-qty fm-mono">{h.qty} stk.</span>
      <span className={`fm-hwrow-buy${idea ? " is-later" : ""}`}>{OT_PROCUREMENT_LABEL[h.status]}</span>
      {h.note && <span className="fm-hwrow-note">{h.note}</span>}
    </li>
  );
}

function ChannelBar({ ch }: { ch: CabinetReport["uses"][number] }) {
  const free = ch.total - ch.used;
  const over = ch.needed - ch.total;
  return (
    <div className={`fm-chan${over > 0 ? " is-over" : ""}`}>
      <div className="fm-chan-head">
        <span>{ch.label}</span>
        <span className="fm-mono">{ch.used} / {ch.total}</span>
      </div>
      {ch.total > 0 && (
        <div className="fm-chan-bar" aria-hidden>
          {Array.from({ length: ch.total }, (_, i) => <i key={i} className={i < ch.used ? "on" : ""} />)}
        </div>
      )}
      <div className="fm-chan-note">
        {ch.cards.length === 0
          ? "Intet kort i skabet endnu."
          : over > 0
            ? `${free} ledige — ${ch.needed} signaler vil have en kanal, så der mangler ${over}.`
            : free === 0
              ? "Alle kanaler er optaget."
              : `${free} ledige.`}
        {ch.upcoming.map((u) => (
          <span key={u.name} className="fm-chan-soon"> +{u.each * u.qty} kanaler ved udvidelse ({u.name}).</span>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="fm-stat">
      <span className="fm-stat-value fm-mono">{value}</span>
      <span className="fm-stat-label">{label}</span>
      {hint && <span className="fm-stat-hint">{hint}</span>}
    </div>
  );
}

/** Vejen fra måling til dashboard, farvet efter hvor langt kæden rækker i dag. */
function DataTab({ c, sensors, report, infra }: {
  c: PlacedCabinet;
  sensors: PlacedSensor[];
  report: CabinetReport;
  infra: OtInfraNode[];
}) {
  const first = sensors[0];
  const channel = first ? report.channel.get(first.id) ?? "AI1" : "AI1";
  const tag = first?.id ?? "FT-743";
  const wid = first?.machineId ?? "743";
  const states = pathState(infra, c, first);

  const detail: Record<OtPathStep, string> = {
    sensor: first ? `${first.model}, ${first.signal} — sidder på W-ID ${wid}.` : "4-20 mA fra måleren.",
    io: `Strømsløjfen bliver til et tal på kanal ${channel}.`,
    kobler: "Modbus TCP / OPC UA. Kobleren holder registrene.",
    edge: "Poller kobleren, buffer ved netbrud, skriver videre.",
    mssql: "Én række pr. måling. Samme database som resten af driftsdata.",
    dashboard: "Læser fra MSSQL — ikke fra kobleren.",
  };

  const broken = states.find((s) => !isDone(s.status));

  return (
    <>
      <section className="fm-modal-body">
        <h3>Datavejen</h3>
        {broken && (
          <p className="fm-warn">
            <span>
              Kæden når til <strong>{states[states.indexOf(broken) - 1]?.label ?? "start"}</strong> i
              dag. Den knækker ved {broken.label.toLowerCase()}.
            </span>
          </p>
        )}
        <ol className="fm-path">
          {states.map((s) => (
            <li key={s.id} className={`st-${s.status}`}>
              <span className="fm-path-title">
                {s.label}
                <span className="fm-path-status">{OT_STATUS_LABEL[s.status]}</span>
              </span>
              <span className="fm-path-detail">{detail[s.id]}</span>
              {s.blockedBy.length > 0 && (
                <span className="fm-path-block">
                  Venter på: {s.blockedBy.map((n) => n.name).join(", ")}.
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section className="fm-modal-body">
        <h3>Tabellen</h3>
        <pre className="fm-code"><code>{`CREATE TABLE ot_maaling (
  id        BIGINT IDENTITY PRIMARY KEY,
  tag       VARCHAR(32)  NOT NULL,   -- ${tag}
  wid       VARCHAR(16)  NOT NULL,   -- ${wid}
  tidspunkt DATETIME2(0) NOT NULL,
  vaerdi    REAL         NOT NULL,
  enhed     VARCHAR(16)  NOT NULL
);

CREATE INDEX ix_ot_maaling_tag_tid
  ON ot_maaling (tag, tidspunkt DESC);`}</code></pre>
      </section>

      <section className="fm-modal-body">
        <h3>Edge — eksempel</h3>
        <pre className="fm-code"><code>{`# Læser ${channel} fra ${c.id} og skriver til MSSQL.
# Registerkortet står under fanen Signaler.
TAGS = [{"tag": "${tag}", "wid": "${wid}", "addr": 30001, "enhed": "t/t"}]

while True:
    for t in TAGS:
        # float32 ligger i to på hinanden følgende input-registre
        regs = client.read_input_registers(t["addr"], 2)
        vaerdi = struct.unpack(">f", struct.pack(">HH", *regs))[0]
        cur.execute(
            "INSERT INTO ot_maaling (tag, wid, tidspunkt, vaerdi, enhed)"
            " VALUES (?, ?, SYSUTCDATETIME(), ?, ?)",
            t["tag"], t["wid"], vaerdi, t["enhed"])
    conn.commit()
    time.sleep(1)`}</code></pre>
        <p className="fm-muted fm-regfoot">
          Eksempel, ikke kode fra drift. Pointen er retningen: kortet og dashboardet læser fra
          MSSQL, aldrig direkte fra kobleren — så et netbrud i produktionen ikke tager kortet med.
        </p>
      </section>
    </>
  );
}

/** Alt der skal være på plads, før piloten leverer data til en database. */
function PrereqTab({ cabinet, sensors, infra }: {
  cabinet: PlacedCabinet;
  sensors: PlacedSensor[];
  infra: OtInfraNode[];
}) {
  const items = prerequisites(cabinet, sensors, infra);
  const done = items.filter((i) => isDone(i.status)).length;

  return (
    <>
      <section className="fm-modal-body">
        <h3>Status</h3>
        <p className="fm-prereq-count">
          <strong>{done} af {items.length}</strong> forudsætninger opfyldt
        </p>
        <div className="fm-prereq-bar" aria-hidden>
          {items.map((i) => <i key={i.id} className={`st-${i.status}`} />)}
        </div>
        <p className="fm-muted fm-regfoot">
          Opfyldt vil sige, at den findes og virker. Bestilt, planlagt og manglende tæller ikke med
          — de er alle sammen noget, der ikke leverer data endnu.
        </p>
      </section>

      <section className="fm-modal-body">
        <h3>Tjekliste</h3>
        <ul className="fm-prereqlist">
          {items.map((i) => (
            <li key={i.id} className={`fm-prereq st-${i.status}${isDone(i.status) ? " is-done" : ""}`}>
              <OtDot s={i.status} />
              <span className="fm-prereq-name">{i.name}</span>
              <span className="fm-prereq-status">{OT_STATUS_LABEL[i.status]}</span>
              {i.location && <span className="fm-prereq-where">{i.location}</span>}
              <span className="fm-prereq-blocks">{i.blocks}</span>
              {i.note && <span className="fm-prereq-note">{i.note}</span>}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/** Sensoridéerne samlet, med kanalbehovet holdt op mod de frie kanaler. */
function ExpansionTab({ ideas, free, demand, cabinet, onRemoveIdea }: {
  ideas: PlacedIdea[];
  free: { ai: number; di: number };
  demand: { ai: number; di: number; bus: number };
  cabinet: PlacedCabinet;
  onRemoveIdea: (id: string) => void;
}) {
  if (ideas.length === 0) {
    return (
      <section className="fm-modal-body">
        <p className="fm-muted">
          Ingen sensoridéer endnu. Klik på en maskine i kortet og vælg en type fra kataloget — så
          lander den her, og kanalbehovet bliver regnet med.
        </p>
      </section>
    );
  }

  const shortAi = demand.ai - free.ai;
  const shortDi = demand.di - free.di;
  const spare = cabinet.hardware.filter((h) => isIdea(h.status) && h.provides);

  // Grupperet pr. maskine — det er sådan man køber og trækker kabler.
  const byMachine = new Map<string, PlacedIdea[]>();
  for (const i of ideas) {
    const key = i.machine?.name ?? `W-ID ${i.machineId}`;
    byMachine.set(key, [...(byMachine.get(key) ?? []), i]);
  }

  return (
    <>
      <section className="fm-modal-body">
        <h3>Kanalbehov</h3>
        <div className="fm-stats">
          <Stat label="Analoge (AI)" value={`${demand.ai} / ${free.ai}`} hint="behov / ledige" />
          <Stat label="Digitale (DI)" value={`${demand.di} / ${free.di}`} hint="behov / ledige" />
          <Stat label="På feltbus" value={demand.bus} hint="bruger ingen kanal" />
        </div>
        {shortAi > 0 || shortDi > 0 ? (
          <p className="fm-warn">
            <span>
              Det passer ikke i skabet som det står:
              {shortAi > 0 && ` ${shortAi} analoge`}
              {shortAi > 0 && shortDi > 0 && " og"}
              {shortDi > 0 && ` ${shortDi} digitale`} kanaler mangler.
              {spare.length > 0 && ` ${spare.map((h) => h.name).join(", ")} er allerede på styklisten som mulig udvidelse.`}
            </span>
          </p>
        ) : (
          <p className="fm-muted">
            Der er kanaler nok i skabet til alle idéerne.
            {demand.bus > 0 && " Feltbus-signalerne fylder ingen kanal, men skal med på switchen."}
          </p>
        )}
      </section>

      <section className="fm-modal-body">
        <h3>Idéer</h3>
        {[...byMachine].map(([name, list]) => (
          <div key={name} className="fm-hwgroup">
            <h4>{name}</h4>
            <ul className="fm-otlist">
              {list.map((i) => (
                <li key={i.id}>
                  <div className="fm-idearow">
                    <span className="fm-dot ot-idea" />
                    <span className="fm-idearow-name">{i.kind.label}</span>
                    <span className="fm-idearow-sig fm-mono">
                      {i.kind.signal}
                      {i.kind.altSignal && <span className="fm-muted"> / {i.kind.altSignal}</span>}
                    </span>
                    <span className="fm-idearow-ch">
                      {CHANNEL_FOR[i.kind.signal] ? "1 kanal" : "feltbus"}
                    </span>
                    <button
                      type="button"
                      className="fm-idearow-del"
                      aria-label={`Fjern ${i.kind.label} på ${name}`}
                      onClick={() => onRemoveIdea(i.id)}
                    >
                      ×
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </>
  );
}

export function CabinetModal({ c, ot, report, phase, ideas, initialTab, onClose, onOpenSensor, onRemoveIdea }: {
  c: PlacedCabinet;
  ot: OtLayout;
  report: CabinetReport;
  phase: OtPhase;
  /** Sensoridéer brugeren har sat på maskinerne i linjen. */
  ideas: PlacedIdea[];
  /** Fanen modalen åbner på — porten i kortet peger på forudsætningerne. */
  initialTab?: CabTab;
  onClose: () => void;
  onOpenSensor: (id: string) => void;
  onRemoveIdea: (id: string) => void;
}) {
  const [tab, setTab] = useState<CabTab>(initialTab ?? "oversigt");
  const { all, decided, phases } = splitSensors(c.id, ot.sensors);
  const free = freeChannels(report);
  const demand = ideaDemand(ideas);
  const registers = registerMap(report, ot.sensors);
  const buyNow = c.hardware.filter((h) => !isIdea(h.status)).length;
  const where = c.near ? `${c.near.name} · W-ID ${shortWIds(c.near.wIds)}` : `W-ID ${c.nearMachine}`;
  const decidedLabel = phases.length ? `Tilsluttet (fase ${phases.join(", ")})` : "Tilsluttet";

  return (
    <Modal
      eyebrow="IO-skab"
      title={c.name}
      wide
      scrollKey={tab}
      sub={
        <>
          <span className="fm-mono">{c.id}</span>
          <span>{all.length === 1 ? "1 signal" : `${all.length} signaler`}</span>
          <span><OtDot s={c.status} />{OT_STATUS_LABEL[c.status]}</span>
        </>
      }
      footer={
        <>
          Kanaltallene er summen af IO-kortene i styklisten — de kan ikke komme til at sige noget
          andet end listen. Skabet står i <span className="fm-mono">data/ot-layer.ts</span>.
        </>
      }
      onClose={onClose}
    >
      <div className="fm-tabs" role="tablist" aria-label="Afsnit">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "udvidelse" && ideas.length > 0 && <span className="fm-count">{ideas.length}</span>}
          </button>
        ))}
      </div>

      {tab === "oversigt" && (
        <>
          <section className="fm-modal-body">
            <dl>
              <Field label="Status" value={OT_STATUS_LABEL[c.status]} />
              <Field label="Placering" value={where} />
              <Field label="Feltbus" value={c.network?.switch} empty="Switch og VLAN afklares" />
              <Field label="Uplink" value={c.network?.uplink} empty="RJ45 eller fiber afklares" />
            </dl>
          </section>

          <section className="fm-modal-body">
            <h3>DIN-skinne</h3>
            <DinRail items={railItems(c)} phase={phase} />
          </section>

          <section className="fm-modal-body">
            <h3>Kanalforbrug</h3>
            {report.uses.map((ch) => <ChannelBar key={ch.kind} ch={ch} />)}
          </section>

          <section className="fm-modal-body">
            <h3>Nøgletal</h3>
            <div className="fm-stats">
              <Stat label="Komponenter" value={c.hardware.length} hint={`${buyNow} købes nu`} />
              <Stat label="Signaler tilsluttet" value={decided.length} />
              <Stat label="Ledige AI" value={free.ai} />
              <Stat label="Ledige DI" value={free.di} />
              <Stat label="Sensoridéer" value={ideas.length} hint={ideas.length ? "se Udvidelse" : "ingen endnu"} />
            </div>
          </section>
        </>
      )}

      {tab === "hardware" && (
        <section className="fm-modal-body">
          <p className="fm-hwsum">
            {buyNow} af {c.hardware.length} komponenter købes nu.
            {c.hardware.length - buyNow > 0 && " Resten afventer en beslutning om udvidelse."}
          </p>
          {hardwareByCategory(c).map(({ category, items }) => (
            <div key={category} className="fm-hwgroup">
              <h4>{OT_HARDWARE_LABEL[category]}</h4>
              <ul className="fm-hwlist">
                {items.map((h) => <HardwareRow key={h.id} h={h} phase={phase} />)}
              </ul>
            </div>
          ))}
        </section>
      )}

      {tab === "signaler" && (
        <>
          <section className="fm-modal-body">
            <h3>{decidedLabel}</h3>
            {decided.length === 0 ? (
              <p className="fm-muted">Ingen signaler er tilsluttet endnu.</p>
            ) : (
              <ul className="fm-otlist">
                {decided.map((s) => (
                  <SensorRow
                    key={s.id}
                    s={s}
                    channel={report.channel.get(s.id) ?? null}
                    phase={phase}
                    onSelect={onOpenSensor}
                  />
                ))}
              </ul>
            )}
          </section>

          <section className="fm-modal-body">
            <h3>Registeroversigt</h3>
            {registers.length === 0 ? (
              <p className="fm-muted">Ingen kanaler er tildelt endnu.</p>
            ) : (
              <>
                <ul className="fm-reglist">
                  <li className="fm-reghead">
                    <span>Tag</span><span>Kanal</span><span>Adresse</span><span>Type</span>
                  </li>
                  {registers.map((r) => (
                    <li key={r.sensorId} className="fm-regrow">
                      <span className="fm-mono">{r.sensorId}</span>
                      <span className="fm-mono">{r.channel}</span>
                      <span className="fm-mono">{r.address}</span>
                      <span>{r.datatype}</span>
                      <span className="fm-regnote">{r.note}</span>
                    </li>
                  ))}
                </ul>
                <p className="fm-muted fm-regfoot">
                  Forslag: analoge værdier som float32 i to input-registre, digitale som én diskret
                  indgang. Adresserne er ikke aftalt med nogen endnu — de følger konventionen, så
                  der er noget konkret at tage med til tavlebyggeren.
                </p>
              </>
            )}
          </section>
        </>
      )}

      {tab === "data" && <DataTab c={c} sensors={decided} report={report} infra={ot.infrastructure} />}

      {tab === "forudsaetninger" && (
        <PrereqTab cabinet={c} sensors={ot.sensors} infra={ot.infrastructure} />
      )}

      {tab === "udvidelse" && (
        <ExpansionTab
          ideas={ideas}
          free={free}
          demand={demand}
          cabinet={c}
          onRemoveIdea={onRemoveIdea}
        />
      )}
    </Modal>
  );
}
