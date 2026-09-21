"use client";
import { Html } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useRef } from "react";
import type { Group, Mesh } from "three";
import { shortWIds, type PlacedMachine } from "../lib/layout";
import { formFor, shapeFor, type Primitive } from "../lib/machine-form";
import type { SceneTheme } from "../lib/useSceneTheme";

interface Props {
  m: PlacedMachine;
  theme: SceneTheme;
  selected: boolean;
  hovered: boolean;
  related: boolean;
  dimmed: boolean;
  showLabel: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}


function Mat({ color, theme, dimmed, glow }: { color: string; theme: SceneTheme; dimmed: boolean; glow: number }) {
  return (
    <meshStandardMaterial
      color={color}
      roughness={0.62}
      metalness={0.18}
      emissive={theme.accent}
      emissiveIntensity={glow}
      transparent
      opacity={dimmed ? 0.16 : 1}
      depthWrite={!dimmed}
    />
  );
}

/** Ét bærende volumen fra machine-form.ts, tegnet som mesh. */
function Volume({ p, mat, body, steel }: {
  p: Primitive;
  mat: (c: string) => React.ReactNode;
  body: string;
  steel: string;
}) {
  const color = p.steel ? steel : body;
  if (p.form === "box") {
    return (
      <mesh castShadow receiveShadow={p.receive} position={p.at} rotation={p.rot ?? [0, 0, 0]}>
        <boxGeometry args={p.size} />{mat(color)}
      </mesh>
    );
  }
  if (p.form === "cylinder") {
    return (
      <mesh castShadow position={p.at} rotation={p.rot ?? [0, 0, 0]}>
        <cylinderGeometry args={[p.rTop, p.rBottom, p.h, p.sides]} />{mat(color)}
      </mesh>
    );
  }
  return (
    <mesh castShadow position={p.at}>
      <sphereGeometry args={[p.r, 20, 14]} />{mat(color)}
    </mesh>
  );
}

/**
 * Overfladepynt, der ikke hører til silhuetten: CT-scannerens åbning.
 * Hologrammet sampler den ikke — den ændrer ikke på, hvordan maskinen ser
 * ud på afstand.
 */
function ornaments(
  m: PlacedMachine,
  mat: (c: string) => React.ReactNode,
  steel: string,
): React.ReactNode {
  if (m.kind !== "analysis" || !/ct|scanner/i.test(m.name)) return null;
  const { x, z, h } = m.size;
  const bore = Math.min(z, h) * 0.22;
  return (
    <>
      <mesh castShadow position={[x / 2 + 0.02, h * 0.55, 0]} rotation={[0, Math.PI / 2, 0]}>
        <torusGeometry args={[bore, 0.06, 12, 32]} />{mat(steel)}
      </mesh>
      <mesh position={[x / 2 + 0.02, h * 0.55, 0]} rotation={[0, Math.PI / 2, 0]}>
        <circleGeometry args={[bore, 32]} />{mat(steel)}
      </mesh>
    </>
  );
}

export function MachineMesh({ m, theme, selected, hovered, related, dimmed, showLabel, onSelect, onHover }: Props) {
  const ring = useRef<Mesh>(null);
  const group = useRef<Group>(null);
  const glow = selected ? 0.22 : hovered ? 0.12 : 0;
  const { x, z, h } = m.size;
  const body = theme[`m-${m.kind}` as const];
  const steel = theme["m-steel"];
  const mat = (c: string) => <Mat color={c} theme={theme} dimmed={dimmed} glow={glow} />;

  useFrame(({ clock }) => {
    if (ring.current) {
      const s = 1 + Math.sin(clock.elapsedTime * 3) * 0.04;
      ring.current.scale.set(s, s, 1);
    }
  });

  const handlers = {
    onClick: (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(m.id); },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onHover(m.id); },
    onPointerOut: () => onHover(null),
  };

  // Grundformen kommer fra machine-form.ts — samme kilde som hologrammet.
  const prims = formFor({ kind: m.kind, name: m.name, size: m.size, wIdCount: m.wIds.length });
  const parts = (
    <>
      {prims.map((p, i) => (
        <Volume key={i} p={p} mat={mat} body={body} steel={steel} />
      ))}
      {ornaments(m, mat, steel)}
    </>
  );


  const topY = m.kind === "elevator" ? h + 1 : m.kind === "process" ? h + 0.4 : h + 0.2;

  return (
    <group ref={group} position={m.pos} rotation={[0, m.rotY, 0]} {...handlers}>
      {parts}
      {/* usynlig klikflade, så hele fodaftrykket kan rammes */}
      <mesh position={[0, topY / 2, 0]}>
        <boxGeometry args={[Math.max(x, 1.6), topY, Math.max(z, 1.6)]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
      {(selected || related) && (
        <mesh ref={selected ? ring : undefined} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[Math.max(x, z) * 0.78, Math.max(x, z) * 0.78 + (selected ? 0.28 : 0.12), 48]} />
          <meshBasicMaterial color={selected ? theme.accent : theme.flow} transparent opacity={selected ? 0.95 : 0.7} />
        </mesh>
      )}
      {showLabel && !dimmed && (
        <Html position={[0, topY + 0.4, 0]} center zIndexRange={[20, 0]} className="fm-tag-wrap">
          <button
            type="button"
            className={`fm-tag${selected ? " is-selected" : ""}${hovered ? " is-hovered" : ""}`}
            // Stop bobling, så canvas ikke tolker klikket som "klik ved siden af".
            onClick={(e) => { e.stopPropagation(); onSelect(m.id); }}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerEnter={() => onHover(m.id)}
            onPointerLeave={() => onHover(null)}
          >
            <span className="fm-tag-name">{m.name}</span>
            {m.wIds.length > 0 && <span className="fm-tag-id">{shortWIds(m.wIds)}</span>}
          </button>
        </Html>
      )}
    </group>
  );
}
