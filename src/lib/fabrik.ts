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
  /** Linjens nummer, hvis den har et. Bestemmer pladsen i rækken; ens numre står i listens rækkefølge. */
  nr?: number;
  /** Et trin, partiet ikke altid kommer igennem. */
  valgfri?: boolean;
  /**
   * Et rum, der hører til hele produktionen frem for ét trin — lageret, som
   * trinnene leverer til og henter fra. Det står som et bånd over linjerne.
   */
  overLinjerne?: boolean;
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
  /**
   * Udledt af et mønster, driften har sagt, men ikke sagt om netop den her.
   * Tegnes som de antagne pile på kortet, indtil nogen har bekræftet den.
   */
  antaget?: boolean;
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
  valgfri: boolean;
  /** Står som et bånd over linjerne, og forbindelserne går lodret op til det. */
  overLinjerne: boolean;
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
  antaget: boolean;
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
/** Dybden på et bånd over linjerne. */
const BAAND = 12;
/** Så langt fra hinanden ligger vejen op til båndet og vejen ned. */
const SIDE = 3;

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
      forskyd: [0, 0], layout: t.layout, maalfast: true, valgfri: false, overLinjerne: false,
    });
  }
  const start = maalfaste.length > 0 ? Math.max(...blokke.map((b) => b.x1)) + MELLEM : 0;

  // Rækkerne: linjerne i nummerorden, rummene for sig. Tegnet eller ej.
  type Kandidat = {
    id: string; navn: string; nr: number | null; layout: Layout | null; slags: "linje" | "rum";
    valgfri: boolean; overLinjerne: boolean;
  };
  const skematiske: Kandidat[] = [
    ...tegnede.filter((t) => t.data.line.positionMode !== "floorplan").map((t) => ({
      id: t.id, navn: t.data.line.name, nr: input.rum.has(t.id) ? null : t.data.line.order, layout: t.layout,
      slags: (input.rum.has(t.id) ? "rum" : "linje") as "linje" | "rum", valgfri: false, overLinjerne: false,
    })),
    ...input.utegnede.filter((u) => !input.linjer[u.id]).map((u) => ({
      id: u.id, navn: u.navn, nr: u.nr ?? null, layout: null, slags: u.slags, valgfri: !!u.valgfri, overLinjerne: !!u.overLinjerne,
    })),
  ];
  // Ens numre står i den rækkefølge, de er skrevet — sorteringen er stabil.
  const orden = (a: Kandidat, b: Kandidat) => (a.nr ?? 999) - (b.nr ?? 999);
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
        layout: k.layout, maalfast: false, valgfri: k.valgfri, overLinjerne: false,
      };
      blokke.push(blok);
      x += b + MELLEM;
    }
  };
  const linjeRaekke = skematiske.filter((k) => k.slags === "linje").sort(orden);
  const rumRaekke = skematiske.filter((k) => k.slags === "rum" && !k.overLinjerne).sort(orden);
  const dybde = (l: Kandidat[]) => Math.max(0, ...l.map((k) => maal(k).d));
  raekke(linjeRaekke, 0);
  const rumZ = dybde(linjeRaekke) / 2 + MELLEM + dybde(rumRaekke) / 2;
  raekke(rumRaekke, rumZ);

  // Rum over linjerne — lageret — står som et bånd over hele rækken.
  const linjeBlokke = blokke.filter((b) => b.slags === "linje");
  let over = linjeBlokke.length > 0 ? Math.min(...linjeBlokke.map((b) => b.z0)) - MELLEM : -MELLEM;
  for (const k of skematiske.filter((x) => x.overLinjerne)) {
    const x0 = linjeBlokke.length > 0 ? Math.min(...linjeBlokke.map((b) => b.x0)) : start;
    const x1 = linjeBlokke.length > 0 ? Math.max(...linjeBlokke.map((b) => b.x1)) : start + UTEGNET.b;
    blokke.push({
      id: k.id, navn: k.navn, slags: "rum", tegnet: !!k.layout, nr: null,
      x0, z0: over - BAAND, x1, z1: over, forskyd: [0, 0], layout: null, maalfast: false,
      valgfri: k.valgfri, overLinjerne: true,
    });
    over -= BAAND + MELLEM;
  }

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
    // Racket står for sig i rækken med rummene — det er ikke en del af
    // produktionen, og så krydser databuerne ikke hele fabrikken.
    const rum = blokke.filter((b) => b.slags === "rum" && !b.overLinjerne);
    const x0 = (rum.length > 0 ? Math.max(...rum.map((b) => b.x1)) : start) + MELLEM;
    blokke.push({
      id: rack.id, navn: rack.name, slags: "rack", tegnet: true, nr: null,
      x0, z0: rumZ - RACK.d / 2, x1: x0 + RACK.b, z1: rumZ + RACK.d / 2, forskyd: [0, 0], layout: null, maalfast: false,
      valgfri: false, overLinjerne: false, status: rack.status,
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
        id: `data:${id}`, slags: "data", navn: "Data til MSSQL", udledt: true, antaget: false,
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
        id: "data:lab", slags: "data", navn: "Svar til MSSQL", udledt: true, antaget: false, findes: isDone(lab.status),
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
  // Et bånd over linjerne rammes lige over den anden ende — ikke midt på
  // båndet, der kan være hele fabrikken bredt.
  const lodret = (e: Ende, liste: { w: string | null; p: [number, number] }[], anden: { p: [number, number] }[]) => {
    const blok = blokke.find((b) => b.id === e.del);
    if (!blok?.overLinjerne || e.wIds?.length || anden.length === 0) return liste;
    const x = anden.reduce((s, a) => s + a.p[0], 0) / anden.length;
    return [{ w: null, p: [Math.min(blok.x1, Math.max(blok.x0, x)), (blok.z0 + blok.z1) / 2] as [number, number] }];
  };
  // Til og fra båndet går side om side: op til venstre, ned til højre. Ellers
  // lå de to retninger oven i hinanden, og den ene kunne ikke ses.
  const sideOmSide = (f: Forbindelse, p: [number, number]): [number, number] => {
    const op = blokke.find((b) => b.id === f.til.del)?.overLinjerne;
    const ned = blokke.find((b) => b.id === f.fra.del)?.overLinjerne;
    return op ? [p[0] - SIDE, p[1]] : ned ? [p[0] + SIDE, p[1]] : p;
  };
  // Mod båndet går en del uden bestemte maskiner fra sin overkant — ikke fra
  // midten, hvor navnet står.
  const overkant = (e: Ende, liste: { w: string | null; p: [number, number] }[], anden: Ende) => {
    const blok = blokke.find((b) => b.id === e.del);
    if (!blokke.find((b) => b.id === anden.del)?.overLinjerne || !blok || blok.overLinjerne || e.wIds?.length) return liste;
    return liste.map((x) => ({ ...x, p: [x.p[0], blok.z0] as [number, number] }));
  };
  for (const f of input.forbindelser) {
    const fraRaa = punkter(f.fra, f, "fra");
    const tilRaa = punkter(f.til, f, "til");
    if (fraRaa.length === 0 || tilRaa.length === 0) continue;
    const fra = overkant(f.fra, lodret(f.fra, fraRaa, tilRaa), f.til);
    const til = overkant(f.til, lodret(f.til, tilRaa, fraRaa), f.fra);
    // Flere maskiner i den ene ende: én bue fra hver, mod midten af den anden.
    const midten = (l: { p: [number, number] }[]): [number, number] =>
      [l.reduce((s, x) => s + x.p[0], 0) / l.length, l.reduce((s, x) => s + x.p[1], 0) / l.length];
    const [mange, en, vendt] = fra.length >= til.length ? [fra, midten(til), false] : [til, midten(fra), true];
    for (const x of mange) {
      buer.push({
        id: x.w ? `${f.id}:${x.w}` : f.id, slags: f.slags, navn: f.navn, note: f.note, findes: f.findes, udledt: false,
        antaget: !!f.antaget,
        fra: sideOmSide(f, vendt ? en : x.p), til: sideOmSide(f, vendt ? x.p : en), fraDel: f.fra.del, tilDel: f.til.del,
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
