"use client";
import type { HudLink, HudModel } from "../../lib/ai-hud";
import type { KaedeLed, KaedeTal } from "../../lib/telemetri";

/**
 * Kæden fra måler til agenter, som et bånd af instrumenter.
 *
 * Hvert led viser sine egne tal — måler, kanal, registeradresse,
 * kanalpladser, eller hvad det venter på. Ikke en kasse med ét ord: står der
 * et instrument, skal man kunne aflæse det.
 *
 * Lyspulser løber kun på de led, der faktisk leverer, og de stopper ved
 * bruddet. Hver gang en puls rammer bruddet, slår den ud som en ring og dør —
 * én ring pr. ankomst, så ringen stadig er en tilstand og ikke pynt. Leddene
 * efter bruddet er spøgelsesbaner: man kan se hele vejen, der venter på at
 * blive tændt.
 *
 * Kæden viser *hvor* bruddet er. Hvad der skal ske ved det, står i
 * BreakStage midt i scenen — det er sidens vigtigste sætning og hører
 * ikke nede i båndet.
 *
 * SVG frem for WebGL: et diagram med seks knuder skal være skarpt, ikke
 * tredimensionelt, og det koster ingenting at tegne.
 */

// Båndet er bredt og lavt: det ligger på tværs i bunden af skærmen. Formatet
// er valgt, så svg'en kan skalere med fuld bredde uden at blive brevkasset.
const W = 1800;
const H = 200;
/** Knudens halve bredde. Segmenterne går fra kant til kant. */
const NODE = 92;
/** Luft inden for knudens kant, så tal ikke rører stregen. */
const PAD = 10;

const BOX_TOP = 24;
const BOX_H = 158;
/** Første aflæsning sidder under overskriften og dens skillestreg. */
const FIRST_ROW = BOX_TOP + 62;
const ROW_H = 17;

/**
 * Et leds ydelse: hvor meget af sin kapacitet det bruger, og om det er
 * flaskehalsen. Det er en anden akse end status — et led kan være på plads
 * og stadig ikke kunne følge med.
 */
interface Ydelse {
  led: KaedeLed;
  /** Leddet er dér, hvor rækkerne hober sig op. */
  flaskehals: boolean;
  /** Kapaciteten er tilbage, men køen er ikke skrevet endnu. */
  indhenter: boolean;
}

interface Node {
  x: number;
  label: string;
  link?: HudLink;
  /** Endestationen: agenterne. Den er ikke et led i kæden. */
  terminal?: boolean;
  readings: { label: string; value: string; tone?: string }[];
  /** Tallene er simulerede. Instrumentet skal sige det. */
  sim?: boolean;
  ydelse?: Ydelse;
}

const tal = (n: number) => Math.round(n).toLocaleString("da-DK");

/**
 * Kædens egne tal pr. led, når der er nogen. I dag er der ingen — kæden
 * står ikke — så kun fremskrivningen har dem, og de er simulerede.
 *
 * "Plads til" er det tal, der viser, hvor en flaskehals ville opstå: det
 * led, der har plads til færrest signaler, rammer loftet først.
 */
function kaedeTal(id: string, k: KaedeTal | null): Node["readings"] {
  if (!k) return [];
  const led = k.led.find((l) => l.id === id);
  const plads = led ? [{ label: "Plads til", value: `${tal(led.pladsTil)} sign.` }] : [];
  if (id === "kobler") return [{ label: "Poll", value: `${k.pollMs} / ${k.cyklusMs} ms` }, ...plads];
  if (id === "edge") {
    return [
      { label: "Rækker/s", value: tal(k.raekkerPrS) },
      ...(k.koe > 0 ? [{ label: "Kø", value: tal(k.koe), tone: "test" }] : []),
      ...plads,
    ];
  }
  if (id === "mssql") {
    const nede = k.dbKapacitet < k.dbNormal;
    return [
      { label: "Kapacitet", value: `${tal(k.dbKapacitet)} r/s`, tone: nede ? "brud" : undefined },
      k.forsinkelseS >= 1
        ? { label: "Bagud", value: `${Math.round(k.forsinkelseS)} s`, tone: "brud" }
        : { label: "Seneste", value: `${k.senesteMs} ms` },
      ...(k.aarsag ? [{ label: "Årsag", value: k.aarsag, tone: "test" }] : []),
      ...plads,
    ];
  }
  return [];
}

