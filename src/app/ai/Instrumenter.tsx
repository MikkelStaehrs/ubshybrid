"use client";
import { useEffect, useRef, useState } from "react";
import { FAULT_HIGH_MA, FAULT_LOW_MA, NOMINAL_HIGH_MA, NOMINAL_LOW_MA } from "../../lib/live-source";

/**
 * Instrumenterne på HUD'en. Håndtegnet SVG — ingen diagrambibliotek.
 *
 * Bevægelse her er altid en ændring i et tal: en viser, der glider fra den
 * gamle værdi til den nye, en kurve, der rykker et skridt, når en ny prøve
 * kommer ind. Intet tæller op for syns skyld, og intet bevæger sig, når
 * tallet står stille.
 */

/**
 * Dansk talformat med tusindtalsseparator — "6.403", ikke "6403". Én
 * formatter pr. antal decimaler, så den ikke bygges forfra hver frame.
 */
const FORMAT = new Map<number, Intl.NumberFormat>();
const komma = (v: number, d: number) => {
  let f = FORMAT.get(d);
  if (!f) {
    f = new Intl.NumberFormat("da-DK", { minimumFractionDigits: d, maximumFractionDigits: d });
    FORMAT.set(d, f);
  }
  return f.format(v);
};

// ---------------------------------------------------------------------------

/** Tal, der er på vej fra én værdi til en anden. Én løkke driver dem alle. */
interface Glid { node: Text; a: number; b: number; start: number; d: number; vist: { v: number | null } }
const glider = new Map<Text, Glid>();
let loekke = 0;

function glid(nu: number) {
  for (const g of glider.values()) {
    const t = Math.min(1, (nu - g.start) / 260);
    const x = g.a + (g.b - g.a) * (1 - (1 - t) ** 3);
    g.node.nodeValue = komma(x, g.d);
    g.vist.v = x;
    if (t >= 1) glider.delete(g.node);
  }
  loekke = glider.size > 0 ? requestAnimationFrame(glid) : 0;
}

/**
 * Et tal, der glider mod sin nye værdi i stedet for at hoppe.
 *
 * Glidningen er kort og følger værdien — den tæller ikke op fra nul ved
 * første visning. Er værdien null, står der en streg.
 *
 * React tegner tallet én gang. Derefter skrives det direkte i tekstnoden af
 * én fælles animationsløkke, så et tal, der ændrer sig, ikke får hele
 * siden til at blive tegnet om hver frame.
 */
