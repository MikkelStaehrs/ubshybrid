// Konteksten en agent får som arbejdsbeskrivelse.
//
// Ét JSON-objekt pr. linje: hierarki, maskiner med stamdata og driftsparametre,
// flow, signaler med kæde, skabe, infrastruktur og agenter. Alt bygges af de
// samme moduler, kortet tegner efter — der findes ingen anden kilde, så
// endpointet og kortet kan ikke komme til at sige to forskellige ting.
//
// Med et agent-id skæres objektet ned til den gren, agenten har i scope. Det
// er præcis den JSON, agenten senere får i hånden — ikke mere.
import { lineOpsFor, opsForMachine, agentStates, describeScope, AGENT_STATUS_LABEL, type AgentState } from "./agents";
import { layoutLine, type PlacedMachine } from "./layout";
import { LINES } from "./lines";
import {
  channelReport, isDone, layoutOt, otLayerFor, pathState, registerMap,
  OT_STATUS_LABEL, type OtLayout, type PlacedSensor,
} from "./ot";
import type { Agent, FlowEdge, OtInfraNode, OtStatus } from "./types";

export const SITE = "UBS · Holeby";

export interface ContextDoc {
  generatedAt: string;
  site: string;
  line: {
    id: string;
    name: string;
    order: number;
    positionMode: "schematic" | "floorplan";
    sourceFile: string;
    parsedAt: string;
    lanes: string[];
  };
  /** Kun det, en agent skal kende: hvad hører til hvad. Maskin-id'er. */
  hierarchy: {
    trunk: string[];
    lanes: { lane: string; machines: string[] }[];
  };
  ops: {
    rateUnit: string;
    stopAfterSeconds: number;
    stopReasons: { code: string; label: string }[];
  } | null;
  machines: MachineCtx[];
  flow: FlowEdge[];
  cabinets: CabinetCtx[];
  signals: SignalCtx[];
  infrastructure: OtInfraNode[];
  agents: AgentCtx[];
  /** Sat når objektet er skåret til én agent. */
  scope?: { agentId: string; kind: string; description: string };
}

export interface MachineCtx {
  id: string;
  wIds: string[];
  name: string;
  kind: string;
  lane: string | null;
  step: number;
  upstream: string[];
  downstream: string[];
  /** Fra tegningen. Tomme felter er udeladt, ikke gættet. */
  stamdata: Record<string, string>;
  ops: {
    normtakt: number | null;
    rateUnit: string;
    stopAfterSeconds: number;
    stopReasons: string[];
    note: string | null;
    /** Felter maskinen afviger fra linjen på. Tom = arver alt. */
    overrides: string[];
  } | null;
  /** Signal-id'er på maskinen. */
  signals: string[];
}

export interface CabinetCtx {
  id: string;
  name: string;
  status: OtStatus;
  statusLabel: string;
  nearMachine: string;
  channels: { kind: string; used: number; total: number }[];
  hardwareCount: number;
}

export interface SignalCtx {
  id: string;
  type: string;
  catalogType: string | null;
  model: string;
  signal: string;
  machineId: string;
  cabinetId: string;
  phase: number;
  status: OtStatus;
  statusLabel: string;
  channel: string | null;
  register: { address: string; datatype: string } | null;
  /** Kæden fra måling til database, led for led. */
  chain: { step: string; label: string; status: OtStatus; statusLabel: string }[];
  /** true når hele kæden står, og en agent kan læse signalet fra databasen. */
  delivers: boolean;
}

export interface AgentCtx {
  id: string;
  name: string;
  role: Agent["role"];
  job: string;
  scope: Agent["scope"];
  scopeLabel: string;
  cadence: string;
  enabled: boolean;
  status: AgentState["status"];
  statusLabel: string;
  summary: string;
  inputs: { label: string; required: boolean; need: string; have: number; total: number; detail: string }[];
  /** Maskin-id'er i scope. Tom for vagtagenten. */
  machines: string[];
}

// ---------------------------------------------------------------------------

function machineCtx(m: PlacedMachine, lineId: string, signals: PlacedSensor[]): MachineCtx {
  const ops = opsForMachine(lineOpsFor(lineId), m.wIds);
  const stamdata: Record<string, string> = {};
  for (const [k, v] of Object.entries(m.details)) if (v) stamdata[k] = v;
  return {
    id: m.id,
    wIds: m.wIds,
    name: m.name,
    kind: m.kind,
    lane: m.lane,
    step: m.step,
    upstream: m.upstream,
    downstream: m.downstream,
    stamdata,
    ops: ops && {
      normtakt: ops.normtakt ?? null,
      rateUnit: ops.rateUnit,
      stopAfterSeconds: ops.stopAfterSeconds,
      stopReasons: ops.stopReasons.map((r) => r.code),
      note: ops.note ?? null,
      overrides: [...ops.overrides],
    },
    signals: signals.filter((s) => m.wIds.includes(s.machineId)).map((s) => s.id),
  };
}

