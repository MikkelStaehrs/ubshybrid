// Hele fabrikken: linjerne og rummene lagt på én grund, og forbindelserne
// mellem dem.
//
// Placeringen er skematisk, indtil fabrikken er målt op: linjerne står i
// nummerorden, rummene for sig. En linje, der er målt op mod fabrikkens
// nulpunkt, står, hvor den står — og de skematiske stilles ved siden af, så
// intet ligger oven i hinanden.
//
// Forbindelserne kommer to steder fra. Materialeflow, prøver og mennesker er
// håndholdte (data/fabrik.ts), bundet til W-ID eller til en linje eller et rum
// som helhed. Data og netværk udledes af OT-laget: om en linjes skab når frem
// til databasen, afgør pathState() — den samme dom som kæden på kortet.
import { halfExtent, layoutLine, type Layout } from "./layout";
import { isDone, pathState, type OtLayout } from "./ot";
import type { LineData, OtInfraNode, OtStatus } from "./types";

export type ForbindelseSlags = "materiale" | "proever" | "data" | "mennesker";

export const SLAGS_NAVN: Record<ForbindelseSlags, string> = {
  materiale: "Materialeflow",
  proever: "Prøver",
  data: "Data og netværk",
  mennesker: "Mennesker",
};

/** En afdeling, linje eller et rum, der ikke er tegnet endnu. */
export interface FabrikDel {
  id: string;
  navn: string;
  slags: "linje" | "rum";
  /** Linjens nummer, hvis den har et. Bestemmer pladsen i rækken. */
  nr?: number;
}

/** Den ene ende af en forbindelse: en linje eller et rum — og evt. bestemte maskiner i det. */
export interface Ende {
  del: string;
  wIds?: string[];
}

export interface Forbindelse {
  id: string;
  slags: Exclude<ForbindelseSlags, "data">;
  /** Højst fire ord. */
  navn: string;
  fra: Ende;
  til: Ende;
  /** Findes i dag — ellers er den tænkt og tegnes stiplet. */
  findes: boolean;
  note?: string;
}

export interface Blok {
  id: string;
  navn: string;
  slags: "linje" | "rum" | "rack";
  tegnet: boolean;
  nr: number | null;
  /** Blokkens rektangel på grunden, i meter. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Lægges oven i tegningens koordinater for at nå grunden. */
  forskyd: [number, number];
  layout: Layout | null;
  /** Målt op mod fabrikkens nulpunkt. */
  maalfast: boolean;
  /** Rackets status, udledt. */
  status?: OtStatus;
}

export interface Bue {
  id: string;
  slags: ForbindelseSlags;
  navn: string;
  note?: string;
  findes: boolean;
  /** Udledt af OT-laget frem for skrevet i hånden. */
  udledt: boolean;
  fra: [number, number];
  til: [number, number];
  fraDel: string;
  tilDel: string;
}

export interface FabrikModel {
  blokke: Blok[];
  buer: Bue[];
  /** Forbindelser, der peger på noget, der ikke findes. De tegnes ikke — og det siges. */
  fejl: string[];
  graenser: { minX: number; maxX: number; minZ: number; maxZ: number };
}

/** Mellemrum mellem blokkene, og kanten om en tegnet linje. */
const MELLEM = 14;
const KANT = 3;
/** En del uden tegning får en standardstørrelse. */
const UTEGNET = { b: 36, d: 18 };
const RACK = { b: 10, d: 6 };

