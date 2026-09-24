// Partiet, strømmen gennem sporene og prøverne, der måler den.
//
// Et parti ligger fast: det er det samme frø hele ordren. Kasserne afviger
// lidt fra hinanden, og et stykke af ordren kan være urent. Fordeleren deler
// frøet i to størrelser, ét spor hver. I sporet sliber jetpealeren låg og kim
// løs, Triøren tager foreign seeds, Alfa sorterer i størrelse, Carter tager
// multigerm, og to kasteborde deler hver strømmen i Heavy, Light og Ready.
// Heavy og Light ryger ud; kun Ready går videre og bliver færdigvare.
//
// Ingen af det kan ses, før nogen tager en prøve. Videometeret ser partiet,
// før det fordeles; CT-scanneren ser strømmen efter jetpealerne og hver af
// kastebordenes tre strømme — som den rigtige gør: frøene i kategorier og de
// små fragmenter for sig. Et svar er en prøve: det svinger så meget, som en
// prøve af den størrelse gør — og ikke mere.
//
// Kastebordene er kalibreret på rigtige CT-prøver. Resten er skøn, og alle
// tal kommer fra data/fremskrivning.ts.
import { FREMMEDE, KASTEBORDET, PARTI, PROCES, PROEVER, type CtMaalt, type Fremmed } from "../../data/fremskrivning";
import { PROEVESTEDER, type Proevested } from "../../data/proevesteder";
import type { Layout, PlacedMachine } from "./layout";

// ---------------------------------------------------------------------------
// Strømmen

/**
 * En strøm, i mængder — ikke andele. Mængderne kan lægges sammen og deles,
 * uden at noget forsvinder; andelene regnes, når nogen måler.
 */
export interface Stroem {
  /** Godt frø, fordelt på FV0 til FV3. */
  fv: [number, number, number, number];
  /** Tomme frø (EMP). */
  tom: number;
  /** Multigerm: BIGF, BIGH og tvillinger (TWIN). */
  bigf: number;
  bigh: number;
  twin: number;
  fremmed: Record<Fremmed, number>;
  sten: number;
  ler: number;
  /** Løse låg og kim — det, jetpealeren sliber løs, og CT'en tæller som små fragmenter. */
  let: number;
}

/** Det, et kastebord skiller hver for sig. Foreign seeds følges ad. */
const SLAGS = ["fv0", "fv1", "fv2", "fv3", "tom", "bigf", "bigh", "twin", "fremmed", "sten", "ler", "let"] as const;
type Slags = (typeof SLAGS)[number];
type Andele = Record<Slags, number>;

const tomFremmed = (): Record<Fremmed, number> => Object.fromEntries(FREMMEDE.map((a) => [a, 0])) as Record<Fremmed, number>;
const hverSlags = (f: (k: Slags) => number): Andele => Object.fromEntries(SLAGS.map((k) => [k, f(k)])) as Andele;
const fvIndeks = (k: Slags) => (k.startsWith("fv") ? Number(k[2]) : -1);

export const fremmedIalt = (s: Stroem) => FREMMEDE.reduce((n, a) => n + s.fremmed[a], 0);
export const godt = (s: Stroem) => s.fv[0] + s.fv[1] + s.fv[2] + s.fv[3];
export const multi = (s: Stroem) => s.bigf + s.bigh + s.twin;
/** Det, CT'en tæller som frø: godt, tomt, multigerm og foreign seeds. */
export const froeIalt = (s: Stroem) => godt(s) + s.tom + multi(s) + fremmedIalt(s);
export const iAlt = (s: Stroem) => froeIalt(s) + s.sten + s.ler + s.let;

function maengde(s: Stroem, k: Slags): number {
  const i = fvIndeks(k);
  if (i >= 0) return s.fv[i];
  return k === "fremmed" ? fremmedIalt(s) : s[k as Exclude<Slags, "fv0" | "fv1" | "fv2" | "fv3" | "fremmed">];
}

/** Hver slags ganget med sin egen andel. */
function del(s: Stroem, a: Andele): Stroem {
  const f = tomFremmed();
  for (const x of FREMMEDE) f[x] = s.fremmed[x] * a.fremmed;
  return {
    fv: [s.fv[0] * a.fv0, s.fv[1] * a.fv1, s.fv[2] * a.fv2, s.fv[3] * a.fv3],
    tom: s.tom * a.tom, bigf: s.bigf * a.bigf, bigh: s.bigh * a.bigh, twin: s.twin * a.twin,
    fremmed: f, sten: s.sten * a.sten, ler: s.ler * a.ler, let: s.let * a.let,
  };
}

