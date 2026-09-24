// Prøvetagningen, som kontoret ser den: CT-køen, kastebordenes seneste svar
// med de kilo godt frø, der er gået ud, og videometeret med sorteringen.
//
// Linjeskærmen regner det af sit billede og sender det; kontoret regner
// intet selv. Der står intet her, laboratoriet ikke har svaret, eller
// simuleringen ikke har regnet.
import { KASTEBORD, PROEVER } from "../../data/fremskrivning";
import { ctMulti, ctPris, graenseFor, type CtSvar, type Fraktion, type ProeveSted } from "./proever";
import type { ProeveSvar, TelemetriBillede } from "./telemetri";

/** Et CT-svar, skåret ned til det, kontoret viser. */
export interface SvarKort {
  taget: number;
  godt: number;
  multi: number;
  frag: number;
  /** Gode frø pr. uønsket — prisen i Heavy og Light. */
  pris: number;
  notsStk: number;
  mg: number | null;
  /** "over": Ready uden for bordets grænse. "fejl": det sidste bords Ready — færdigvaren. */
  niveau: "ok" | "over" | "fejl";
}

export interface BordRaekke {
  maskine: string;
  kort: string;
  lane: string;
  /** Pladsen i sporet: 0 er det første. */
  bord: number;
  ready: SvarKort | null;
  heavy: SvarKort | null;
  light: SvarKort | null;
  /** Godt frø ud i Heavy og Light over ordren, og lige nu i timen. Skøn. */
  tabKg: number | null;
  tabKgPrT: number | null;
}

export interface ProeveOverblik {
  ct: {
    igang: { navn: string; opnr: string | null; svarT: number } | null;
    naeste: { navn: string; opnr: string | null }[];
    taget: number;
    sprunget: number;
    /** En runde gennem den faste plan, i minutter. */
    rundeMin: number;
  };
  jetpealere: { lane: string; navn: string; opnr: string | null; svar: SvarKort | null }[];
  borde: BordRaekke[];
  /** Kastebordenes tab over ordren. Skøn: mængden til siderne er ikke vejet. */
  tab: { godtKg: number; godtIndKg: number; readyKg: number } | null;
  videometer: {
    igang: { kasse: number; svarT: number } | null;
    seneste: { kasse: number; stk: number; arter: { art: string; stk: number }[]; slibeskader: number; taget: number } | null;
    hoej: number;
    lav: number;
  };
  /** Sorteringen på Triørerne. */
  sortering: "normal" | "kraftig";
}

const opnr = (s: ProeveSted) => s.proevested?.operationsnr ?? null;

function kort(p: ProeveSvar, c: CtSvar, sidste: boolean): SvarKort {
  const f = p.sted.fraktion;
  const g = p.sted.bord !== null ? graenseFor(p.sted.bord) : null;
  const over = f === "ready" && !!g && (ctMulti(c) > g.readyMulti || c.frag > g.readyFrag);
  return {
    taget: p.taget, godt: c.godt, multi: ctMulti(c), frag: c.frag, pris: ctPris(c), notsStk: c.notsStk, mg: c.mg,
    niveau: over ? (sidste ? "fejl" : "over") : "ok",
  };
}

/** Kontorets prøveboks af linjeskærmens billede. null uden en ordre. */
export function proeveOverblik(b: TelemetriBillede): ProeveOverblik | null {
  if (!b.ordre) return null;
  const lab = b.laboratorie;
  const svarFra = (maskine: string | null, fraktion: Fraktion | null) =>
    lab.seneste.filter((p) => p.ct && p.sted.maskine === maskine && p.sted.fraktion === fraktion).sort((x, y) => y.taget - x.taget)[0] ?? null;

  // Bordene i hvert spor, i den rækkefølge frøet når dem. Simulatoren ved
  // det fra tegningen og har skrevet det på regnskabet og på prøvestederne.
  const kbs = b.maskiner.filter((m) => KASTEBORD.test(m.navn) && m.lane);
  const plads = (id: string) =>
    b.tab?.borde.find((x) => x.maskine === id)?.bord ?? lab.seneste.find((p) => p.sted.maskine === id)?.sted.bord ?? Infinity;
  const lanes = [...new Set(kbs.map((m) => m.lane!))].sort();
  const borde: BordRaekke[] = [];
  for (const lane of lanes) {
    const iSpor = kbs.filter((m) => m.lane === lane).sort((x, y) => plads(x.id) - plads(y.id));
    iSpor.forEach((m, i) => {
      const sidste = i === iSpor.length - 1;
      const svar = (f: Fraktion) => {
        const p = svarFra(m.id, f);
        return p ? kort(p, p.ct!, sidste) : null;
      };
      const t = b.tab?.borde.find((x) => x.maskine === m.id) ?? null;
      borde.push({
        maskine: m.id, kort: m.kort, lane, bord: i,
        ready: svar("ready"), heavy: svar("heavy"), light: svar("light"),
        tabKg: t ? t.heavyGodtKg + t.lightGodtKg : null,
        tabKgPrT: t ? t.godtKgPrT : null,
      });
    });
  }

  const jetpealere = lab.seneste
    .filter((p) => p.ct && p.sted.fraktion === null && p.sted.lane)
    .reduce((acc, p) => (acc.some((x) => x.sted.id === p.sted.id && x.taget >= p.taget) ? acc : [...acc.filter((x) => x.sted.id !== p.sted.id), p]), [] as ProeveSvar[])
    .sort((x, y) => x.sted.lane!.localeCompare(y.sted.lane!))
    .map((p) => ({ lane: p.sted.lane!, navn: p.sted.navn, opnr: opnr(p.sted), svar: kort(p, p.ct!, false) }));

  const vm = lab.seneste.filter((p) => p.videometer).sort((x, y) => y.taget - x.taget)[0] ?? null;
  const tab = b.tab;
  return {
    ct: {
      igang: lab.ct.igang ? { navn: lab.ct.igang.sted.navn, opnr: opnr(lab.ct.igang.sted), svarT: lab.ct.igang.svarT } : null,
      naeste: lab.ct.naeste.map((s) => ({ navn: s.navn, opnr: opnr(s) })),
      taget: lab.ct.taget,
      sprunget: lab.sprunget,
      rundeMin: PROEVER.ctPlan.length * PROEVER.ct.minutter,
    },
    jetpealere,
    borde,
    tab: tab ? { godtKg: tab.godtKg, godtIndKg: tab.godtIndKg, readyKg: tab.readyKg } : null,
    videometer: {
      igang: lab.videometer.igang ? { kasse: lab.videometer.igang.kasse, svarT: lab.videometer.igang.svarT } : null,
      seneste: vm?.videometer
        ? {
            kasse: (vm.kasse ?? 0) + 1,
            stk: vm.videometer.fremmedIalt,
            arter: Object.entries(vm.videometer.fremmed).filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1]).map(([art, stk]) => ({ art, stk })),
            slibeskader: vm.videometer.slibeskader,
            taget: vm.taget,
          }
        : null,
      hoej: PROEVER.videometer.fremmedHoej,
      lav: PROEVER.videometer.fremmedLav,
    },
    sortering: Object.values(b.sortering).some((x) => x === "kraftig") ? "kraftig" : "normal",
  };
}

/** Andelen af det gode frø, der er gået ud i Heavy og Light. null før der er kommet noget ind. */
export const tabPct = (t: NonNullable<ProeveOverblik["tab"]>) => (t.godtIndKg > 0 ? (t.godtKg / t.godtIndKg) * 100 : null);