export function fabrikModel(input: {
  linjer: Record<string, LineData>;
  rum: Set<string>;
  utegnede: FabrikDel[];
  forbindelser: Forbindelse[];
  /** OT-laget for en tegnet linje eller et rum, hvis der er et. */
  ot: (id: string, layout: Layout) => OtLayout | null;
}): FabrikModel {
  const fejl: string[] = [];
  const blokke: Blok[] = [];

  const tegnede = Object.entries(input.linjer).map(([id, data]) => ({ id, data, layout: layoutLine(data) }));
  // Målfaste linjer står, hvor de står. De skematiske stilles efter dem.
  const maalfaste = tegnede.filter((t) => t.data.line.positionMode === "floorplan");
  for (const t of maalfaste) {
    const b = t.layout.bounds;
    blokke.push({
      id: t.id, navn: t.data.line.name, slags: input.rum.has(t.id) ? "rum" : "linje", tegnet: true,
      nr: input.rum.has(t.id) ? null : t.data.line.order,
      x0: b.minX - KANT, z0: b.minZ - KANT, x1: b.maxX + KANT, z1: b.maxZ + KANT,
      forskyd: [0, 0], layout: t.layout, maalfast: true,
    });
  }
  const start = maalfaste.length > 0 ? Math.max(...blokke.map((b) => b.x1)) + MELLEM : 0;

  // Rækkerne: linjerne i nummerorden, rummene for sig. Tegnet eller ej.
  type Kandidat = { id: string; navn: string; nr: number | null; layout: Layout | null; slags: "linje" | "rum" };
  const skematiske: Kandidat[] = [
    ...tegnede.filter((t) => t.data.line.positionMode !== "floorplan").map((t) => ({
      id: t.id, navn: t.data.line.name, nr: input.rum.has(t.id) ? null : t.data.line.order, layout: t.layout,
      slags: (input.rum.has(t.id) ? "rum" : "linje") as "linje" | "rum",
    })),
    ...input.utegnede.filter((u) => !input.linjer[u.id]).map((u) => ({ id: u.id, navn: u.navn, nr: u.nr ?? null, layout: null, slags: u.slags })),
  ];
  const orden = (a: Kandidat, b: Kandidat) => (a.nr ?? 999) - (b.nr ?? 999) || a.navn.localeCompare(b.navn, "da");
  const maal = (k: Kandidat) => k.layout
    ? { b: k.layout.bounds.maxX - k.layout.bounds.minX + 2 * KANT, d: k.layout.bounds.maxZ - k.layout.bounds.minZ + 2 * KANT }
    : UTEGNET;
  const raekke = (liste: Kandidat[], zMidte: number) => {
    let x = start;
    for (const k of liste) {
      const { b, d } = maal(k);
      const blok: Blok = {
        id: k.id, navn: k.navn, slags: k.slags, tegnet: !!k.layout, nr: k.nr,
        x0: x, z0: zMidte - d / 2, x1: x + b, z1: zMidte + d / 2,
        forskyd: k.layout
          ? [x + KANT - k.layout.bounds.minX, zMidte - (k.layout.bounds.minZ + k.layout.bounds.maxZ) / 2]
          : [0, 0],
        layout: k.layout, maalfast: false,
      };
      blokke.push(blok);
      x += b + MELLEM;
    }
  };
  const linjeRaekke = skematiske.filter((k) => k.slags === "linje").sort(orden);
  const rumRaekke = skematiske.filter((k) => k.slags === "rum").sort(orden);
  const dybde = (l: Kandidat[]) => Math.max(0, ...l.map((k) => maal(k).d));
  raekke(linjeRaekke, 0);
  const rumZ = dybde(linjeRaekke) / 2 + MELLEM + dybde(rumRaekke) / 2;
  raekke(rumRaekke, rumZ);

  // --- Data og netværk: udledt af OT-laget -----------------------------------------
  const infra = new Map<string, OtInfraNode>();
  const otFor = new Map<string, OtLayout>();
  for (const t of tegnede) {
    const ot = input.ot(t.id, t.layout);
    if (!ot) continue;
    otFor.set(t.id, ot);
    for (const n of ot.infrastructure) infra.set(n.id, n);
  }
  const rack = [...infra.values()].find((n) => n.type === "rack");
  const buer: Bue[] = [];
  if (rack) {
    const x0 = Math.max(...blokke.map((b) => b.x1)) + MELLEM;
    blokke.push({
      id: rack.id, navn: rack.name, slags: "rack", tegnet: true, nr: null,
      x0, z0: -RACK.d / 2, x1: x0 + RACK.b, z1: RACK.d / 2, forskyd: [0, 0], layout: null, maalfast: false,
      status: rack.status,
    });
    const midt = (b: Blok): [number, number] => [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2];
    const rackBlok = blokke.at(-1)!;
    for (const [id, ot] of otFor) {
      const blok = blokke.find((b) => b.id === id)!;
      const skab = ot.cabinets[0];
      if (!skab) continue;
      const trin = pathState(ot.infrastructure, skab, ot.sensors[0]);
      const brud = trin.find((s) => !isDone(s.status));
      const mssql = trin.find((s) => s.id === "mssql");
      buer.push({
        id: `data:${id}`, slags: "data", navn: "Data til MSSQL", udledt: true,
        findes: !!mssql && isDone(mssql.status),
        note: brud ? `Kæden stopper ved ${brud.label}.` : "Kæden står hele vejen.",
        fra: [skab.pos[0] + blok.forskyd[0], skab.pos[2] + blok.forskyd[1]], til: midt(rackBlok),
        fraDel: id, tilDel: rack.id,
      });
    }
    // Laboratoriet: det rum, analyseudstyret står i.
    const lab = [...infra.values()].find((n) => n.type === "lab");
    const labBlok = blokke.find((b) => b.layout?.machines.some((m) => m.kind === "analysis"));
    if (lab && labBlok) {
      buer.push({
        id: "data:lab", slags: "data", navn: "Svar til MSSQL", udledt: true, findes: isDone(lab.status),
        note: isDone(lab.status) ? `${lab.name} leverer.` : `${lab.name} er ikke forbundet.`,
        fra: midt(labBlok), til: midt(rackBlok), fraDel: labBlok.id, tilDel: rack.id,
      });
    }
  }

  // --- De håndholdte forbindelser --------------------------------------------------
  const punkter = (e: Ende, f: Forbindelse, side: string): { w: string | null; p: [number, number] }[] => {
    const blok = blokke.find((b) => b.id === e.del);
    if (!blok) {
      fejl.push(`${f.id}: ${side} "${e.del}" findes hverken som linje, rum eller utegnet del`);
      return [];
    }
    if (!e.wIds || e.wIds.length === 0) return [{ w: null, p: [(blok.x0 + blok.x1) / 2, (blok.z0 + blok.z1) / 2] }];
    if (!blok.layout) {
      fejl.push(`${f.id}: ${blok.navn} er ikke tegnet, så W-${e.wIds.join(", W-")} kan ikke findes`);
      return [];
    }
    const ud: { w: string; p: [number, number] }[] = [];
    for (const w of e.wIds) {
      const m = blok.layout.machines.find((x) => x.wIds.includes(w));
      if (!m) { fejl.push(`${f.id}: W-${w} findes ikke i ${blok.navn}`); continue; }
      ud.push({ w, p: [m.pos[0] + blok.forskyd[0], m.pos[2] + blok.forskyd[1]] });
    }
    return ud;
  };
  for (const f of input.forbindelser) {
    const fra = punkter(f.fra, f, "fra");
    const til = punkter(f.til, f, "til");
    if (fra.length === 0 || til.length === 0) continue;
    // Flere maskiner i den ene ende: én bue fra hver, mod midten af den anden.
    const midten = (l: { p: [number, number] }[]): [number, number] =>
      [l.reduce((s, x) => s + x.p[0], 0) / l.length, l.reduce((s, x) => s + x.p[1], 0) / l.length];
    const [mange, en, vendt] = fra.length >= til.length ? [fra, midten(til), false] : [til, midten(fra), true];
    for (const x of mange) {
      buer.push({
        id: x.w ? `${f.id}:${x.w}` : f.id, slags: f.slags, navn: f.navn, note: f.note, findes: f.findes, udledt: false,
        fra: vendt ? en : x.p, til: vendt ? x.p : en, fraDel: f.fra.del, tilDel: f.til.del,
      });
    }
  }

  const graenser = {
    minX: Math.min(...blokke.map((b) => b.x0)), maxX: Math.max(...blokke.map((b) => b.x1)),
    minZ: Math.min(...blokke.map((b) => b.z0)), maxZ: Math.max(...blokke.map((b) => b.z1)),
  };
  return { blokke, buer, fejl, graenser };
}

/** Overlapper to blokke? Til testen — og til den, der flytter noget. */
export function overlapper(a: Pick<Blok, "x0" | "x1" | "z0" | "z1">, b: Pick<Blok, "x0" | "x1" | "z0" | "z1">): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
}

/** En maskines fodaftryk på grunden. */
export function paaGrunden(blok: Blok, m: Layout["machines"][number]) {
  const h = halfExtent(m);
  return { x: m.pos[0] + blok.forskyd[0], z: m.pos[2] + blok.forskyd[1], hx: h.x, hz: h.z };
}
