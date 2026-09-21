"use client";
import { Html, Line } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import {
  decidedAgents, describeScope, sharedInlet, AGENT_STATUS_LABEL, type AgentState,
} from "../lib/agents";
import { halfExtent, type PlacedMachine } from "../lib/layout";
import { isDone, type OtLayout, type Point3 } from "../lib/ot";
import type { SceneTheme } from "../lib/useSceneTheme";

interface Props {
  states: AgentState[];
  ot: OtLayout | null;
  theme: SceneTheme;
  selectedId: string | null;
  /** true når fælleszonen er valgt. Den ejes ikke af nogen agent. */
  inletSelected: boolean;
  showLabels: boolean;
  onSelect: (agentId: string | null) => void;
  onSelectInlet: () => void;
}

type ColorToken = Exclude<keyof SceneTheme, "dark">;

/** Tre agentfarver, der går rundt. Den fjerde agent får den første igen. */
export const agentToken = (i: number): ColorToken => `agent-${(i % 3) + 1}` as ColorToken;

interface Zone {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Gulvfladen under en flok maskiner, med luft omkring — som sporzonerne. */
function zoneOf(ms: PlacedMachine[], pad = 1.8): Zone | null {
  if (ms.length === 0) return null;
  return {
    x0: Math.min(...ms.map((m) => m.pos[0] - halfExtent(m).x)) - pad,
    x1: Math.max(...ms.map((m) => m.pos[0] + halfExtent(m).x)) + pad,
    z0: Math.min(...ms.map((m) => m.pos[2] - halfExtent(m).z)) - pad,
    z1: Math.max(...ms.map((m) => m.pos[2] + halfExtent(m).z)) + pad,
  };
}

const rect = (z: Zone, y: number): Point3[] => [
  [z.x0, y, z.z0], [z.x1, y, z.z0], [z.x1, y, z.z1], [z.x0, y, z.z1], [z.x0, y, z.z0],
];

function ZoneTag({ position, name, sub, className, onSelect }: {
  position: Point3;
  name: string;
  sub?: string;
  className: string;
  onSelect?: () => void;
}) {
  return (
    <Html position={position} center zIndexRange={[20, 0]} className="fm-tag-wrap">
      <button
        type="button"
        className={`fm-tag fm-tag-zone ${className}`}
        disabled={!onSelect}
        onClick={(e) => { e.stopPropagation(); onSelect?.(); }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span className="fm-tag-name">{name}</span>
        {sub && <span className="fm-tag-id">{sub}</span>}
      </button>
    </Html>
  );
}

/**
 * En agents område på gulvet. Kanten er stiplet, når agenten mangler sine
 * inputs — samme sprog som OT-laget: stiplet er noget, der ikke er der endnu.
 */
function AgentZone({ st, zone, color, on, showLabel, onSelect }: {
  st: AgentState;
  zone: Zone;
  color: string;
  on: boolean;
  showLabel: boolean;
  onSelect: () => void;
}) {
  const missing = st.status === "missing";
  const cx = (zone.x0 + zone.x1) / 2;
  const cz = (zone.z0 + zone.z1) / 2;
  // Skiltet står på den kant, der vender væk fra midten — ikke oven i maskinerne.
  const tagZ = cz < 0 ? zone.z0 + 1.1 : zone.z1 - 1.1;
  const handlers = {
    onClick: (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(); },
  };
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0.016, cz]} {...handlers}>
        <planeGeometry args={[zone.x1 - zone.x0, zone.z1 - zone.z0]} />
        <meshBasicMaterial color={color} transparent opacity={on ? 0.32 : missing ? 0.12 : 0.2} depthWrite={false} />
      </mesh>
      <Line
        points={rect(zone, 0.03)}
        color={color}
        lineWidth={on ? 2.6 : 1.6}
        dashed={missing}
        dashSize={0.7}
        gapSize={0.45}
        transparent
        opacity={on ? 1 : 0.85}
      />
      {showLabel && (
        <ZoneTag
          position={[cx, 0.5, tagZ]}
          name={st.agent.name}
          sub={AGENT_STATUS_LABEL[st.status]}
          className={`ags-${st.status}${on ? " is-selected" : ""}`}
          onSelect={onSelect}
        />
      )}
    </group>
  );
}

/**
 * Vagtagenten har ingen maskiner. Den markerer leddene i signalkæden:
 * IO-skabet i hallen og racket udenfor, med uplinket imellem.
 */