function minus(a: Stroem, b: Stroem): Stroem {
  const f = tomFremmed();
  for (const x of FREMMEDE) f[x] = Math.max(0, a.fremmed[x] - b.fremmed[x]);
  const d = (x: number, y: number) => Math.max(0, x - y);
  return {
    fv: [d(a.fv[0], b.fv[0]), d(a.fv[1], b.fv[1]), d(a.fv[2], b.fv[2]), d(a.fv[3], b.fv[3])],
    tom: d(a.tom, b.tom), bigf: d(a.bigf, b.bigf), bigh: d(a.bigh, b.bigh), twin: d(a.twin, b.twin),
    fremmed: f, sten: d(a.sten, b.sten), ler: d(a.ler, b.ler), let: d(a.let, b.let),
  };
}

const alle = (x: number) => hverSlags(() => x);

/** Jetpealeren sliber låg og kim løs. Det, der går løs, er nyt i strømmen. */
export function efterJetpealer(s: Stroem): Stroem {
  return { ...del(s, alle(1)), let: s.let + (froeIalt(s) * PROCES.jetpealerLet) / 100 };
}

export type Sortering = "normal" | "kraftig";

/** Triøren: foreign seeds sorteres fra, og det koster lidt godt frø. */
export function efterTrioere(s: Stroem, sortering: Sortering): Stroem {
  const p = PROCES.sortering[sortering];
  const g = 1 - p.godtTab / 100;
  return del(s, { ...alle(1), fv0: g, fv1: g, fv2: g, fv3: g, fremmed: 1 - p.fremmed });
}

/** Carter: bigerm og tvillinger sorteres fra, og det koster lidt godt frø. */
export function efterCarter(s: Stroem): Stroem {
  const c = PROCES.carter;
  const g = 1 - c.godtTab / 100;
  return del(s, { ...alle(1), fv0: g, fv1: g, fv2: g, fv3: g, bigf: 1 - c.multi, bigh: 1 - c.multi, twin: 1 - c.multi });
}

/**
 * Det, der når det første kastebord: jetpealer, Triøre, Alfa og Carter. Alfa
 * sorterer i størrelse — det flytter ikke sammensætningen i modellen.
 */
export function tilKastebord(kasse: Stroem, sortering: Sortering): Stroem {
  return efterCarter(efterTrioere(efterJetpealer(kasse), sortering));
}

export type Fraktion = "heavy" | "light" | "ready";

export interface Skilt {
  heavy: Stroem;
  light: Stroem;
  /** Det, der går videre. Fra det sidste bord er det færdigvaren. */
  ready: Stroem;
}

// --- Kastebordets skillemodel ----------------------------------------------------
//
// En slags k, der står tættere i Heavy end i tilløbet, går oftere derud. Ved
// en snitdybde t går andelen 1 − (1 − t)^a[k] af slagsen til siden: a > 1
// beriges, a < 1 fortyndes, a = 0 går aldrig derud. Eksponenterne er sat, så
// bordet ved standardindstillingerne giver netop det, CT'en har set i de tre
// strømme — med den del af tilløbet til siderne, KASTEBORDET.masse skønner.
// Indstillingen flytter, hvor meget der går til siden; hvad der går med,
// følger af eksponenterne. Åbnes snittet, ligner siden mere tilløbet.

type Plads = "foerste" | "sidste";
const plads = (bord: number): Plads => (bord === 0 ? "foerste" : "sidste");

interface Kalibrering {
  h0: number;
  l0: number;
  aH: Andele;
  /** Light tager af det, Heavy har ladt ligge. */
  aL: Andele;
}

function maalt(c: CtMaalt, k: Slags): number {
  const i = fvIndeks(k);
  if (i >= 0) return c.fv[i];
  return k === "let" ? c.frag : c[k as "tom" | "bigf" | "bigh" | "twin"];
}

