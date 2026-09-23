import { AGENTS } from "../../data/agents";
import { LINE_OPS } from "../../data/line-config";
import type { Layout, PlacedMachine } from "./layout";
import { historyFor } from "./maintenance";
import { isDone, pathState, sensorType, signalDelivery, OT_PATH_STEPS, type OtLayout } from "./ot";
import type {
  Agent, AgentBeslutning, AgentEngine, AgentInput, AgentRole, LineOps, MachineOps, OtSensor,
  StopReason,
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

export const AGENT_ENGINE_LABEL: Record<AgentEngine, string> = {
  kode: "Kode",
  claude: "Claude",
};

/** Kun claude-agenter koster noget at køre. Det skal fladen sige. */
export const AGENT_ENGINE_NOTE: Record<AgentEngine, string> = {
  kode: "Ren regel-logik. Ingen API-kald.",
  claude: "Kalder Claude API. Koster pr. kørsel.",
};

export const AGENT_ROLE_LABEL: Record<AgentRole, string> = {
  linjeagent: "Linjeagent",
  tvaergaaende: "Tværgående",
  vagt: "Vagt",
  styring: "Styring",
};

/**
 * Fire trin, udledt af inputs — aldrig skrevet i hånden.
 *
 * "Klar" og "I drift" skilles af agentens `beslutning`: at alle signaler
 * findes betyder ikke, at nogen har sat scriptet i gang. Og en aktiveret
 * agent uden data falder tilbage — den kan aldrig stå som "I drift" på
 * ingenting.
 */
export type AgentStatus = "missing" | "partial" | "ready" | "running" | "idea";

export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  missing: "Mangler – nødvendig",
  partial: "Delvis",
  ready: "Klar",
  running: "I drift",
  idea: "Idé",
};

/** Rækkefølge i signaturforklaringen: længst fra at virke sidst. */
export const AGENT_STATUS_ORDER: AgentStatus[] = ["running", "ready", "partial", "missing", "idea"];

export const AGENT_BESLUTNING_LABEL: Record<AgentBeslutning, string> = {
  ide: "Idé — ikke besluttet",
  besluttet: "Besluttet, ikke slået til",
  aktiveret: "Slået til",
};

/**
 * En idé er tænkt, ikke besluttet — som i OT-laget. Den tæller ikke med i
 * optællinger og tegnes ikke på gulvet, før nogen siger ja til den.
 */
export const isAgentIdea = (st: { agent: Agent }) => st.agent.beslutning === "ide";

/** De agenter, der faktisk er besluttet. Alt der tælles, tælles på dem. */
export const decidedAgents = <T extends { agent: Agent }>(states: T[]) =>
  states.filter((st) => !isAgentIdea(st));

export interface AgentInputState {
  input: AgentInput;
  /** Hvad inputtet er, kort. */
  label: string;
  /** Hvor mange der leverer — hele vejen til database, ikke bare monteret. */
  have: number;
  total: number;
  /** "0 af 10 maskiner har driftssignal". */
  detail: string;
  /** Navnene på det, der blokerer netop dette input. Tom når intet gør. */
  blockedBy: string[];
  /**
   * Venter inputtet på noget i kæden? Kun de inputs kan have en fælles
   * blokering — et manglende driftssignal venter ikke på et uplink, det
   * findes bare ikke, og det skal sige sit eget.
   */
  chainBlocked: boolean;
}

export interface AgentState {
  agent: Agent;
  status: AgentStatus;
  inputs: AgentInputState[];
  /** Maskinerne agenten ejer. Tom for vagtagenten, der ser på kæden. */
  machines: PlacedMachine[];
  /** Maskiner opstrøms — må ses, ejes ikke, tæller ikke i status. */
  upstream: PlacedMachine[];
  /** Én sætning om hvad der står i vejen. */
  summary: string;
  /**
   * Det, alle de manglende inputs venter på. Vises én gang øverst, så hvert
   * input kun skal sige det, der er særligt for det.
   */
  shared: string[];
}

/**
 * Hvor stor en del af scopet en datakilde skal dække, før et påkrævet input
 * tæller som leveret.
 *
 * Tallet er valgt, ikke målt. Firs procent er nok til at skrive noget
 * meningsfuldt om en linje uden at kræve, at hver eneste maskine har en
 * historik — men det er et skøn, og det skal forbi den, der skal bruge
 * rapporten, før nogen regner på det.
 */
export const DATASET_COVERAGE_MIN = 0.8;

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

