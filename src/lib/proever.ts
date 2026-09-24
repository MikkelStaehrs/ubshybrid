// Partiet, strømmen gennem sporene og prøverne, der måler den.
//
// Et parti ligger fast: det er det samme frø hele ordren. Kasserne afviger
// lidt fra hinanden, og et stykke af ordren kan være urent. Frøet løber
// gennem jetpealeren (der sliber låg og kim løs), Carter og Alfa (der
// sorterer foreign seeds fra) og to kasteborde, der hver deler strømmen i
// Heavy, Light og Mainline.
//
// Ingen af det kan ses, før nogen tager en prøve. Videometeret ser partiet,
// før det fordeles; CT-scanneren ser strømmen efter jetpealerne og hver af
// kastebordenes tre strømme. Et svar er en prøve: det svinger så meget, som
// en prøve af den størrelse gør — og ikke mere.
//
// Alle tal kommer fra data/fremskrivning.ts og er skøn.
import { FREMMEDE, KASTEBORDET, PARTI, PROCES, PROEVER, type Fremmed } from "../../data/fremskrivning";
import type { Layout, PlacedMachine } from "./layout";

// ---------------------------------------------------------------------------
// Strømmen

/**
 * En strøm, i mængder — ikke andele. Mængderne kan lægges sammen og deles,
 * uden at noget forsvinder; andelene regnes, når nogen måler.
 */
export interface Stroem {
  /** Godt frø: FV0 til FV3. */
  godt: number;
  /** Multigerm: BIGF og BIGH. */
  multi: number;
  fremmed: Record<Fremmed, number>;
  sten: number;
  ler: number;
  /** Løse låg og kim — det, jetpealeren sliber løs. */
  let: number;
}

type Slags = "godt" | "multi" | "fremmed" | "sten" | "ler" | "let";

const tomFremmed = (): Record<Fremmed, number> => Object.fromEntries(FREMMEDE.map((a) => [a, 0])) as Record<Fremmed, number>;

export const fremmedIalt = (s: Stroem) => FREMMEDE.reduce((n, a) => n + s.fremmed[a], 0);
export const iAlt = (s: Stroem) => s.godt + s.multi + fremmedIalt(s) + s.sten + s.ler + s.let;

/** Hver slags ganget med sin egen andel. */
function del(s: Stroem, andel: Record<Slags, number>): Stroem {
  const f = tomFremmed();
  for (const a of FREMMEDE) f[a] = s.fremmed[a] * andel.fremmed;
  return { godt: s.godt * andel.godt, multi: s.multi * andel.multi, fremmed: f, sten: s.sten * andel.sten, ler: s.ler * andel.ler, let: s.let * andel.let };
}

function minus(a: Stroem, b: Stroem): Stroem {
  const f = tomFremmed();
  for (const x of FREMMEDE) f[x] = Math.max(0, a.fremmed[x] - b.fremmed[x]);
  return {
    godt: Math.max(0, a.godt - b.godt), multi: Math.max(0, a.multi - b.multi), fremmed: f,
    sten: Math.max(0, a.sten - b.sten), ler: Math.max(0, a.ler - b.ler), let: Math.max(0, a.let - b.let),
  };
}

/** Jetpealeren sliber låg og kim løs. Det lette materiale er nyt i strømmen. */
export function efterJetpealer(s: Stroem): Stroem {
  const iAltFoer = iAlt(s);
  return { ...s, fremmed: { ...s.fremmed }, let: s.let + (iAltFoer * PROCES.jetpealerLet) / (100 - PROCES.jetpealerLet) };
}

export type Sortering = "normal" | "kraftig";

/** Carter og Alfa: foreign seeds sorteres fra, og det koster lidt godt frø. */
export function efterSortering(s: Stroem, sortering: Sortering): Stroem {
  const p = PROCES.sortering[sortering];
  return del(s, { godt: 1 - p.godtTab / 100, multi: 1, fremmed: 1 - p.fremmed, sten: 1, ler: 1, let: 1 });
}

export type Fraktion = "heavy" | "light" | "mainline";

export interface Skilt {
  heavy: Stroem;
  light: Stroem;
  mainline: Stroem;
}

const klem = (x: number) => Math.min(0.98, Math.max(0, x));

/**
 * Et kastebord deler strømmen i tre. Tværhældningen styrer, hvor meget der
 * går til Heavy; luften, hvor meget der går til Light — begge regnet fra
 * bordets udgangspunkt. Resten er Mainline.
 */