function kalibrer(p: Plads): Kalibrering {
  const m = KASTEBORDET.maalt[p];
  const { heavy: h0, light: l0 } = KASTEBORDET.masse[p];
  const sH = {} as Andele;
  const sL = {} as Andele;
  for (const k of SLAGS) {
    if (k === "fremmed" || k === "sten" || k === "ler") {
      const b = KASTEBORDET.beriget[k];
      sH[k] = Math.min(0.98, h0 * b.heavy);
      sL[k] = Math.min(0.98 - sH[k], l0 * b.light);
      continue;
    }
    const [H, R, L] = [maalt(m.heavy, k), maalt(m.ready, k), maalt(m.light, k)];
    // Tilløbet er summen af det, der kom ud.
    const F = h0 * H + l0 * L + (1 - h0 - l0) * R;
    sH[k] = F > 0 ? Math.min(0.98, (h0 * H) / F) : 0;
    sL[k] = F > 0 ? Math.min(0.98 - sH[k], (l0 * L) / F) : 0;
  }
  const eksponent = (s: number, t: number) => (s <= 0 ? 0 : Math.log(1 - s) / Math.log(1 - t));
  const lr0 = l0 / (1 - h0);
  return {
    h0, l0,
    aH: hverSlags((k) => eksponent(sH[k], h0)),
    aL: hverSlags((k) => eksponent(sL[k] / (1 - sH[k]), lr0)),
  };
}

const KALIBRERING: Record<Plads, Kalibrering> = { foerste: kalibrer("foerste"), sidste: kalibrer("sidste") };

const andelVed = (a: Andele, t: number) => hverSlags((k) => (a[k] === 0 ? 0 : 1 - Math.pow(1 - t, a[k])));

