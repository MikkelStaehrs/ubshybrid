import { isFaultMa } from "./live-source";
import { OT_INFRASTRUCTURE } from "../../data/ot-infrastructure";
import { OT_LAYERS } from "../../data/ot-layer";
import { OT_SENSOR_TYPES, SENSOR_TYPE_BY_KEY } from "../../data/ot-sensor-types";
import type { Layout, PlacedMachine } from "./layout";
import type {
  OtCabinet, OtCableTray, OtHardware, OtHardwareCategory, OtInfraNode, OtLayer, OtPathStep,
  OtPhase, OtSensor, OtSensorType, OtSignalKind, OtStatus, SensorIdea,
} from "./types";

export const OT_PHASES: OtPhase[] = [1, 2, 3];

/** Styklistens afsnit, i visningsrækkefølge. */
export const OT_HARDWARE_ORDER: OtHardwareCategory[] = ["forsyning", "io", "netvaerk", "klemmer", "skab"];

export const OT_HARDWARE_LABEL: Record<OtHardwareCategory, string> = {
  forsyning: "Forsyning",
  io: "IO",
  netvaerk: "Netværk",
  klemmer: "Klemmer",
  skab: "Skab",
};

export const OT_STATUS_LABEL: Record<OtStatus, string> = {
  active: "I drift",
  test: "Test",
  ordered: "Bestilt",
  planned: "Planlagt",
  missing: "Mangler – nødvendig",
  idea: "Mulig udvidelse",
};

/** Rækkefølge i signaturforklaringen: længst i udrulningen først. */
export const OT_STATUS_ORDER: OtStatus[] = ["active", "test", "ordered", "planned", "missing", "idea"];

/**
 * En idé er ikke besluttet. Alt andet er, og skal tegnes som noget der
 * kommer — eller allerede står der.
 */
export const isIdea = (s: OtStatus) => s === "idea";

/** Hvad en komponent i styklisten betyder for indkøbet. */
export const OT_PROCUREMENT_LABEL: Record<OtStatus, string> = {
  active: "Monteret",
  test: "Monteret (test)",
  ordered: "Bestilt",
  planned: "Købes nu",
  missing: "Skal etableres",
  idea: "Ved udvidelse",
};

/** IO-skabets mål i meter. */
const CABINET_SIZE = { x: 1, z: 0.45, h: 2 };

/** Standardplacering: lidt over maskinens top, hvor afkastet sidder. */
const SENSOR_LIFT = 0.35;

export type Point3 = [number, number, number];

export interface PlacedCabinet extends OtCabinet {
  pos: Point3;
  size: typeof CABINET_SIZE;
  /** Maskinen skabet står ved. Mangler den, står skabet midt i linjen. */
  near?: PlacedMachine;
}

export interface PlacedSensor extends OtSensor {
  /** null når W-ID'et ikke findes i linjen — så tegnes sensoren ikke. */
  pos: Point3 | null;
  machine?: PlacedMachine;
}

export interface PlacedTray extends OtCableTray {
  /** Fra skabet og udad. */
  points: Point3[];
}

/** Kablet fra én sensor gennem bakken til skabet. */
export interface OtCable {
  sensorId: string;
  status: OtStatus;
  phase: OtPhase;
  points: Point3[];
}

export interface OtChannelUse {
  kind: "ai" | "di";
  label: string;
  /** Kanaler skabet har ved den valgte fase — summen af IO-kortene. */
  total: number;
  /** Kanaler der er tildelt. Aldrig større end `total`. */
  used: number;
  /** Kanaler sensorerne beder om. Større end `total` = skabet er for lille. */
  needed: number;
  /** IO-kortene bag tallet, så barren kan forklare sig selv. */
  cards: OtCardUse[];
  /** Kort der først kommer i en senere fase — det er dem filteret afslører. */
  upcoming: OtCardUse[];
}

export interface OtCardUse {
  name: string;
  qty: number;
  /** Kanaler pr. kort. */
  each: number;
  phase: OtPhase;
}