function layoutNodes(model: HudModel, kaede: KaedeTal | null): Node[] {
  const all: Omit<Node, "x">[] = [
    ...model.links.map((link) => {
      const ekstra = kaedeTal(link.id, kaede);
      const led = kaede?.led.find((l) => l.id === link.id);
      return {
        label: link.label,
        link,
        readings: [...link.instrument.readings, ...ekstra],
        sim: ekstra.length > 0,
        ydelse: led && kaede
          ? {
              led,
              flaskehals: kaede.flaskehals === led.id && led.udnyttelse >= 1,
              indhenter: kaede.flaskehals === led.id && led.udnyttelse < 1,
            }
          : undefined,
      };
    }),
    {
      label: "Agenter",
      terminal: true,
      // Endestationen har også et tal: hvor mange der venter på kæden.
      readings: [{ label: "Besluttet", value: String(model.decided) }],
    },
  ];
  const step = (W - NODE * 2 - 40) / Math.max(1, all.length - 1);
  return all.map((n, i) => ({ ...n, x: NODE + 20 + i * step }));
}

/**
 * Gløden er et selvstændigt, forblødt element. Den bliver aldrig animeret
 * med et filter på — kun dens opacity ændrer sig, og det koster ingenting.
 */
function Glow({ x, y, tone, pulse }: { x: number; y: number; tone: string; pulse: boolean }) {
  return (
    <circle
      className={`cc-glow tone-${tone}${pulse ? " is-pulse" : ""}`}
      cx={x}
      cy={y}
      r={70}
      fill={`url(#cc-glod-${tone})`}
    />
  );
}

/**
 * Glødens gradienter, én pr. tone. En gradient tegnes én gang; et
 * sløringsfilter skulle regnes om, hver gang gløden ændrede styrke.
 */
const GLOD: Record<string, string> = {
  drift: "#6fe0c2", test: "#ffc766", brud: "#ff6f5c", moerk: "#25332f",
};
function GlodDefs() {
  return (
    <defs>
      {Object.entries(GLOD).map(([tone, farve]) => (
        <radialGradient key={tone} id={`cc-glod-${tone}`}>
          <stop offset="0%" stopColor={farve} stopOpacity={0.9} />
          <stop offset="100%" stopColor={farve} stopOpacity={0} />
        </radialGradient>
      ))}
    </defs>
  );
}

/**
 * Et segment mellem to instrumenter.
 *
 * Banen lyser kun, hvis leddet før den leverede. Efter bruddet er den et
 * spøgelse: stiplet og svag, så vejen kan ses uden at se tændt ud.
 */
/**
 * Køen foran en flaskehals: én blok pr. så mange ventende rækker. Den vokser,
 * mens leddet ikke kan følge med, og skrumper, mens det indhenter.
 */
const RAEKKER_PR_BLOK = 500;

function Segment({ from, to, y, link, ghost, koe, traeg }: {
  from: number;
  to: number;
  y: number;
  link: HudLink;
  ghost: boolean;
  /** Rækker, der venter foran næste led. 0 når der ingen kø er. */
  koe: number;
  /** Hvor meget langsommere rækkerne kommer igennem end normalt. 1 er normalt. */
  traeg: number;
}) {
  const live = link.delivers;
  const blokke = Math.min(9, Math.ceil(koe / RAEKKER_PR_BLOK));
  return (
    <g className={`cc-seg tone-${link.tone}${live ? " is-live" : ""}${ghost ? " is-ghost" : ""}${blokke ? " has-koe" : ""}`}>
      <line x1={from} y1={y} x2={to} y2={y} className="cc-track" />
      {Array.from({ length: blokke }, (_, i) => (
        <rect key={i} x={to - 10 - i * 9} y={y - 4} width={7} height={8} className="cc-koe" />
      ))}
      {live && (
        /* Hoved med hale. Hele gruppen skydes langs banen; halen er én
           streg med aftagende alfa, ikke en stak elementer. Farten følger,
           hvor hurtigt rækkerne faktisk kommer igennem. */
        <g
          className="cc-spark"
          style={{ ["--len" as string]: `${to - from}px`, ["--varighed" as string]: `${(1.8 * traeg).toFixed(2)}s` }}
        >
          <line x1={from - 30} y1={y} x2={from} y2={y} className="cc-tail" />
          <circle cx={from} cy={y} r={9} className="cc-head-glod" />
          <circle cx={from} cy={y} r={3.6} className="cc-head" />
        </g>
      )}
    </g>
  );
}

/** Kanalpladserne på IO-kortet. Optagede er fyldte, resten er tomme. */
function Slots({ x, y, slots }: {
  x: number;
  y: number;
  slots: { name: string; used: boolean }[];
}) {
  const PER_ROW = 12;
  const PITCH = (NODE * 2 - PAD * 2) / PER_ROW;
  return (
    <g className="cc-slots">
      {slots.map((s, i) => (
        <rect
          key={s.name}
          x={x - NODE + PAD + (i % PER_ROW) * PITCH}
          y={y + Math.floor(i / PER_ROW) * PITCH}
          width={PITCH - 4}
          height={PITCH - 4}
          className={s.used ? "cc-slot is-used" : "cc-slot"}
        >
          <title>{`${s.name}: ${s.used ? "optaget" : "ledig"}`}</title>
        </rect>
      ))}
    </g>
  );
}