export function skil(ind: Stroem, dTvaers: number, dLuft: number): Skilt {
  const slags: Slags[] = ["godt", "multi", "fremmed", "sten", "ler", "let"];
  const h = Object.fromEntries(slags.map((k) => [k, klem(KASTEBORDET.heavy[k] + KASTEBORDET.heavyPrGrad[k] * dTvaers)])) as Record<Slags, number>;
  // Light kan ikke tage det, Heavy allerede har taget.
  const l = Object.fromEntries(slags.map((k) => [k, Math.min(1 - h[k], klem(KASTEBORDET.light[k] + KASTEBORDET.lightPrTiLuft[k] * (dLuft / 10)))])) as Record<Slags, number>;
  const heavy = del(ind, h);
  const light = del(ind, l);
  return { heavy, light, mainline: minus(minus(ind, heavy), light) };
}

// ---------------------------------------------------------------------------
// Partiet

export interface Parti {
  /** Det gode frø fordelt på FV0 til FV3, i procent. */
  fv: number[];
  bigfAndel: number;
  /** Frø med slibeskader, i procent af det gode frø. */
  slibeskader: number;
  /** Hver kasse, som den tippes. */
  kasser: Stroem[];
  /** Det urene stykke, hvis der er et: første og sidste kasse, fra 0. */
  urent: { fra: number; til: number } | null;
}

/** En normalfordelt størrelse, der ikke går under nul. */
const omkring = (r: () => number, niveau: number, rel: number) => Math.max(0, niveau * (1 + rel * gauss(r)));

/**
 * Et nyt parti til en ordre: niveauet trækkes én gang, kasserne afviger lidt
 * fra det, og et stykke kan være urent. Det er det, der ligger fast — ikke
 * noget, der vandrer fra minut til minut.
 */
export function nytParti(r: () => number, kasser: number): Parti {
  const v = PARTI.ordreVariation;
  const niveau = {
    multi: omkring(r, PARTI.multigerm, v),
    fremmed: omkring(r, PARTI.fremmed, v),
    sten: omkring(r, PARTI.sten, v),
    ler: omkring(r, PARTI.ler, v),
  };
  const urent = r() < PARTI.urent.chance
    ? (() => {
        const [a, b] = PARTI.urent.foersteKasse;
        const fra = Math.min(kasser - 1, a - 1 + Math.floor(r() * (b - a + 1)));
        const [k0, k1] = PARTI.urent.kasser;
        return { fra, til: Math.min(kasser - 1, fra + k0 - 1 + Math.floor(r() * (k1 - k0 + 1))) };
      })()
    : null;
  const gange = PARTI.urent.gange[0] + r() * (PARTI.urent.gange[1] - PARTI.urent.gange[0]);
  const fv = PARTI.fv.map((p) => omkring(r, p, 0.04));
  const fvSum = fv.reduce((a, b) => a + b, 0);
  const liste: Stroem[] = [];
  for (let k = 0; k < Math.max(1, kasser); k++) {
    const kv = PARTI.kasseVariation;
    const urentHer = urent !== null && k >= urent.fra && k <= urent.til;
    const fremmedI = omkring(r, niveau.fremmed, kv) * (urentHer ? gange : 1);
    const f = tomFremmed();
    for (const a of FREMMEDE) f[a] = fremmedI * PARTI.fremmedArter[a];
    const multi = omkring(r, niveau.multi, kv);
    const sten = omkring(r, niveau.sten, kv);
    const ler = omkring(r, niveau.ler, kv);
    liste.push({ godt: Math.max(0, 100 - multi - fremmedI - sten - ler), multi, fremmed: f, sten, ler, let: 0 });
  }
  return {
    fv: fv.map((p) => (p / fvSum) * 100),
    bigfAndel: PARTI.bigfAndel,
    slibeskader: omkring(r, PARTI.slibeskader, v),
    kasser: liste,
    urent,
  };
}

// ---------------------------------------------------------------------------
// Prøverne

/** Hvad en CT-prøve viser, i procent af de frø og partikler, der var i den. */
export interface CtSvar {
  froe: number;
  godt: number;
  bigf: number;
  bigh: number;
  /** Foreign seeds — i procent, og som antal i prøven. De er sjældne. */
  nots: number;
  notsStk: number;
  sten: number;
  ler: number;
  let: number;
  /** Det gode frø fordelt på FV0 til FV3. */
  fv: number[];
}

export interface VideometerSvar {
  gram: number;
  /** Foreign seeds i prøven, efter art. */
  fremmed: Record<Fremmed, number>;
  fremmedIalt: number;
  /** Frø med slibeskader, i procent af det gode frø. */
  slibeskader: number;
}

