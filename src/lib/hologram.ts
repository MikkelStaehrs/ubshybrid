// Hologrammet: fabrikken som punktsky.
//
// Ren udregning, ingen React. Punkterne samples på maskinernes bærende
// volumener fra machine-form.ts — samme kilde som kortet tegner efter, så
// de to ikke kan få hver deres idé om, hvordan en elevator ser ud.
//
// Tætheden er målingen: hvor meget vi ved om en maskine, bestemmer hvor
// mange punkter den får og hvor lyst de brænder. Det er udledt af
// signalDelivery(), aldrig sat i hånden.
import { hudState, type HudState } from "./ai-hud";
import { layoutLine, type Layout, type PlacedMachine } from "./layout";
import { formFor, type Primitive } from "./machine-form";
import { isDone, signalDelivery, type OtLayout, type PlacedSensor } from "./ot";
import type { FlowEdge, LineData } from "./types";

/**
 * Punktbudget for hele scenen. Sættes ned én gang ved opstart, hvis
 * frametiden ikke holder — se Hologram.tsx.
 */
export const PUNKT_BUDGET = 40_000;

/** Andel af budgettet, gulvgitteret får. Resten fordeles på maskinerne. */
const GULV_ANDEL = 0.22;

/**
 * Hvor mange gange tættere en maskine bliver, jo mere vi ved om den.
 * Tallene er vægte, ikke målinger — de afgør kun, hvad øjet trækkes mod.
 */
const TAETHED: Record<HudState, number> = {
  afventer: 1,
  test: 2.6,
  "paa-plads": 4.2,
};

/** Lysstyrke pr. tilstand. Hvid for drift, rav for test, tåge for resten. */
const LYS: Record<HudState, number> = {
  afventer: 0.26,
  test: 0.72,
  "paa-plads": 1,
};

// ---------------------------------------------------------------------------

/**
 * Deterministisk støj. Seedet fra W-ID, så en maskine får de samme punkter
 * ved hver render og i enhver test — ingen flimren ved reload.
 */
function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — lille, hurtig og stabil på tværs af maskiner. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rumfang, så store volumener får flere punkter end små. */
function volumeOf(p: Primitive): number {
  if (p.form === "box") return p.size[0] * p.size[1] * p.size[2];
  if (p.form === "cylinder") {
    const r = (p.rTop + p.rBottom) / 2;
    return Math.PI * r * r * p.h;
  }
  return (4 / 3) * Math.PI * p.r ** 3;
}

/** Et punkt på overfladen af ét volumen, i maskinens egne akser. */
function samplePrimitive(p: Primitive, r: () => number): [number, number, number] {
  let x = 0;
  let y = 0;
  let z = 0;

  if (p.form === "box") {
    const [sx, sy, sz] = p.size;
    // Vælg en side vægtet efter areal, så kanterne ikke bliver overrepræsenteret.
    const areas = [sy * sz, sx * sz, sx * sy];
    const total = areas.reduce((a, b) => a + b, 0) * 2;
    let pick = r() * total;
    const u = r() - 0.5;
    const v = r() - 0.5;
    if ((pick -= areas[0] * 2) < 0) { x = (r() < 0.5 ? -0.5 : 0.5) * sx; y = u * sy; z = v * sz; }
    else if ((pick -= areas[1] * 2) < 0) { x = u * sx; y = (r() < 0.5 ? -0.5 : 0.5) * sy; z = v * sz; }
    else { x = u * sx; y = v * sy; z = (r() < 0.5 ? -0.5 : 0.5) * sz; }
  } else if (p.form === "cylinder") {
    const t = r();
    const ang = (Math.floor(r() * p.sides) + (p.sides > 8 ? r() : 0.5)) * ((Math.PI * 2) / p.sides);
    const rad = p.rBottom + (p.rTop - p.rBottom) * t;
    x = Math.cos(ang) * rad;
    z = Math.sin(ang) * rad;
    y = (t - 0.5) * p.h;
  } else {
    // Jævnt på kuglen, ikke klumpet ved polerne.
    const u = r() * 2 - 1;
    const ang = r() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    x = Math.cos(ang) * s * p.r;
    y = u * p.r;
    z = Math.sin(ang) * s * p.r;
  }

  // Volumenets egen drejning, derefter dets plads i maskinen.
  const rot = p.form === "sphere" ? undefined : p.rot;
  if (rot) {
    const [rx, ry, rz] = rot;
    if (rz) { const c = Math.cos(rz), s2 = Math.sin(rz); [x, y] = [x * c - y * s2, x * s2 + y * c]; }
    if (rx) { const c = Math.cos(rx), s2 = Math.sin(rx); [y, z] = [y * c - z * s2, y * s2 + z * c]; }
    if (ry) { const c = Math.cos(ry), s2 = Math.sin(ry); [x, z] = [x * c + z * s2, -x * s2 + z * c]; }
  }
  return [x + p.at[0], y + p.at[1], z + p.at[2]];
}

