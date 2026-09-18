"use client";
import { Html, Line } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useRef } from "react";
import type { Mesh } from "three";
import {
  isDone, isIdea, withinPhase, OT_STATUS_LABEL,
  type OtLayout, type OtSelection, type PlacedCabinet, type PlacedGateway, type PlacedIdea,
  type PlacedSensor, type Point3,
} from "../lib/ot";
import type { OtPhase, OtStatus } from "../lib/types";
import type { SceneTheme } from "../lib/useSceneTheme";

interface Props {
  ot: OtLayout;
  theme: SceneTheme;
  /** Kumulativt: fase 2 viser også fase 1. */
  phase: OtPhase;
  showLabels: boolean;
  selected: OtSelection | null;
  hovered: OtSelection | null;
  /** Skitserede sensorer. De tegnes altid — en idé hører ikke til en fase. */
  ideas: PlacedIdea[];
  onSelect: (sel: OtSelection | null) => void;
  onHover: (sel: OtSelection | null) => void;
}

const statusColor = (theme: SceneTheme, s: OtStatus) => theme[`ot-${s}` as const];

// Jo længere fra besluttet, jo mindre fylder tingen. En idé er kun et omrids.
const MARKER_OPACITY: Record<OtStatus, number> = { active: 1, test: 1, ordered: 0.85, planned: 0.72, missing: 0.85, idea: 0.8 };
const MARKER_GLOW: Record<OtStatus, number> = { active: 0.3, test: 0.3, ordered: 0.15, planned: 0.1, missing: 0, idea: 0 };
const CABLE_OPACITY: Record<OtStatus, number> = { active: 0.95, test: 0.95, ordered: 0.7, planned: 0.6, missing: 0.9, idea: 0.28 };
/** Kun det, der er trukket, tegnes med fuld streg. */
const CABLE_DASHED: Record<OtStatus, boolean> = { active: false, test: false, ordered: true, planned: true, missing: true, idea: true };

const same = (a: OtSelection | null, b: OtSelection) => a?.kind === b.kind && a.id === b.id;

/** Tag over en sensor eller et skab — samme udseende som maskinernes. */
function Tag({ position, name, id, on, hot, onSelect, onHover }: {
  position: Point3;
  name: string;
  id?: string;
  on: boolean;
  hot: boolean;
  onSelect: () => void;
  onHover: (v: boolean) => void;
}) {
  return (
    <Html position={position} center zIndexRange={[20, 0]} className="fm-tag-wrap">
      <button
        type="button"
        className={`fm-tag fm-tag-ot${on ? " is-selected" : ""}${hot ? " is-hovered" : ""}`}
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerEnter={() => onHover(true)}
        onPointerLeave={() => onHover(false)}
      >
        <span className="fm-tag-name">{name}</span>
        {id && <span className="fm-tag-id">{id}</span>}
      </button>
    </Html>
  );
}