/** Et antal i en prøve: Poisson for de sjældne, normal for resten. */
function antal(r: () => number, forventet: number): number {
  if (forventet <= 0) return 0;
  if (forventet < 30) {
    const l = Math.exp(-forventet);
    let k = 0;
    let p = 1;
    do { k++; p *= r(); } while (p > l);
    return k - 1;
  }
  return Math.max(0, Math.round(forventet + Math.sqrt(forventet) * gauss(r)));
}

/** En CT-prøve af en strøm: tæl, hvad der var i den. */
export function ctProeve(s: Stroem, parti: Parti, r: () => number): CtSvar {
  const n = PROEVER.ct.froe;
  const t = iAlt(s) || 1;
  const stk = {
    godt: antal(r, (n * s.godt) / t),
    bigf: antal(r, (n * s.multi * parti.bigfAndel) / t),
    bigh: antal(r, (n * s.multi * (1 - parti.bigfAndel)) / t),
    nots: antal(r, (n * fremmedIalt(s)) / t),
    sten: antal(r, (n * s.sten) / t),
    ler: antal(r, (n * s.ler) / t),
    let: antal(r, (n * s.let) / t),
  };
  const i = Object.values(stk).reduce((a, b) => a + b, 0) || 1;
  const pct = (x: number) => (x / i) * 100;
  const fvStk = parti.fv.map((p) => antal(r, (stk.godt * p) / 100));
  const fvI = fvStk.reduce((a, b) => a + b, 0) || 1;
  return {
    froe: i, godt: pct(stk.godt), bigf: pct(stk.bigf), bigh: pct(stk.bigh), nots: pct(stk.nots), notsStk: stk.nots,
    sten: pct(stk.sten), ler: pct(stk.ler), let: pct(stk.let), fv: fvStk.map((x) => (x / fvI) * 100),
  };
}

/** En videometerprøve af partiet, før det fordeles. */
export function videometerProeve(s: Stroem, parti: Parti, r: () => number): VideometerSvar {
  const froe = PROEVER.videometer.gram * PARTI.froePrGram;
  const t = iAlt(s) || 1;
  const f = tomFremmed();
  for (const a of FREMMEDE) f[a] = antal(r, (froe * s.fremmed[a]) / t);
  const godt = (froe * s.godt) / t;
  return {
    gram: PROEVER.videometer.gram,
    fremmed: f,
    fremmedIalt: FREMMEDE.reduce((n, a) => n + f[a], 0),
    slibeskader: godt > 0 ? (antal(r, (godt * parti.slibeskader) / 100) / godt) * 100 : 0,
  };
}

// ---------------------------------------------------------------------------
// Prøvestederne

export interface ProeveSted {
  /** "videometer", "jetpealer:N" eller "<W-ID>:<fraktion>". */
  id: string;
  /** "Mainline KB-3N", "Efter Jetpealer N". Til skærmen. */
  navn: string;
  instrument: "ct" | "videometer";
  lane: string | null;
  /** Maskinen, prøven tages ved. */
  maskine: string | null;
  fraktion: Fraktion | null;
  /** Hvilket kastebord i sporet: 0 er det første. */
  bord: number | null;
}

const KB = /^kb[-\s]/i;
const JETPEALER = /jet\s?pe[ae]ler/i;

/** Kastebordene i hvert spor, i den rækkefølge frøet når dem. */
export function bordeISpor(layout: Layout): Map<string, PlacedMachine[]> {
  const m = new Map<string, PlacedMachine[]>();
  for (const x of layout.machines.filter((y) => y.kind !== "person" && KB.test(y.name) && y.lane)) {
    m.set(x.lane!, [...(m.get(x.lane!) ?? []), x].sort((a, b) => a.step - b.step));
  }
  return m;
}

/** Den faste plan, slået op i tegningen. Et sted, tegningen ikke har, springes over. */
export function ctPlan(layout: Layout, kort: (m: PlacedMachine) => string): ProeveSted[] {
  const borde = bordeISpor(layout);
  const steder: ProeveSted[] = [];
  for (const id of PROEVER.ctPlan) {
    const [a, b] = id.split(":");
    if (a === "jetpealer") {
      const m = layout.machines.find((x) => JETPEALER.test(x.name) && x.lane === b);
      if (m) steder.push({ id, navn: `Efter ${kort(m)}`, instrument: "ct", lane: b, maskine: m.id, fraktion: null, bord: null });
      continue;
    }
    const m = layout.machines.find((x) => x.wIds.includes(a) && KB.test(x.name));
    if (!m || !m.lane) continue;
    const fraktion = b as Fraktion;
    const bord = (borde.get(m.lane) ?? []).findIndex((x) => x.id === m.id);
    steder.push({ id, navn: `${FRAKTION[fraktion]} ${kort(m)}`, instrument: "ct", lane: m.lane, maskine: m.id, fraktion, bord });
  }
  return steder;
}

