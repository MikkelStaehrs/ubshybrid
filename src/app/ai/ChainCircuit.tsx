"use client";
import type { HudLink, HudModel } from "../../lib/ai-hud";

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
const W = 1600;
const H = 232;
/** Knudens halve bredde. Segmenterne går fra kant til kant. */
const NODE = 88;
/** Luft inden for knudens kant, så tal ikke rører stregen. */
const PAD = 10;

const BOX_TOP = 30;
const BOX_H = 172;
/** Første aflæsning sidder under overskriften og dens skillestreg. */
const FIRST_ROW = BOX_TOP + 62;
const ROW_H = 17;

interface Node {
  x: number;
  label: string;
  link?: HudLink;
  /** Endestationen: agenterne. Den er ikke et led i kæden. */
  terminal?: boolean;
  readings: { label: string; value: string }[];
}

function layoutNodes(model: HudModel): Node[] {
  const all: Omit<Node, "x">[] = [
    ...model.links.map((link) => ({
      label: link.label,
      link,
      readings: link.instrument.readings,
    })),
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
    <circle className={`cc-glow tone-${tone}${pulse ? " is-pulse" : ""}`} cx={x} cy={y} r={58} />
  );
}

/**
 * Et segment mellem to instrumenter.
 *
 * Banen lyser kun, hvis leddet før den leverede. Efter bruddet er den et
 * spøgelse: stiplet og svag, så vejen kan ses uden at se tændt ud.
 */
function Segment({ from, to, y, link, ghost }: {
  from: number;
  to: number;
  y: number;
  link: HudLink;
  ghost: boolean;
}) {
  const live = link.delivers;
  return (
    <g className={`cc-seg tone-${link.tone}${live ? " is-live" : ""}${ghost ? " is-ghost" : ""}`}>
      <line x1={from} y1={y} x2={to} y2={y} className="cc-track" />
      {live && (
        /* Hoved med hale. Hele gruppen skydes langs banen; halen er én
           streg med aftagende alfa, ikke en stak elementer. */
        <g className="cc-spark" style={{ ["--len" as string]: `${to - from}px` }}>
          <line x1={from - 30} y1={y} x2={from} y2={y} className="cc-tail" />
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

function Instrument({ n, reading }: { n: Node; reading?: string }) {
  const tone = n.terminal ? "moerk" : n.link!.tone;
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
    <g className={`cc-node tone-${tone}${broken ? " is-broken" : ""}`}>
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
          <text x={left} y={FIRST_ROW + 4} className="cc-live-value">{reading}</text>
          <text x={right} y={FIRST_ROW + 4} className="cc-sim">SIM</text>
        </>
      )}

      {n.readings.map((r, i) => (
        <g key={r.label}>
          <text x={left} y={rowsTop + i * ROW_H} className="cc-rd-label">{r.label}</text>
          <text x={right} y={rowsTop + i * ROW_H} className="cc-rd-value">{r.value}</text>
        </g>
      ))}

      {inst?.slots && inst.slots.length > 0 && (
        <Slots x={n.x} y={slotsTop} slots={inst.slots} />
      )}

      {venter && (
        <text x={left} y={BOX_TOP + BOX_H - 12} className="cc-waits">Venter · {venter}</text>
      )}
    </g>
  );
}

export function ChainCircuit({ model, reading }: { model: HudModel; reading?: string }) {
  const nodes = layoutNodes(model);
  const y = BOX_TOP + BOX_H / 2;
  if (nodes.length < 2) return null;

  const brudAt = model.links.findIndex((l) => l.broken);
  // Ringen kræver, at der rent faktisk ankommer noget: leddet før bruddet
  // skal levere. Ellers er der ingen puls at blive standset.
  const ringer = brudAt > 0 && model.links[brudAt - 1].delivers;

  return (
    <div className="cc">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaFor(model)} className="cc-svg">
        {/* Segmenterne tegnes først, så knuderne ligger ovenpå. */}
        {nodes.slice(0, -1).map((n, i) => {
          const link = n.link;
          if (!link) return null;
          return (
            <Segment
              key={link.id}
              from={n.x + NODE}
              to={nodes[i + 1].x - NODE}
              y={y}
              link={link}
              ghost={brudAt >= 0 && i >= brudAt}
            />
          );
        })}

        {nodes.map((n) => (
          <Instrument
            key={n.label}
            n={n}
            reading={n.link?.instrument.signalId ? reading : undefined}
          />
        ))}

        {/* Ringen ved bruddet: én pr. ankommende puls. Den deler takt med
            pulsen, så den aldrig slår ud uden at noget er nået frem. */}
        {ringer && <circle className="cc-ring" cx={nodes[brudAt].x - NODE} cy={y} r={9} />}
      </svg>
    </div>
  );
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