/** Kanalregnskabet for ét skab ved én fase. */
export interface CabinetReport {
  uses: OtChannelUse[];
  /** sensor-id → kanal. null når der ikke er en ledig af den slags endnu. */
  channel: Map<string, string | null>;
}

export interface OtLayout {
  cabinets: PlacedCabinet[];
  sensors: PlacedSensor[];
  trays: PlacedTray[];
  cables: OtCable[];
  /** Vejen ud af hallen mod OT-racket. null når der ikke er noget rack. */
  gateway: PlacedGateway | null;
  infrastructure: OtInfraNode[];
}

/** Hvad der er valgt i OT-visningen. Maskiner vælges for sig, som hidtil. */
export interface OtSelection {
  kind: "sensor" | "cabinet" | "gateway";
  id: string;
}

/** OT-installationen for en linje, hvis der er registreret noget. */
export function otLayerFor(lineId: string): OtLayer | undefined {
  return OT_LAYERS[lineId];
}

/** Kumulativt filter: fase 2 viser også fase 1. */
export const withinPhase = (phase: OtPhase) => (x: { phase: OtPhase }) => x.phase <= phase;

// ---------------------------------------------------------------------------

/** W-ID til maskine. En maskine kan dække flere W-ID'er. */
function indexByWid(layout: Layout): Map<string, PlacedMachine> {
  const out = new Map<string, PlacedMachine>();
  for (const m of layout.machines) for (const w of m.wIds) out.set(w, m);
  return out;
}

/** Punkt i maskinens egne akser omsat til kortets akser. */
function fromMachine(m: PlacedMachine, ox: number, oz: number): [number, number] {
  const c = Math.cos(m.rotY);
  const s = Math.sin(m.rotY);
  return [m.pos[0] + ox * c + oz * s, m.pos[2] - ox * s + oz * c];
}

function dedupe(pts: Point3[]): Point3[] {
  return pts.filter((p, i) => {
    if (i === 0) return true;
    const q = pts[i - 1];
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) > 0.01;
  });
}

/** Hvornår en komponent er med. Uden fase er den med fra starten. */
export const hardwarePhase = (h: OtHardware): OtPhase => h.phase ?? 1;

/** Komponenterne der sidder på DIN-skinnen, i styklistens rækkefølge. */
export function railItems(c: OtCabinet): OtHardware[] {
  return c.hardware.filter((h) => h.rail !== undefined);
}

/** Styklisten grupperet i afsnit. Tomme afsnit udelades. */
export function hardwareByCategory(c: OtCabinet): { category: OtHardwareCategory; items: OtHardware[] }[] {
  return OT_HARDWARE_ORDER
    .map((category) => ({ category, items: c.hardware.filter((h) => h.category === category) }))
    .filter((g) => g.items.length > 0);
}

/**
 * Kanalerne skabet har ved en given fase — summen af de IO-kort, der er med
 * indtil da. Tallet står altså aldrig og siger noget andet end styklisten.
 */
function capacityAt(c: OtCabinet, phase: OtPhase) {
  const total = { ai: 0, di: 0 };
  const cards = { ai: [] as OtCardUse[], di: [] as OtCardUse[] };
  const upcoming = { ai: [] as OtCardUse[], di: [] as OtCardUse[] };

  for (const h of c.hardware) {
    if (!h.provides) continue;
    const at = hardwarePhase(h);
    for (const kind of ["ai", "di"] as const) {
      const each = h.provides[kind];
      if (!each) continue;
      const card: OtCardUse = { name: h.name, qty: h.qty, each, phase: at };
      if (at > phase) {
        upcoming[kind].push(card);
      } else {
        total[kind] += each * h.qty;
        cards[kind].push(card);
      }
    }
  }
  return { total, cards, upcoming };
}

/**
 * Kanaler tildeles i faserækkefølge, så fase 1 beholder sin plads uanset hvad
 * der planlægges senere. Er der ikke kanaler nok ved den viste fase, står de
 * sidste sensorer uden frem for at få en opdigtet — det er netop den slags,
 * kortet skal afsløre.
 */
