"use client";
import type { HudLink, HudModel } from "../../lib/ai-hud";

/**
 * Kæden fra måler til agenter, tegnet som et kredsløb.
 *
 * Lyspulser løber kun på de led, der faktisk leverer, og de stopper ved
 * bruddet. Står kæden stille i virkeligheden, står den stille her — der er
 * ingen animation, som ikke svarer til en tilstand i modellen.
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
const H = 130;
/** Knudens halve bredde. Segmenterne går fra kant til kant. */
const NODE = 64;

interface Node {
  x: number;
  label: string;
  link?: HudLink;
  /** Endestationen: agenterne. Den er ikke et led i kæden. */
  terminal?: boolean;
}

function layoutNodes(links: HudLink[]): Node[] {
  const all: Node[] = [
    ...links.map((link) => ({ x: 0, label: link.label, link })),
    { x: 0, label: "Agenter", terminal: true },
  ];
  const step = (W - NODE * 2 - 24) / Math.max(1, all.length - 1);
  return all.map((n, i) => ({ ...n, x: NODE + 12 + i * step }));
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
      r={46}
    />
  );
}

function Segment({ from, to, y, link }: { from: number; to: number; y: number; link: HudLink }) {
  // Et segment lyser kun, hvis leddet før det leverede. Pulsen løber ikke
  // videre forbi bruddet — det er hele pointen.
  const live = link.delivers;
  return (
    <g className={`cc-seg tone-${link.tone}${live ? " is-live" : ""}`}>
      <line x1={from} y1={y} x2={to} y2={y} className="cc-track" />
      {live && (
        <line x1={from} y1={y} x2={to} y2={y} className="cc-pulse" strokeDasharray="14 86" />
      )}
    </g>
  );
}

export function ChainCircuit({ model }: { model: HudModel }) {
  const nodes = layoutNodes(model.links);
  const y = 56;
  if (nodes.length < 2) return null;

  return (
    <div className="cc">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaFor(model)} className="cc-svg">
        {/* Segmenterne tegnes først, så knuderne ligger ovenpå. */}
        {nodes.slice(0, -1).map((n, i) => {
          const link = n.link;
          if (!link) return null;
          return (
            <Segment key={link.id} from={n.x + NODE} to={nodes[i + 1].x - NODE} y={y} link={link} />
          );
        })}

        {nodes.map((n) => {
          const tone = n.terminal ? "moerk" : n.link!.tone;
          const broken = !!n.link?.broken;
          return (
            <g key={n.label} className={`cc-node tone-${tone}${broken ? " is-broken" : ""}`}>
              <Glow x={n.x} y={y} tone={tone} pulse={broken} />
              <rect
                x={n.x - NODE}
                y={y - 24}
                width={NODE * 2}
                height={48}
                rx={6}
                className="cc-box"
              />
              <text x={n.x} y={y + 5} className="cc-label">{short(n.label)}</text>
              {n.link && (
                <text x={n.x} y={y + 46} className="cc-status">{n.link.statusLabel}</text>
              )}
            </g>
          );
        })}
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