function signalCtx(s: PlacedSensor, ot: OtLayout): SignalCtx {
  const cabinet = ot.cabinets.find((c) => c.id === s.cabinetId);
  const report = cabinet ? channelReport(cabinet, ot.sensors, 1) : null;
  const register = report ? registerMap(report, [s])[0] : undefined;
  const chain = cabinet
    ? pathState(ot.infrastructure, cabinet, s)
        .filter((st) => st.id !== "dashboard")
        .map((st) => ({ step: st.id, label: st.label, status: st.status, statusLabel: OT_STATUS_LABEL[st.status] }))
    : [];
  return {
    id: s.id,
    type: s.type,
    catalogType: s.catalogType ?? null,
    model: s.model,
    signal: s.signal,
    machineId: s.machineId,
    cabinetId: s.cabinetId,
    phase: s.phase,
    status: s.status,
    statusLabel: OT_STATUS_LABEL[s.status],
    channel: report?.channel.get(s.id) ?? null,
    register: register ? { address: register.address, datatype: register.datatype } : null,
    chain,
    delivers: chain.length > 0 && chain.every((st) => isDone(st.status)),
  };
}

function agentCtx(st: AgentState): AgentCtx {
  const a = st.agent;
  return {
    id: a.id,
    name: a.name,
    role: a.role,
    job: a.job,
    scope: a.scope,
    scopeLabel: describeScope(a),
    cadence: a.cadence,
    enabled: a.enabled,
    status: st.status,
    statusLabel: AGENT_STATUS_LABEL[st.status],
    summary: st.summary,
    inputs: st.inputs.map((i) => ({
      label: i.label,
      required: i.input.required,
      need: i.input.need,
      have: i.have,
      total: i.total,
      detail: i.detail,
    })),
    machines: st.machines.map((m) => m.id),
  };
}

// ---------------------------------------------------------------------------

export type ContextError = { status: 400 | 404; error: string };

/**
 * Hele linjen, eller den gren én agent har i scope. Returnerer en fejl med
 * HTTP-status frem for at kaste — ruten skal bare sende den videre.
 */
export function buildContext(lineId: string | null, agentId: string | null): ContextDoc | ContextError {
  if (!lineId) return { status: 400, error: "Angiv ?line=<id>. Linjer: " + Object.keys(LINES).join(", ") + "." };
  const data = LINES[lineId];
  if (!data) return { status: 404, error: `Linjen "${lineId}" findes ikke. Linjer: ${Object.keys(LINES).join(", ")}.` };

  const layout = layoutLine(data);
  const otData = otLayerFor(lineId);
  const ot = otData ? layoutOt(otData, layout, lineId) : null;
  const states = agentStates(lineId, layout, ot);
  const lineOps = lineOpsFor(lineId);

  let machines = layout.machines.filter((m) => m.kind !== "person");
  let sensors = ot?.sensors ?? [];
  let agents = states;
  let scope: ContextDoc["scope"];

  if (agentId) {
    const st = states.find((s) => s.agent.id === agentId);
    if (!st) {
      return { status: 404, error: `Agenten "${agentId}" findes ikke på ${lineId}. Agenter: ${states.map((s) => s.agent.id).join(", ")}.` };
    }
    const wanted = new Set(st.agent.inputs.map((i) => i.signalId).filter((x): x is string => !!x));
    machines = st.machines;
    // Vagtagenten har hele kæden i scope, og kæden bærer alle signaler.
    sensors = st.agent.scope.kind === "chain"
      ? sensors
      : sensors.filter((s) => wanted.has(s.id) || machines.some((m) => m.wIds.includes(s.machineId)));
    agents = [st];
    scope = { agentId, kind: st.agent.scope.kind, description: describeScope(st.agent) };
  }

  const ids = new Set(machines.map((m) => m.id));
  const lanes = data.lanes
    .map((lane) => ({ lane, machines: machines.filter((m) => m.lane === lane).map((m) => m.id) }))
    .filter((l) => l.machines.length > 0);

  return {
    generatedAt: new Date().toISOString(),
    site: SITE,
    line: {
      id: lineId,
      name: data.line.name,
      order: data.line.order,
      positionMode: data.line.positionMode,
      sourceFile: data.line.sourceFile,
      parsedAt: data.line.parsedAt,
      lanes: data.lanes,
    },
    hierarchy: {
      trunk: machines.filter((m) => m.lane === null).map((m) => m.id),
      lanes,
    },
    ops: lineOps
      ? { rateUnit: lineOps.rateUnit, stopAfterSeconds: lineOps.stopAfterSeconds, stopReasons: lineOps.stopReasons }
      : null,
    machines: machines.map((m) => machineCtx(m, lineId, sensors)),
    // Kanter der rører scope — indløb og afløb hører med til en stoprapport.
    flow: data.edges.filter((e) => ids.has(e.from) || ids.has(e.to)),
    cabinets: (ot?.cabinets ?? []).map((c) => {
      const report = channelReport(c, ot!.sensors, 1);
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        statusLabel: OT_STATUS_LABEL[c.status],
        nearMachine: c.nearMachine,
        channels: report.uses.map((u) => ({ kind: u.kind.toUpperCase(), used: u.used, total: u.total })),
        hardwareCount: c.hardware.length,
      };
    }),
    signals: ot ? sensors.map((s) => signalCtx(s, ot)) : [],
    infrastructure: ot?.infrastructure ?? [],
    agents: agents.map(agentCtx),
    scope,
  };
}

export const isContextError = (x: ContextDoc | ContextError): x is ContextError => "error" in x;