export function channelReport(c: OtCabinet, sensors: OtSensor[], phase: OtPhase): CabinetReport {
  const { total, cards, upcoming } = capacityAt(c, phase);
  // Feltbus-målere taler selv på netværket og fylder ingen kanal.
  const mine = sensors
    .filter((s) => s.cabinetId === c.id && s.phase <= phase && s.signal !== "feltbus")
    .sort((a, b) => a.phase - b.phase || a.id.localeCompare(b.id, "da"));

  const channel = new Map<string, string | null>();
  const count = { ai: 0, di: 0 };
  const needed = { ai: 0, di: 0 };

  for (const s of mine) {
    // Strøm- og spændingssignaler fylder en analog indgang, resten en digital.
    const kind = s.signal === "digital" ? "di" : "ai";
    needed[kind]++;
    const free = count[kind] < total[kind];
    channel.set(s.id, free ? `${kind.toUpperCase()}${++count[kind]}` : null);
  }

  return {
    channel,
    uses: [
      { kind: "ai", label: "Analoge indgange", total: total.ai, used: count.ai, needed: needed.ai, cards: cards.ai, upcoming: upcoming.ai },
      { kind: "di", label: "Digitale indgange", total: total.di, used: count.di, needed: needed.di, cards: cards.di, upcoming: upcoming.di },
    ],
  };
}

/** Kanalregnskab for alle skabe ved den viste fase. */
export function channelReports(ot: OtLayout, phase: OtPhase): Map<string, CabinetReport> {
  return new Map(ot.cabinets.map((c) => [c.id, channelReport(c, ot.sensors, phase)]));
}

function trayPoints(
  tray: OtCableTray,
  cab: PlacedCabinet,
  layout: Layout,
  byWid: Map<string, PlacedMachine>,
): Point3[] {
  const served = layout.machines.filter((m) => m.lane === tray.lane);
  const xs = served.map((m) => m.pos[0]);
  const extra = tray.extendTo ? byWid.get(tray.extendTo) : undefined;
  if (extra) xs.push(extra.pos[0]);
  if (!xs.length) return [];

  const y = tray.height;
  const laneZ = served.length ? served.reduce((sum, m) => sum + m.pos[2], 0) / served.length : 0;
  const z = laneZ + tray.offset;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);

  const pts: Point3[] = [[cab.pos[0], y, cab.pos[2]]];
  // Bakken svinger ud til sporet, hvis skabet ikke allerede står på linjen.
  if (Math.abs(z - cab.pos[2]) > 0.01) pts.push([cab.pos[0], y, z]);
  // Den ende af sporet der ligger længst fra skabet.
  pts.push([maxX - cab.pos[0] >= cab.pos[0] - minX ? maxX : minX, y, z]);
  return dedupe(pts);
}

/** Nærmeste punkt på en bakke, og hvilket stykke af den det ligger på. */
function projectOnPath(pts: Point3[], x: number, z: number) {
  let best = { point: pts[0], seg: 0, dist: Infinity };
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay, az] = pts[i];
    const [bx, , bz] = pts[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
    const point: Point3 = [ax + dx * t, ay, az + dz * t];
    const dist = Math.hypot(x - point[0], z - point[2]);
    if (dist < best.dist) best = { point, seg: i, dist };
  }
  return best;
}

/**
 * Kablet går lodret ned fra sensoren til bakkehøjde, vandret ind på bakken og
 * følger den tilbage til skabet — som et kabel faktisk trækkes.
 */
function cablePoints(from: Point3, tray: PlacedTray, cab: PlacedCabinet): Point3[] {
  const y = tray.points[0][1];
  const hit = projectOnPath(tray.points, from[0], from[2]);
  const pts: Point3[] = [from, [from[0], y, from[2]], hit.point];
  for (let i = hit.seg; i >= 0; i--) pts.push(tray.points[i]);
  pts.push([cab.pos[0], cab.size.h, cab.pos[2]]);
  return dedupe(pts);
}

// ---------------------------------------------------------------------------