// ---------------------------------------------------------------------------

/**
 * Hvad vi ved om én maskine.
 *
 * I dag kommer det udelukkende fra signalerne: et signal, der leverer hele
 * vejen til databasen, er PÅ PLADS; et monteret signal, der ikke når frem,
 * er TEST; ingen signaler er AFVENTER. Agentinputs peger på de samme
 * signaler, så de flytter ikke tallet endnu — når et agentinput begynder at
 * levere, gør signalet bag det det også.
 */
export function machineState(m: PlacedMachine, ot: OtLayout | null): HudState {
  if (!ot) return "afventer";
  const mine = ot.sensors.filter((s: PlacedSensor) => m.wIds.includes(s.machineId));
  if (mine.length === 0) return "afventer";
  if (mine.some((s) => signalDelivery(s, ot).delivers)) return "paa-plads";
  if (mine.some((s) => isDone(s.status))) return "test";
  return "afventer";
}

export interface MachineCloud {
  id: string;
  wIds: string[];
  name: string;
  state: HudState;
  /** Maskinens midte i kortets akser — til labels og henvisningslinjer. */
  at: [number, number, number];
  /** Toppen, hvor en henvisningslinje skal starte. */
  top: number;
  points: number;
}

export interface HologramData {
  /** xyz pr. punkt. */
  positions: Float32Array;
  /** Lysstyrke 0–1 pr. punkt. */
  bright: Float32Array;
  /** 0 = tåge, 1 = test (rav), 2 = drift (hvid). Shaderen farver efter den. */
  tone: Float32Array;
  /**
   * Hvilken maskine punktet tilhører, som indeks i `machines`. -1 er gulvet.
   * Shaderen slår maskinens aktuelle tilstand op med den — så en maskine kan
   * skifte farve, når den stopper, uden at skyen skal bygges om.
   */
  maskine: Float32Array;
  count: number;
  machines: MachineCloud[];
  /** Kanter med målt flow. Kun de her bærer bevægelse. */
  flowEdges: FlowEdge[];
  /** Optælling til det store udlæste tal. */
  tally: { drift: number; test: number; afventer: number; total: number };
  bounds: Layout["bounds"];
}

const TONE_INDEX: Record<HudState, number> = { afventer: 0, test: 1, "paa-plads": 2 };

/**
 * Kanterne, hvor materialestrømmen faktisk måles.
 *
 * I dag er det de to omkring elevator 743, hvor FT-743 sidder ved indgangen.
 * Alle andre kanter er en statisk prikket bane — vi ved ikke, om der løber
 * noget.
 */
export function flowEdgesFor(data: LineData, layout: Layout, ot: OtLayout | null): FlowEdge[] {
  if (!ot) return [];
  const målt = new Set<string>();
  for (const s of ot.sensors) {
    if (s.type !== "Materialestrøm" || !isDone(s.status)) continue;
    const m = layout.machines.find((x) => x.wIds.includes(s.machineId));
    if (m) målt.add(m.id);
  }
  return data.edges.filter((e) => målt.has(e.from) || målt.has(e.to));
}

