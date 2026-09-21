import { AGENTS } from "../../data/agents";
import { LINE_OPS } from "../../data/line-config";
import type { Layout, PlacedMachine } from "./layout";
import { isDone, pathState, sensorType, OT_PATH_STEPS, type OtLayout } from "./ot";
import type {
  Agent, AgentInput, AgentRole, LineOps, MachineOps, OtSensor, StopReason,
} from "./types";

export function agentsFor(lineId: string): Agent[] {
  return AGENTS[lineId] ?? [];
}

export function lineOpsFor(lineId: string): LineOps | undefined {
  return LINE_OPS[lineId];
}

/**
 * Driftsparametre for én maskine: linjens værdier, med maskinens egne
 * afvigelser lagt ovenpå. `overrides` siger hvilke felter der faktisk afveg,
 * så panelet kan skrive "afviger fra linjen" frem for at lade som om alle
 * seksogtyve maskiner er sat op i hånden.
 */
export function opsForMachine(ops: LineOps | undefined, wIds: string[]) {
  if (!ops) return null;
  const own: MachineOps = {};
  const overrides = new Set<string>();
  for (const w of wIds) {
    const m = ops.machines?.[w];
    if (!m) continue;
    for (const [k, v] of Object.entries(m)) {
      if (v === undefined) continue;
      own[k as keyof MachineOps] = v as never;
      overrides.add(k);
    }
  }
  return {
    rateUnit: ops.rateUnit,
    normtakt: own.normtakt,
    stopAfterSeconds: own.stopAfterSeconds ?? ops.stopAfterSeconds,
    stopReasons: (own.stopReasons ?? ops.stopReasons) as StopReason[],
    note: own.note,
    overrides,
  };
}

// ---------------------------------------------------------------------------

export const AGENT_ROLE_LABEL: Record<AgentRole, string> = {
  linjeagent: "Linjeagent",
  tvaergaaende: "Tværgående",
  vagt: "Vagt",
};

/**
 * Fire trin, udledt af inputs — aldrig skrevet i hånden.
 *
 * "Klar" og "I drift" skilles af agentens `enabled`: at alle signaler findes
 * betyder ikke, at nogen har sat scriptet i gang.
 */
export type AgentStatus = "missing" | "partial" | "ready" | "running";

export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  missing: "Mangler – nødvendig",
  partial: "Delvis",
  ready: "Klar",
  running: "I drift",
};

/** Rækkefølge i signaturforklaringen: længst fra at virke sidst. */
export const AGENT_STATUS_ORDER: AgentStatus[] = ["running", "ready", "partial", "missing"];

export interface AgentInputState {
  input: AgentInput;
  /** Hvad inputtet er, kort. */
  label: string;
  /** Hvor mange der leverer — hele vejen til database, ikke bare monteret. */
  have: number;
  total: number;
  /** "0 af 10 maskiner har driftssignal". */
  detail: string;
}

export interface AgentState {
  agent: Agent;
  status: AgentStatus;
  inputs: AgentInputState[];
  /** Maskinerne i scope. Tom for vagtagenten, der ser på kæden. */
  machines: PlacedMachine[];
  /** Én sætning om hvad der står i vejen. */
  summary: string;
}

/** Personer er ikke maskiner og kan ikke bære et driftssignal. */
const realMachines = (ms: PlacedMachine[]) => ms.filter((m) => m.kind !== "person");

export function machinesInScope(agent: Agent, layout: Layout): PlacedMachine[] {
  switch (agent.scope.kind) {
    case "line":
      return realMachines(layout.machines);
    case "lane": {
      const lane = agent.scope.lane;
      return realMachines(layout.machines.filter((m) => m.lane === lane));
    }
    case "machines": {
      const want = new Set(agent.scope.wIds);
      return realMachines(layout.machines.filter((m) => m.wIds.some((w) => want.has(w))));
    }
    case "chain":
      return [];
  }
}

export function describeScope(agent: Agent): string {
  switch (agent.scope.kind) {
    case "line": return "Hele linjen";
    case "lane": return `Spor ${agent.scope.lane}`;
    case "machines": return `${agent.scope.wIds.length} maskiner`;
    case "chain": return "Signalkæden";
  }
}

// ---------------------------------------------------------------------------

/**
 * Hvor langt et signal er fra at kunne læses af en agent.
 *
 * "Monteret" er en delstatus, ikke et levende input: en agent læser fra
 * databasen, så signalet leverer først, når kæden står hele vejen dertil.
 * Dashboardet er ikke med i kravet — det er der for mennesker, ikke agenter.
 */
type SignalReach = "absent" | "unmounted" | "mounted" | "delivers";