/** Lægger OT-laget oven på det færdige maskinlayout. */
export function layoutOt(layer: OtLayer, layout: Layout, lineId: string): OtLayout {
  const byWid = indexByWid(layout);

  const cabinets: PlacedCabinet[] = layer.cabinets.map((c) => {
    const near = byWid.get(c.nearMachine);
    const [x, z] = near
      ? fromMachine(near, c.offset.x, c.offset.z)
      : [layout.center[0] + c.offset.x, layout.center[2] + c.offset.z];
    return { ...c, near, pos: [x, 0, z] as Point3, size: CABINET_SIZE };
  });
  const cabinetById = new Map(cabinets.map((c) => [c.id, c]));

  const trays: PlacedTray[] = layer.cableTrays.flatMap((t) => {
    const cab = cabinetById.get(t.cabinetId);
    if (!cab) return [];
    const points = trayPoints(t, cab, layout, byWid);
    return points.length > 1 ? [{ ...t, points }] : [];
  });

  const sensors: PlacedSensor[] = layer.sensors.map((s) => {
    const machine = byWid.get(s.machineId);
    if (!machine) return { ...s, machine, pos: null };
    // Placeringen står i dataene. Uden den: afkastet i nedstrøms ende af toppen.
    const mx = s.mount?.x ?? machine.size.x * 0.85;
    const mz = s.mount?.z ?? 0;
    const my = s.mount?.y ?? machine.size.h + SENSOR_LIFT;
    const [x, z] = fromMachine(machine, mx, mz);
    return { ...s, machine, pos: [x, my, z] as Point3 };
  });

  const cables: OtCable[] = sensors.flatMap((s) => {
    const cab = cabinetById.get(s.cabinetId);
    if (!s.pos || !cab) return [];
    const lane = s.machine?.lane ?? null;
    const tray = trays.find((t) => t.cabinetId === cab.id && t.lane === lane);
    const points = tray
      ? cablePoints(s.pos, tray, cab)
      // Uden bakke går kablet direkte — så er der noget at rette i dataene.
      : dedupe([s.pos, [cab.pos[0], cab.size.h, cab.pos[2]]]);
    return [{ sensorId: s.id, status: s.status, phase: s.phase, points }];
  });

  const infrastructure = infrastructureFor(lineId);
  return {
    cabinets, sensors, trays, cables, infrastructure,
    gateway: layoutGateway(infrastructure, cabinets, layout),
  };
}

/** Sensorerne på et skab, i faserækkefølge. */
export function sensorsOn(cabinetId: string, sensors: PlacedSensor[]): PlacedSensor[] {
  return sensors
    .filter((s) => s.cabinetId === cabinetId)
    .sort((a, b) => a.phase - b.phase || a.id.localeCompare(b.id, "da"));
}

/**
 * Sensorerne delt i dem, der er besluttet, og dem der kun er en mulighed.
 * `phases` er faserne de besluttede dækker — det er den, overskriften siger.
 */
export function splitSensors(cabinetId: string, sensors: PlacedSensor[]) {
  const all = sensorsOn(cabinetId, sensors);
  const decided = all.filter((s) => !isIdea(s.status));
  return {
    all,
    decided,
    ideas: all.filter((s) => isIdea(s.status)),
    phases: [...new Set(decided.map((s) => s.phase))].sort((a, b) => a - b),
  };
}

// ---------------------------------------------------------------------------
// Sensorkatalog og idéer
//
// Idéer er skitser, brugeren laver i browseren. De rører ikke data/ og
// overlever ikke en genindlæsning — det er med vilje: en idé må ikke kunne
// forveksles med noget, der er projekteret.
// ---------------------------------------------------------------------------

/** Kanaler idéen optager i skabet. Feltbus-signaler bruger ingen. */
export const CHANNEL_FOR: Record<OtSignalKind, "ai" | "di" | null> = {
  AI: "ai",
  DI: "di",
  "IO-Link": null,
  Modbus: null,
};

export { OT_SENSOR_TYPES };

