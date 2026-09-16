import type { LineData, Machine, MachineKind } from "./types";

// Draw.io-pixels → meter. Flowdiagrammet er ikke målfast, så vi bruger to
// skalaer: langs flowet (tegningens y) og på tværs (tegningens x).
export const SCALE_ALONG = 1 / 18;
export const SCALE_ACROSS = 1 / 15;

/** Fodaftryk (meter) og højde pr. maskintype. x = langs flowet, z = på tværs. */
export const KIND_SIZE: Record<MachineKind, { x: number; z: number; h: number }> = {
  intake: { x: 2.6, z: 2.6, h: 1.8 },
  elevator: { x: 1.1, z: 1.1, h: 5.2 },
  distributor: { x: 1.6, z: 1.6, h: 2.2 },
  process: { x: 3.2, z: 2.6, h: 2.4 },
};

export const KIND_LABEL: Record<MachineKind, string> = {
  intake: "Indtag",
  elevator: "Elevator",
  distributor: "Fordeler",
  process: "Procesmaskine",
};

export interface PlacedMachine extends Machine {
  pos: [number, number, number];
  size: { x: number; z: number; h: number };
}

export interface Layout {
  machines: PlacedMachine[];
  byId: Map<string, PlacedMachine>;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  center: [number, number, number];
}

export function layoutLine(data: LineData): Layout {
  const cx = (m: Machine) => m.drawio.x + m.drawio.w / 2;
  const cy = (m: Machine) => m.drawio.y + m.drawio.h / 2;
  const root = data.machines.find((m) => m.step === 0) ?? data.machines[0];
  const minY = Math.min(...data.machines.map(cy));
  const trunkX = cx(root);

  const machines: PlacedMachine[] = data.machines.map((m) => {
    const size = { ...KIND_SIZE[m.kind] };
    // Flere W-ID'er på én boks (fx 4 vippestole) → bredere station.
    if (m.wIds.length > 1) size.z = Math.max(size.z, m.wIds.length * 1.6);
    return {
      ...m,
      size,
      // Tegningen drejes 90°: nedad i Draw.io = mod højre på kortet.
      pos: [(cy(m) - minY) * SCALE_ALONG, 0, (trunkX - cx(m)) * SCALE_ACROSS],
    };
  });

  const pad = 6;
  const bounds = {
    minX: Math.min(...machines.map((m) => m.pos[0] - m.size.x / 2)) - pad,
    maxX: Math.max(...machines.map((m) => m.pos[0] + m.size.x / 2)) + pad,
    minZ: Math.min(...machines.map((m) => m.pos[2] - m.size.z / 2)) - pad,
    maxZ: Math.max(...machines.map((m) => m.pos[2] + m.size.z / 2)) + pad,
  };
  return {
    machines,
    byId: new Map(machines.map((m) => [m.id, m])),
    bounds,
    center: [(bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2],
  };
}

/** Ortogonal rute mellem to maskiner (som pilene i Draw.io). */
export function flowPath(a: PlacedMachine, b: PlacedMachine): [number, number][] {
  const p0: [number, number] = [a.pos[0], a.pos[2]];
  const p2: [number, number] = [b.pos[0], b.pos[2]];
  if (Math.abs(p0[1] - p2[1]) < 0.01 || Math.abs(p0[0] - p2[0]) < 0.01) return [p0, p2];
  return [p0, [p0[0], p2[1]], p2];
}

/** "793/794/795/796" → "793–796" når numrene er fortløbende. */
export function shortWIds(wIds: string[]): string {
  const n = wIds.map(Number);
  if (n.length > 2 && n.every((v, i) => Number.isFinite(v) && (i === 0 || v === n[i - 1] + 1))) {
    return `${wIds[0]}–${wIds[wIds.length - 1]}`;
  }
  return wIds.join("/");
}