export function buildHologram(
  data: LineData,
  ot: OtLayout | null,
  budget = PUNKT_BUDGET,
): HologramData {
  const layout = layoutLine(data);
  const machines = layout.machines.filter((m) => m.kind !== "person");

  // Fordel budgettet efter, hvor meget vi ved om hver maskine.
  const weights = machines.map((m) => {
    const state = machineState(m, ot);
    const prims = formFor({ kind: m.kind, name: m.name, size: m.size, wIdCount: m.wIds.length });
    const area = prims.reduce((sum, p) => sum + Math.cbrt(volumeOf(p)) ** 2, 0);
    return { m, state, prims, weight: area * TAETHED[state] };
  });
  const totalWeight = weights.reduce((s, w) => s + w.weight, 0) || 1;
  const machineBudget = Math.floor(budget * (1 - GULV_ANDEL));

  const pos: number[] = [];
  const bright: number[] = [];
  const tone: number[] = [];
  const maskine: number[] = [];
  const clouds: MachineCloud[] = [];

  for (const [idx, { m, state, prims, weight }] of weights.entries()) {
    const n = Math.max(24, Math.round((weight / totalWeight) * machineBudget));
    const r = rng(seedFrom(m.wIds.join("/") || m.id));
    const vols = prims.map(volumeOf);
    const volTotal = vols.reduce((a, b) => a + b, 0) || 1;
    const cos = Math.cos(m.rotY);
    const sin = Math.sin(m.rotY);
    let top = 0;

    for (let i = 0; i < n; i++) {
      // Vælg volumen vægtet efter rumfang — determineret af den samme rng.
      let pick = r() * volTotal;
      let vi = 0;
      while (vi < vols.length - 1 && (pick -= vols[vi]) > 0) vi++;
      const [lx, ly, lz] = samplePrimitive(prims[vi], r);
      // Maskinens egen drejning, så ud i kortets akser.
      pos.push(m.pos[0] + lx * cos + lz * sin, ly, m.pos[2] - lx * sin + lz * cos);
      // Lidt variation, så skyen ikke er fladt ensartet.
      bright.push(LYS[state] * (0.7 + r() * 0.45));
      tone.push(TONE_INDEX[state]);
      maskine.push(idx);
      if (ly > top) top = ly;
    }

    clouds.push({
      id: m.id, wIds: m.wIds, name: m.name, state,
      at: [m.pos[0], m.size.h / 2, m.pos[2]], top: m.size.h, points: n,
    });
  }

  // Gulvet: et fint gitter, jævnt og svagt. Det er rummet, ikke data.
  const { minX, maxX, minZ, maxZ } = layout.bounds;
  const floorBudget = budget - pos.length / 3;
  const ratio = (maxX - minX) / Math.max(1, maxZ - minZ);
  const cols = Math.max(2, Math.round(Math.sqrt(floorBudget * ratio)));
  const rows = Math.max(2, Math.floor(floorBudget / cols));
  for (let ix = 0; ix < cols; ix++) {
    for (let iz = 0; iz < rows; iz++) {
      pos.push(
        minX + ((maxX - minX) * ix) / (cols - 1),
        0,
        minZ + ((maxZ - minZ) * iz) / (rows - 1),
      );
      bright.push(0.14);
      tone.push(0);
      maskine.push(-1);
    }
  }

  const tally = {
    drift: clouds.filter((c) => c.state === "paa-plads").length,
    test: clouds.filter((c) => c.state === "test").length,
    afventer: clouds.filter((c) => c.state === "afventer").length,
    total: clouds.length,
  };

  return {
    positions: new Float32Array(pos),
    bright: new Float32Array(bright),
    tone: new Float32Array(tone),
    maskine: new Float32Array(maskine),
    count: pos.length / 3,
    machines: clouds,
    flowEdges: flowEdgesFor(data, layout, ot),
    tally,
    bounds: layout.bounds,
  };
}

export { hudState };