export function sensorType(key: string): OtSensorType | undefined {
  return SENSOR_TYPE_BY_KEY[key];
}

export interface PlacedIdea extends SensorIdea {
  kind: OtSensorType;
  machine?: PlacedMachine;
  pos: Point3 | null;
}

/**
 * Idéerne lægges på maskinernes opstrømsside, så de ikke lander oven i de
 * rigtige sensorer. Flere på samme maskine stilles på række.
 */
export function layoutIdeas(ideas: SensorIdea[], layout: Layout): PlacedIdea[] {
  const byWid = indexByWid(layout);
  const seen = new Map<string, number>();
  const total = new Map<string, number>();
  for (const i of ideas) total.set(i.machineId, (total.get(i.machineId) ?? 0) + 1);

  return ideas.flatMap((idea): PlacedIdea[] => {
    const kind = sensorType(idea.type);
    if (!kind) return [];
    const machine = byWid.get(idea.machineId);
    const n = total.get(idea.machineId) ?? 1;
    const i = seen.get(idea.machineId) ?? 0;
    seen.set(idea.machineId, i + 1);
    if (!machine) return [{ ...idea, kind, machine: undefined, pos: null }];
    const [x, z] = fromMachine(machine, -machine.size.x * 0.85, (i - (n - 1) / 2) * 0.55);
    return [{ ...idea, kind, machine, pos: [x, machine.size.h + SENSOR_LIFT, z] as Point3 }];
  });
}

/** Hvad idéerne ville koste i kanaler. `bus` går på feltbussen og fylder ingen. */
export function ideaDemand(ideas: PlacedIdea[]) {
  const out = { ai: 0, di: 0, bus: 0 };
  for (const i of ideas) {
    const ch = CHANNEL_FOR[i.kind.signal];
    if (ch) out[ch]++;
    else out.bus++;
  }
  return out;
}

/** Ledige kanaler i skabet ved den viste fase. */
export function freeChannels(report: CabinetReport) {
  const of = (kind: "ai" | "di") => {
    const u = report.uses.find((x) => x.kind === kind);
    return u ? u.total - u.used : 0;
  };
  return { ai: of("ai"), di: of("di") };
}

// ---------------------------------------------------------------------------

export interface OtRegister {
  sensorId: string;
  channel: string;
  kind: "ai" | "di";
  /** Modbus-adresse, som den ville se ud. */
  address: string;
  datatype: string;
  note: string;
}

/**
 * Forslag til registerkort, udledt af kanalnumrene: analoge værdier som
 * float32 i to input-registre, digitale som én diskret indgang. Adresserne er
 * ikke aftalt med nogen endnu — de følger bare en almindelig konvention, så
 * der er noget konkret at tage med til tavlebyggeren.
 */