/** Farven på en udnyttelse: grøn med luft, rav tæt på loftet, rød over. */
const udnyttelsesTone = (u: number) => (u >= 1 ? "brud" : u >= 0.8 ? "test" : "drift");

/** Målerens aflæsning: procenten, og W/HR når 100 %-punktet findes. */
export interface Aflaesning { tekst: string; whr?: string }

function Instrument({ n, reading, sim }: { n: Node; reading?: Aflaesning; sim?: boolean }) {
  const tone = n.terminal ? "moerk" : n.link!.tone;
  const y = n.ydelse;
  // Bruddet og flaskehalsen er to forskellige ting. Et brud er et led, der
  // ikke findes; en flaskehals er et led, der findes, men ikke kan følge
  // med. De får hver deres udtryk — flaskehalsen sit eget mærke og sin egen
  // ramme, ikke bruddets bankende glød.
  const broken = !!n.link?.broken;
  const inst = n.link?.instrument;
  // IO-kortet venter på skabet selv, ikke på en infrastrukturnode — og det
  // står som `next` på bruddet. Derfor faldes der tilbage til den.
  const venter = n.link && !n.link.delivers ? (n.link.next ?? inst?.waits) : undefined;

  const left = n.x - NODE + PAD;
  const right = n.x + NODE - PAD;
  // Aflæsningen står øverst, når der er en. Resten rykker ned under den.
  const rowsTop = FIRST_ROW + (reading ? 24 : 0);
  const slotsTop = rowsTop + n.readings.length * ROW_H - 4;

  return (
    <g className={`cc-node tone-${tone}${broken ? " is-broken" : ""}${y?.flaskehals ? " is-flaskehals" : ""}`}>
      <Glow x={n.x} y={BOX_TOP + BOX_H / 2} tone={tone} pulse={broken} />
      <rect x={n.x - NODE} y={BOX_TOP} width={NODE * 2} height={BOX_H} className="cc-box" />

      <text x={left} y={BOX_TOP + 26} className="cc-label">{short(n.label)}</text>
      {n.link && (
        <text x={right} y={BOX_TOP + 26} className="cc-status">{n.link.statusLabel}</text>
      )}
      <line x1={left} y1={BOX_TOP + 38} x2={right} y2={BOX_TOP + 38} className="cc-rule" />

      {/* Aflæsningen fra måleren. Den kommer fra simulatoren, så den er
          mærket — et tal uden mærkat ville ligne noget, kæden havde leveret. */}
      {reading && (
        <>
          <text x={left} y={FIRST_ROW + 4} className="cc-live-value">{reading.tekst}</text>
          {reading.whr && <text x={right} y={FIRST_ROW + 4} className="cc-live-whr">{reading.whr}</text>}
          {/* SIM står i bunden, så den ikke støder ind i W/HR. */}
          {sim !== false && <text x={right} y={BOX_TOP + BOX_H - 8} className="cc-sim">SIM</text>}
        </>
      )}

      {n.readings.map((r, i) => (
        <g key={r.label}>
          <text x={left} y={rowsTop + i * ROW_H} className="cc-rd-label">{r.label}</text>
          <text x={right} y={rowsTop + i * ROW_H} className={`cc-rd-value${r.tone ? ` rd-${r.tone}` : ""}`}>{r.value}</text>
        </g>
      ))}

      {/* Udnyttelsen: hvor meget af sin kapacitet leddet bruger. Bjælken
          stopper ved kanten; tallet siger, hvor langt over den er. */}
      {y && (
        <g className={`cc-udny u-${udnyttelsesTone(y.led.udnyttelse)}`}>
          <text x={left} y={BOX_TOP + BOX_H - 30} className="cc-rd-label">Udnyttelse</text>
          <text x={right} y={BOX_TOP + BOX_H - 30} className="cc-udny-tal">{Math.round(y.led.udnyttelse * 100)} %</text>
          <rect x={left} y={BOX_TOP + BOX_H - 25} width={right - left} height={4} className="cc-udny-spor" />
          <rect
            x={left}
            y={BOX_TOP + BOX_H - 25}
            width={(right - left) * Math.min(1, y.led.udnyttelse)}
            height={4}
            className="cc-udny-fyld"
          />
        </g>
      )}

      {/* Flaskehalsen får sit eget mærke over kassen. Status forbliver
          "på plads" — leddet findes; det kan bare ikke følge med. */}
      {(y?.flaskehals || y?.indhenter) && (
        <g className={`cc-flag${y.flaskehals ? " is-flaskehals" : " is-indhenter"}`}>
          <rect x={n.x - 62} y={BOX_TOP - 19} width={124} height={15} className="cc-flag-bg" />
          <text x={n.x} y={BOX_TOP - 8} className="cc-flag-tekst">{y.flaskehals ? "Flaskehals" : "Indhenter"}</text>
        </g>
      )}

      {inst?.slots && inst.slots.length > 0 && (
        <Slots x={n.x} y={slotsTop} slots={inst.slots} />
      )}

      {venter && (
        <>
          <text x={left} y={BOX_TOP + BOX_H - 34} className="cc-rd-label">Venter</text>
          {ombryd(venter, 29).map((linje, i) => (
            <text key={i} x={left} y={BOX_TOP + BOX_H - 21 + i * 12} className="cc-waits">{linje}</text>
          ))}
        </>
      )}
      {n.sim && !venter && (
        <text x={right} y={BOX_TOP + BOX_H - 8} className="cc-sim">SIM</text>
      )}
    </g>
  );
}