function reachOf(s: OtSensor | undefined, ot: OtLayout | null): { reach: SignalReach; breaksAt?: string } {
  if (!s || !ot) return { reach: "absent" };
  if (!isDone(s.status)) return { reach: "unmounted" };
  const cabinet = ot.cabinets.find((c) => c.id === s.cabinetId);
  if (!cabinet) return { reach: "mounted", breaksAt: "IO-skab" };
  const chain = pathState(ot.infrastructure, cabinet, s).filter((st) => st.id !== "dashboard");
  const broken = chain.find((st) => !isDone(st.status));
  return broken ? { reach: "mounted", breaksAt: broken.label } : { reach: "delivers" };
}

function resolveInput(input: AgentInput, scope: PlacedMachine[], ot: OtLayout | null): AgentInputState {
  // 1) Et konkret signal.
  if (input.signalId) {
    const s = ot?.sensors.find((x) => x.id === input.signalId);
    const { reach, breaksAt } = reachOf(s, ot);
    const detail =
      reach === "absent" ? `${input.signalId} findes ikke i anlægget`
        : reach === "unmounted" ? `${input.signalId} er kun ${s!.status === "idea" ? "en idé" : "planlagt"}`
          : reach === "mounted" ? `${input.signalId} monteret, venter på kæden (knækker ved ${breaksAt})`
            : `${input.signalId} leverer`;
    return { input, label: input.signalId, have: reach === "delivers" ? 1 : 0, total: 1, detail };
  }

  // 2) En type fra kataloget, ét pr. maskine i scope.
  if (input.type) {
    const kind = sensorType(input.type);
    const label = (kind?.label ?? input.type).toLowerCase();
    const total = scope.length;
    const ofType = (ot?.sensors ?? []).filter((s) => s.catalogType === input.type);
    const reachOn = (m: PlacedMachine) =>
      ofType.filter((s) => m.wIds.includes(s.machineId)).map((s) => reachOf(s, ot).reach);
    const mounted = scope.filter((m) => reachOn(m).some((r) => r === "mounted" || r === "delivers")).length;
    const have = scope.filter((m) => reachOn(m).includes("delivers")).length;
    const detail =
      total === 0 ? "Ingen maskiner i scope"
        : mounted > have ? `${have} af ${total} maskiner leverer ${label} (${mounted} monteret, venter på kæden)`
          : `${have} af ${total} maskiner har ${label}`;
    return { input, label: kind?.label ?? input.type, have, total, detail };
  }

  // 3) Et led i datavejen — vagtagentens verden.
  if (input.chainStep) {
    const step = input.chainStep;
    const label = OT_PATH_STEPS.find((s) => s.id === step)?.label ?? step;
    const cabinet = ot?.cabinets[0];
    const state = cabinet && ot
      ? pathState(ot.infrastructure, cabinet, ot.sensors[0]).find((s) => s.id === step)
      : undefined;
    const have = state && isDone(state.status) ? 1 : 0;
    return {
      input,
      label,
      have,
      total: 1,
      detail: have
        ? `${label} svarer`
        : state?.blockedBy.length
          ? `${label} venter på ${state.blockedBy.map((n) => n.name).join(", ")}`
          : `${label} findes ikke`,
    };
  }

  return { input, label: "Ukendt input", have: 0, total: 1, detail: "Inputtet er ikke beskrevet" };
}

export function agentState(agent: Agent, layout: Layout, ot: OtLayout | null): AgentState {
  const machines = machinesInScope(agent, layout);
  const inputs = agent.inputs.map((i) => resolveInput(i, machines, ot));

  // Status regnes kun på de påkrævede inputs. De støttende vises, men afgør
  // ingenting — en stoprapport kan skrives uden flow, ikke uden driftssignal.
  const required = inputs.filter((i) => i.input.required);
  const delivering = required.filter((i) => i.have > 0);
  const complete = required.every((i) => i.have === i.total);
  const unmet = required.filter((i) => i.have < i.total);

  const status: AgentStatus =
    required.length === 0 || delivering.length === 0 ? "missing"
      : !complete ? "partial"
        : agent.enabled ? "running" : "ready";

  // Ikke småt begyndelsesbogstav — "IO-kobleren" må ikke blive til "io-kobleren".
  const missingText = unmet.map((i) => i.input.need).join("; ");
  const summary =
    status === "missing"
      ? `Ingen påkrævede inputs leverer. Mangler: ${missingText}.`
      : status === "partial"
        ? `${unmet.map((i) => i.detail).join(". ")}.`
        : status === "ready"
          ? "Alle påkrævede inputs leverer. Agenten er ikke slået til endnu."
          : "Kører.";

  return { agent, status, inputs, machines, summary };
}

export function agentStates(lineId: string, layout: Layout, ot: OtLayout | null): AgentState[] {
  return agentsFor(lineId).map((a) => agentState(a, layout, ot));
}