/** Opstrøms maskiner, fratrukket dem agenten ejer i forvejen. */
export function upstreamMachines(agent: Agent, layout: Layout): PlacedMachine[] {
  const want = new Set(agent.scope.upstream ?? []);
  if (want.size === 0) return [];
  const own = new Set(machinesInScope(agent, layout).map((m) => m.id));
  return realMachines(layout.machines.filter((m) => !own.has(m.id) && m.wIds.some((w) => want.has(w))));
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
 * "Monteret" er en delstatus, ikke et levende input. Dommen træffes af
 * signalDelivery() i ot.ts — den samme, /api/context og Live-visningen
 * bruger. Her oversættes den bare til de fire trin, panelet skriver ud.
 */
type SignalReach = "absent" | "unmounted" | "mounted" | "delivers";

function reachOf(s: OtSensor | undefined, ot: OtLayout | null): { reach: SignalReach; breaksAt?: string } {
  const d = signalDelivery(s, ot);
  if (d.delivers) return { reach: "delivers" };
  if (!s || !ot) return { reach: "absent" };
  if (!isDone(s.status)) return { reach: "unmounted" };
  return { reach: "mounted", breaksAt: d.breaksAt };
}

function resolveInput(
  input: AgentInput,
  scope: PlacedMachine[],
  upstream: PlacedMachine[],
  ot: OtLayout | null,
): AgentInputState {
  // 1) Et konkret signal.
  if (input.signalId) {
    const s = ot?.sensors.find((x) => x.id === input.signalId);
    const { reach, breaksAt } = reachOf(s, ot);
    const detail =
      reach === "absent" ? `${input.signalId} findes ikke i anlægget`
        : reach === "unmounted" ? `${input.signalId} er kun ${s!.status === "idea" ? "en idé" : "planlagt"}`
          : reach === "mounted" ? `${input.signalId} monteret, venter på kæden${breaksAt ? ` (knækker ved ${breaksAt})` : ""}`
            : `${input.signalId} leverer`;
    return {
      input,
      label: input.signalId,
      have: reach === "delivers" ? 1 : 0,
      total: 1,
      detail,
      blockedBy: breaksAt ? [breaksAt] : [],
      chainBlocked: !!breaksAt,
    };
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
    return {
      input, label: kind?.label ?? input.type, have, total, detail,
      blockedBy: [], chainBlocked: false,
    };
  }

  // 3) Materialestrømmen ind i scopet, uanset hvad måleren hedder.
  if (input.inlet) {
    // Indgangen er det, der ligger opstrøms — og for en agent, der ejer hele
    // linjen, dens egen første maskine. Sensoren findes på stedet, ikke ved
    // navn: flytter måleren sig, følger inputtet med af sig selv.
    const where = upstream.length > 0 ? upstream : scope;
    const wIds = new Set(where.flatMap((m) => m.wIds));
    const målere = (ot?.sensors ?? []).filter(
      (s) => s.catalogType === "flow" && wIds.has(s.machineId),
    );
    const reaches = målere.map((s) => ({ id: s.id, ...reachOf(s, ot) }));
    const leverer = reaches.find((r) => r.reach === "delivers");
    const monteret = reaches.find((r) => r.reach === "mounted");
    const detail =
      leverer ? `${leverer.id} ved indgangen leverer`
        : monteret ? `${monteret.id} monteret ved indgangen, venter på kæden`
          + (monteret.breaksAt ? ` (knækker ved ${monteret.breaksAt})` : "")
          : reaches.length > 0
            ? `${reaches[0].id} er kun planlagt`
            : "Ingen flowmåling ved indgangen";
    return {
      input,
      label: "Materiale ved indgang",
      have: leverer ? 1 : 0,
      total: 1,
      detail,
      blockedBy: monteret?.breaksAt ? [monteret.breaksAt] : [],
      chainBlocked: !!monteret?.breaksAt,
    };
  }

  // 4) En datakilde, målt som dækning over scopet — som driftssignalerne.
  if (input.dataset) {
    const total = scope.length;
    const have = scope.filter((m) => historyFor(m.wIds).length > 0).length;
    const share = total > 0 ? have / total : 0;
    return {
      input,
      label: "Vedligeholdshistorik",
      // Et påkrævet input leverer først over tærsklen — ikke ved første række.
      have: share >= DATASET_COVERAGE_MIN ? total : have,
      total,
      detail: total === 0
        ? "Ingen maskiner i scope"
        : `${have} af ${total} maskiner har vedligeholdshistorik`
          + (share >= DATASET_COVERAGE_MIN
            ? ""
            : ` (kræver ${Math.round(DATASET_COVERAGE_MIN * 100)} %)`),
      blockedBy: [],
      chainBlocked: false,
    };
  }

  // 5) Et led i datavejen — kædevagtens verden.
  if (input.chainStep) {
    const step = input.chainStep;
    const label = OT_PATH_STEPS.find((s) => s.id === step)?.label ?? step;
    const cabinet = ot?.cabinets[0];
    const state = cabinet && ot
      ? pathState(ot.infrastructure, cabinet, ot.sensors[0]).find((s) => s.id === step)
      : undefined;
    const have = state && isDone(state.status) ? 1 : 0;
    const blockedBy = have ? [] : (state?.blockedBy ?? []).map((n) => n.name);
    return {
      input,
      label,
      have,
      total: 1,
      detail: have
        ? `${label} svarer`
        : blockedBy.length
          ? `${label} venter på ${blockedBy.join(", ")}`
          : `${label} findes ikke`,
      blockedBy,
      chainBlocked: blockedBy.length > 0,
    };
  }

  return {
    input, label: "Ukendt input", have: 0, total: 1,
    detail: "Inputtet er ikke beskrevet", blockedBy: [], chainBlocked: false,
  };
}

/**
 * Det, der blokerer *alle* de inputs, som mangler noget.
 *
 * Vagtagentens tre led venter i vid udstrækning på det samme — uplinket skal
 * stå, før noget af det virker. Vises det pr. input, gentages stien tre gange.
 * Her trækkes fællesmængden ud, så hvert input kun behøver vise sin rest.
 *
 * Fællesmængden er udledt af pathState-bruddene: sker der noget i
 * infrastrukturen, flytter den sig af sig selv.
 */
function sharedBlockers(inputs: AgentInputState[]): string[] {
  const blocked = inputs.filter((i) => i.have < i.total && i.chainBlocked);
  if (blocked.length < 2) return [];
  return blocked[0].blockedBy.filter((name) => blocked.every((i) => i.blockedBy.includes(name)));
}

export function agentState(agent: Agent, layout: Layout, ot: OtLayout | null): AgentState {
  const machines = machinesInScope(agent, layout);
  const upstream = upstreamMachines(agent, layout);
  // Kun de ejede maskiner tæller — indløbet er kontekst, ikke ansvar.
  const inputs = agent.inputs.map((i) => resolveInput(i, machines, upstream, ot));

  // Status regnes kun på de påkrævede inputs. De støttende vises, men afgør
  // ingenting — en stoprapport kan skrives uden flow, ikke uden driftssignal.
  const required = inputs.filter((i) => i.input.required);
  const delivering = required.filter((i) => i.have > 0);
  const complete = required.every((i) => i.have === i.total);
  const unmet = required.filter((i) => i.have < i.total);

  // En idé er ikke besluttet, og dens inputs afgør ingenting endnu.
  // Ellers: inputs bestemmer, og beslutningen kan kun løfte til "I drift",
  // aldrig dække over at der mangler data.
  const fromInputs: AgentStatus =
    required.length === 0 || delivering.length === 0 ? "missing"
      : !complete ? "partial"
        : agent.beslutning === "aktiveret" ? "running" : "ready";
  const status: AgentStatus = agent.beslutning === "ide" ? "idea" : fromInputs;

  // Ikke småt begyndelsesbogstav — "IO-kobleren" må ikke blive til "io-kobleren".
  const missingText = unmet.map((i) => i.input.need).join("; ");
  const summary =
    status === "idea"
      ? `Idé — ikke besluttet. Ville kræve: ${agent.inputs.filter((i) => i.required).map((i) => i.need).join("; ")}.`
      : status === "missing"
        ? `Ingen påkrævede inputs leverer. Mangler: ${missingText}.`
        : status === "partial"
          ? `${unmet.map((i) => i.detail).join(". ")}.`
          : status === "ready"
            ? "Alle påkrævede inputs leverer. Agenten er ikke slået til endnu."
            : "Kører.";

  const shared = sharedBlockers(inputs);
  // Hvert input viser kun sin rest — fællesmængden står for sig.
  const trimmed = inputs.map((i) => ({
    ...i,
    blockedBy: i.blockedBy.filter((n) => !shared.includes(n)),
  }));
  return { agent, status, inputs: trimmed, machines, upstream, summary, shared };
}

export function agentStates(lineId: string, layout: Layout, ot: OtLayout | null): AgentState[] {
  return agentsFor(lineId).map((a) => agentState(a, layout, ot));
}

/**
 * Det fælles indløb: de maskiner, mindst én agent har som upstream, og hvem
 * der deler dem. Zonen på kortet og panelet bag den spørger begge her, så
 * teksten ikke kan komme til at sige noget andet end panelet.
 *
 * Zonen ejes ikke af nogen agent og har derfor ingen status.
 */
export interface SharedInlet {
  machines: PlacedMachine[];
  /** Agenterne der har indløbet som upstream, i den rækkefølge de står. */
  agents: AgentState[];
  /** "Spor N og Spor S" — scope-navnene, som de vises. */
  sharedBy: string;
}

export function sharedInlet(states: AgentState[]): SharedInlet | null {
  const byId = new Map<string, PlacedMachine>();
  const agents: AgentState[] = [];
  // En idé former ikke zonen. Den er ikke besluttet og ejer ingenting endnu.
  for (const st of decidedAgents(states)) {
    if (st.upstream.length === 0) continue;
    agents.push(st);
    for (const m of st.upstream) byId.set(m.id, m);
  }
  if (byId.size === 0) return null;
  const names = agents.map((st) => describeScope(st.agent));
  return {
    // Samme rækkefølge som på linjen, så listen læses som flowet.
    machines: [...byId.values()].sort((a, b) => a.step - b.step),
    agents,
    sharedBy: names.length > 1
      ? `${names.slice(0, -1).join(", ")} og ${names[names.length - 1]}`
      : names[0] ?? "",
  };
}