/** Den snitdybde, der sender netop `maal` af strømmen til siden. */
function snit(s: Stroem, a: Andele, maal: number): number {
  if (maal <= 0) return 0;
  const ud = (t: number) => SLAGS.reduce((n, k) => n + maengde(s, k) * (a[k] === 0 ? 0 : 1 - Math.pow(1 - t, a[k])), 0);
  const top = 1 - 1e-9;
  if (ud(top) <= maal) return top;
  let lo = 0;
  let hi = top;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (ud(mid) < maal) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Den del af tilløbet, der går til en side. Aldrig nul og aldrig det hele. */
const sideAndel = (x: number) => Math.min(0.4, Math.max(0.001, x));

/**
 * Et kastebord deler strømmen i tre. Tværhældningen styrer, hvor meget der
 * går til Heavy; luften, hvor meget der går til Light — begge regnet fra
 * bordets udgangspunkt. Resten er Ready. `bord` er bordets plads i sporet:
 * det første og det sidste er kalibreret hver for sig.
 */
export function skil(ind: Stroem, dTvaers: number, dLuft: number, bord = 0): Skilt {
  const k = KALIBRERING[plads(bord)];
  const ialt = iAlt(ind);
  const h = sideAndel(k.h0 * (1 + KASTEBORDET.heavyPrGrad * dTvaers));
  const l = sideAndel(k.l0 * (1 + KASTEBORDET.lightPrTiLuft * (dLuft / 10)));
  const heavy = del(ind, andelVed(k.aH, snit(ind, k.aH, h * ialt)));
  const rest = minus(ind, heavy);
  const light = del(rest, andelVed(k.aL, snit(rest, k.aL, Math.min(l * ialt, iAlt(rest) * 0.98))));
  return { heavy, light, ready: minus(rest, light) };
}

/** Et kastebords tab, i andele af det, sporet fik ind. */
export interface BordTab {
  heavy: number;
  light: number;
  /** Det gode frø i Heavy og Light. */
  heavyGodt: number;
  lightGodt: number;
}

/**
 * Sporets kasteborde, ét efter ét: hvad hvert bord sender ud, og hvad der
 * går videre fra det sidste — i andele af `grundlag`, det sporet fik ind.
 */
export function sporetsBorde(ind: Stroem, indstillinger: { dT: number; dL: number }[], grundlag = iAlt(ind)) {
  const borde: BordTab[] = [];
  let st = ind;
  indstillinger.forEach((d, i) => {
    const sk = skil(st, d.dT, d.dL, i);
    borde.push({
      heavy: iAlt(sk.heavy) / grundlag, light: iAlt(sk.light) / grundlag,
      heavyGodt: godt(sk.heavy) / grundlag, lightGodt: godt(sk.light) / grundlag,
    });
    st = sk.ready;
  });
  return { borde, ready: iAlt(st) / grundlag, readyGodt: godt(st) / grundlag };
}

// ---------------------------------------------------------------------------
// Partiet

export interface Parti {
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
    tom: omkring(r, PARTI.tom, v),
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
  const fvTrukket = PARTI.fv.map((p) => omkring(r, p, 0.04));
  const fvSum = fvTrukket.reduce((a, b) => a + b, 0);
  const fvAndel = fvTrukket.map((p) => p / fvSum);
  const { bigf, bigh, twin } = PARTI.multiArter;
  const liste: Stroem[] = [];
  for (let k = 0; k < Math.max(1, kasser); k++) {
    const kv = PARTI.kasseVariation;
    const urentHer = urent !== null && k >= urent.fra && k <= urent.til;
    const fremmedI = omkring(r, niveau.fremmed, kv) * (urentHer ? gange : 1);
    const f = tomFremmed();
    for (const a of FREMMEDE) f[a] = fremmedI * PARTI.fremmedArter[a];
    const m = omkring(r, niveau.multi, kv);
    const sten = omkring(r, niveau.sten, kv);
    const ler = omkring(r, niveau.ler, kv);
    const tom = omkring(r, niveau.tom, kv);
    const g = Math.max(0, 100 - m - fremmedI - sten - ler - tom);
    liste.push({
      fv: [g * fvAndel[0], g * fvAndel[1], g * fvAndel[2], g * fvAndel[3]],
      tom, bigf: m * bigf, bigh: m * bigh, twin: m * twin, fremmed: f, sten, ler, let: 0,
    });
  }
  return { slibeskader: omkring(r, PARTI.slibeskader, v), kasser: liste, urent };
}

// ---------------------------------------------------------------------------
// Prøverne

/**
 * Hvad en CT-prøve viser — som den rigtige: frøene i kategorier, i procent af
 * frøene, og de små fragmenter for sig. Sten og ler ser den ikke.
 */
export interface CtSvar {
  froe: number;
  /** Godt frø, FV0–FV3. */
  godt: number;
  /** Det gode frø fordelt på FV0 til FV3. */
  fv: number[];
  bigf: number;
  bigh: number;
  twin: number;
  /** Tomme frø (EMP). */
  tom: number;
  /** Foreign seeds (NOTS) — i procent, og som antal i prøven. De er sjældne. */
  nots: number;
  notsStk: number;
  /** Små fragmenter — løse låg og kim — som antal, og i procent af frøene. */
  fragStk: number;
  frag: number;
  /** Median frøvægt i prøven. Sporene har hver sin størrelse. null uden spor. */
  mg: number | null;
}

/** Multigerm i et CT-svar: BIGF, BIGH og tvillinger. */
export const ctMulti = (c: CtSvar) => c.bigf + c.bigh + c.twin;

/**
 * Prisen i en sidestrøm: gode frø smidt ud pr. uønsket frø eller fragment
 * fjernet. Kan læses af CT'en alene — der skal intet vejes.
 */
export const ctPris = (c: CtSvar) => c.godt / Math.max(100 / Math.max(1, c.froe), 100 - c.godt + c.frag);

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

/** En CT-prøve af en strøm: tæl, hvad der var i den. `mg` er sporets frøvægt. */
export function ctProeve(s: Stroem, r: () => number, mg: number | null = null): CtSvar {
  const n = PROEVER.ct.froe;
  const f = froeIalt(s) || 1;
  const fv = s.fv.map((x) => antal(r, (n * x) / f));
  const stk = {
    tom: antal(r, (n * s.tom) / f),
    bigf: antal(r, (n * s.bigf) / f),
    bigh: antal(r, (n * s.bigh) / f),
    twin: antal(r, (n * s.twin) / f),
    nots: antal(r, (n * fremmedIalt(s)) / f),
  };
  const fragStk = antal(r, (n * s.let) / f);
  const godtStk = fv.reduce((a, b) => a + b, 0);
  const i = godtStk + Object.values(stk).reduce((a, b) => a + b, 0) || 1;
  const pct = (x: number) => (x / i) * 100;
  return {
    froe: i, godt: pct(godtStk), fv: fv.map((x) => (godtStk > 0 ? (x / godtStk) * 100 : 0)),
    bigf: pct(stk.bigf), bigh: pct(stk.bigh), twin: pct(stk.twin), tom: pct(stk.tom),
    nots: pct(stk.nots), notsStk: stk.nots, fragStk, frag: pct(fragStk),
    mg: mg === null ? null : Math.round(mg * (1 + 0.01 * gauss(r)) * 10) / 10,
  };
}

/** En videometerprøve af partiet, før det fordeles. */
export function videometerProeve(s: Stroem, parti: Parti, r: () => number): VideometerSvar {
  const froe = PROEVER.videometer.gram * PARTI.froePrGram;
  const t = iAlt(s) || 1;
  const f = tomFremmed();
  for (const a of FREMMEDE) f[a] = antal(r, (froe * s.fremmed[a]) / t);
  const g = (froe * godt(s)) / t;
  return {
    gram: PROEVER.videometer.gram,
    fremmed: f,
    fremmedIalt: FREMMEDE.reduce((n, a) => n + f[a], 0),
    slibeskader: g > 0 ? (antal(r, (g * parti.slibeskader) / 100) / g) * 100 : 0,
  };
}

// ---------------------------------------------------------------------------
// Prøvestederne

export interface ProeveSted {
  /** "videometer", "jetpealer:N" eller "<W-ID>:<fraktion>". */
  id: string;
  /** "Ready KB-3N", "Efter Jetpealer N". Til skærmen. */
  navn: string;
  instrument: "ct" | "videometer";
  lane: string | null;
  /** Maskinen, prøven tages ved. */
  maskine: string | null;
  fraktion: Fraktion | null;
  /** Hvilket kastebord i sporet: 0 er det første. */
  bord: number | null;
  /** Prøvestedet i data/proevesteder.ts — og dermed operationsnummeret. null: stedet er ikke registreret. */
  proevested: Proevested | null;
}

/** Prøvestedet for en maskine og evt. en strøm, som driften har registreret det. */
export function proevestedFor(wId: string, fraktion: Fraktion | null): Proevested | null {
  return PROEVESTEDER.find((p) => p.hvor.wId === wId && (p.hvor.stroem ?? null) === fraktion) ?? null;
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
      if (m) steder.push({ id, navn: `Efter ${kort(m)}`, instrument: "ct", lane: b, maskine: m.id, fraktion: null, bord: null, proevested: proevestedFor(m.wIds[0], null) });
      continue;
    }
    const m = layout.machines.find((x) => x.wIds.includes(a) && KB.test(x.name));
    if (!m || !m.lane) continue;
    const fraktion = b as Fraktion;
    const bord = (borde.get(m.lane) ?? []).findIndex((x) => x.id === m.id);
    steder.push({ id, navn: `${FRAKTION[fraktion]} ${kort(m)}`, instrument: "ct", lane: m.lane, maskine: m.id, fraktion, bord, proevested: proevestedFor(a, fraktion) });
  }
  return steder;
}

