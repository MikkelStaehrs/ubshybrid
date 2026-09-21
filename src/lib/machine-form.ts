// Hvordan en maskine ser ud — ét sted.
//
// Både kortet (MachineMesh) og hologrammet på /ai læser herfra. Ellers ville
// de to få hver deres idé om, hvordan en elevator er bygget, og de ville
// glide fra hinanden første gang en maskintype blev rettet.
//
// Her står de bærende volumener: det, der giver maskinen sin silhuet, og det
// hologrammet sampler punkter på. Små detaljer — nitter, håndtag, ringen ved
// CT-scannerens åbning — bliver i MachineMesh. De er overfladepynt, ikke
// svaret på hvordan en maskine ser ud.
import type { MachineKind } from "./types";

/** Fodaftryk (meter) og højde pr. maskintype. x = langs flowet, z = på tværs. */
export const KIND_SIZE: Record<MachineKind, { x: number; z: number; h: number }> = {
  intake: { x: 2.6, z: 2.6, h: 1.8 },
  elevator: { x: 1.1, z: 1.1, h: 5.2 },
  distributor: { x: 1.6, z: 1.6, h: 2.2 },
  process: { x: 3.2, z: 2.6, h: 2.4 },
  analysis: { x: 1.6, z: 0.9, h: 1.3 },
  person: { x: 0.5, z: 0.36, h: 1.8 },
};

/** Illustrative former ud fra navnet — nemme at udvide når vi kender modellerne. */
export type Shape = "box" | "drum" | "tower" | "sieve" | "deck";

export function shapeFor(name: string): Shape {
  if (/tri[øo]r/i.test(name)) return "drum";
  if (/jet\s?pe[ae]ler|nordmark/i.test(name)) return "tower";
  if (/^kb[-\s]/i.test(name)) return "sieve";
  if (/alfa/i.test(name)) return "deck";
  return "box";
}

export type Vec3 = [number, number, number];

/**
 * Et bærende volumen i maskinens egne akser.
 *
 * `steel` skiller ramme og beslag fra selve maskinkroppen, så kortet kan
 * farve dem forskelligt. Hologrammet er ligeglad — det sampler dem ens.
 */
export type Primitive =
  | { form: "box"; size: Vec3; at: Vec3; rot?: Vec3; steel?: boolean; receive?: boolean }
  | {
      form: "cylinder";
      /** Toppen kan være smallere end bunden. Er `rTop` 0, er det en kegle. */
      rTop: number;
      rBottom: number;
      h: number;
      /** Fire sider giver en firkantet tragt, mange giver en rund cylinder. */
      sides: number;
      at: Vec3;
      rot?: Vec3;
      steel?: boolean;
    }
  | { form: "sphere"; r: number; at: Vec3; steel?: boolean };

export interface FormInput {
  kind: MachineKind;
  name: string;
  /** Maskinens mål, som layoutLine har regnet dem ud. */
  size: { x: number; z: number; h: number };
  /** Antal W-ID'er. Fire vippestole i én boks bliver til fire kar. */
  wIdCount: number;
}