function ChainMarks({ st, ot, color, on, showLabel, onSelect }: {
  st: AgentState;
  ot: OtLayout;
  color: string;
  on: boolean;
  showLabel: boolean;
  onSelect: () => void;
}) {
  const cab = ot.cabinets[0];
  const gw = ot.gateway;
  if (!cab) return null;
  const missing = st.status === "missing";
  const handlers = {
    onClick: (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(); },
  };
  const disc = (pos: Point3, key: string) => (
    <mesh key={key} rotation={[-Math.PI / 2, 0, 0]} position={[pos[0], 0.03, pos[2]]} {...handlers}>
      <ringGeometry args={[1.1, 1.1 + (on ? 0.3 : 0.16), 48]} />
      <meshBasicMaterial color={color} transparent opacity={on ? 1 : 0.8} />
    </mesh>
  );
  const box = (pos: Point3, size: [number, number, number], absent: boolean, key: string) => (
    <mesh key={key} position={[pos[0], size[1] / 2, pos[2]]} {...handlers}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} wireframe={absent} transparent opacity={absent ? 0.7 : 0.9} />
    </mesh>
  );
  const anchor = gw ? gw.pos : cab.pos;
  return (
    <group>
      {box(cab.pos, [cab.size.x, cab.size.h, cab.size.z], !isDone(cab.status), "cab")}
      {disc(cab.pos, "cab-disc")}
      {gw && (
        <>
          {box(gw.pos, [0.8, 1.4, 0.8], !isDone(gw.status), "rack")}
          {disc(gw.pos, "rack-disc")}
          <Line
            points={gw.points}
            color={color}
            lineWidth={on ? 2.6 : 1.8}
            dashed={missing}
            dashSize={0.6}
            gapSize={0.4}
            transparent
            opacity={0.9}
          />
        </>
      )}
      {showLabel && (
        <ZoneTag
          position={[anchor[0], gw ? 2.6 : cab.size.h + 1, anchor[2]]}
          name={st.agent.name}
          sub={`${describeScope(st.agent)} · ${AGENT_STATUS_LABEL[st.status]}`}
          className={`ags-${st.status}${on ? " is-selected" : ""}`}
          onSelect={onSelect}
        />
      )}
    </group>
  );
}

export function AgentLayer({
  states, ot, theme, selectedId, inletSelected, showLabels, onSelect, onSelectInlet,
}: Props) {
  // Indløbet er fælles for de agenter, der har det som upstream. Tegnes én
  // gang, og teksten kommer fra samme kilde som panelet bag den.
  const shared = sharedInlet(states);
  const inlet = shared ? zoneOf(shared.machines, 1.4) : null;
  const sharedColor = theme["agent-shared"];

  return (
    <group>
      {inlet && shared && (
        <group>
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[(inlet.x0 + inlet.x1) / 2, 0.014, (inlet.z0 + inlet.z1) / 2]}
            onClick={(e) => { e.stopPropagation(); onSelectInlet(); }}
          >
            <planeGeometry args={[inlet.x1 - inlet.x0, inlet.z1 - inlet.z0]} />
            <meshBasicMaterial color={sharedColor} transparent opacity={inletSelected ? 0.22 : 0.1} depthWrite={false} />
          </mesh>
          <Line
            points={rect(inlet, 0.028)}
            color={sharedColor}
            lineWidth={inletSelected ? 2.4 : 1.2}
            transparent
            opacity={inletSelected ? 1 : 0.7}
          />
          {showLabels && (
            <ZoneTag
              position={[(inlet.x0 + inlet.x1) / 2, 0.5, inlet.z0 + 1.1]}
              name="Fælles indløb"
              sub={`upstream for ${shared.sharedBy}`}
              className={`ags-shared${inletSelected ? " is-selected" : ""}`}
              onSelect={onSelectInlet}
            />
          )}
        </group>
      )}

      {/* Kun besluttede agenter tegnes. En idé har intet område at have. */}
      {decidedAgents(states).map((st, i) => {
        const color = theme[agentToken(i)];
        const on = selectedId === st.agent.id;
        if (st.agent.scope.kind === "chain") {
          return ot ? (
            <ChainMarks key={st.agent.id} st={st} ot={ot} color={color} on={on} showLabel={showLabels} onSelect={() => onSelect(st.agent.id)} />
          ) : null;
        }
        const zone = zoneOf(st.machines);
        return zone ? (
          <AgentZone key={st.agent.id} st={st} zone={zone} color={color} on={on} showLabel={showLabels} onSelect={() => onSelect(st.agent.id)} />
        ) : null;
      })}
    </group>
  );
}