// ---------------------------------------------------------------------------
function SensorMarker({ s, theme, on, hot, onSelect, onHover }: {
  s: PlacedSensor;
  theme: SceneTheme;
  on: boolean;
  hot: boolean;
  onSelect: () => void;
  onHover: (v: boolean) => void;
}) {
  const head = useRef<Mesh>(null);
  const color = statusColor(theme, s.status);
  const idea = isIdea(s.status);

  useFrame(({ clock }) => {
    // Den sensor der er valgt, trækker vejret — nemmere at følge på afstand.
    if (head.current) {
      const k = on ? 1 + Math.sin(clock.elapsedTime * 3) * 0.12 : hot ? 1.12 : 1;
      head.current.scale.setScalar(k);
    }
  });

  const handlers = {
    onClick: (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(); },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onHover(true); },
    onPointerOut: () => onHover(false),
  };

  return (
    <group position={s.pos!} {...handlers}>
      {/* Beslaget ned mod elevatorens afkast */}
      <mesh position={[0, -0.28, 0]}>
        <cylinderGeometry args={[0.035, 0.035, 0.56, 8]} />
        <meshStandardMaterial color={theme["ot-tray"]} roughness={0.7} transparent opacity={idea ? 0.35 : 1} />
      </mesh>
      <mesh ref={head} castShadow={!idea}>
        <octahedronGeometry args={[0.26]} />
        <meshStandardMaterial
          color={color}
          roughness={0.35}
          metalness={0.25}
          emissive={color}
          emissiveIntensity={on ? 0.75 : hot ? 0.45 : MARKER_GLOW[s.status]}
          // Idéen står som trådnet — man kan se, hvor den ville sidde, uden at
          // den ligner noget, der er købt.
          wireframe={idea}
          transparent
          opacity={MARKER_OPACITY[s.status]}
        />
      </mesh>
      {/* Usynlig klikflade — hovedet er for lille at ramme oppefra */}
      <mesh>
        <boxGeometry args={[1.1, 1.1, 1.1]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
/**
 * En skitseret sensor: samme form som en rigtig, men som trådnet og uden
 * lys — den skal kunne ses, uden at ligne noget der er købt.
 */
function IdeaMarker({ i, theme, hot, onHover }: {
  i: PlacedIdea;
  theme: SceneTheme;
  hot: boolean;
  onHover: (v: boolean) => void;
}) {
  const color = theme["ot-idea"];
  return (
    <group
      position={i.pos!}
      onPointerOver={(e) => { e.stopPropagation(); onHover(true); }}
      onPointerOut={() => onHover(false)}
    >
      <mesh position={[0, -0.28, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.56, 6]} />
        <meshStandardMaterial color={color} roughness={0.7} transparent opacity={0.3} />
      </mesh>
      <mesh scale={hot ? 1.15 : 1}>
        <octahedronGeometry args={[0.24]} />
        <meshStandardMaterial color={color} wireframe transparent opacity={hot ? 0.95 : 0.75} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
function CabinetMesh({ c, theme, on, hot, onSelect, onHover }: {
  c: PlacedCabinet;
  theme: SceneTheme;
  on: boolean;
  hot: boolean;
  onSelect: () => void;
  onHover: (v: boolean) => void;
}) {
  const { x, z, h } = c.size;
  const color = theme["ot-cabinet"];

  const handlers = {
    onClick: (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(); },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onHover(true); },
    onPointerOut: () => onHover(false),
  };

  return (
    <group position={c.pos} {...handlers}>
      <mesh castShadow receiveShadow position={[0, h / 2, 0]}>
        <boxGeometry args={[x, h, z]} />
        <meshStandardMaterial
          color={color}
          roughness={0.5}
          metalness={0.3}
          emissive={theme.accent}
          emissiveIntensity={on ? 0.24 : hot ? 0.12 : 0}
        />
      </mesh>
      {/* Lågens greb, så skabet vender rigtigt */}
      <mesh position={[x * 0.36, h * 0.52, z / 2 + 0.03]}>
        <boxGeometry args={[0.06, 0.34, 0.06]} />
        <meshStandardMaterial color={theme["ot-tray"]} roughness={0.6} metalness={0.4} />
      </mesh>
      <mesh position={[0, h * 0.78, z / 2 + 0.02]}>
        <planeGeometry args={[x * 0.62, 0.16]} />
        <meshBasicMaterial color={theme["scene-bg"]} />
      </mesh>
      {(on || hot) && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[x * 0.95, x * 0.95 + (on ? 0.26 : 0.12), 40]} />
          <meshBasicMaterial color={on ? theme.accent : theme["ot-cabinet"]} transparent opacity={on ? 0.95 : 0.7} />
        </mesh>
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
/**
 * OT-racket står i kontorbygningen, ikke i hallen. Det tegnes som en node
 * uden for væggen med uplinket som streg ind til IO-skabet — så kan man se,
 * at forbindelsen ikke findes, uden at kortet skal foregive at vise et
 * kontorlokale.
 */
function GatewayNode({ g, theme, on, hot, showLabel, onSelect, onHover }: {
  g: PlacedGateway;
  theme: SceneTheme;
  on: boolean;
  hot: boolean;
  showLabel: boolean;
  onSelect: () => void;
  onHover: (v: boolean) => void;
}) {
  const color = statusColor(theme, g.status);
  const absent = !isDone(g.status);
  const h = 1.4;

  const handlers = {
    onClick: (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(); },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onHover(true); },
    onPointerOut: () => onHover(false),
  };

  return (
    <group>
      <Line
        points={g.points}
        color={color}
        lineWidth={on || hot ? 2.6 : 2}
        dashed={absent}
        dashSize={0.6}
        gapSize={0.4}
        transparent
        opacity={absent ? 0.9 : 1}
      />
      <group position={g.pos} {...handlers}>
        <mesh position={[0, h / 2, 0]} castShadow={!absent}>
          <boxGeometry args={[0.8, h, 0.8]} />
          <meshStandardMaterial
            color={color}
            roughness={0.5}
            metalness={0.2}
            // Et rack, der ikke findes, tegnes som trådnet.
            wireframe={absent}
            transparent
            opacity={absent ? 0.85 : 1}
            emissive={color}
            emissiveIntensity={on ? 0.5 : hot ? 0.3 : 0}
          />
        </mesh>
        <mesh>
          <boxGeometry args={[2, 2.4, 2]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
        </mesh>
      </group>
      {showLabel && (
        <Tag
          position={[g.pos[0], h + 0.9, g.pos[2]]}
          name={g.label}
          id={OT_STATUS_LABEL[g.status]}
          on={on}
          hot={hot}
          onSelect={onSelect}
          onHover={onHover}
        />
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
export function OtLayer(p: Props) {
  const { ot, theme } = p;
  const inPhase = withinPhase(p.phase);
  const sensors = ot.sensors.filter((s) => s.pos && inPhase(s));
  // En linje skal have mindst to punkter at tegne imellem.
  const cables = ot.cables.filter((c) => inPhase(c) && c.points.length > 1);

  return (
    <group>
      {/* Bakkerne hører til anlægget, ikke til en fase — de tegnes altid. */}
      {ot.trays.map((t) => (
        <Line
          key={t.id}
          points={t.points}
          color={theme["ot-tray"]}
          lineWidth={3.5}
          transparent
          opacity={0.85}
        />
      ))}

      {cables.map((c) => (
        <Line
          key={c.sensorId}
          points={c.points}
          color={statusColor(theme, c.status)}
          lineWidth={isIdea(c.status) ? 1.1 : 1.6}
          // Kabler, der ikke er trukket endnu, tegnes stiplet.
          dashed={CABLE_DASHED[c.status]}
          dashSize={isIdea(c.status) ? 0.3 : 0.5}
          gapSize={isIdea(c.status) ? 0.45 : 0.35}
          transparent
          opacity={CABLE_OPACITY[c.status]}
        />
      ))}

      {ot.gateway && (
        <GatewayNode
          g={ot.gateway}
          theme={theme}
          showLabel={p.showLabels}
          on={same(p.selected, { kind: "gateway", id: ot.gateway.rack.id })}
          hot={same(p.hovered, { kind: "gateway", id: ot.gateway.rack.id })}
          onSelect={() => p.onSelect({ kind: "gateway", id: ot.gateway!.rack.id })}
          onHover={(v) => p.onHover(v ? { kind: "gateway", id: ot.gateway!.rack.id } : null)}
        />
      )}

      {ot.cabinets.map((c) => {
        const sel: OtSelection = { kind: "cabinet", id: c.id };
        return (
          <group key={c.id}>
            <CabinetMesh
              c={c}
              theme={theme}
              on={same(p.selected, sel)}
              hot={same(p.hovered, sel)}
              onSelect={() => p.onSelect(sel)}
              onHover={(v) => p.onHover(v ? sel : null)}
            />
            {p.showLabels && (
              <Tag
                position={[c.pos[0], c.size.h + 0.75, c.pos[2]]}
                name={c.name}
                id={c.id}
                on={same(p.selected, sel)}
                hot={same(p.hovered, sel)}
                onSelect={() => p.onSelect(sel)}
                onHover={(v) => p.onHover(v ? sel : null)}
              />
            )}
          </group>
        );
      })}

      {/* Idéerne hører ikke til en fase — de er noget, nogen lige har tænkt. */}
      {p.ideas.filter((i) => i.pos).map((i) => (
        <IdeaMarker
          key={i.id}
          i={i}
          theme={theme}
          hot={p.hovered?.kind === "sensor" && p.hovered.id === i.id}
          onHover={(v) => p.onHover(v ? { kind: "sensor", id: i.id } : null)}
        />
      ))}

      {sensors.map((s) => {
        const sel: OtSelection = { kind: "sensor", id: s.id };
        return (
          <group key={s.id}>
            <SensorMarker
              s={s}
              theme={theme}
              on={same(p.selected, sel)}
              hot={same(p.hovered, sel)}
              onSelect={() => p.onSelect(sel)}
              onHover={(v) => p.onHover(v ? sel : null)}
            />
            {p.showLabels && (
              <Tag
                position={[s.pos![0], s.pos![1] + 0.75, s.pos![2]]}
                name={s.id}
                on={same(p.selected, sel)}
                hot={same(p.hovered, sel)}
                onSelect={() => p.onSelect(sel)}
                onHover={(v) => p.onHover(v ? sel : null)}
              />
            )}
          </group>
        );
      })}
    </group>
  );
}