/** Maskinens bærende volumener, i dens egne akser med gulvet i y = 0. */
export function formFor({ kind, name, size, wIdCount }: FormInput): Primitive[] {
  const { x, z, h } = size;

  if (kind === "elevator") {
    return [
      { form: "box", size: [x * 1.35, 0.9, z * 1.5], at: [0, 0.45, 0], steel: true, receive: true },
      { form: "box", size: [x * 0.7, h, z], at: [0, h / 2, 0] },
      // Afkastet i toppen. En flowmåler hænger her, med mindre dataene
      // siger noget andet — FT-743 sidder fx nede ved indløbet.
      { form: "box", size: [x * 1.3, 0.8, z * 1.6], at: [0, h + 0.35, 0.1] },
    ];
  }

  if (kind === "distributor") {
    return [
      { form: "cylinder", rTop: x * 0.45, rBottom: x * 0.45, h: 1.6, sides: 24, at: [0, 0.8, 0] },
      { form: "cylinder", rTop: 0, rBottom: x * 0.45, h: 0.7, sides: 24, at: [0, 1.95, 0], steel: true },
    ];
  }

  if (kind === "intake") {
    const n = Math.max(1, wIdCount);
    const unitZ = z / n;
    if (n > 1) {
      // Vippestole: ramme og vippet kar pr. stk.
      return Array.from({ length: n }, (_, i) => {
        const oz = -z / 2 + unitZ * (i + 0.5);
        return [
          { form: "box", size: [x * 0.7, 1, unitZ * 0.7], at: [0, 0.5, oz], steel: true },
          { form: "box", size: [x * 0.75, 0.5, unitZ * 0.8], at: [0.2, 1.25, oz], rot: [0, 0, -0.35] },
        ] as Primitive[];
      }).flat();
    }
    // Påslag: tragt på fire ben.
    const legs: Primitive[] = [-1, 1].flatMap((sx) =>
      [-1, 1].map((sz): Primitive => ({
        form: "box",
        size: [0.14, 0.9, 0.14],
        at: [sx * x * 0.3, 0.45, sz * unitZ * 0.3],
        steel: true,
      })),
    );
    return [
      ...legs,
      { form: "cylinder", rTop: x * 0.62, rBottom: x * 0.18, h: 0.9, sides: 4, at: [0, 1.35, 0], rot: [0, Math.PI / 4, 0] },
    ];
  }

  if (kind === "person") {
    // Piktogram frem for forsøg på realisme — han er her for sjov.
    const legH = h * 0.47;
    const torsoH = h * 0.3;
    const headR = h * 0.075;
    return [
      ...[-1, 1].map((sx): Primitive => ({
        form: "box", size: [x * 0.34, legH, z * 0.3], at: [0, legH / 2, sx * z * 0.22],
      })),
      { form: "box", size: [x * 0.62, torsoH, z], at: [0, legH + torsoH / 2, 0] },
      ...[-1, 1].map((sx): Primitive => ({
        form: "box", size: [x * 0.26, torsoH * 0.92, 0.1], at: [0, legH + torsoH * 0.55, sx * (z / 2 + 0.06)],
      })),
      { form: "sphere", r: headR, at: [0, legH + torsoH + headR * 1.35, 0] },
    ];
  }

  if (kind === "analysis") {
    // CT-scanner: massiv kasse. Videometer: bånd gennem en kuppel, på et bord.
    if (/ct|scanner/i.test(name)) {
      return [{ form: "box", size: [x, h, z], at: [0, h / 2, 0], receive: true }];
    }
    const tableH = h * 0.66;
    const domeR = Math.min(0.2, z * 0.28);
    return [
      ...[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz): Primitive => ({
          form: "box", size: [0.06, tableH, 0.06], at: [sx * x * 0.42, tableH / 2, sz * z * 0.36], steel: true,
        })),
      ),
      { form: "box", size: [x, 0.05, z], at: [0, tableH, 0], steel: true, receive: true },
      // Transportbåndet er 30 cm bredt — et af de få rigtige mål vi har.
      { form: "box", size: [x * 0.95, 0.07, 0.3], at: [0, tableH + 0.06, 0] },
      { form: "sphere", r: domeR, at: [0, tableH + 0.09, 0] },
    ];
  }

  // Procesmaskiner: fundament plus en krop, der afhænger af navnet.
  const shape = shapeFor(name);
  const bodyH = h * 0.62;
  const out: Primitive[] = [
    { form: "box", size: [x, 0.16, z], at: [0, 0.08, 0], steel: true, receive: true },
  ];

  if (shape === "drum") {
    out.push(
      { form: "box", size: [x * 0.9, 0.8, z * 0.55], at: [0, 0.55, 0], steel: true },
      { form: "cylinder", rTop: z * 0.36, rBottom: z * 0.36, h: x * 0.95, sides: 28, at: [0, 1.55, 0], rot: [0, 0, Math.PI / 2] },
    );
  } else {
    out.push({ form: "box", size: [x * 0.9, bodyH, z * 0.85], at: [0, 0.16 + bodyH / 2, 0] });
  }

  if (shape === "tower") {
    out.push({ form: "cylinder", rTop: z * 0.28, rBottom: z * 0.28, h: 1.1, sides: 24, at: [x * 0.15, 0.16 + bodyH + 0.55, 0], steel: true });
  }
  if (shape === "sieve") {
    for (let i = 0; i < 3; i++) {
      out.push({
        form: "box",
        size: [x * (0.8 - i * 0.08), 0.18, z * (0.75 - i * 0.08)],
        at: [0, 0.16 + bodyH + 0.14 + i * 0.26, 0],
        steel: i % 2 === 0,
      });
    }
  }
  if (shape === "deck") {
    out.push({ form: "box", size: [x * 0.95, 0.12, z * 0.95], at: [0, 0.16 + bodyH + 0.2, 0], rot: [0.12, 0, 0.08], steel: true });
  }
  if (shape === "box" || shape === "drum") {
    out.push({
      form: "cylinder",
      rTop: 0.55,
      rBottom: 0.2,
      h: 0.6,
      sides: 4,
      at: [-x * 0.25, (shape === "drum" ? 2.2 : 0.16 + bodyH) + 0.3, 0],
      rot: [0, Math.PI / 4, 0],
      steel: true,
    });
  }
  return out;
}

/** Maskinens højeste punkt. Bruges til labels og henvisningslinjer. */
export function formTop(prims: Primitive[]): number {
  let top = 0;
  for (const p of prims) {
    const half = p.form === "box" ? p.size[1] / 2 : p.form === "cylinder" ? p.h / 2 : p.r;
    top = Math.max(top, p.at[1] + half);
  }
  return top;
}