export function ChainCircuit({ model, reading, kaede = null, sim }: {
  model: HudModel;
  reading?: Aflaesning;
  kaede?: KaedeTal | null;
  /** Er aflæsningen simuleret? Så mærkes den. */
  sim?: boolean;
}) {
  const nodes = layoutNodes(model, kaede);
  const y = BOX_TOP + BOX_H / 2;
  if (nodes.length < 2) return null;

  const brudAt = model.links.findIndex((l) => l.broken);
  // Ringen kræver, at der rent faktisk ankommer noget: leddet før bruddet
  // skal levere. Ellers er der ingen puls at blive standset.
  const ringer = brudAt > 0 && model.links[brudAt - 1].delivers;

  return (
    <div className="cc">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaFor(model)} className="cc-svg">
        <GlodDefs />
        {/* Segmenterne tegnes først, så knuderne ligger ovenpå. */}
        {nodes.slice(0, -1).map((n, i) => {
          const link = n.link;
          if (!link) return null;
          // Køen står foran flaskehalsen. Pulserne ind i den og ud af den
          // går langsommere — rækkerne kommer ikke hurtigere igennem, end
          // databasen kan skrive dem.
          const naeste = nodes[i + 1].link?.id;
          const iKoe = kaede && naeste && kaede.flaskehals === naeste ? kaede.koe : 0;
          const traeg = kaede && (naeste === kaede.flaskehals || link.id === kaede.flaskehals)
            ? Math.min(4, kaede.raekkerPrS / Math.max(1, kaede.dbKapacitet) * (kaede.koe > 0 ? 1.6 : 1))
            : 1;
          return (
            <Segment
              key={link.id}
              from={n.x + NODE}
              to={nodes[i + 1].x - NODE}
              y={y}
              link={link}
              ghost={brudAt >= 0 && i >= brudAt}
              koe={iKoe}
              traeg={Math.max(1, traeg)}
            />
          );
        })}

        {nodes.map((n) => (
          <Instrument
            key={n.label}
            n={n}
            reading={n.link?.instrument.signalId ? reading : undefined}
            sim={sim}
          />
        ))}

        {/* Ringen ved bruddet: én pr. ankommende puls. Den deler takt med
            pulsen, så den aldrig slår ud uden at noget er nået frem. */}
        {ringer && <circle className="cc-ring" cx={nodes[brudAt].x - NODE} cy={y} r={9} />}
      </svg>
    </div>
  );
}

/**
 * Ombryd en tekst til højst to linjer af `bredde` tegn. SVG-tekst ombrydes
 * ikke af sig selv, og et navn, der løber ud over instrumentets kant, ser
 * ud som en fejl.
 */
function ombryd(tekst: string, bredde: number): string[] {
  const linjer: string[] = [];
  let cur = "";
  for (const ord of tekst.split(" ")) {
    const naeste = cur ? `${cur} ${ord}` : ord;
    if (naeste.length > bredde && cur) { linjer.push(cur); cur = ord; }
    else cur = naeste;
  }
  if (cur) linjer.push(cur);
  if (linjer.length <= 2) return linjer;
  const anden = linjer.slice(1).join(" ");
  return [linjer[0], anden.length > bredde ? `${anden.slice(0, bredde - 1)}…` : anden];
}

/** Kortere navne i kasserne — den fulde tekst står i aria-labelen. */
function short(label: string): string {
  if (label === "Feltbus-kobler") return "Kobler";
  return label;
}

function ariaFor(m: HudModel): string {
  const parts = m.links.map((l) => `${l.label}: ${l.statusLabel}`);
  const tail = m.broken
    ? `Kæden stopper ved ${m.broken.label}.${m.broken.next ? ` Afventer ${m.broken.next}.` : ""}`
    : "Hele kæden leverer.";
  return `Signalkæden fra måler til agenter. ${parts.join(". ")}. ${tail}`;
}