export const FRAKTION: Record<Fraktion, string> = { heavy: "Heavy", light: "Light", ready: "Ready" };

export const VIDEOMETER: ProeveSted = {
  id: "videometer", navn: "Videometer", instrument: "videometer", lane: null, maskine: null, fraktion: null, bord: null,
  proevested: PROEVESTEDER.find((p) => p.analyse.instrument === "videometer" && p.slags === "proces") ?? null,
};

// ---------------------------------------------------------------------------
// Det, en linjeagent vurderer et kastebord efter

export interface Vurdering {
  /** Hvad der er galt, og hvilken vej hver indstilling bør gå. */
  tvaers: "op" | "ned" | "begge" | null;
  luft: "op" | "ned" | "begge" | null;
  grunde: string[];
}

/** Grænserne for et bord på sin plads i sporet. */
export const graenseFor = (bord: number) => KASTEBORDET.graenser[Math.min(bord, KASTEBORDET.graenser.length - 1)];

/**
 * Et kastebord vurderes på Ready og på prisen i siderne. Er Ready for uren,
 * lukkes bordet et trin. Smider en side mange gode frø ud pr. uønsket, og
 * har Ready luft, åbnes det et trin — Heavy og Light ryger ud, så hvert godt
 * frø dér er tabt. Er Ready for uren, og prisen samtidig høj, er det en
 * afvejning — ikke noget, en indstilling kan løse.
 */