export const FRAKTION: Record<Fraktion, string> = { heavy: "Heavy", light: "Light", mainline: "Mainline" };

export const VIDEOMETER: ProeveSted = {
  id: "videometer", navn: "Videometer", instrument: "videometer", lane: null, maskine: null, fraktion: null, bord: null,
};

// ---------------------------------------------------------------------------
// Det, en linjeagent vurderer et kastebord efter

export interface Vurdering {
  /** Hvad der er galt, og hvilken vej hver indstilling bør gå. */
  tvaers: "op" | "ned" | "begge" | null;
  luft: "op" | "ned" | "begge" | null;
  grunde: string[];
}

/**
 * Et kastebord vurderes på sine tre strømme: for meget multigerm eller let
 * materiale i Mainline, for meget godt frø i Heavy eller Light. Peger to fund
 * hver sin vej på samme indstilling, er det en afvejning — ikke noget, en
 * indstilling kan løse.
 */
export function vurder(bord: number, s: Partial<Record<Fraktion, CtSvar>>): Vurdering {
  const g = KASTEBORDET.graenser[Math.min(bord, KASTEBORDET.graenser.length - 1)];
  const grunde: string[] = [];
  const retning = (op: boolean, ned: boolean) => (op && ned ? "begge" : op ? "op" : ned ? "ned" : null);
  const m = s.mainline;
  const multiOp = !!m && m.bigf + m.bigh > g.multi;
  const letOp = !!m && m.let > g.let;
  const heavyNed = !!s.heavy && s.heavy.godt > g.heavyGodt;
  const lightNed = !!s.light && s.light.godt > g.lightGodt;
  if (multiOp) grunde.push(`multigerm i Mainline ${tal1(m!.bigf + m!.bigh)} % — højst ${tal1(g.multi)}`);
  if (letOp) grunde.push(`let materiale i Mainline ${tal1(m!.let)} % — højst ${tal1(g.let)}`);
  if (heavyNed) grunde.push(`godt frø i Heavy ${tal0(s.heavy!.godt)} % — højst ${tal0(g.heavyGodt)}`);
  if (lightNed) grunde.push(`godt frø i Light ${tal0(s.light!.godt)} % — højst ${tal0(g.lightGodt)}`);
  return { tvaers: retning(multiOp, heavyNed), luft: retning(letOp, lightNed), grunde };
}

/**
 * Hvad ét trin på en indstilling gør ved et typisk parti — agentens
 * tommelfingerregel, den samme sammenhæng simulatoren regner med. Den
 * kender ikke partiet, der ligger på bordet lige nu.
 */
export function virkningAfTrin(bord: number, par: "tvaers" | "luft", retning: 1 | -1): { navn: string; delta: number }[] {
  const typisk = efterSortering(efterJetpealer(nytTypiskKasse()), "normal");
  const ind = bord === 0 ? typisk : skil(typisk, 0, 0).mainline;
  const foer = skil(ind, 0, 0);
  const d = retning * KASTEBORDET.trin[par];
  const efter = par === "tvaers" ? skil(ind, d, 0) : skil(ind, 0, d);
  const pctAf = (x: Stroem, k: "multi" | "let" | "godt") => (x[k] / (iAlt(x) || 1)) * 100;
  return par === "tvaers"
    ? [
        { navn: "Multigerm i Mainline", delta: pctAf(efter.mainline, "multi") - pctAf(foer.mainline, "multi") },
        { navn: "Godt frø i Heavy", delta: pctAf(efter.heavy, "godt") - pctAf(foer.heavy, "godt") },
      ]
    : [
        { navn: "Let i Mainline", delta: pctAf(efter.mainline, "let") - pctAf(foer.mainline, "let") },
        { navn: "Godt frø i Light", delta: pctAf(efter.light, "godt") - pctAf(foer.light, "godt") },
      ];
}

function nytTypiskKasse(): Stroem {
  const f = tomFremmed();
  for (const a of FREMMEDE) f[a] = PARTI.fremmed * PARTI.fremmedArter[a];
  return { godt: 100 - PARTI.multigerm - PARTI.fremmed - PARTI.sten - PARTI.ler, multi: PARTI.multigerm, fremmed: f, sten: PARTI.sten, ler: PARTI.ler, let: 0 };
}

const tal1 = (v: number) => v.toFixed(1).replace(".", ",");
const tal0 = (v: number) => Math.round(v).toString();

/** Standardnormalfordelt, af to uniforme. Samme som simulatorens. */
export function gauss(r: () => number): number {
  let u = 0;
  while (u === 0) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}