export function registerMap(report: CabinetReport, sensors: PlacedSensor[]): OtRegister[] {
  const out: OtRegister[] = [];
  for (const s of sensors) {
    const channel = report.channel.get(s.id);
    if (!channel) continue;
    const kind = channel.startsWith("AI") ? "ai" : "di";
    const n = Number(channel.slice(2));
    if (!Number.isFinite(n)) continue;
    out.push(
      kind === "ai"
        ? {
            sensorId: s.id,
            channel,
            kind,
            address: `3${String(n * 2 - 1).padStart(4, "0")}–3${String(n * 2).padStart(4, "0")}`,
            datatype: "float32",
            note: `Skaleret fra ${s.signal} til måleenhed i kobleren.`,
          }
        : {
            sensorId: s.id,
            channel,
            kind,
            address: `1${String(n).padStart(4, "0")}`,
            datatype: "bit",
            note: "Diskret indgang, 0 = lav, 1 = høj.",
          },
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// OT-infrastruktur og forudsætninger
// ---------------------------------------------------------------------------

/** Hvor virkelig en ting er. Lav værdi = længst fra at fungere. */
const STATUS_RANK: Record<OtStatus, number> = {
  missing: 0, idea: 1, planned: 2, ordered: 3, test: 4, active: 5,
};

/** Findes den, og virker den? Alt andet er noget, der mangler. */
export const isDone = (s: OtStatus) => s === "active" || s === "test";

export const isMissing = (s: OtStatus) => s === "missing";

/** En kæde er ikke stærkere end sit dårligste led. */
export function weakest(statuses: OtStatus[]): OtStatus {
  return statuses.reduce((a, b) => (STATUS_RANK[b] < STATUS_RANK[a] ? b : a), "active" as OtStatus);
}

export const OT_PATH_STEPS: { id: OtPathStep; label: string }[] = [
  { id: "sensor", label: "Sensor" },
  { id: "io", label: "IO-kort" },
  { id: "kobler", label: "Feltbus-kobler" },
  { id: "edge", label: "Edge" },
  { id: "mssql", label: "MSSQL" },
  { id: "dashboard", label: "Dashboard" },
];

export function infrastructureFor(lineId: string): OtInfraNode[] {
  return OT_INFRASTRUCTURE[lineId] ?? [];
}

/**
 * Porten ud af hallen. Racket står i kontorbygningen, så det tegnes som en
 * node uden for væggen med uplinket som streg fra IO-skabet. Resten af
 * infrastrukturen — VLAN, edge, sky — har ingen plads på et fabrikskort.
 */
export interface PlacedGateway {
  rack: OtInfraNode;
  uplink?: OtInfraNode;
  label: string;
  pos: Point3;
  /** Stregen fra skabet og ud gennem væggen. */
  points: Point3[];
  /** Svageste status af rack og uplink — stregen er ikke bedre end de to. */
  status: OtStatus;
}

function layoutGateway(
  infra: OtInfraNode[],
  cabinets: PlacedCabinet[],
  layout: Layout,
): PlacedGateway | null {
  const rack = infra.find((n) => n.type === "rack");
  const cab = cabinets[0];
  if (!rack || !cab) return null;
  const uplink = infra.find((n) => n.type === "uplink");

  // Uden for nordvæggen, ud for skabet.
  const z = layout.bounds.minZ - 5;
  const y = 4.2;
  return {
    rack,
    uplink,
    label: `→ ${rack.name}, ${rack.location.split(",")[0].toLowerCase()}`,
    pos: [cab.pos[0], 0, z],
    points: dedupe([
      [cab.pos[0], cab.size.h, cab.pos[2]],
      [cab.pos[0], y, cab.pos[2]],
      [cab.pos[0], y, z],
      [cab.pos[0], 1.4, z],
    ]),
    status: weakest([rack.status, uplink?.status ?? "active"]),
  };
}

// ---------------------------------------------------------------------------

/** Ét led i datavejen, med den status kæden frem til det har. */
export interface PathStepState {
  id: OtPathStep;
  label: string;
  status: OtStatus;
  /** Hvad der holder trinnet tilbage. Tom når intet gør. */
  blockedBy: OtInfraNode[];
}

/**
 * Hvert trin arver det svageste af sine forudsætninger: skabet, og den
 * infrastruktur der peger på trinnet gennem `requiredFor`. Sensoren er sig
 * selv — den venter ikke på et skab for at eksistere.
 */
export function pathState(
  infra: OtInfraNode[],
  cabinet: OtCabinet,
  sensor: OtSensor | undefined,
): PathStepState[] {
  return OT_PATH_STEPS.map(({ id, label }) => {
    if (id === "sensor") {
      return { id, label, status: sensor?.status ?? "missing", blockedBy: [] };
    }
    const deps = infra.filter((n) => n.requiredFor.includes(id));
    return {
      id,
      label,
      status: weakest([cabinet.status, ...deps.map((n) => n.status)]),
      blockedBy: deps.filter((n) => !isDone(n.status)),
    };
  });
}

// ---------------------------------------------------------------------------

/**
 * Hvad dommen er tjekket imod. En agent skal kunne se forskel på "kæden
 * findes ikke" og "kæden findes, og måleren svarede forkert".
 */
export type DeliveryBasis = "kæde" | "kæde+aflæsning";

export interface SignalDelivery {
  /** Kan en agent læse signalet fra databasen lige nu? */
  delivers: boolean;
  /** Hvorfor ikke, ved navn. null når den leverer. */
  reason: string | null;
  /** Leddet kæden knækker ved. Kun sat når det er kæden, der mangler. */
  breaksAt?: string;
  basis: DeliveryBasis;
}

/**
 * Den ene dom over et signal. Live-visningen, agentstatussen og
 * /api/context spørger her — ingen af dem regner selv.
 *
 * To ting skal holde: kæden skal stå hele vejen til databasen, og måleren
 * skal svare inden for sløjfen. Er kæden hel, men råsignalet uden for
 * 3,6–21 mA, leverer signalet ikke, og årsagen er sensorfejl.
 *
 * `reading` er valgfri, fordi serveren ikke kan se måleren: uden den er
 * dommen truffet på kæden alene, og `basis` siger det.
 */
export function signalDelivery(
  sensor: OtSensor | undefined,
  ot: OtLayout | null,
  reading?: { raw: number } | null,
): SignalDelivery {
  const basis: DeliveryBasis = reading ? "kæde+aflæsning" : "kæde";
  if (!sensor || !ot) return { delivers: false, reason: "signalet findes ikke", basis };
  if (!isDone(sensor.status)) {
    return { delivers: false, reason: sensor.status === "idea" ? "kun en idé" : "ikke monteret", basis };
  }
  const cabinet = ot.cabinets.find((c) => c.id === sensor.cabinetId);
  if (!cabinet) return { delivers: false, reason: "intet IO-skab", breaksAt: "IO-skab", basis };

  // Dashboardet er for mennesker. En agent læser fra databasen.
  const chain = pathState(ot.infrastructure, cabinet, sensor).filter((st) => st.id !== "dashboard");
  const broken = chain.find((st) => !isDone(st.status));
  if (broken) {
    return { delivers: false, reason: `kæden knækker ved ${broken.label}`, breaksAt: broken.label, basis };
  }
  if (reading && isFaultMa(reading.raw)) return { delivers: false, reason: "sensorfejl", basis };
  return { delivers: true, reason: null, basis };
}

// ---------------------------------------------------------------------------

export interface Prerequisite {
  id: string;
  name: string;
  location?: string;
  status: OtStatus;
  /** Hvad der ikke virker, så længe den ikke er på plads. */
  blocks: string;
  note?: string;
}

const stepLabel = (id: OtPathStep) => OT_PATH_STEPS.find((s) => s.id === id)?.label ?? id;

/**
 * Alt der skal være på plads, før piloten leverer data til en database —
 * måleren, skabet og infrastrukturen, i den rækkefølge kæden hænger sammen.
 */
export function prerequisites(
  cabinet: OtCabinet,
  sensors: OtSensor[],
  infra: OtInfraNode[],
): Prerequisite[] {
  const pilot = sensors.find((s) => s.cabinetId === cabinet.id);
  const out: Prerequisite[] = [];

  if (pilot) {
    out.push({
      id: pilot.id,
      name: `${pilot.id} — ${pilot.type}`,
      location: `W-ID ${pilot.machineId}`,
      status: pilot.status,
      blocks: "Uden måleren er der intet at sende.",
      note: `${pilot.model}, ${pilot.signal}.`,
    });
  }

  out.push({
    id: cabinet.id,
    name: `${cabinet.name} (${cabinet.id})`,
    location: `Ved W-ID ${cabinet.nearMachine}`,
    status: cabinet.status,
    blocks: "Signalet bliver ikke til et tal uden IO-kort og kobler.",
    note: `${cabinet.hardware.length} komponenter på styklisten.`,
  });

  for (const n of infra) {
    out.push({
      id: n.id,
      name: n.name,
      location: n.location,
      status: n.status,
      blocks: n.requiredFor.length
        ? `Blokerer ${n.requiredFor.map(stepLabel).join(", ")}.`
        : "Ingen kendt afhængighed.",
      note: n.note,
    });
  }
  return out;
}