export function Tal({ v, d = 1, className }: { v: number | null; d?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  // Det, der står lige nu — også midt i en glidning.
  const vist = useRef<{ v: number | null }>({ v });
  // React skal aldrig røre teksten efter første gang. Samme streng hver
  // gang, så den ikke overskriver det, løkken har skrevet.
  const foerste = useRef(v === null ? "—" : komma(v, d));

  useEffect(() => {
    const node = ref.current?.firstChild;
    if (!(node instanceof Text)) return;
    const fra = vist.current.v;
    // Ved ro springer tallet direkte til sin nye værdi. Det er stadig et tal,
    // der ændrer sig — bare uden glidning.
    const ro = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (ro || v === null || fra === null) {
      glider.delete(node);
      node.nodeValue = v === null ? "—" : komma(v, d);
      vist.current.v = v;
      return;
    }
    glider.set(node, { node, a: fra, b: v, start: performance.now(), d, vist: vist.current });
    if (!loekke) loekke = requestAnimationFrame(glid);
  }, [v, d]);

  useEffect(() => () => {
    const node = ref.current?.firstChild;
    if (node instanceof Text) glider.delete(node);
  }, []);

  return <span ref={ref} className={className}>{foerste.current}</span>;
}

// ---------------------------------------------------------------------------

/**
 * Radial måler. 240° bue med de aftalte zoner tegnet i baggrunden, så man
 * kan se, hvor værdien ligger i forhold til det normale — ikke bare tallet.
 */
export function Maaler({ v, min, max, zoner, enhed, d = 1, tone, label }: {
  v: number | null;
  min: number;
  max: number;
  /** Farvede bånd på skalaen: [fra, til, klasse]. */
  zoner?: [number, number, string][];
  enhed: string;
  d?: number;
  /** Visertonen: "drift", "test", "brud", "moerk". */
  tone: string;
  label?: string;
}) {
  const R = 44;
  const C = 60;
  const SWEEP = 240;
  const START = 90 + (360 - SWEEP) / 2; // bunden er åben
  const andel = (x: number) => Math.max(0, Math.min(1, (x - min) / (max - min)));
  const punkt = (a: number, r = R) => {
    const rad = ((START + a * SWEEP) * Math.PI) / 180;
    return [C + Math.cos(rad) * r, C + Math.sin(rad) * r] as const;
  };
  const bue = (a0: number, a1: number, r = R) => {
    const [x0, y0] = punkt(a0, r);
    const [x1, y1] = punkt(a1, r);
    const stor = (a1 - a0) * SWEEP > 180 ? 1 : 0;
    return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${stor} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
  };
  const a = v === null ? 0 : andel(v);
  const [nx, ny] = punkt(a, R);
  const streger = Array.from({ length: 13 }, (_, i) => i / 12);

  return (
    <div className={`m-maaler tone-${tone}`}>
      <svg viewBox="0 0 120 108" className="m-svg" aria-hidden>
        <path d={bue(0, 1)} className="m-spor" />
        {zoner?.map(([f, t, k]) => <path key={k} d={bue(andel(f), andel(t), R + 7)} className={`m-zone z-${k}`} />)}
        {streger.map((s, i) => {
          // Hver tredje streg er lang: skalaen i fjerdedele.
          const lang = i % 3 === 0;
          const [x0, y0] = punkt(s, R - 5);
          const [x1, y1] = punkt(s, lang ? R - 11 : R - 8);
          return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} className={lang ? "m-streg is-lang" : "m-streg"} />;
        })}
        {v !== null && (
          <>
            <path d={bue(0, Math.max(0.001, a))} className="m-fyld-glod" />
            <path d={bue(0, Math.max(0.001, a))} className="m-fyld" />
            <circle cx={nx} cy={ny} r={6} className="m-spids-glod" />
            <circle cx={nx} cy={ny} r={3.2} className="m-spids" />
          </>
        )}
      </svg>
      <div className="m-tal">
        <Tal v={v} d={d} className="m-vaerdi" />
        <span className="m-enhed">{enhed}</span>
        {label && <span className="m-label">{label}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * En kurve over historikken. Huller er huller: en prøve uden måling bryder
 * linjen i stedet for at blive trukket til nul.
 */
export function Kurve({ serie, min, max, tone = "drift", hoejde = 34, graense }: {
  serie: (number | null)[];
  min?: number;
  max?: number;
  tone?: string;
  hoejde?: number;
  /** Vandrette hjælpelinjer, fx en alarmgrænse. */
  graense?: number[];
}) {
  const W = 200;
  const H = hoejde;
  const tal = serie.filter((v): v is number => v !== null);
  if (tal.length < 2) return <div className="m-kurve is-tom" style={{ height: H }} />;
  let lo = min ?? Math.min(...tal);
  let hi = max ?? Math.max(...tal);
  if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.12;
  if (min === undefined) lo -= pad;
  if (max === undefined) hi += pad;
  const x = (i: number) => (i / Math.max(1, serie.length - 1)) * W;
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * (H - 4) - 2;

  const stykker: string[] = [];
  let cur = "";
  serie.forEach((v, i) => {
    if (v === null) { if (cur) stykker.push(cur); cur = ""; return; }
    cur += `${cur ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  });
  if (cur) stykker.push(cur);
  const sidste = [...serie].reverse().find((v) => v !== null) ?? null;
  const flade = stykker.length === 1 && serie[0] !== null
    ? `${stykker[0]}L${W},${H}L0,${H}Z`
    : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={`m-kurve tone-${tone}`} style={{ height: H }} aria-hidden>
      {graense?.map((g) => g >= lo && g <= hi && (
        <line key={g} x1={0} x2={W} y1={y(g)} y2={y(g)} className="m-graense" />
      ))}
      {flade && <path d={flade} className="m-flade" />}
      {stykker.map((d, i) => <path key={i} d={d} className="m-linje" vectorEffect="non-scaling-stroke" />)}
      {sidste !== null && serie[serie.length - 1] !== null && (
        <circle cx={W} cy={y(sidste)} r={2.2} className="m-prik" />
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------

/**
 * Oscilloskopet for strømsløjfen: det rå signal i mA, med sløjfens fire
 * grænser trukket op. Så kan man se med egne øjne, om et fald er et stop
 * (ned til 4 mA) eller en fejl (under 3,6).
 */
export function Oscilloskop({ serie }: { serie: (number | null)[] }) {
  const W = 300;
  const H = 96;
  const LO = 2.8;
  const HI = 21.8;
  const y = (ma: number) => H - ((ma - LO) / (HI - LO)) * H;
  const x = (i: number) => (i / Math.max(1, serie.length - 1)) * W;

  let d = "";
  serie.forEach((v, i) => {
    if (v === null) return;
    const vv = Math.max(LO, Math.min(HI, v));
    d += `${d ? "L" : "M"}${x(i).toFixed(1)},${y(vv).toFixed(1)}`;
  });
  const sidste = serie.length ? serie[serie.length - 1] : null;
  const fejl = sidste !== null && (sidste < FAULT_LOW_MA || sidste > FAULT_HIGH_MA);

  const linjer: [number, string, string][] = [
    [FAULT_HIGH_MA, "21", "fejl"],
    [NOMINAL_HIGH_MA, "20", "nom"],
    [NOMINAL_LOW_MA, "4", "nom"],
    [FAULT_LOW_MA, "3,6", "fejl"],
  ];

  return (
    <div className={`m-scope${fejl ? " is-fejl" : ""}`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
        {/* Gitteret: ét lodret skridt pr. 10 sekunder ved fire prøver i sekundet. */}
        {Array.from({ length: 6 }, (_, i) => (
          <line key={i} x1={(i / 6) * W} x2={(i / 6) * W} y1={0} y2={H} className="m-gitter" />
        ))}
        {/* Fejlzonerne uden for sløjfen. */}
        <rect x={0} y={0} width={W} height={y(FAULT_HIGH_MA)} className="m-fejlzone" />
        <rect x={0} y={y(FAULT_LOW_MA)} width={W} height={H - y(FAULT_LOW_MA)} className="m-fejlzone" />
        {linjer.map(([ma, , k]) => (
          <line key={ma} x1={0} x2={W} y1={y(ma)} y2={y(ma)} className={`m-ma m-ma-${k}`} vectorEffect="non-scaling-stroke" />
        ))}
        {/* Glød som en bredere, svag streg — ikke et filter, der skal regnes om hver takt. */}
        {d && <path d={d} className="m-spor-glod" vectorEffect="non-scaling-stroke" />}
        {d && <path d={d} className="m-spor-linje" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="m-scope-akse">
        {linjer.map(([ma, t, k]) => (
          <span key={ma} className={`m-ma-lbl m-ma-${k}`} style={{ top: `${(y(ma) / H) * 100}%` }}>{t}</span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Fire klasser, der summer til hundrede, som ét bånd. */
export function Fordeling({ andele, navne, alarm }: {
  andele: number[] | null;
  navne: readonly string[];
  alarm?: boolean;
}) {
  if (!andele) {
    return <div className="m-fordeling is-tom"><span>Afventer signal</span></div>;
  }
  return (
    <div className={`m-fordeling${alarm ? " is-alarm" : ""}`}>
      <div className="m-bånd">
        {andele.map((p, i) => (
          <span key={navne[i]} className={`m-del d-${i}`} style={{ width: `${p}%` }} />
        ))}
      </div>
      <div className="m-akse">
        {andele.map((p, i) => (
          <span key={navne[i]} className={`m-klasse d-${i}`}>
            <b>{navne[i]}</b>
            <Tal v={p} d={1} />
            <i>%</i>
          </span>
        ))}
      </div>
    </div>
  );
}

/** En vandret bjælke med en valgfri alarmgrænse tegnet ind. */
export function Bjaelke({ v, max, graense, alarm }: {
  v: number | null;
  max: number;
  graense?: number;
  alarm?: boolean;
}) {
  const p = v === null ? 0 : Math.max(0, Math.min(1, v / max)) * 100;
  return (
    <span className={`m-bjaelke${alarm ? " is-alarm" : ""}${v === null ? " is-tom" : ""}`}>
      {/* scaleX frem for bredde: en bredde, der ændrer sig, tvinger browseren
          til at regne layout om for hver frame, en transform gør ikke. */}
      <span className="m-bjaelke-fyld" style={{ transform: `scaleX(${p / 100})` }} />
      {graense !== undefined && <span className="m-bjaelke-graense" style={{ left: `${(graense / max) * 100}%` }} />}
    </span>
  );
}

// ---------------------------------------------------------------------------

/**
 * Tekst, der afkodes tegn for tegn ved opstart. Det er grænsefladen, der
 * kommer til syne — ikke data. Tallene på skærmen bliver aldrig kodet om.
 */
export function Afkod({ tekst, forsinkelse = 0, still }: { tekst: string; forsinkelse?: number; still?: boolean }) {
  const [vist, setVist] = useState(still ? tekst : "");
  useEffect(() => {
    if (still) { setVist(tekst); return; }
    const TEGN = "▚▞▟▙█▓▒░/\\|<>+=#";
    let raf = 0;
    const start = performance.now() + forsinkelse;
    const varighed = 420 + tekst.length * 18;
    const trin = (nu: number) => {
      const t = (nu - start) / varighed;
      if (t < 0) { raf = requestAnimationFrame(trin); return; }
      if (t >= 1) { setVist(tekst); return; }
      const fast = Math.floor(t * tekst.length);
      let s = tekst.slice(0, fast);
      for (let i = fast; i < tekst.length; i++) {
        s += tekst[i] === " " ? " " : TEGN[(Math.random() * TEGN.length) | 0];
      }
      setVist(s);
      raf = requestAnimationFrame(trin);
    };
    raf = requestAnimationFrame(trin);
    return () => cancelAnimationFrame(raf);
  }, [tekst, forsinkelse, still]);
  return <>{vist}</>;
}