export function vurder(bord: number, s: Partial<Record<Fraktion, CtSvar>>): Vurdering {
  const g = graenseFor(bord);
  const grunde: string[] = [];
  const r = s.ready;
  const multiOver = !!r && ctMulti(r) > g.readyMulti;
  const fragOver = !!r && r.frag > g.readyFrag;
  const multiLuft = !!r && ctMulti(r) <= g.readyMulti * KASTEBORDET.margen;
  const fragLuft = !!r && r.frag <= g.readyFrag * KASTEBORDET.margen;
  const heavyDyr = !!s.heavy && ctPris(s.heavy) > g.pris && (multiOver || multiLuft);
  const lightDyr = !!s.light && ctPris(s.light) > g.pris && (fragOver || fragLuft);
  if (multiOver) grunde.push(`multigerm i Ready ${tal1(ctMulti(r!))} % — højst ${tal1(g.readyMulti)}`);
  if (fragOver) grunde.push(`fragmenter i Ready ${tal1(r!.frag)} % — højst ${tal1(g.readyFrag)}`);
  if (heavyDyr) grunde.push(`Heavy smider ${tal0(ctPris(s.heavy!))} gode frø ud pr. uønsket — højst ${g.pris}`);
  if (lightDyr) grunde.push(`Light smider ${tal0(ctPris(s.light!))} gode frø ud pr. uønsket — højst ${g.pris}`);
  const retning = (over: boolean, dyr: boolean) => (over && dyr ? "begge" : over ? "op" : dyr ? "ned" : null);
  return { tvaers: retning(multiOver, heavyDyr), luft: retning(fragOver, lightDyr), grunde };
}

/** Det, ét trin ventes at gøre. `fraktion` og `noegle` er med, når CT'en kan måle det. */
export interface TrinVirkning {
  navn: string;
  delta: number;
  fraktion?: Fraktion;
  noegle?: "multi" | "frag";
}

/**
 * Hvad ét trin på en indstilling gør ved et typisk parti — agentens
 * tommelfingerregel, den samme sammenhæng simulatoren regner med. Den
 * kender ikke partiet, der ligger på bordet lige nu. Tabet er godt frø i
 * Heavy og Light, i procentpoint af det, sporet fik ind.
 */
export function virkningAfTrin(bord: number, par: "tvaers" | "luft", retning: 1 | -1): TrinVirkning[] {
  const spor = tilKastebord(typiskKasse(), "normal");
  const ind = bord === 0 ? spor : skil(spor, 0, 0, 0).ready;
  const d = retning * KASTEBORDET.trin[par];
  const foer = skil(ind, 0, 0, bord);
  const efter = par === "tvaers" ? skil(ind, d, 0, bord) : skil(ind, 0, d, bord);
  const tab = (x: Skilt) => ((godt(x.heavy) + godt(x.light)) / iAlt(spor)) * 100;
  const iReady = (x: Skilt) => (par === "tvaers" ? multi(x.ready) : x.ready.let) / froeIalt(x.ready) * 100;
  return [
    par === "tvaers"
      ? { navn: "Multigerm i Ready", delta: iReady(efter) - iReady(foer), fraktion: "ready", noegle: "multi" }
      : { navn: "Fragmenter i Ready", delta: iReady(efter) - iReady(foer), fraktion: "ready", noegle: "frag" },
    { navn: "Godt frø tabt", delta: tab(efter) - tab(foer) },
  ];
}

/** En kasse af et typisk parti, uden tilfældighed. */
export function typiskKasse(): Stroem {
  const f = tomFremmed();
  for (const a of FREMMEDE) f[a] = PARTI.fremmed * PARTI.fremmedArter[a];
  const m = PARTI.multigerm;
  const g = 100 - m - PARTI.fremmed - PARTI.sten - PARTI.ler - PARTI.tom;
  const fvSum = PARTI.fv.reduce((a, b) => a + b, 0);
  const fv = PARTI.fv.map((p) => (g * p) / fvSum);
  const { bigf, bigh, twin } = PARTI.multiArter;
  return {
    fv: [fv[0], fv[1], fv[2], fv[3]], tom: PARTI.tom, bigf: m * bigf, bigh: m * bigh, twin: m * twin,
    fremmed: f, sten: PARTI.sten, ler: PARTI.ler, let: 0,
  };
}

const tal1 = (v: number) => v.toFixed(1).replace(".", ",");
const tal0 = (v: number) => Math.round(v).toString();

/** Standardnormalfordelt, af to uniforme. Samme som simulatorens. */
export function gauss(r: () => number): number {
  let u = 0;
  while (u === 0) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}
